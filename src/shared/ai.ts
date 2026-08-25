import { ALL_STATUSES, PRIORITY_WEIGHTS, TASK_TYPE_PROJECT, TASK_TYPE_TASK } from "./constants";
import { isBlockId } from "./block-id";
import type { MyDayState, TaskCacheEntry } from "./types";

export type AiFeatureId = "extractTasks" | "decomposeTask" | "planMyDay" | "review";

export type AiWriteTargetType =
    "original" | "source_document" | "current_document" | "document" | "mcp_default" | "child" | "source_child";

export interface AiWriteTarget {
    type: AiWriteTargetType;
    documentId?: string;
    /** 子块落点对应的逻辑父任务块 ID。 */
    parentBlockId?: string;
}

export interface AiProposedTask {
    title: string;
    kind?: "task" | "project";
    sourceBlockId?: string;
    parentId?: string | null;
    dependsOnIndexes?: number[];
    status?: string;
    priority?: string;
    importance?: number;
    effort?: number;
    start?: string | null;
    due?: string | null;
    contexts?: string[];
    tags?: string[];
    note?: string | null;
    outcome?: string | null;
    dod?: string | null;
    actionKind?: "action" | "stage" | null;
    reason?: string;
}

export interface AiMyDaySuggestion {
    blockId: string;
    reason: string;
}

export interface AiReviewGroup {
    key: string;
    title: string;
    summary: string;
    blockIds: string[];
}

export interface AiReviewReport {
    summary: string;
    groups: AiReviewGroup[];
    actions: Array<{ blockId: string; action: string; reason: string }>;
}

export interface AiProposal {
    feature: AiFeatureId;
    summary: string;
    target?: AiWriteTarget;
    tasks?: AiProposedTask[];
    myDay?: AiMyDaySuggestion[];
    review?: AiReviewReport;
    warnings?: string[];
}

export interface AiProposalContext {
    sourceBlockIds?: string[];
    defaultProjectId?: string;
}

export type AiProposalApplyItemStatus = "created" | "converted" | "failed" | "partial";

export interface AiProposalApplyItemResult {
    index: number;
    sourceBlockId?: string;
    target: AiWriteTargetType;
    status: AiProposalApplyItemStatus;
    task?: TaskCacheEntry;
    error?: string;
    retryable: boolean;
}

export interface AiProposalApplyResult {
    feature: AiProposal["feature"];
    created: TaskCacheEntry[];
    converted: TaskCacheEntry[];
    myDay: MyDayState | null;
    warnings: string[];
    items: AiProposalApplyItemResult[];
}

export interface AiPlanValidationResult {
    proposal: AiProposal;
    errors: string[];
}

/**
 * 用本地回顾数据重建固定分组。
 * 模型只负责摘要和判断，任务归属与数量由插件确定，避免出现
 * “待回顾 0”这类与本地回顾清单不一致的结果。
 */
export function completeAiReviewGroups(
    proposal: AiProposal,
    sourceGroups: Record<string, string[]>,
    groupTitles: Record<string, string> = {},
): AiProposal {
    if (proposal.feature !== "review" || !proposal.review) return proposal;

    const aiGroups = new Map(proposal.review.groups.map((group) => [group.key, group]));
    const knownKeys = new Set(Object.keys(sourceGroups));
    const groups = Object.entries(sourceGroups).map(([key, sourceIds]) => {
        const aiGroup = aiGroups.get(key);
        return {
            key,
            title: aiGroup?.title || groupTitles[key] || key,
            summary: aiGroup?.summary || "",
            // blockIds 是确定性数据，始终以本地回顾结果为准。
            blockIds: sourceIds.filter((blockId): blockId is string => typeof blockId === "string" && !!blockId),
        };
    });
    // 兼容旧版模型可能返回的额外分析分组；这些分组不是固定清单，保留其 AI 内容。
    for (const group of proposal.review.groups) {
        if (!knownKeys.has(group.key)) groups.push(group);
    }
    proposal.review = { ...proposal.review, groups };
    return proposal;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/;
const PRIORITIES = new Set(Object.keys(PRIORITY_WEIGHTS));

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function isValidDate(value: string): boolean {
    if (!DATE_RE.test(value)) return false;
    const [datePart, timePart = "00:00"] = value.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart.split(":").map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, 0, 0);
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day &&
        date.getUTCHours() === hour &&
        date.getUTCMinutes() === minute
    );
}

