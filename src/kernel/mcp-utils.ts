import {
    ATTR_CONTEXT,
    ATTR_DEPENDS,
    ATTR_DEP_MODE,
    ATTR_DUE,
    ATTR_EFFORT,
    ATTR_EXT_PREFIX,
    ATTR_IMPORTANCE,
    ATTR_NOTE,
    ATTR_PARENT,
    ATTR_PRIORITY,
    ATTR_REMINDER,
    ATTR_REPEAT,
    ATTR_REVIEW_DATE,
    ATTR_REVIEW_INTERVAL,
    ATTR_SEQUENTIAL,
    ATTR_START,
    ATTR_STATUS,
    ATTR_TAGS,
    ATTR_TASK,
    ALL_STATUSES,
} from "../shared/constants";
import {
    decodeCustomFieldValue,
    encodeCustomFieldValue,
    isCustomFieldApplicable,
    type CustomFieldDef,
    type CustomFieldInput,
} from "../shared/custom-fields";
import { normalizeRepeatRule, parseRepeatRule, parseRepeatState, type RepeatRuleV2 } from "../shared/repeat";
import type { ReminderItem, TaskCacheEntry } from "../shared/types";
import { BLOCK_ID_SOURCE, extractBlockId, isBlockId } from "../shared/block-id";

const PARAGRAPH_ID_BEFORE_TYPE_RE = new RegExp(
    `data-node-id=["'](${BLOCK_ID_SOURCE})["'][^>]*data-type=["']NodeParagraph["']`,
);
const PARAGRAPH_TYPE_BEFORE_ID_RE = new RegExp(
    `data-type=["']NodeParagraph["'][^>]*data-node-id=["'](${BLOCK_ID_SOURCE})["']`,
);

export const READ_MCP_TOOL_NAMES = [
    "get_task_metadata",
    "search_tasks",
    "get_tasks",
    "get_next_actions",
    "list_projects",
    "get_my_day",
    "get_review",
    "get_statistics",
] as const;

export const WRITE_MCP_TOOL_NAMES = [
    "create_tasks",
    "update_tasks",
    "delete_tasks",
    "convert_blocks_to_tasks",
    "update_my_day",
    "mark_tasks_reviewed",
] as const;

export type McpToolName = typeof READ_MCP_TOOL_NAMES[number] | typeof WRITE_MCP_TOOL_NAMES[number];

export interface McpCapabilityEffects {
    localRead: true;
    localWrite?: true;
}

export function getMcpCapabilityEffects(name: McpToolName): McpCapabilityEffects {
    return (WRITE_MCP_TOOL_NAMES as readonly string[]).includes(name)
        ? { localRead: true, localWrite: true }
        : { localRead: true };
}

export function getDesiredMcpToolNames(enabled: boolean, allowWrite: boolean): McpToolName[] {
    if (!enabled) return [];
    return allowWrite
        ? [...READ_MCP_TOOL_NAMES, ...WRITE_MCP_TOOL_NAMES]
        : [...READ_MCP_TOOL_NAMES];
}

export interface McpTaskDto {
    id: string;
    siyuanUrl: string;
    title: string;
    kind: "task" | "project";
    status: string;
    priority: string;
    importance: number;
    effort: number;
    start: string | null;
    due: string | null;
    contexts: string[];
    tags: string[];
    note: string;
    parentId: string | null;
    childIds: string[];
    dependencyIds: string[];
    dependencyMode: string;
    sequential: boolean;
    blocked: boolean;
    blockedReason: string | null;
    isNextAction: boolean;
    order: number;
    created: string | null;
    completedAt: string[];
    reviewInterval: number;
    reviewDate: string | null;
    reminders: { mode: "default" | "disabled" | "custom"; items: ReminderItem[] };
    repeat: { rule: unknown | null; status: "none" | "active" | "paused" | "ended" };
    customFields: Record<string, unknown>;
}

