import type { AiFeatureId } from "../../shared/ai";
import { isBlockId } from "../../shared/block-id";

export interface AiPromptVariableContext {
    feature: AiFeatureId;
    context: any;
}

export interface RenderedAiPrompt {
    text: string;
    unknown: string[];
    blockIds: string[];
}

/**
 * Variables intentionally have a small, explicit vocabulary.  Values are
 * rendered as data blocks so note text cannot accidentally become an
 * instruction, and missing values are made explicit instead of leaving
 * {{placeholders}} in the request.
 */
export const AI_PROMPT_VARIABLES = [
    "feature", "today", "currentDate", "now", "currentDateTime", "timezone",
    "sourceBlockIds", "selectedBlockIds", "sourceBlocks", "selectedBlocks",
    "sourceDocument", "sourceDocumentId", "currentDocument", "currentDocumentId",
    "currentTaskBlock", "currentTaskBlockContent", "currentTaskBlockWithChildren",
    "currentTaskBlockWithParent", "currentTaskChildren", "currentTaskParent", "currentTaskDoc",
    "nextaction", "candidateTasks", "allNextActions", "myDay", "myDayTaskIds",
    "inbox", "waiting", "someday", "overdue", "reviewDue", "activeProjects",
    "blockedTasks", "review", "reviewGroups", "reviewTasks", "reviewData", "truncated", "availableContexts",
    "availableTags", "availableStatuses", "availablePriorities", "writeTargets", "outputSchema",
] as const;

type VariableName = typeof AI_PROMPT_VARIABLES[number];
const VARIABLE_SET = new Set<string>(AI_PROMPT_VARIABLES);
const MAX_EXPLICIT_BLOCKS = 8;

function localDateParts(): { date: string; time: string; timezone: string } {
    const now = new Date();
    const date = new Intl.DateTimeFormat("sv-SE").format(now);
    const time = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "medium", hour12: false }).format(now);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "本地时区";
    return { date, time, timezone };
}

function valueFor(name: VariableName, input: AiPromptVariableContext): unknown {
    const { feature, context = {} } = input;
    const date = localDateParts();
    const review = context.reviewData || context.review || context;
    const candidates = context.candidates || context.candidateTasks || [];
    const existingMyDay = context.existingMyDay || context.myDay || [];
    const task = context.task || context.currentTaskBlock;
    const children = context.children || context.currentTaskChildren || [];
    const groups = context.groups || context.reviewGroups;
    const sourceIds = context.sourceBlockIds || context.selectedBlockIds || [];
    const known: Record<string, unknown> = {
        feature, today: date.date, currentDate: date.date, now: date.time, currentDateTime: date.time, timezone: date.timezone,
        sourceBlockIds: sourceIds, selectedBlockIds: sourceIds,
        sourceBlocks: context.sourceBlocks || "见请求末尾由思源附加的选定块正文",
        selectedBlocks: context.selectedBlocks || context.sourceBlocks || "见请求末尾由思源附加的选定块正文",
        sourceDocument: context.sourceDocument, sourceDocumentId: context.sourceDocumentId,
        currentDocument: context.currentDocument, currentDocumentId: context.currentDocumentId,
        currentTaskBlock: task, currentTaskBlockContent: context.currentTaskBlockContent || task?.title,
        currentTaskBlockWithChildren: task ? { task, children } : undefined,
        currentTaskBlockWithParent: context.currentTaskBlockWithParent,
        currentTaskChildren: children, currentTaskParent: context.currentTaskParent, currentTaskDoc: context.currentTaskDoc,
        nextaction: candidates, candidateTasks: candidates, allNextActions: candidates,
        myDay: existingMyDay, myDayTaskIds: Array.isArray(existingMyDay) ? existingMyDay.map((x: any) => typeof x === "string" ? x : x.blockId).filter(Boolean) : [],
        inbox: review.inbox || context.inbox, waiting: review.waiting || context.waiting,
        someday: review.someday || context.someday, overdue: review.overdue || context.overdue,
        reviewDue: review.reviewDue || context.reviewDue, activeProjects: review.activeProjects || context.activeProjects,
        blockedTasks: context.blockedTasks, review: context.review || review, reviewGroups: groups,
        reviewTasks: context.tasks || review.tasks, reviewData: review, truncated: context.truncated,
        availableContexts: context.availableContexts, availableTags: context.availableTags,
        availableStatuses: context.availableStatuses, availablePriorities: context.availablePriorities,
        writeTargets: context.writeTargets, outputSchema: context.outputSchema,
    };
    return known[name];
}

function renderValue(name: string, value: unknown): string {
    if (value === undefined || value === null || value === "") return `[${name}：未提供]`;
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return `[${name}：无法序列化]`;
    }
}

export function renderAiPromptTemplate(template: string, input: AiPromptVariableContext): RenderedAiPrompt {
    const unknown: string[] = [];
    const blockIds: string[] = [];
    const text = template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, expression: string) => {
        const blockMatch = expression.match(/^block\s*:\s*(.+)$/i);
        if (blockMatch) {
            const blockId = blockMatch[1].trim().toLowerCase();
            if (!isBlockId(blockId)) return `[block：无效的思源块 ID ${blockId}]`;
            if (!blockIds.includes(blockId) && blockIds.length >= MAX_EXPLICIT_BLOCKS) {
                return `[block：最多引用 ${MAX_EXPLICIT_BLOCKS} 个指定块，已忽略 ${blockId}]`;
            }
            if (!blockIds.includes(blockId)) blockIds.push(blockId);
            return `[指定块 ${blockId} 的 Markdown 内容见本请求末尾的思源块正文]`;
        }
        const rawName = expression.trim();
        if (!VARIABLE_SET.has(rawName)) {
            if (!unknown.includes(rawName)) unknown.push(rawName);
            return `[${rawName}：未知变量]`;
        }
        return renderValue(rawName, valueFor(rawName as VariableName, input));
    });
    return { text, unknown, blockIds };
}