function normalizeStringList(value: unknown, field: string, errors: string[]): string[] | undefined {
    // 提示词协议使用 null 表示“未提供”。将其视为空值而不是非法数组，
    // 这样模型返回 null 时不会因为可选字段导致整份提案无法写入。
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value)) {
        errors.push(`${field} must be an array`);
        return undefined;
    }
    const result: string[] = [];
    for (const item of value) {
        if (typeof item !== "string") {
            errors.push(`${field} items must be strings`);
            continue;
        }
        const normalized = item.trim();
        if (normalized && !result.includes(normalized)) result.push(normalized);
    }
    if (result.length > 50) errors.push(`${field} must contain at most 50 items`);
    return result;
}

function normalizeOptionalScale(value: unknown): number | undefined {
    // importance / effort 在 JSON 协议中允许使用 null 表示未知；
    // 其他非空值仍原样交给后续校验，以继续拒绝字符串、小数和越界数值。
    return value === null || value === undefined ? undefined : (value as number);
}

export function validateAiProposal(input: unknown, context: AiProposalContext = {}): AiPlanValidationResult {
    const errors: string[] = [];
    if (!isRecord(input))
        return { proposal: { feature: "review", summary: "" }, errors: ["proposal must be an object"] };

    const feature = input.feature;
    if (!["extractTasks", "decomposeTask", "planMyDay", "review"].includes(String(feature))) {
        errors.push("feature is invalid");
    }
    const proposal: AiProposal = {
        feature: (feature as AiFeatureId) || "review",
        summary: typeof input.summary === "string" ? input.summary.trim() : "",
        target: isRecord(input.target)
            ? {
                  type: input.target.type as AiWriteTargetType,
                  documentId: typeof input.target.documentId === "string" ? input.target.documentId : undefined,
                  parentBlockId:
                      typeof input.target.parentBlockId === "string" ? input.target.parentBlockId : undefined,
              }
            : undefined,
        warnings: Array.isArray(input.warnings)
            ? input.warnings.filter((item): item is string => typeof item === "string")
            : undefined,
    };
    if (!proposal.summary || proposal.summary.length > 4000) errors.push("summary must contain 1-4000 characters");

    if (
        proposal.target &&
        ![
            "original",
            "source_document",
            "current_document",
            "document",
            "mcp_default",
            "child",
            "source_child",
        ].includes(proposal.target.type)
    ) {
        errors.push("target.type is invalid");
    }
    if (proposal.target?.type === "document" && !isBlockId(proposal.target.documentId || "")) {
        errors.push("target.documentId is required for document target");
    }
    if (proposal.target?.type === "child" && !isBlockId(proposal.target.parentBlockId || "")) {
        errors.push("target.parentBlockId is required for child target");
    }

    if (proposal.feature === "review") {
        if (!isRecord(input.review)) {
            errors.push("review is required for review proposals");
        } else {
            const reviewInput = input.review;
            const groups = Array.isArray(reviewInput.groups) ? reviewInput.groups : [];
            const actions = Array.isArray(reviewInput.actions) ? reviewInput.actions : [];
            proposal.review = {
                summary: typeof reviewInput.summary === "string" ? reviewInput.summary : proposal.summary,
                groups: groups.map((group, index) => {
                    const value = isRecord(group) ? group : {};
                    return {
                        key: typeof value.key === "string" ? value.key : `group-${index + 1}`,
                        title: typeof value.title === "string" ? value.title : "",
                        summary: typeof value.summary === "string" ? value.summary : "",
                        blockIds: Array.isArray(value.blockIds)
                            ? value.blockIds.filter((id: unknown): id is string => typeof id === "string")
                            : [],
                    };
                }),
                actions: actions.map((action) => {
                    const value = isRecord(action) ? action : {};
                    return {
                        blockId: typeof value.blockId === "string" ? value.blockId : "",
                        action: typeof value.action === "string" ? value.action : "",
                        reason: typeof value.reason === "string" ? value.reason : "",
                    };
                }),
            };
            for (const group of proposal.review.groups) {
                for (const id of group.blockIds)
                    if (!isBlockId(id)) errors.push("review group contains invalid block ID");
            }
            for (const action of proposal.review.actions)
                if (!isBlockId(action.blockId)) errors.push("review action contains invalid block ID");
        }
        return { proposal, errors };
    }

    if (proposal.feature === "planMyDay") {
        const suggestions = Array.isArray(input.myDay) ? input.myDay : [];
        proposal.myDay = suggestions.map((item) => {
            const value = isRecord(item) ? item : {};
            return {
                blockId: typeof value.blockId === "string" ? value.blockId : "",
                reason: typeof value.reason === "string" ? value.reason : "",
            };
        });
        if (proposal.myDay.length > 100) errors.push("myDay must contain at most 100 items");
        for (const item of proposal.myDay) if (!isBlockId(item.blockId)) errors.push("myDay contains invalid block ID");
        return { proposal, errors };
    }

    const rawTasks = Array.isArray(input.tasks) ? input.tasks : [];
    if (rawTasks.length > 100) errors.push("tasks must contain at most 100 items");
    proposal.tasks = rawTasks.map((task, index) => {
        const value = isRecord(task) ? task : {};
        const item: AiProposedTask = {
            title: typeof value.title === "string" ? value.title.trim() : "",
            kind: value.kind === "project" ? "project" : "task",
            sourceBlockId: typeof value.sourceBlockId === "string" ? value.sourceBlockId : undefined,
            parentId: value.parentId === null ? null : typeof value.parentId === "string" ? value.parentId : undefined,
            dependsOnIndexes: Array.isArray(value.dependsOnIndexes)
                ? value.dependsOnIndexes.filter((entry: unknown): entry is number => Number.isInteger(entry))
                : undefined,
            status: typeof value.status === "string" ? value.status : undefined,
            priority: typeof value.priority === "string" ? value.priority : undefined,
            importance: normalizeOptionalScale(value.importance),
            effort: normalizeOptionalScale(value.effort),
            start: value.start === null ? null : typeof value.start === "string" ? value.start : undefined,
            due: value.due === null ? null : typeof value.due === "string" ? value.due : undefined,
            contexts: normalizeStringList(value.contexts, `tasks[${index}].contexts`, errors),
            tags: normalizeStringList(value.tags, `tasks[${index}].tags`, errors),
            note: value.note === null ? null : typeof value.note === "string" ? value.note : undefined,
            outcome: value.outcome === null ? null : typeof value.outcome === "string" ? value.outcome : undefined,
            dod: value.dod === null ? null : typeof value.dod === "string" ? value.dod : undefined,
            actionKind:
                value.actionKind === null
                    ? null
                    : value.actionKind === "action" || value.actionKind === "stage"
                      ? value.actionKind
                      : undefined,
            reason: typeof value.reason === "string" ? value.reason : undefined,
        };
        if (!item.title || item.title.length > 512) errors.push(`tasks[${index}].title must contain 1-512 characters`);
        if (item.sourceBlockId && !isBlockId(item.sourceBlockId))
            errors.push(`tasks[${index}].sourceBlockId is invalid`);
        if (item.parentId && !isBlockId(item.parentId)) errors.push(`tasks[${index}].parentId is invalid`);
        if (item.status && !(ALL_STATUSES as readonly string[]).includes(item.status))
            errors.push(`tasks[${index}].status is invalid`);
        if (item.priority && !PRIORITIES.has(item.priority)) errors.push(`tasks[${index}].priority is invalid`);
        if (value.actionKind !== undefined && value.actionKind !== null && item.actionKind === undefined) {
            errors.push(`tasks[${index}].actionKind must be action or stage`);
        }
        if (value.outcome !== undefined && value.outcome !== null && typeof value.outcome !== "string") {
            errors.push(`tasks[${index}].outcome must be a string or null`);
        }
        if (value.dod !== undefined && value.dod !== null && typeof value.dod !== "string") {
            errors.push(`tasks[${index}].dod must be a string or null`);
        }
        if (item.kind === "project" && item.actionKind) {
            errors.push(`tasks[${index}].actionKind only applies to an ordinary Action`);
        }
        if (item.outcome && (/\r|\n/.test(item.outcome) || item.outcome.length > 500)) {
            errors.push(`tasks[${index}].outcome must be single-line plain text <= 500 characters`);
        }
        if (item.dod && item.dod.length > 4000) {
            errors.push(`tasks[${index}].dod must be plain text <= 4000 characters`);
        }
        for (const field of ["importance", "effort"] as const) {
            const value = item[field];
            if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 7))
                errors.push(`tasks[${index}].${field} must be integer 1-7`);
        }
        for (const field of ["start", "due"] as const) {
            const value = item[field];
            if (value && !isValidDate(value)) errors.push(`tasks[${index}].${field} is invalid`);
        }
        if (item.dependsOnIndexes) {
            for (const dep of item.dependsOnIndexes)
                if (dep < 0 || dep >= rawTasks.length || dep === index)
                    errors.push(`tasks[${index}].dependsOnIndexes contains invalid index`);
        }
        return item;
    });

    if (proposal.feature === "extractTasks" && context.sourceBlockIds) {
        const sourceBlockIds = new Set(context.sourceBlockIds);
        proposal.tasks.forEach((task, index) => {
            if (!task.sourceBlockId) {
                errors.push(`tasks[${index}].sourceBlockId is required for extractTasks input context`);
            } else if (!sourceBlockIds.has(task.sourceBlockId)) {
                errors.push(`tasks[${index}].sourceBlockId must belong to the extractTasks input context`);
            }
        });
    }

    if (proposal.feature === "extractTasks" && context.defaultProjectId) {
        if (!isBlockId(context.defaultProjectId)) {
            errors.push("extractTasks default Project is invalid");
        } else {
            proposal.tasks = proposal.tasks.map((task) => ({ ...task, parentId: context.defaultProjectId }));
        }
    }

    if (proposal.target?.type === "original") {
        const originalSourceIds = new Set<string>();
        proposal.tasks.forEach((task, index) => {
            if (!task.sourceBlockId) errors.push(`tasks[${index}].sourceBlockId is required for original target`);
            else if (originalSourceIds.has(task.sourceBlockId)) {
                errors.push("original target requires a unique sourceBlockId for every task");
            } else {
                originalSourceIds.add(task.sourceBlockId);
            }
        });
    }
    if (proposal.target?.type === "source_child") {
        proposal.tasks.forEach((task, index) => {
            if (!task.sourceBlockId) errors.push(`tasks[${index}].sourceBlockId is required for source_child target`);
        });
    }
    if (
        (proposal.target?.type === "current_document" || proposal.target?.type === "source_document") &&
        !proposal.target.documentId
    ) {
        errors.push("target.documentId is required for document-based target");
    }

    // Detect proposal-local dependency cycles.
    const graph = proposal.tasks.map((task) => task.dependsOnIndexes || []);
    const visiting = new Set<number>();
    const visited = new Set<number>();
    const visit = (index: number) => {
        if (visiting.has(index)) {
            errors.push("tasks dependency cycle detected");
            return;
        }
        if (visited.has(index)) return;
        visiting.add(index);
        for (const dep of graph[index]) visit(dep);
        visiting.delete(index);
        visited.add(index);
    };
    graph.forEach((_value, index) => visit(index));
    return { proposal, errors };
}

