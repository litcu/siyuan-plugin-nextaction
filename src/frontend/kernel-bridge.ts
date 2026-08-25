import type {
    TaskCacheEntry,
    TaskSnapshotV2,
    StatisticsResult,
    PluginSettings,
    MyDayState,
    ReviewData,
    CompletedTasksPage,
    ProjectSupportData,
} from "../shared/types";
import type { CompletedTasksPageOptions } from "../shared/task-pagination";
import type { AiProposal, AiProposalApplyResult, AiProposalContext } from "../shared/ai";
import type { RepeatRuleV2 } from "../shared/repeat";
import type { CreateTaskInput, CreateTaskResult } from "../shared/task-creation";
import type {
    RpcChildTargetResult,
    RpcMcpDocumentListItem,
    RpcMcpDocumentTarget,
    RpcMcpNotebookTarget,
    RpcMcpStatus,
    RpcMethodName,
    RpcParams,
    RpcReturn,
} from "../shared/rpc-methods";
import type { ExtractActionInput, ExtractActionResult } from "../shared/action-extraction";
import { isRpcFailure } from "../shared/rpc-methods";
import { assertBlockId } from "../shared/block-id";
import { RPC_ERROR_NOT_READY } from "../shared/constants";

interface KernelRpcHost {
    kernel: {
        state: { code: number; description?: string };
        rpc: {
            call: Record<string, (params?: unknown) => Promise<unknown>>;
            bind: (method: string, handler: (...params: unknown[]) => void) => void;
            unbind: (method: string, handler: (...params: unknown[]) => void) => void;
        };
    };
}

export class RpcCallError extends Error {
    code: number;
    constructor(code: number, message: string) {
        super(message);
        this.name = "RpcCallError";
        this.code = code;
    }
}

export class RpcTransportError extends Error {
    readonly kind = "transport";

    constructor(message: string, options?: { cause?: unknown }) {
        super(message);
        this.name = "RpcTransportError";
        if (options && "cause" in options) {
            (this as Error & { cause?: unknown }).cause = options.cause;
        }
    }
}

export class KernelBridge {
    private readonly plugin: KernelRpcHost;

    constructor(plugin: KernelRpcHost) {
        this.plugin = plugin;
    }

    private async call<Method extends RpcMethodName>(
        method: Method,
        params: RpcParams<Method>,
    ): Promise<RpcReturn<Method>> {
        if (this.plugin.kernel.state.code !== 2) {
            throw new RpcCallError(RPC_ERROR_NOT_READY, "Kernel not ready");
        }
        let result: unknown;
        try {
            result = await this.plugin.kernel.rpc.call[method](params);
        } catch (cause: unknown) {
            const message = cause instanceof Error ? cause.message : String(cause);
            throw new RpcTransportError(message || "Kernel RPC transport failed", { cause });
        }
        if (isRpcFailure(result)) {
            throw new RpcCallError(result._rpcError.code, result._rpcError.message);
        }
        return result as RpcReturn<Method>;
    }

    async echo(params: unknown[] = []): Promise<unknown[]> {
        return this.call("echo", { params });
    }

    async convertToTask(blockId: string, cleanTitle?: string, taskType?: string): Promise<TaskCacheEntry> {
        return this.call("convertToTask", { blockId: assertBlockId(blockId), cleanTitle, taskType });
    }

    async convertToTaskWithChildren(
        blockId: string,
        cleanTitle?: string,
        taskType?: string,
    ): Promise<{ converted: number; skipped: number }> {
        return this.call("convertToTaskWithChildren", { blockId: assertBlockId(blockId), cleanTitle, taskType });
    }

    async removeTask(blockId: string): Promise<void> {
        await this.call("removeTask", { blockId: assertBlockId(blockId) });
    }

    async updateTask(blockId: string, attrs: Record<string, string>): Promise<TaskCacheEntry> {
        return this.call("updateTask", { blockId: assertBlockId(blockId), attrs });
    }

    async setRepeatRule(blockId: string, rule: RepeatRuleV2): Promise<TaskCacheEntry> {
        return this.call("setRepeatRule", { blockId: assertBlockId(blockId), rule });
    }

    async skipRepeatOccurrence(blockId: string): Promise<TaskCacheEntry> {
        return this.call("skipRepeatOccurrence", { blockId: assertBlockId(blockId) });
    }

    async setRepeatPaused(blockId: string, paused: boolean): Promise<TaskCacheEntry> {
        return this.call("setRepeatPaused", { blockId: assertBlockId(blockId), paused });
    }

    async getTask(blockId: string): Promise<TaskCacheEntry | null> {
        return this.call("getTask", { blockId: assertBlockId(blockId) });
    }

    async getNextActions(): Promise<TaskCacheEntry[]> {
        return this.call("getNextActions", {});
    }

    async getAllTasks(filters?: { status?: string; sortBy?: string }): Promise<TaskCacheEntry[]> {
        return this.call("getAllTasks", filters || {});
    }

    async getTaskSnapshotV2(): Promise<TaskSnapshotV2> {
        return this.call("getTaskSnapshotV2", {});
    }

    async getProjectSupport(projectId: string): Promise<ProjectSupportData> {
        return this.call("getProjectSupport", { projectId: assertBlockId(projectId, "projectId") });
    }

    async extractAction(input: ExtractActionInput): Promise<ExtractActionResult> {
        return this.call("extractAction", {
            ...input,
            sourceBlockId: assertBlockId(input.sourceBlockId, "sourceBlockId"),
            ...(input.projectId ? { projectId: assertBlockId(input.projectId, "projectId") } : {}),
        });
    }