export interface McpSearchTasksInput {
    query?: string;
    kind?: "task" | "project" | "all";
    statuses?: string[];
    priorities?: string[];
    contexts?: string[];
    tags?: string[];
    parentId?: string;
    projectId?: string;
    startFrom?: string;
    startTo?: string;
    dueFrom?: string;
    dueTo?: string;
    sortBy?: "order" | "due" | "importance" | "priority" | "created";
    offset?: number;
    limit?: number;
}

export interface McpTaskPatch {
    title?: string;
    kind?: "task" | "project";
    status?: string;
    priority?: string;
    importance?: number;
    effort?: number;
    start?: string | null;
    due?: string | null;
    contexts?: string[];
    tags?: string[];
    note?: string | null;
    parentId?: string | null;
    dependencyIds?: string[];
    dependencyMode?: "all" | "any";
    sequential?: boolean;
    reviewInterval?: number;
    reviewDate?: string | null;
    reminders?: { mode: "default" | "disabled" | "custom"; items?: ReminderItem[] };
    repeat?: RepeatRuleV2 | null;
    customFields?: Record<string, unknown>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/;
const PRIORITIES = new Set(["critical", "high", "medium", "low", "veryLow", "none"]);
const PATCH_KEYS = new Set([
    "title", "kind", "status", "priority", "importance", "effort", "start", "due", "contexts", "tags", "note",
    "parentId", "dependencyIds", "dependencyMode", "sequential", "reviewInterval",
    "reviewDate", "reminders", "repeat", "customFields",
]);

export function validateMcpTaskPatch(patch: unknown): asserts patch is McpTaskPatch {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        throw new Error("patch must be an object");
    }
    const keys = Object.keys(patch);
    if (keys.length === 0) throw new Error("patch must contain at least one supported field");
    for (const key of keys) {
        if (!PATCH_KEYS.has(key)) throw new Error(`${key} is not allowed in update_tasks`);
    }
    const value = patch as McpTaskPatch;
    if (value.title !== undefined) {
        if (typeof value.title !== "string") throw new Error("title must be a string");
        const title = value.title.replace(/[\r\n]+/g, " ").trim();
        if (!title || title.length > 512) throw new Error("title must contain 1-512 characters");
    }
    if (value.kind !== undefined && value.kind !== "task" && value.kind !== "project") {
        throw new Error("kind must be task or project");
    }
    if (value.status !== undefined) validateMcpStatus(value.status);
    if (value.repeat !== undefined && value.repeat !== null && !normalizeRepeatRule(value.repeat)) {
        throw new Error("repeat is invalid");
    }
}

function splitPipe(value: string): string[] {
    return value ? value.split("|").map(item => item.trim()).filter(Boolean) : [];
}

export function normalizeMcpContext(value: string): string {
    return value.trim().replace(/^@+/, "").trim();
}

function uniqueStrings(values: unknown, field: string, normalize: (value: string) => string = value => value.trim()): string[] {
    if (!Array.isArray(values)) throw new Error(`${field} must be an array`);
    const result: string[] = [];
    for (const value of values) {
        if (typeof value !== "string") throw new Error(`${field} items must be strings`);
        const normalized = normalize(value);
        if (!normalized) continue;
        if (normalized.includes("|")) throw new Error(`${field} items must not contain |`);
        if (normalized.length > 100) throw new Error(`${field} items must be <= 100 characters`);
        if (!result.includes(normalized)) result.push(normalized);
    }
    if (result.length > 50) throw new Error(`${field} must contain at most 50 items`);
    return result;
}

function validateDate(value: unknown, field: string): string {
    if (typeof value !== "string" || !DATE_RE.test(value)) {
        throw new Error(`${field} must be YYYY-MM-DD or YYYY-MM-DDTHH:mm`);
    }
    const [datePart, timePart = "00:00"] = value.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart.split(":").map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, 0, 0);
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
        || date.getUTCHours() !== hour
        || date.getUTCMinutes() !== minute
    ) {
        throw new Error(`${field} is not a valid date`);
    }
    return value;
}

