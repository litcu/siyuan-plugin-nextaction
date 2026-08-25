import { validateAiProposal, type AiProposal } from "./ai";
import { assertBlockId } from "./block-id";
import { RPC_ERROR_INVALID_PARAMS } from "./constants";
import type { RepeatRuleV2 } from "./repeat";
import { validateSettings, type PluginSettings } from "./settings";
import type { CompletedTasksPageOptions } from "./task-pagination";
import {
    CREATE_TASK_DESTINATION_TYPES,
    CREATE_TASK_FORMATS,
    type CreateTaskDestination,
    type CreateTaskInput,
    type CreateTaskResult,
} from "./task-creation";
import type {
    CompletedTasksPage,
    MyDayState,
    ReviewData,
    ProjectSupportData,
    StatisticsResult,
    TaskCacheEntry,
    TaskSnapshotV2,
} from "./types";

export interface RpcErrorPayload {
    code: number;
    message: string;
}

export interface RpcFailure {
    _rpcError: RpcErrorPayload;
}

export type RpcResult<T> = T | RpcFailure;

export interface RpcMcpRegisteredToolStatus {
    localName: string;
    fullName: string;
    title: string;
    source: "plugin";
    write: boolean;
}

export interface RpcMcpStatus {
    supported: boolean;
    enabled: boolean;
    allowWrite: boolean;
    endpoint: string;
    tools: RpcMcpRegisteredToolStatus[];
    lastError: string;
}

export interface RpcMcpNotebookTarget {
    id: string;
    name: string;
    icon: string;
}

export interface RpcMcpDocumentTarget {
    id: string;
    title: string;
    notebookId: string;
    notebookName?: string;
    path?: string;
    icon?: string;
}

export interface RpcMcpDocumentListItem extends RpcMcpDocumentTarget {
    path: string;
    icon: string;
    hasChildren: boolean;
}

export interface RpcChildTargetResult {
    available: boolean;
    parentBlockId: string;
    containerId?: string;
    containerType?: string;
    reason?: string;
}

export interface RpcCustomFieldDiagnostics {
    fields: Array<{ fieldId: string; key: string; status: string; count: number }>;
    orphans: Array<{ key: string; count: number; sampleBlockIds: string[] }>;
}

export interface RpcAiApplyResult {
    feature: string;
    created: TaskCacheEntry[];
    converted: TaskCacheEntry[];
    myDay: MyDayState | null;
    warnings: string[];
}

export class RpcContractError extends Error {
    readonly code = RPC_ERROR_INVALID_PARAMS;

    constructor(message: string) {
        super(message);
        this.name = "RpcContractError";
    }
}

interface RpcDefinition<Params, Result> {
    parseParams: (value: unknown) => Params;
    readonly __result?: Result;
}

function defineRpc<Params, Result>(parseParams: (value: unknown) => Params): RpcDefinition<Params, Result> {
    return { parseParams };
}

function record(value: unknown, label = "params"): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new RpcContractError(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function paramsRecord(value: unknown): Record<string, unknown> {
    return value === undefined ? {} : record(value);
}

function requiredString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) throw new RpcContractError(`${name} is required`);
    return value;
}

function optionalString(value: unknown, name: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new RpcContractError(`${name} must be a string`);
    return value;
}

function requiredBlockId(value: unknown, name = "blockId"): string {
    return assertBlockId(requiredString(value, name), name);
}

function optionalBlockId(value: unknown, name: string): string | null | undefined {
    if (value === undefined || value === null || value === "") return value === undefined ? undefined : null;
    return assertBlockId(requiredString(value, name), name);
}

function requiredObject(value: unknown, name: string): Record<string, unknown> {
    return record(value, name);
}

function stringRecord(value: unknown, name: string): Record<string, string> {
    const input = requiredObject(value, name);
    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(input)) {
        if (typeof item !== "string") throw new RpcContractError(`${name}.${key} must be a string`);
        result[key] = item;
    }
    return result;
}

function noParams(value: unknown): Record<string, never> {
    paramsRecord(value);
    return {};
}

function blockIdParams(value: unknown): { blockId: string } {
    const input = paramsRecord(value);
    return { blockId: requiredBlockId(input.blockId) };
}

