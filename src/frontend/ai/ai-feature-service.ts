import { Dialog } from "siyuan";
import type { AiFeatureId, AiProposal } from "../../shared/ai";
import { completeAiReviewGroups, parseAiJson, validateAiProposal } from "../../shared/ai";
import type { TaskCacheEntry, ReviewData } from "../../shared/types";
import type { KernelBridge } from "../kernel-bridge";
import { taskStore } from "../stores/task-store";
import { notifyError, notifyInfo } from "../notify";
import { get } from "svelte/store";

interface AiServiceHost {
    bridge: KernelBridge;
    i18n: any;
    getCurrentDocumentId?: () => string;
}

let host: AiServiceHost | null = null;
const AI_REQUEST_TIMEOUT_MS = 120_000;
const MAX_MY_DAY_CANDIDATES = 40;
// 回顾是最容易把大量上下文发送给模型的功能。限制条目并压缩字段，
// 避免请求体过大导致首 token 等待过久。
const MAX_REVIEW_TASKS = 100;
const MAX_REVIEW_GROUP_ITEMS = 36;

class AiRawResponseError extends Error {
    readonly raw: string;
    readonly details: string;

    constructor(raw: string, details = "") {
        super("AI 返回内容无法使用");
        this.name = "AiRawResponseError";
        this.raw = raw;
        this.details = details;
    }
}

export function initAiFeatureService(next: AiServiceHost): void {
    host = next;
}

function requireHost(): AiServiceHost {
    if (!host) throw new Error("AI feature service is not initialized");
    return host;
}

function showRawAiResponse(title: string, raw: string, details = ""): void {
    const dialog = new Dialog({
        title,
        content: `<div class="nextaction na-ai-raw-response">${details ? `<div class="na-ai-raw-response__hint"></div>` : ""}<pre style="max-height: 60vh; overflow: auto; white-space: pre-wrap; user-select: text;"></pre></div>`,
        width: "520px",
    });
    const pre = dialog.element.querySelector("pre");
    if (pre) pre.textContent = raw;
    const hint = dialog.element.querySelector(".na-ai-raw-response__hint");
    if (hint) hint.textContent = details;
}

function showAiLoading(title: string): { close: () => void } {
    const dialog = new Dialog({
        title,
        content: `<div class="nextaction na-ai-loading"><span class="na-ai-loading__spinner"></span><strong>正在请求思源 AI…</strong><small>根据内容量和模型响应速度，可能需要一些时间</small></div>`,
        width: "360px",
        hideCloseIcon: true,
    });
    dialog.element.classList.add("nextaction", "na-ai-dialog", "na-ai-loading-dialog");
    dialog.element.querySelector(".b3-dialog")?.classList.add("nextaction", "na-ai-dialog", "na-ai-loading-dialog");
    let closed = false;
    return {
        close: () => {
            if (closed) return;
            closed = true;
            if (!dialog.element.isConnected) return;
            dialog.destroy();
        },
    };
}

function taskSnapshot(task: TaskCacheEntry): Record<string, unknown> {
    return {
        blockId: task.blockId,
        title: task.title,
        status: task.status,
        priority: task.priority,
        importance: task.importance,
        effort: task.effort,
        start: task.start || null,
        due: task.due || null,
        context: task.context || "",
        tags: task.tags || "",
        parentId: task.parentId || null,
        childCount: task.childIds?.length || 0,
        depends: task.depends || "",
        blocked: task.blocked,
        blockedReason: task.blockedReason || null,
        reviewDate: task.reviewDate || null,
        note: task.note ? task.note.slice(0, 500) : "",
    };
}

function reviewSnapshot(task: TaskCacheEntry): Record<string, unknown> {
    return {
        blockId: task.blockId,
        title: task.title.slice(0, 180),
        status: task.status,
        priority: task.priority,
        importance: task.importance,
        effort: task.effort,
        start: task.start || null,
        due: task.due || null,
        context: task.context ? task.context.slice(0, 120) : "",
        parentId: task.parentId || null,
        blocked: task.blocked,
        blockedReason: task.blockedReason || null,
        reviewDate: task.reviewDate || null,
        childCount: task.childIds?.length || 0,
    };
}