function validateReminderItems(value: unknown): ReminderItem[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 7) {
        throw new Error("custom reminders must contain 1-7 items");
    }
    return value.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new Error(`reminder item ${index + 1} is invalid`);
        }
        if ((item as any).type === "relative") {
            const minutes = (item as any).minutes;
            if (!Number.isInteger(minutes) || minutes <= 0) {
                throw new Error(`relative reminder ${index + 1} minutes must be a positive integer`);
            }
            return { type: "relative", minutes };
        }
        if ((item as any).type === "absolute") {
            const time = (item as any).time;
            try {
                if (typeof time !== "string" || !time.includes("T")) throw new Error();
                validateDate(time, `absolute reminder ${index + 1}`);
            } catch {
                throw new Error(`absolute reminder ${index + 1} must be a valid YYYY-MM-DDTHH:mm value`);
            }
            return { type: "absolute", time };
        }
        throw new Error(`reminder item ${index + 1} type must be relative or absolute`);
    });
}

function remindersToDto(raw: string): McpTaskDto["reminders"] {
    if (!raw) return { mode: "default", items: [] };
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return { mode: "default", items: [] };
        if (parsed.length === 0) return { mode: "disabled", items: [] };
        return { mode: "custom", items: parsed as ReminderItem[] };
    } catch {
        return { mode: "default", items: [] };
    }
}

export function taskToMcpDto(entry: TaskCacheEntry, fields: CustomFieldDef[], isNextAction: boolean): McpTaskDto {
    const customFields: Record<string, unknown> = {};
    for (const field of fields) {
        const raw = entry.customFields[field.key];
        if (raw === undefined || raw === "") continue;
        try {
            customFields[field.key] = decodeCustomFieldValue(field, raw);
        } catch {
            customFields[field.key] = raw;
        }
    }
    const repeatRule = entry.repeat ? parseRepeatRule(entry.repeat) : null;
    const repeatState = entry.repeatState ? parseRepeatState(entry.repeatState) : null;
    return {
        id: entry.blockId,
        siyuanUrl: `siyuan://blocks/${entry.blockId}`,
        title: entry.title,
        kind: entry.taskType === "2" ? "project" : "task",
        status: entry.status,
        priority: entry.priority,
        importance: entry.importance,
        effort: entry.effort,
        start: entry.start || null,
        due: entry.due || null,
        contexts: [...new Set(splitPipe(entry.context).map(normalizeMcpContext).filter(Boolean))],
        tags: splitPipe(entry.tags),
        note: entry.note || "",
        parentId: entry.parentId || null,
        childIds: [...entry.childIds],
        dependencyIds: splitPipe(entry.depends),
        dependencyMode: entry.depMode || "all",
        sequential: entry.sequential,
        blocked: entry.blocked,
        blockedReason: entry.blockedReason || null,
        isNextAction,
        order: entry.order,
        created: entry.created || null,
        completedAt: splitPipe(entry.completed),
        reviewInterval: entry.reviewInterval,
        reviewDate: entry.reviewDate || null,
        reminders: remindersToDto(entry.reminder),
        repeat: {
            rule: repeatRule,
            status: repeatState?.status || (repeatRule ? "active" : "none"),
        },
        customFields,
    };
}

function belongsToProject(entry: TaskCacheEntry, projectId: string, map: Map<string, TaskCacheEntry>): boolean {
    let current: TaskCacheEntry | undefined = entry;
    const visited = new Set<string>();
    while (current && !visited.has(current.blockId)) {
        if (current.blockId === projectId) return true;
        visited.add(current.blockId);
        current = current.parentId ? map.get(current.parentId) : undefined;
    }
    return false;
}

function priorityRank(priority: string): number {
    return ({ critical: 5, high: 4, medium: 3, low: 2, veryLow: 1, none: 1 } as Record<string, number>)[priority] || 0;
}