function createTaskParams(value: unknown): CreateTaskInput {
    const input = paramsRecord(value);
    const title = requiredString(input.title, "title");
    if (input.kind !== undefined && input.kind !== "task" && input.kind !== "project") {
        throw new RpcContractError("kind must be task or project");
    }
    if (input.addToMyDay !== undefined && typeof input.addToMyDay !== "boolean") {
        throw new RpcContractError("addToMyDay must be boolean");
    }
    let destination: CreateTaskDestination | undefined;
    if (input.destination !== undefined) {
        const rawDestination = requiredObject(input.destination, "destination");
        if (!(CREATE_TASK_DESTINATION_TYPES as readonly unknown[]).includes(rawDestination.type)) {
            throw new RpcContractError("destination.type is invalid");
        }
        if (
            rawDestination.format !== undefined &&
            !(CREATE_TASK_FORMATS as readonly unknown[]).includes(rawDestination.format)
        ) {
            throw new RpcContractError("destination.format is invalid");
        }
        for (const key of ["notebookId", "documentId", "parentBlockId"] as const) {
            if (rawDestination[key] !== undefined && typeof rawDestination[key] !== "string") {
                throw new RpcContractError(`destination.${key} must be a string`);
            }
        }
        destination = rawDestination as unknown as CreateTaskDestination;
    }
    if (input.properties !== undefined) requiredObject(input.properties, "properties");
    if (input.schedule !== undefined) {
        const schedule = requiredObject(input.schedule, "schedule");
        if (!Number.isFinite(schedule.start) || !Number.isFinite(schedule.end)) {
            throw new RpcContractError("schedule start and end must be numbers");
        }
    }
    return { ...input, title, destination } as unknown as CreateTaskInput;
}

function proposalParams(value: unknown): { proposal: AiProposal } {
    const input = paramsRecord(value);
    const validation = validateAiProposal(input.proposal);
    if (validation.errors.length > 0) throw new RpcContractError(validation.errors[0]);
    return { proposal: validation.proposal };
}

function rawProposalParams(value: unknown): { proposal: AiProposal } {
    const input = paramsRecord(value);
    return { proposal: requiredObject(input.proposal, "proposal") as unknown as AiProposal };
}