function buildReviewContext(review: ReviewData): Record<string, unknown> {
    const sourceGroups: Array<[string, TaskCacheEntry[]]> = [
        ["overdue", review.overdueTasks],
        ["nextActions", review.nextActions],
        ["inbox", review.inboxTasks],
        ["waiting", review.waitingTasks],
        ["someday", review.somedayTasks],
        ["activeProjects", review.activeProjects],
        ["reviewDue", review.reviewDueTasks],
    ];
    const taskMap = new Map<string, Record<string, unknown>>();
    const groups: Record<string, string[]> = {};
    for (const [key, entries] of sourceGroups) {
        groups[key] = entries.slice(0, MAX_REVIEW_GROUP_ITEMS).map(task => {
            if (!taskMap.has(task.blockId) && taskMap.size < MAX_REVIEW_TASKS) {
                taskMap.set(task.blockId, reviewSnapshot(task));
            }
            return task.blockId;
        });
    }
    return {
        groups,
        tasks: Array.from(taskMap.values()),
        truncated: taskMap.size >= MAX_REVIEW_TASKS || sourceGroups.some(([, entries]) => entries.length > MAX_REVIEW_GROUP_ITEMS),
    };
}

function completeReviewProposal(proposal: AiProposal, context: Record<string, unknown>, i18n: any): AiProposal {
    const groups = context.groups;
    if (!groups || typeof groups !== "object" || Array.isArray(groups)) return proposal;
    return completeAiReviewGroups(proposal, groups as Record<string, string[]>, {
        overdue: i18n?.aiReviewOverdue || "逾期",
        nextActions: i18n?.aiReviewNextActions || "下一步行动",
        inbox: i18n?.aiReviewInbox || "收件箱",
        waiting: i18n?.aiReviewWaiting || "等待中",
        someday: i18n?.aiReviewSomeday || "将来/也许",
        activeProjects: i18n?.aiReviewProjects || "活跃项目",
        reviewDue: i18n?.aiReviewDue || "待回顾",
    });
}

