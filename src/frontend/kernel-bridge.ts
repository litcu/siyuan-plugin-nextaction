import type { TaskCacheEntry, TaskChangeNotification, StatisticsResult, PluginSettings, MyDayState, ReviewData } from "../shared/types";

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

    private async call<T>(method: string, params?: Record<string, any>): Promise<T> {
        const result = await this.plugin.kernel.rpc.call[method](params || {});
        if (hasRpcError(result)) {
            throw new RpcCallError(result._rpcError.code, result._rpcError.message);
        }
        return result as T;
    }

    async convertToTask(blockId: string, cleanTitle?: string, taskType?: string): Promise<TaskCacheEntry> {
        return this.call("convertToTask", { blockId, cleanTitle, taskType });
    }

    async convertToTaskWithChildren(blockId: string, cleanTitle?: string, taskType?: string): Promise<{ converted: number; skipped: number }> {
        return this.call("convertToTaskWithChildren", { blockId, cleanTitle, taskType });
    }

    async removeTask(blockId: string): Promise<void> {
        await this.call("removeTask", { blockId });
    }

    async updateTask(blockId: string, attrs: Record<string, string>): Promise<TaskCacheEntry> {
        return this.call("updateTask", { blockId, attrs });
    }

    async getTask(blockId: string): Promise<TaskCacheEntry | null> {
        return this.call("getTask", { blockId });
    }

    async getNextActions(): Promise<TaskCacheEntry[]> {
        return this.call("getNextActions", {});
    }

    async getAllTasks(filters?: { status?: string; sortBy?: string }): Promise<TaskCacheEntry[]> {
        return this.call("getAllTasks", filters || {});
    }

    async getTasksByParent(parentBlockId: string): Promise<TaskCacheEntry[]> {
        return this.call("getTasksByParent", { parentBlockId });
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
        return this.call("reorderTask", { blockId, parentId: parentId ?? null, afterId: afterId ?? null });
    }

    async convertToProject(blockId: string, cleanTitle?: string): Promise<TaskCacheEntry> {
        return this.call("convertToTask", { blockId, cleanTitle, taskType: "2" });
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

    async getMyDay(): Promise<MyDayState> {
        return this.call("getMyDay", {});
    }

    async addTaskToMyDay(blockId: string): Promise<MyDayState> {
        return this.call("addTaskToMyDay", { blockId });
    }

    async removeTaskFromMyDay(blockId: string): Promise<MyDayState> {
        return this.call("removeTaskFromMyDay", { blockId });
    }

    async reorderMyDayTask(blockId: string, afterId?: string): Promise<MyDayState> {
        return this.call("reorderMyDayTask", { blockId, afterId: afterId ?? null });
    }

    async setMyDaySchedule(blockId: string, start: number | null, end: number | null): Promise<MyDayState> {
        return this.call("setMyDaySchedule", { blockId, start, end });
    }

    async removeMyDaySchedule(blockId: string): Promise<MyDayState> {
        return this.call("removeMyDaySchedule", { blockId });
    }

    async getReviewData(): Promise<ReviewData> {
        return this.call("getReviewData", {});
    }

    async markTaskReviewed(blockIds: string[]): Promise<TaskCacheEntry[]> {
        return this.call("markTaskReviewed", { blockIds });
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
