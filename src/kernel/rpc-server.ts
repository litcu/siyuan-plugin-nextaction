import { RPC_ERROR_INTERNAL } from "../shared/constants";
import type { AiProposalService } from "./ai-proposal-service";
import type { TaskService } from "./task-service";
import type {
    RpcChildTargetResult,
    RpcContract,
    RpcMcpDocumentListItem,
    RpcMcpDocumentTarget,
    RpcMcpNotebookTarget,
    RpcMcpStatus,
    RpcMethodName,
    RpcParams,
    RpcResult,
    RpcReturn,
} from "../shared/rpc-methods";
import { RPC_METHOD_NAMES, RpcContractError, parseRpcParams } from "../shared/rpc-methods";
import type { CreateTaskInput, CreateTaskResult } from "../shared/task-creation";
import type { PluginSettings } from "../shared/settings";
import type { ReviewData, TaskSnapshotV2 } from "../shared/types";
import { errorToRpcError, getSiyuan } from "./utils";

export interface RpcServerHooks {
    updateSettings?: (settings: Partial<PluginSettings>) => Promise<PluginSettings>;
    completeReview?: () => Promise<ReviewData>;
    getMcpStatus?: () => RpcMcpStatus;
    listMcpTargetNotebooks?: () => Promise<RpcMcpNotebookTarget[]>;
    listMcpTargetDocuments?: (
        notebookId: string,
        path: string,
    ) => Promise<{ notebookId: string; path: string; items: RpcMcpDocumentListItem[] }>;
    searchMcpTargetDocuments?: (query: string) => Promise<RpcMcpDocumentListItem[]>;
    resolveMcpDocumentTarget?: (value: unknown) => Promise<RpcMcpDocumentTarget>;
    resolveChildTarget?: (value: unknown) => Promise<RpcChildTargetResult>;
    createTask?: (input: CreateTaskInput) => Promise<CreateTaskResult>;
    aiProposalService?: AiProposalService;
    getTaskSnapshotV2?: () => TaskSnapshotV2;
    broadcastTaskReset?: () => void;
}

type MaybePromise<T> = T | Promise<T>;
type RpcHandlerMap = {
    [Method in RpcMethodName]: (params: RpcParams<Method>) => MaybePromise<RpcReturn<Method>>;
};

function unavailable(name: string): never {
    throw new RpcContractError(`${name} is unavailable`);
}

function formatUnknownError(error: unknown): string {
    if (error instanceof Error) return error.stack || error.message;
    return String(error);
}

function rawParams(method: RpcMethodName, args: unknown[]): unknown {
    if (method !== "echo") return args[0];
    const first = args[0];
    if (first && typeof first === "object" && !Array.isArray(first) && "params" in first) return first;
    return { params: args };
}

function bindRpcMethod<Method extends RpcMethodName>(method: Method, handler: RpcHandlerMap[Method]): void {
    const siyuan = getSiyuan();
    void siyuan.rpc.bind(method, async (...args: unknown[]): Promise<RpcResult<RpcReturn<Method>>> => {
        try {
            const params = parseRpcParams(method, rawParams(method, args));
            return await handler(params);
        } catch (error: unknown) {
            const failure = errorToRpcError(error);
            if (failure._rpcError.code === RPC_ERROR_INTERNAL) {
                await siyuan.logger.error(`RPC ${method} failed: ${formatUnknownError(error)}`);
            }
            return failure;
        }
    });
}