    async getCompletedTasksPage(options: CompletedTasksPageOptions = {}): Promise<CompletedTasksPage> {
        return this.call("getCompletedTasksPage", options);
    }

    async getTasksByParent(parentBlockId: string): Promise<TaskCacheEntry[]> {
        return this.call("getTasksByParent", { parentBlockId: assertBlockId(parentBlockId, "parentBlockId") });
    }

    async recalcAllOrders(): Promise<void> {
        await this.call("recalcAllOrders", {});
    }

    async rebuildCache(): Promise<void> {
        await this.call("rebuildCache", {});
    }

    async rebuildParentRelationships(): Promise<number> {
        const result = await this.call("rebuildParentRelationships", {});
        return result.fixed;
    }

    async getContexts(): Promise<string[]> {
        return this.call("getContexts", {});
    }

    async getTags(): Promise<string[]> {
        return this.call("getTags", {});
    }

    async getDoneTaskCount(): Promise<number> {
        const result = await this.call("getDoneTaskCount", {});
        return result.count;
    }

    async getProjectReminders(): Promise<TaskCacheEntry[]> {
        return this.call("getProjectReminders", {});
    }

    async reorderTask(blockId: string, parentId?: string, afterId?: string): Promise<TaskCacheEntry> {
        return this.call("reorderTask", {
            blockId: assertBlockId(blockId),
            parentId: parentId ? assertBlockId(parentId, "parentId") : null,
            afterId: afterId ? assertBlockId(afterId, "afterId") : null,
        });
    }

    async convertToProject(blockId: string, cleanTitle?: string): Promise<TaskCacheEntry> {
        return this.call("convertToTask", { blockId: assertBlockId(blockId), cleanTitle, taskType: "2" });
    }

    async getStatistics(period: "week" | "month" = "week"): Promise<StatisticsResult> {
        return this.call("getStatistics", { period });
    }

    async updateSettings(settings: Partial<PluginSettings>): Promise<PluginSettings> {
        return this.call("updateSettings", { settings });
    }

    async getSettings(): Promise<PluginSettings> {
        return this.call("getSettings", {});
    }

    async validateAiProposal(
        proposal: AiProposal,
        context: AiProposalContext = {},
    ): Promise<{ proposal: AiProposal; errors: string[] }> {
        return this.call("validateAiProposal", { proposal, context });
    }

    async applyAiProposal(proposal: AiProposal, context: AiProposalContext = {}): Promise<AiProposalApplyResult> {
        return this.call("applyAiProposal", { proposal, context });
    }

    async getMcpStatus(): Promise<RpcMcpStatus> {
        return this.call("getMcpStatus", {});
    }

    async listMcpTargetNotebooks(): Promise<RpcMcpNotebookTarget[]> {
        return this.call("listMcpTargetNotebooks", {});
    }

    async listMcpTargetDocuments(
        notebookId: string,
        path = "/",
    ): Promise<{ notebookId: string; path: string; items: RpcMcpDocumentListItem[] }> {
        return this.call("listMcpTargetDocuments", { notebookId, path });
    }

    async searchMcpTargetDocuments(query: string): Promise<RpcMcpDocumentListItem[]> {
        return this.call("searchMcpTargetDocuments", { query });
    }

    async createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
        return this.call("createTask", input);
    }

    async resolveMcpDocumentTarget(value: string): Promise<RpcMcpDocumentTarget> {
        return this.call("resolveMcpDocumentTarget", { value });
    }

    async resolveChildTarget(value: string): Promise<RpcChildTargetResult> {
        return this.call("resolveChildTarget", { value });
    }

    async getCustomFieldDiagnostics(): Promise<{
        fields: Array<{ fieldId: string; key: string; status: string; count: number }>;
        orphans: Array<{ key: string; count: number; sampleBlockIds: string[] }>;
    }> {
        return this.call("getCustomFieldDiagnostics", {});
    }

    async purgeCustomField(fieldId: string): Promise<{ cleared: number; failedBlockIds: string[] }> {
        return this.call("purgeCustomField", { fieldId });
    }

    async purgeOrphanCustomField(key: string): Promise<{ cleared: number; failedBlockIds: string[] }> {
        return this.call("purgeOrphanCustomField", { key });
    }

    async getMyDay(): Promise<MyDayState> {
        return this.call("getMyDay", {});
    }

    async addTaskToMyDay(blockId: string): Promise<MyDayState> {
        return this.call("addTaskToMyDay", { blockId: assertBlockId(blockId) });
    }

    async removeTaskFromMyDay(blockId: string): Promise<MyDayState> {
        return this.call("removeTaskFromMyDay", { blockId: assertBlockId(blockId) });
    }

    async reorderMyDayTask(blockId: string, afterId?: string): Promise<MyDayState> {
        return this.call("reorderMyDayTask", {
            blockId: assertBlockId(blockId),
            afterId: afterId ? assertBlockId(afterId, "afterId") : null,
        });
    }

    async setMyDaySchedule(blockId: string, start: number | null, end: number | null): Promise<MyDayState> {
        return this.call("setMyDaySchedule", { blockId: assertBlockId(blockId), start, end });
    }

    async removeMyDaySchedule(blockId: string): Promise<MyDayState> {
        return this.call("removeMyDaySchedule", { blockId: assertBlockId(blockId) });
    }

    async getReviewData(): Promise<ReviewData> {
        return this.call("getReviewData", {});
    }

    async completeReview(): Promise<ReviewData> {
        return this.call("completeReview", {});
    }

    async markTaskReviewed(blockIds: string[]): Promise<TaskCacheEntry[]> {
        return this.call("markTaskReviewed", {
            blockIds: blockIds.map((blockId, index) => assertBlockId(blockId, `blockIds[${index}]`)),
        });
    }
}