export function parseAiJson(text: string): unknown {
    const trimmed = text.replace(/^\uFEFF/, "").trim();
    const fenced = trimmed.match(/```(?:json|JSON)?\s*([\s\S]*?)\s*```/i);
    const candidates = [fenced?.[1] || trimmed];
    const source = candidates[0];
    const firstObject = source.search(/[\[{]/);
    if (firstObject >= 0 && firstObject > 0) candidates.push(source.slice(firstObject));

    for (const candidate of candidates) {
        const direct = tryParseJson(candidate);
        if (direct !== null) return direct;
        const balanced = extractBalancedJson(candidate);
        if (balanced) {
            const parsed = tryParseJson(balanced);
            if (parsed !== null) return parsed;
        }
    }
    return null;
}

function tryParseJson(candidate: string): unknown {
    const normalized = candidate.trim();
    try {
        return JSON.parse(normalized);
    } catch {
        // Models occasionally add a trailing comma even when asked for JSON.
        try {
            return JSON.parse(normalized.replace(/,\s*([}\]])/g, "$1"));
        } catch {
            return null;
        }
    }
}

function extractBalancedJson(source: string): string | null {
    const start = source.search(/[\[{]/);
    if (start < 0) return null;
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index++) {
        const char = source[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === "{" || char === "[") stack.push(char);
        else if (char === "}" || char === "]") {
            const expected = char === "}" ? "{" : "[";
            if (stack.pop() !== expected) return null;
            if (stack.length === 0) return source.slice(start, index + 1);
        }
    }
    return null;
}

export const AI_TASK_TYPES = { task: TASK_TYPE_TASK, project: TASK_TYPE_PROJECT } as const;