export function registerRpcMethods(taskService: TaskService, hooks: RpcServerHooks = {}): void {
    const handlers: RpcHandlerMap = {
        echo: ({ params }) => params,
        convertToTask: ({ blockId, cleanTitle, taskType }) =>
            taskService.convertToTask(blockId, cleanTitle, taskType || "1"),
        convertToTaskWithChildren: ({ blockId, cleanTitle, taskType }) =>
            taskService.convertToTaskWithChildren(blockId, cleanTitle, taskType || "1"),
        removeTask: async ({ blockId }) => {
            await taskService.removeTask(blockId);
            return { success: true };
        },
        updateTask: ({ blockId, attrs }) => taskService.updateTask(blockId, attrs),
        setRepeatRule: ({ blockId, rule }) => taskService.setRepeatRule(blockId, rule),
        skipRepeatOccurrence: ({ blockId }) => taskService.skipRepeatOccurrence(blockId),
        setRepeatPaused: ({ blockId, paused }) => taskService.setRepeatPaused(blockId, paused),
        getTask: ({ blockId }) => taskService.getTask(blockId),
        getNextActions: () => taskService.getNextActions(),
        getAllTasks: ({ status, sortBy }) => taskService.getAllTasks({ status, sortBy }),
        getTaskSnapshotV2: () => (hooks.getTaskSnapshotV2 ? hooks.getTaskSnapshotV2() : unavailable("task sync V2")),
        getCompletedTasksPage: (params) => taskService.getCompletedTasksPage(params),
        getTasksByParent: ({ parentBlockId }) => taskService.getTasksByParent(parentBlockId),
        recalcAllOrders: async () => {
            await taskService.recalcAllOrders();
            return { success: true };
        },
        rebuildCache: async () => {
            await taskService.rebuildCache();
            hooks.broadcastTaskReset?.();
            return { success: true };
        },
        getDoneTaskCount: () => ({ count: taskService.getDoneTaskCount() }),
        getContexts: () => taskService.getContexts(),
        getTags: () => taskService.getTags(),
        rebuildParentRelationships: async () => ({ fixed: await taskService.rebuildParentRelationships() }),
        getProjectReminders: () => taskService.getProjectReminders(),
        reorderTask: ({ blockId, parentId, afterId }) =>
            taskService.reorderTask(blockId, parentId ?? undefined, afterId ?? undefined),
        getStatistics: ({ period }) => taskService.getStatistics(period || "week"),
        updateSettings: ({ settings }) =>
            hooks.updateSettings
                ? hooks.updateSettings(settings)
                : Promise.resolve(taskService.updateSettings(settings)),
        getSettings: () => taskService.getSettings(),
        validateAiProposal: ({ proposal }) =>
            hooks.aiProposalService ? hooks.aiProposalService.validate(proposal) : unavailable("AI proposal service"),
        applyAiProposal: ({ proposal }) =>
            hooks.aiProposalService ? hooks.aiProposalService.apply(proposal) : unavailable("AI proposal service"),
        getMcpStatus: () =>
            hooks.getMcpStatus
                ? hooks.getMcpStatus()
                : {
                      supported: false,
                      enabled: false,
                      allowWrite: false,
                      endpoint: "/mcp",
                      tools: [],
                      lastError: "MCP manager is unavailable",
                  },
        listMcpTargetNotebooks: () =>
            hooks.listMcpTargetNotebooks ? hooks.listMcpTargetNotebooks() : Promise.resolve([]),
        listMcpTargetDocuments: ({ notebookId, path }) =>
            hooks.listMcpTargetDocuments
                ? hooks.listMcpTargetDocuments(notebookId, path || "/")
                : unavailable("MCP manager"),
        searchMcpTargetDocuments: ({ query }) =>
            hooks.searchMcpTargetDocuments ? hooks.searchMcpTargetDocuments(query) : Promise.resolve([]),
        resolveMcpDocumentTarget: ({ value }) =>
            hooks.resolveMcpDocumentTarget ? hooks.resolveMcpDocumentTarget(value) : unavailable("MCP manager"),
        resolveChildTarget: ({ value }) =>
            hooks.resolveChildTarget ? hooks.resolveChildTarget(value) : unavailable("MCP manager"),
        createTask: (input) => (hooks.createTask ? hooks.createTask(input) : unavailable("MCP manager")),
        getCustomFieldDiagnostics: () => taskService.getCustomFieldDiagnostics(),
        purgeCustomField: ({ fieldId }) => taskService.purgeCustomField(fieldId),
        purgeOrphanCustomField: ({ key }) => taskService.purgeOrphanCustomField(key),
        getMyDay: () => taskService.getMyDay(),
        addTaskToMyDay: ({ blockId }) => taskService.addTaskToMyDay(blockId),
        removeTaskFromMyDay: ({ blockId }) => taskService.removeTaskFromMyDay(blockId),
        reorderMyDayTask: ({ blockId, afterId }) => taskService.reorderMyDayTask(blockId, afterId ?? undefined),
        setMyDaySchedule: ({ blockId, start, end }) => taskService.setMyDaySchedule(blockId, start, end),
        removeMyDaySchedule: ({ blockId }) => taskService.removeMyDaySchedule(blockId),
        getReviewData: () => taskService.getReviewData(),
        completeReview: () => (hooks.completeReview ? hooks.completeReview() : unavailable("completeReview")),
        markTaskReviewed: ({ blockIds }) => taskService.markTaskReviewed(blockIds),
    } satisfies { [Method in keyof RpcContract]: RpcHandlerMap[Method] };

    for (const method of RPC_METHOD_NAMES) {
        bindRpcMethod(method, handlers[method]);
    }
}