export function searchTasksForMcp(entries: TaskCacheEntry[], input: McpSearchTasksInput = {}) {
    const map = new Map(entries.map(entry => [entry.blockId, entry]));
    let filtered = entries.slice();
    if (input.kind && input.kind !== "all") {
        filtered = filtered.filter(entry => input.kind === "project" ? entry.taskType === "2" : entry.taskType !== "2");
    }
    if (input.statuses?.length) filtered = filtered.filter(entry => input.statuses!.includes(entry.status));
    if (input.priorities?.length) filtered = filtered.filter(entry => input.priorities!.includes(entry.priority));
    if (input.contexts?.length) {
        const contexts = input.contexts.map(normalizeMcpContext).filter(Boolean);
        filtered = filtered.filter(entry => splitPipe(entry.context).map(normalizeMcpContext).some(value => contexts.includes(value)));
    }
    if (input.tags?.length) filtered = filtered.filter(entry => splitPipe(entry.tags).some(value => input.tags!.includes(value)));
    if (input.parentId !== undefined) filtered = filtered.filter(entry => entry.parentId === input.parentId);
    if (input.projectId) filtered = filtered.filter(entry => belongsToProject(entry, input.projectId!, map));
    if (input.startFrom) filtered = filtered.filter(entry => !!entry.start && entry.start >= input.startFrom!);
    if (input.startTo) filtered = filtered.filter(entry => !!entry.start && entry.start <= input.startTo!);
    if (input.dueFrom) filtered = filtered.filter(entry => !!entry.due && entry.due >= input.dueFrom!);
    if (input.dueTo) filtered = filtered.filter(entry => !!entry.due && entry.due <= input.dueTo!);
    if (input.query?.trim()) {
        const query = input.query.trim().toLocaleLowerCase();
        filtered = filtered.filter(entry => [entry.title, entry.note, entry.context, entry.tags, JSON.stringify(entry.customFields)]
            .join("\n").toLocaleLowerCase().includes(query));
    }

    const sortBy = input.sortBy || "order";
    filtered.sort((a, b) => {
        if (sortBy === "due") return (a.due || "9999").localeCompare(b.due || "9999") || a.blockId.localeCompare(b.blockId);
        if (sortBy === "importance") return b.importance - a.importance || a.blockId.localeCompare(b.blockId);
        if (sortBy === "priority") return priorityRank(b.priority) - priorityRank(a.priority) || a.blockId.localeCompare(b.blockId);
        if (sortBy === "created") return (b.created || "").localeCompare(a.created || "") || a.blockId.localeCompare(b.blockId);
        return b.order - a.order || (a.due || "9999").localeCompare(b.due || "9999") || a.blockId.localeCompare(b.blockId);
    });

    const total = filtered.length;
    const offset = Math.max(0, Math.trunc(input.offset || 0));
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit || 50)));
    const items = filtered.slice(offset, offset + limit);
    return { items, total, offset, limit, hasMore: offset + items.length < total };
}

