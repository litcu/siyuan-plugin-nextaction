import type { TaskCacheEntry, TaskChangeNotification, StatisticsResult, PluginSettings, MyDayState, ReviewData, CompletedTasksPage } from "../shared/types";
import type { CompletedTasksPageOptions } from "../shared/task-pagination";
import type { AiProposal } from "../shared/ai";
import type { RepeatRuleV2 } from "../shared/repeat";
import type { CreateTaskInput, CreateTaskResult } from "../shared/task-creation";
import type { RpcMethodName } from "../shared/rpc-methods";
import { assertBlockId } from "../shared/block-id";

interface RpcError {
    code: number;
    message: string;
}

export class RpcCallError extends Error {
    code: number;
    constructor(code: number, message: string) {
        super(message);
        this.name = "RpcCallError";
        this.code = code;
    }
}

function hasRpcError(result: any): result is { _rpcError: RpcError } {
    return result && typeof result === "object" && result._rpcError;
}

export class KernelBridge {
    private plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    private async call<T>(method: RpcMethodName, params?: Record<string, any>): Promise<T> {
        const result = await this.plugin.kernel.rpc.call[method](params || {});
        if (hasRpcError(result)) {
            throw new RpcCallError(result._rpcError.code, result._rpcError.message);
        }
        return result as T;
    }

    async echo(params: unknown[] = []): Promise<unknown[]> {
        return this.call("echo", { params });
    }

    async convertToTask(blockId: string, cleanTitle?: string, taskType?: string): Promise<TaskCacheEntry> {
        return this.call("convertToTask", { blockId: assertBlockId(blockId), cleanTitle, taskType });
    }

    async convertToTaskWithChildren(blockId: string, cleanTitle?: string, taskType?: string): Promise<{ converted: number; skipped: number }> {
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
        const result = await this.call<{ fixed: number }>("rebuildParentRelationships", {});
        return result.fixed;
    }

    async getContexts(): Promise<string[]> {
        return this.call("getContexts", {});
    }

    async getTags(): Promise<string[]> {
        return this.call("getTags", {});
    }

    async getDoneTaskCount(): Promise<number> {
        const result = await this.call<{ count: number }>("getDoneTaskCount", {});
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

    async validateAiProposal(proposal: AiProposal): Promise<{ proposal: AiProposal; errors: string[] }> {
        return this.call("validateAiProposal", { proposal });
    }

    async applyAiProposal(proposal: AiProposal): Promise<{ feature: string; created: TaskCacheEntry[]; converted: TaskCacheEntry[]; myDay: MyDayState | null; warnings: string[] }> {
        return this.call("applyAiProposal", { proposal });
    }

    async getMcpStatus(): Promise<any> {
        return this.call("getMcpStatus", {});
    }

    async listMcpTargetNotebooks(): Promise<Array<{ id: string; name: string; icon: string }>> {
        return this.call("listMcpTargetNotebooks", {});
    }

    async listMcpTargetDocuments(notebookId: string, path = "/"): Promise<{ notebookId: string; path: string; items: Array<{ id: string; title: string; notebookId: string; path: string; icon: string; hasChildren: boolean }> }> {
        return this.call("listMcpTargetDocuments", { notebookId, path });
    }

    async searchMcpTargetDocuments(query: string): Promise<Array<{ id: string; title: string; notebookId: string; notebookName?: string; path: string; icon: string; hasChildren: boolean }>> {
        return this.call("searchMcpTargetDocuments", { query });
    }

    async createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
        return this.call("createTask", input as unknown as Record<string, any>);
    }

    async resolveMcpDocumentTarget(value: string): Promise<{ id: string; title: string; notebookId: string; path?: string; icon?: string }> {
        return this.call("resolveMcpDocumentTarget", { value });
    }

    async resolveChildTarget(value: string): Promise<{ available: boolean; parentBlockId: string; containerId?: string; containerType?: string; reason?: string }> {
        return this.call("resolveChildTarget", { value });
    }

    async getCustomFieldDiagnostics(): Promise<{ fields: Array<{ fieldId: string; key: string; status: string; count: number }>; orphans: Array<{ key: string; count: number; sampleBlockIds: string[] }> }> {
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

    bindTasksChanged(handler: (notification: TaskChangeNotification) => void): void {
        this.plugin.kernel.rpc.bind("tasksChanged", (...params: any[]) => {
            handler(params[0] as TaskChangeNotification);
        });
    }

    unbindTasksChanged(handler: (...params: any[]) => void): void {
        this.plugin.kernel.rpc.unbind("tasksChanged", handler);
    }
}