async function callSiyuanAi(blockIds: string[], action: string): Promise<string> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
        response = await fetch("/api/ai/chatGPTWithAction", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: blockIds, action }),
            signal: controller.signal,
        });
    } catch (error: any) {
        if (error?.name === "AbortError") throw new Error("AI 请求超时，请检查思源 AI Provider 或网络连接");
        throw error;
    } finally {
        window.clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`SiYuan AI HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.code !== 0) throw new Error(payload?.msg || "SiYuan AI is not configured");
    const text = typeof payload?.data === "string" ? payload.data.trim() : "";
    if (!text) throw new Error("SiYuan AI returned an empty response");
    return text;
}

function promptFor(feature: AiFeatureId, context: unknown): string {
    const taskSchema = `"tasks": [{"title":"任务标题","kind":"task|project","sourceBlockId":"可选的现有源块ID","parentId":"可选的现有父任务ID","dependsOnIndexes":[0],"status":"可选状态","priority":"可选优先级","importance":4,"effort":4,"start":null,"due":null,"contexts":[],"tags":[],"note":null,"reason":"原因"}]`;
    const featureSchema: Record<AiFeatureId, string> = {
        extractTasks: taskSchema,
        decomposeTask: taskSchema,
        planMyDay: `"myDay": [{"blockId":"上下文中已有的任务块ID","reason":"加入今天的原因"}]`,
        review: `"review": {"summary":"总结","groups":[{"key":"inbox","title":"分组标题","summary":"分组说明"}],"actions":[{"blockId":"上下文中已有的任务块ID","action":"建议","reason":"原因"}]}`,
    };
    const schema = `只返回 JSON，不要 markdown，不要解释。结构必须符合：
{
  "feature": "${feature}",
  "summary": "简短中文总结",
  ${featureSchema[feature]},
  "warnings": []
}
只填写当前功能需要的字段。${feature === "extractTasks" || feature === "decomposeTask"
        ? "新生成的任务尚未有独立 blockId；不要为新任务虚构 blockId，只保留 sourceBlockId、parentId 和 dependsOnIndexes。不要输出 myDay 或 review。"
        : feature === "review"
            ? "groups 只返回 key、title、summary，不要返回 blockIds，任务分组由插件根据本地数据填充；actions.blockId 只能引用上下文中已有的任务 blockId，不要虚构。不要输出 tasks。"
            : "只能引用上下文中已有的任务 blockId，不要虚构 blockId。不要输出 tasks。"} 信息不足时留空或放入 warnings。`;
    const instructions: Record<AiFeatureId, string> = {
        extractTasks: "从提供的笔记内容中识别真正可执行的任务和项目。保留来源块 ID；不要把背景、观点或资料当成任务。",
        decomposeTask: "把目标拆成少量、明确、可执行的子任务；第一项应是当前真正的下一步行动。使用 dependsOnIndexes 表示必要顺序。",
        planMyDay: "从候选任务中挑选今天最值得加入 My Day 的任务。只返回建议加入的 blockId，不安排时间，不修改任务属性。",
        review: "按 GTD 回顾分组分析任务。上下文中的 groups 保存本地分组与任务 ID 的映射，tasks 保存去重后的任务摘要；只返回每个分组的观察、风险和处理建议，不要重复返回任务 ID。指出积压、等待、将来/也许、逾期和缺少下一步行动的项目。只生成报告。",
    };
    return `${instructions[feature]}\n\n${schema}\n\n上下文：\n${JSON.stringify(context)}`;
}

async function requestProposal(feature: AiFeatureId, ids: string[], context: unknown): Promise<AiProposal> {
    let lastRaw = "";
    let lastErrors: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
        const retryInstruction = attempt === 0
            ? ""
            : `\n\n这是第 2 次尝试。上一次返回内容无法使用（${lastErrors.join("；") || "不是合法 JSON"}）。请重新生成，必须只返回一个完整 JSON 对象，不要 markdown、不要代码围栏、不要前后解释。`;
        const raw = await callSiyuanAi(ids, promptFor(feature, context) + retryInstruction);
        lastRaw = raw;
        const parsed = parseAiJson(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            lastErrors = ["返回内容不是 JSON 对象"];
            continue;
        }
        const candidate = parsed as Record<string, unknown>;
        if (!candidate.feature) candidate.feature = feature;
        if (typeof candidate.summary !== "string" || !candidate.summary.trim()) {
            candidate.summary = feature === "review" ? "AI 回顾建议" : "AI 建议结果";
        }
        const validation = validateAiProposal(candidate);
        if (!validation.errors.length) return validation.proposal;
        lastErrors = validation.errors;
    }
    throw new AiRawResponseError(lastRaw, lastErrors.join("；"));
}

async function openComponent(title: string, loader: () => Promise<any>, props: Record<string, unknown>): Promise<void> {
    const dialog = new Dialog({
        title,
        content: `<div class="nextaction na-ai-dialog-host"></div>`,
        width: "520px",
        destroyCallback: () => {
            const component = (dialog as any)._naAiComponent;
            component?.$destroy?.();
        },
    });
    dialog.element.classList.add("nextaction", "na-ai-dialog");
    dialog.element.querySelector(".b3-dialog")?.classList.add("nextaction", "na-ai-dialog");
    const hostElement = dialog.element.querySelector(".na-ai-dialog-host");
    if (!hostElement) {
        dialog.destroy();
        throw new Error("AI 结果窗口无法打开，请重新加载插件后再试");
    }
    const module = await loader();
    const Component = module.default;
    const component = new Component({ target: hostElement, props: { ...props, dialog } });
    (dialog as any)._naAiComponent = component;
}

export async function runAiExtractTasks(blockIds: string[]): Promise<void> {
    const { bridge, i18n } = requireHost();
    const loading = showAiLoading(i18n?.aiExtractTasks || "AI 提取任务");
    try {
        const proposal = await requestProposal("extractTasks", blockIds, { sourceBlockIds: blockIds });
        if (!proposal.target) proposal.target = { type: "mcp_default" };
        await openComponent(i18n?.aiExtractTasks || "AI 提取任务", () => import("../components/AiProposalDialog.svelte"), {
            proposal,
            bridge,
            i18n,
            defaultDocumentId: host?.getCurrentDocumentId?.(),
            onDone: () => taskStore.loadTasks(),
        });
    } catch (error: any) {
        console.error("[NextAction] AI extract failed:", error);
        if (error instanceof AiRawResponseError) showRawAiResponse(i18n?.ai || "AI", error.raw, error.details);
        else notifyError(error?.message || String(error));
    } finally {
        loading.close();
    }
}

export async function runAiDecomposeTask(task: TaskCacheEntry): Promise<void> {
    const { bridge, i18n } = requireHost();
    const loading = showAiLoading(i18n?.aiDecomposeTask || "AI 拆解任务");
    try {
        const state = get(taskStore);
        const children = state.allTasks.filter(item => item.parentId === task.blockId).map(taskSnapshot);
        const proposal = await requestProposal("decomposeTask", [task.blockId], { task: taskSnapshot(task), children });
        if (!proposal.target) proposal.target = { type: "mcp_default" };
        if (proposal.tasks) proposal.tasks = proposal.tasks.map(item => ({ ...item, parentId: item.parentId ?? task.blockId }));
        await openComponent(i18n?.aiDecomposeTask || "AI 拆解任务", () => import("../components/AiProposalDialog.svelte"), {
            proposal,
            bridge,
            i18n,
            defaultDocumentId: host?.getCurrentDocumentId?.(),
            onDone: () => taskStore.loadTasks(),
        });
    } catch (error: any) {
        console.error("[NextAction] AI decompose failed:", error);
        if (error instanceof AiRawResponseError) showRawAiResponse(i18n?.ai || "AI", error.raw, error.details);
        else notifyError(error?.message || String(error));
    } finally {
        loading.close();
    }
}

export async function runAiPlanMyDay(): Promise<void> {
    const { bridge, i18n } = requireHost();
    const loading = showAiLoading(i18n?.aiPlanMyDay || "自动规划我的一天");
    try {
        const state = get(taskStore);
        const existing = new Set((state.myDayState?.tasks || []).map(item => item.blockId));
        const candidates = (await bridge.getNextActions())
            .filter(task => !existing.has(task.blockId) && task.status !== "done" && task.status !== "someday" && !task.blocked)
            .slice(0, MAX_MY_DAY_CANDIDATES)
            .map(taskSnapshot);
        const proposal = await requestProposal("planMyDay", [], { existingMyDay: [...existing], candidates });
        await openComponent(i18n?.aiPlanMyDay || "自动规划我的一天", () => import("../components/AiProposalDialog.svelte"), {
            proposal,
            bridge,
            i18n,
            onDone: () => taskStore.loadMyDay(),
            myDayOnly: true,
        });
    } catch (error: any) {
        console.error("[NextAction] AI My Day planning failed:", error);
        if (error instanceof AiRawResponseError) showRawAiResponse(i18n?.ai || "AI", error.raw, error.details);
        else notifyError(error?.message || String(error));
    } finally {
        loading.close();
    }
}

export async function runAiReview(): Promise<void> {
    const { bridge, i18n } = requireHost();
    const loading = showAiLoading(i18n?.aiReview || "智能回顾");
    try {
        const review = await bridge.getReviewData();
        const reviewContext = buildReviewContext(review);
        const proposal = completeReviewProposal(await requestProposal("review", [], reviewContext), reviewContext, i18n);
        const reviewTaskMap = new Map<string, TaskCacheEntry>();
        for (const task of [
            ...review.overdueTasks,
            ...review.nextActions,
            ...review.inboxTasks,
            ...review.waitingTasks,
            ...review.somedayTasks,
            ...review.activeProjects,
            ...review.reviewDueTasks,
        ]) {
            reviewTaskMap.set(task.blockId, task);
        }
        const reviewTasks = Array.from(reviewTaskMap.values());
        await openComponent(i18n?.aiReview || "智能回顾", () => import("../components/AiReviewDialog.svelte"), { proposal, bridge, i18n, reviewTasks });
    } catch (error: any) {
        console.error("[NextAction] AI review failed:", error);
        if (error instanceof AiRawResponseError) showRawAiResponse(i18n?.ai || "AI", error.raw, error.details);
        else notifyError(error?.message || String(error));
    } finally {
        loading.close();
    }
}

export function isAiAvailable(): boolean {
    return !!host;
}