export function buildTaskAttrsFromMcpPatch(
    patch: McpTaskPatch,
    fields: CustomFieldDef[],
    task: TaskCacheEntry,
    taskMap = new Map<string, TaskCacheEntry>([[task.blockId, task]]),
): Record<string, string> {
    validateMcpTaskPatch(patch);
    const attrs: Record<string, string> = {};
    if (patch.kind !== undefined) attrs[ATTR_TASK] = patch.kind === "project" ? "2" : "1";
    if (patch.status !== undefined) attrs[ATTR_STATUS] = validateMcpStatus(patch.status);
    if (patch.priority !== undefined) {
        if (!PRIORITIES.has(patch.priority)) throw new Error("priority is invalid");
        attrs[ATTR_PRIORITY] = patch.priority;
    }
    for (const [key, attr] of [["importance", ATTR_IMPORTANCE], ["effort", ATTR_EFFORT]] as const) {
        const value = patch[key];
        if (value !== undefined) {
            if (!Number.isInteger(value) || value! < 1 || value! > 7) throw new Error(`${key} must be integer 1-7`);
            attrs[attr] = String(value);
        }
    }
    for (const [key, attr] of [["start", ATTR_START], ["due", ATTR_DUE], ["reviewDate", ATTR_REVIEW_DATE]] as const) {
        const value = patch[key];
        if (value !== undefined) attrs[attr] = value === null ? "" : validateDate(value, key);
    }
    if (patch.contexts !== undefined) attrs[ATTR_CONTEXT] = uniqueStrings(patch.contexts, "contexts", normalizeMcpContext).join("|");
    if (patch.tags !== undefined) attrs[ATTR_TAGS] = uniqueStrings(patch.tags, "tags").join("|");
    if (patch.note !== undefined) {
        if (patch.note !== null && (typeof patch.note !== "string" || patch.note.length > 4000)) throw new Error("note must be a string <= 4000 characters");
        attrs[ATTR_NOTE] = patch.note || "";
    }
    if (patch.parentId !== undefined) {
        const parentId = patch.parentId === null ? "" : extractBlockId(patch.parentId);
        if (patch.parentId !== null && !parentId) throw new Error("parentId is invalid");
        attrs[ATTR_PARENT] = parentId;
    }
    if (patch.dependencyIds !== undefined) {
        const ids = [...new Set(uniqueStrings(patch.dependencyIds, "dependencyIds").map(extractBlockId))];
        if (ids.some(id => !id)) throw new Error("dependencyIds contains invalid block ID");
        attrs[ATTR_DEPENDS] = ids.join("|");
    }
    if (patch.dependencyMode !== undefined) {
        if (patch.dependencyMode !== "all" && patch.dependencyMode !== "any") {
            throw new Error("dependencyMode must be all or any");
        }
        attrs[ATTR_DEP_MODE] = patch.dependencyMode;
    }
    if (patch.sequential !== undefined) {
        if (typeof patch.sequential !== "boolean") throw new Error("sequential must be boolean");
        attrs[ATTR_SEQUENTIAL] = patch.sequential ? "1" : "";
    }
    if (patch.reviewInterval !== undefined) {
        if (!Number.isInteger(patch.reviewInterval) || patch.reviewInterval < 0 || patch.reviewInterval > 3650) {
            throw new Error("reviewInterval must be integer 0-3650");
        }
        attrs[ATTR_REVIEW_INTERVAL] = String(patch.reviewInterval);
    }
    if (patch.reminders !== undefined) {
        if (!patch.reminders || typeof patch.reminders !== "object" || Array.isArray(patch.reminders)) {
            throw new Error("reminders must be an object");
        }
        if (patch.reminders.mode === "default") attrs[ATTR_REMINDER] = "";
        else if (patch.reminders.mode === "disabled") attrs[ATTR_REMINDER] = "[]";
        else if (patch.reminders.mode === "custom") attrs[ATTR_REMINDER] = JSON.stringify(validateReminderItems(patch.reminders.items));
        else throw new Error("reminders.mode must be default, disabled, or custom");
    }
    if (patch.repeat !== undefined) {
        if (patch.repeat === null) attrs[ATTR_REPEAT] = "";
        else attrs[ATTR_REPEAT] = JSON.stringify(normalizeRepeatRule(patch.repeat));
    }
    if (patch.customFields !== undefined) {
        for (const [key, value] of Object.entries(patch.customFields)) {
            const field = fields.find(item => item.key === key && item.status === "active");
            if (!field) throw new Error(`Unknown or archived custom field: ${key}`);
            if (!isCustomFieldApplicable(field, task, taskMap)) throw new Error(`Custom field is not applicable: ${key}`);
            attrs[ATTR_EXT_PREFIX + key] = value == null ? "" : encodeCustomFieldValue(field, value as CustomFieldInput);
        }
    }
    if (Object.keys(attrs).length === 0) throw new Error("update_tasks patch must contain at least one attribute field");
    return attrs;
}

export { extractBlockId } from "../shared/block-id";

export function extractDocumentIdFromPath(value: unknown): string {
    if (typeof value !== "string") return "";
    const fileName = value.trim().replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
    return extractBlockId(fileName.replace(/\.sy$/i, ""));
}

export function extractInsertedBlockId(data: unknown): string {
    return extractInsertedBlockMeta(data).id;
}