export const RPC_CONTRACT = {
    echo: defineRpc<{ params: unknown[] }, unknown[]>((value) => {
        const input = paramsRecord(value);
        if (input.params !== undefined && !Array.isArray(input.params))
            throw new RpcContractError("params must be an array");
        return { params: input.params || [] };
    }),
    convertToTask: defineRpc<{ blockId: string; cleanTitle?: string; taskType?: string }, TaskCacheEntry>((value) => {
        const input = paramsRecord(value);
        const taskType = optionalString(input.taskType, "taskType");
        if (taskType !== undefined && taskType !== "1" && taskType !== "2")
            throw new RpcContractError("taskType must be 1 or 2");
        return {
            blockId: requiredBlockId(input.blockId),
            cleanTitle: optionalString(input.cleanTitle, "cleanTitle"),
            taskType,
        };
    }),
    convertToTaskWithChildren: defineRpc<
        { blockId: string; cleanTitle?: string; taskType?: string },
        { converted: number; skipped: number }
    >((value) => {
        const input = paramsRecord(value);
        const taskType = optionalString(input.taskType, "taskType");
        if (taskType !== undefined && taskType !== "1" && taskType !== "2")
            throw new RpcContractError("taskType must be 1 or 2");
        return {
            blockId: requiredBlockId(input.blockId),
            cleanTitle: optionalString(input.cleanTitle, "cleanTitle"),
            taskType,
        };
    }),
    removeTask: defineRpc<{ blockId: string }, { success: true }>(blockIdParams),
    updateTask: defineRpc<{ blockId: string; attrs: Record<string, string> }, TaskCacheEntry>((value) => {
        const input = paramsRecord(value);
        return { blockId: requiredBlockId(input.blockId), attrs: stringRecord(input.attrs, "attrs") };
    }),
    setRepeatRule: defineRpc<{ blockId: string; rule: RepeatRuleV2 }, TaskCacheEntry>((value) => {
        const input = paramsRecord(value);
        return {
            blockId: requiredBlockId(input.blockId),
            rule: requiredObject(input.rule, "rule") as unknown as RepeatRuleV2,
        };
    }),
    skipRepeatOccurrence: defineRpc<{ blockId: string }, TaskCacheEntry>(blockIdParams),
    setRepeatPaused: defineRpc<{ blockId: string; paused: boolean }, TaskCacheEntry>((value) => {
        const input = paramsRecord(value);
        if (typeof input.paused !== "boolean") throw new RpcContractError("paused must be boolean");
        return { blockId: requiredBlockId(input.blockId), paused: input.paused };
    }),
    getTask: defineRpc<{ blockId: string }, TaskCacheEntry | null>(blockIdParams),
    getNextActions: defineRpc<Record<string, never>, TaskCacheEntry[]>(noParams),
    getAllTasks: defineRpc<{ status?: string; sortBy?: string }, TaskCacheEntry[]>((value) => {
        const input = paramsRecord(value);
        return { status: optionalString(input.status, "status"), sortBy: optionalString(input.sortBy, "sortBy") };
    }),
    getTaskSnapshotV2: defineRpc<Record<string, never>, TaskSnapshotV2>(noParams),
    getProjectSupport: defineRpc<{ projectId: string }, ProjectSupportData>((value) => {
        const input = paramsRecord(value);
        return { projectId: requiredBlockId(input.projectId, "projectId") };
    }),
    getCompletedTasksPage: defineRpc<CompletedTasksPageOptions, CompletedTasksPage>((value) => {
        const input = paramsRecord(value);
        for (const key of ["page", "pageSize"] as const) {
            if (input[key] !== undefined && (!Number.isInteger(input[key]) || Number(input[key]) <= 0)) {
                throw new RpcContractError(`${key} must be a positive integer`);
            }
        }
        if (input.sortBy !== undefined && typeof input.sortBy !== "string")
            throw new RpcContractError("sortBy must be a string");
        if (input.sortAsc !== undefined && typeof input.sortAsc !== "boolean")
            throw new RpcContractError("sortAsc must be boolean");
        return input as CompletedTasksPageOptions;
    }),
    getTasksByParent: defineRpc<{ parentBlockId: string }, TaskCacheEntry[]>((value) => {
        const input = paramsRecord(value);
        return { parentBlockId: requiredBlockId(input.parentBlockId, "parentBlockId") };
    }),
    recalcAllOrders: defineRpc<Record<string, never>, { success: true }>(noParams),
    rebuildCache: defineRpc<Record<string, never>, { success: true }>(noParams),
    getDoneTaskCount: defineRpc<Record<string, never>, { count: number }>(noParams),
    getContexts: defineRpc<Record<string, never>, string[]>(noParams),
    getTags: defineRpc<Record<string, never>, string[]>(noParams),
    rebuildParentRelationships: defineRpc<Record<string, never>, { fixed: number }>(noParams),
    getProjectReminders: defineRpc<Record<string, never>, TaskCacheEntry[]>(noParams),
    reorderTask: defineRpc<{ blockId: string; parentId?: string | null; afterId?: string | null }, TaskCacheEntry>(
        (value) => {
            const input = paramsRecord(value);
            return {
                blockId: requiredBlockId(input.blockId),
                parentId: optionalBlockId(input.parentId, "parentId"),
                afterId: optionalBlockId(input.afterId, "afterId"),
            };
        },
    ),
    getStatistics: defineRpc<{ period?: "week" | "month" }, StatisticsResult>((value) => {
        const input = paramsRecord(value);
        if (input.period !== undefined && input.period !== "week" && input.period !== "month")
            throw new RpcContractError("period must be week or month");
        return { period: input.period };
    }),
    updateSettings: defineRpc<{ settings: Partial<PluginSettings> }, PluginSettings>((value) => {
        const input = paramsRecord(value);
        const settings = requiredObject(input.settings, "settings") as Partial<PluginSettings>;
        const validationError = validateSettings(settings);
        if (validationError) throw new RpcContractError(validationError);
        return { settings };
    }),
    getSettings: defineRpc<Record<string, never>, PluginSettings>(noParams),
    validateAiProposal: defineRpc<{ proposal: AiProposal }, { proposal: AiProposal; errors: string[] }>(
        rawProposalParams,
    ),
    applyAiProposal: defineRpc<{ proposal: AiProposal }, RpcAiApplyResult>(proposalParams),
    getMcpStatus: defineRpc<Record<string, never>, RpcMcpStatus>(noParams),
    listMcpTargetNotebooks: defineRpc<Record<string, never>, RpcMcpNotebookTarget[]>(noParams),
    listMcpTargetDocuments: defineRpc<
        { notebookId: string; path?: string },
        { notebookId: string; path: string; items: RpcMcpDocumentListItem[] }
    >((value) => {
        const input = paramsRecord(value);
        return { notebookId: requiredString(input.notebookId, "notebookId"), path: optionalString(input.path, "path") };
    }),
    searchMcpTargetDocuments: defineRpc<{ query: string }, RpcMcpDocumentListItem[]>((value) => {
        const input = paramsRecord(value);
        return { query: typeof input.query === "string" ? input.query : "" };
    }),
    resolveMcpDocumentTarget: defineRpc<{ value: string }, RpcMcpDocumentTarget>((value) => {
        const input = paramsRecord(value);
        return { value: requiredString(input.value, "value") };
    }),
    resolveChildTarget: defineRpc<{ value: string }, RpcChildTargetResult>((value) => {
        const input = paramsRecord(value);
        return { value: requiredString(input.value, "value") };
    }),
    createTask: defineRpc<CreateTaskInput, CreateTaskResult>(createTaskParams),
    getCustomFieldDiagnostics: defineRpc<Record<string, never>, RpcCustomFieldDiagnostics>(noParams),
    purgeCustomField: defineRpc<{ fieldId: string }, { cleared: number; failedBlockIds: string[] }>((value) => {
        const input = paramsRecord(value);
        return { fieldId: requiredString(input.fieldId, "fieldId") };
    }),
    purgeOrphanCustomField: defineRpc<{ key: string }, { cleared: number; failedBlockIds: string[] }>((value) => {
        const input = paramsRecord(value);
        return { key: requiredString(input.key, "key") };
    }),
    getMyDay: defineRpc<Record<string, never>, MyDayState>(noParams),
    addTaskToMyDay: defineRpc<{ blockId: string }, MyDayState>(blockIdParams),
    removeTaskFromMyDay: defineRpc<{ blockId: string }, MyDayState>(blockIdParams),
    reorderMyDayTask: defineRpc<{ blockId: string; afterId?: string | null }, MyDayState>((value) => {
        const input = paramsRecord(value);
        return { blockId: requiredBlockId(input.blockId), afterId: optionalBlockId(input.afterId, "afterId") };
    }),
    setMyDaySchedule: defineRpc<{ blockId: string; start: number | null; end: number | null }, MyDayState>((value) => {
        const input = paramsRecord(value);
        const start = input.start;
        const end = input.end;
        if (start !== null && (typeof start !== "number" || !Number.isFinite(start)))
            throw new RpcContractError("start must be a number or null");
        if (end !== null && (typeof end !== "number" || !Number.isFinite(end)))
            throw new RpcContractError("end must be a number or null");
        return { blockId: requiredBlockId(input.blockId), start, end };
    }),
    removeMyDaySchedule: defineRpc<{ blockId: string }, MyDayState>(blockIdParams),
    getReviewData: defineRpc<Record<string, never>, ReviewData>(noParams),
    completeReview: defineRpc<Record<string, never>, ReviewData>(noParams),
    markTaskReviewed: defineRpc<{ blockIds: string[] }, TaskCacheEntry[]>((value) => {
        const input = paramsRecord(value);
        if (!Array.isArray(input.blockIds) || input.blockIds.length === 0)
            throw new RpcContractError("blockIds must be a non-empty array");
        return { blockIds: input.blockIds.map((blockId, index) => requiredBlockId(blockId, `blockIds[${index}]`)) };
    }),
} as const;

export type RpcContract = typeof RPC_CONTRACT;
export type RpcMethodName = keyof RpcContract;
export type RpcParams<M extends RpcMethodName> = ReturnType<RpcContract[M]["parseParams"]>;
export type RpcReturn<M extends RpcMethodName> =
    RpcContract[M] extends RpcDefinition<unknown, infer Result> ? Result : never;

export const RPC_METHOD_NAMES = Object.freeze(Object.keys(RPC_CONTRACT) as RpcMethodName[]);

export function parseRpcParams<M extends RpcMethodName>(method: M, value: unknown): RpcParams<M> {
    return RPC_CONTRACT[method].parseParams(value) as RpcParams<M>;
}

export function isRpcFailure(value: unknown): value is RpcFailure {
    if (!value || typeof value !== "object") return false;
    const error = (value as { _rpcError?: unknown })._rpcError;
    return (
        !!error &&
        typeof error === "object" &&
        typeof (error as RpcErrorPayload).code === "number" &&
        typeof (error as RpcErrorPayload).message === "string"
    );
}