export interface InsertedBlockMeta {
    id: string;
    parentId: string;
    nodeType: string;
    /** 当 markdown 根节点是列表时，记录需要整体回滚的根块。 */
    rootId?: string;
}

export function extractInsertedBlockMeta(data: unknown): InsertedBlockMeta {
    if (!Array.isArray(data)) return { id: "", parentId: "", nodeType: "" };
    for (const transaction of data) {
        const operations = transaction && typeof transaction === "object" ? (transaction as any).doOperations : null;
        if (!Array.isArray(operations)) continue;
        for (const operation of operations) {
            if (operation?.action !== "insert" || !isBlockId(operation.id)) continue;
            const dom = typeof operation.data === "string" ? operation.data : "";
            const typeMatch = dom.match(/data-type=["']([^"']+)["']/i);
            const paragraphMatch = dom.match(PARAGRAPH_ID_BEFORE_TYPE_RE)
                || dom.match(PARAGRAPH_TYPE_BEFORE_ID_RE);
            if (paragraphMatch?.[1] && paragraphMatch[1] !== operation.id) {
                return {
                    id: paragraphMatch[1],
                    parentId: isBlockId(operation.parentID) ? operation.parentID : "",
                    nodeType: "NodeParagraph",
                    rootId: operation.id,
                };
            }
            return {
                id: operation.id,
                parentId: isBlockId(operation.parentID) ? operation.parentID : "",
                nodeType: typeMatch?.[1] || "",
            };
        }
    }
    return { id: "", parentId: "", nodeType: "" };
}

export function escapeMarkdownText(value: string): string {
    return value.replace(/[\r\n]+/g, " ").replace(/([\\`*_[\]{}()#+\-.!>|])/g, "\\$1").trim();
}

/**
 * 生成符合思源块 ID 格式的临时节点 ID。
 * DOM 插入允许调用方直接提供节点 ID；使用同一格式可以让插入事务和后续
 * convertToTask 在 SQL 索引建立前都能稳定识别新段落。
 */
export function createNodeId(): string {
    const now = new Date();
    const timestamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
        String(now.getSeconds()).padStart(2, "0"),
    ].join("");
    const random = Math.floor(Math.random() * 36 ** 7).toString(36).padStart(7, "0").slice(-7);
    return `${timestamp}-${random}`;
}

function escapeHtmlText(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * 构造一个可直接追加到既有 NodeList 下的 NodeListItem。
 * NodeList 不能直接包含段落或另一个列表，必须插入列表项并在其内部放段落。
 */
export function buildListItemBlockDom(title: string, subtype: "u" | "o" | "t" = "u"): string {
    const normalizedSubtype = subtype === "o" || subtype === "t" ? subtype : "u";
    const marker = normalizedSubtype === "o" ? "1." : "*";
    const listItemId = createNodeId();
    const paragraphId = createNodeId();
    const updated = listItemId.slice(0, 14);
    const actionClass = normalizedSubtype === "t" ? "protyle-action protyle-action--task" : "protyle-action";
    const icon = normalizedSubtype === "t" ? "Unc" : "Dot";
    const taskAttr = normalizedSubtype === "t" ? " data-task=\" \"" : "";

    return `<div data-marker="${marker}" data-subtype="${normalizedSubtype}" data-node-id="${listItemId}" data-type="NodeListItem" class="li" updated="${updated}"${taskAttr}>`
        + `<div class="${actionClass}" draggable="true"><svg><use xlink:href="#icon${icon}"></use></svg></div>`
        + `<div data-node-id="${paragraphId}" data-type="NodeParagraph" class="p" updated="${updated}">`
        + `<div contenteditable="true" spellcheck="false">${escapeHtmlText(title)}</div>`
        + `<div class="protyle-attr" contenteditable="false"></div></div>`
        + `<div class="protyle-attr" contenteditable="false"></div></div>`;
}

export function validateMcpStatus(status: unknown): string {
    if (typeof status !== "string" || !(ALL_STATUSES as readonly string[]).includes(status)) {
        throw new Error("status is invalid");
    }
    return status;
}
