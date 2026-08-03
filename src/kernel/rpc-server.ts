import { TaskService } from "./task-service";
import { getSiyuan, rpcError, errorToRpcError } from "./utils";
import {
    RPC_ERROR_INVALID_PARAMS,
} from "../shared/constants";
import type { MyDayState } from "../shared/types";
import type { PluginSettings } from "../shared/settings";
import type { AiProposalService } from "./ai-proposal-service";

interface RpcResult {
    _rpcError?: { code: number; message: string };
    [key: string]: any;
}

export interface RpcServerHooks {
    updateSettings?: (settings: Partial<PluginSettings>) => Promise<PluginSettings | RpcResult>;
    getMcpStatus?: () => any;
    listMcpTargetNotebooks?: () => Promise<any>;
    resolveMcpDocumentTarget?: (value: unknown) => Promise<any>;
    resolveChildTarget?: (value: unknown) => Promise<any>;
    aiProposalService?: AiProposalService;
}

export function registerRpcMethods(taskService: TaskService, hooks: RpcServerHooks = {}): void {
    const siyuan = getSiyuan();

    siyuan.rpc.bind("echo", async (...params: any[]) => {
        return params;
    });

    siyuan.rpc.bind("convertToTask", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId is required");
        }
        try {
            return await taskService.convertToTask(p.blockId, p.cleanTitle, p.taskType || "1");
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("convertToTaskWithChildren", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId is required");
        }
        try {
            return await taskService.convertToTaskWithChildren(p.blockId, p.cleanTitle, p.taskType || "1");
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("removeTask", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId is required");
        }
        try {
            await taskService.removeTask(p.blockId);
            return { success: true };
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("updateTask", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId is required");
        }
        if (!p.attrs || typeof p.attrs !== "object") {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "attrs is required and must be an object");
        }
        try {
            const result = await taskService.updateTask(p.blockId, p.attrs);
            return result;
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("setRepeatRule", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId || !p.rule || typeof p.rule !== "object") {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId and rule are required");
        }
        try {
            return await taskService.setRepeatRule(p.blockId, p.rule);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("skipRepeatOccurrence", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId) return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId is required");
        try {
            return await taskService.skipRepeatOccurrence(p.blockId);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("setRepeatPaused", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId || typeof p.paused !== "boolean") {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId and paused are required");
        }
        try {
            return await taskService.setRepeatPaused(p.blockId, p.paused);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("getTask", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId is required");
        }
        try {
            return taskService.getTask(p.blockId);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("getNextActions", async (..._params: any[]) => {
        try {
            return taskService.getNextActions();
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("getAllTasks", async (...params: any[]) => {
        const p = params[0] || {};
        try {
            return taskService.getAllTasks({
                status: p.status,
                sortBy: p.sortBy,
            });
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("getTasksByParent", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.parentBlockId) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "parentBlockId is required");
        }
        try {
            return taskService.getTasksByParent(p.parentBlockId);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("recalcAllOrders", async (..._params: any[]) => {
        try {
            await taskService.recalcAllOrders();
            return { success: true };
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("rebuildCache", async (..._params: any[]) => {
        try {
            await taskService.rebuildCache();
            return { success: true };
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("getDoneTaskCount", async (..._params: any[]) => {
        try {
            return { count: taskService.getDoneTaskCount() };
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("getContexts", async (..._params: any[]) => {
        try {
            return taskService.getContexts();
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("getTags", async (..._params: any[]) => {
        try {
            return taskService.getTags();
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("rebuildParentRelationships", async (..._params: any[]) => {
        try {
            const fixed = await taskService.rebuildParentRelationships();
            return { fixed };
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("getProjectReminders", async () => {
        try {
            return taskService.getProjectReminders();
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("reorderTask", async (p: any) => {
        if (!p.blockId) return rpcError(RPC_ERROR_INVALID_PARAMS, "Missing blockId");
        try {
            const result = await taskService.reorderTask(p.blockId, p.parentId ?? undefined, p.afterId ?? undefined);
            return result;
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("getStatistics", async (...params: any[]) => {
        const p = params[0] || {};
        try {
            return taskService.getStatistics(p.period || "week");
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("updateSettings", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.settings || typeof p.settings !== "object") {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "settings is required and must be an object");
        }
        try {
            return hooks.updateSettings
                ? await hooks.updateSettings(p.settings)
                : taskService.updateSettings(p.settings);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("getSettings", async (..._params: any[]) => {
        try {
            return taskService.getSettings();
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("validateAiProposal", async (...params: any[]) => {
        if (!hooks.aiProposalService) return rpcError(RPC_ERROR_INVALID_PARAMS, "AI proposal service is unavailable");
        try {
            return hooks.aiProposalService.validate(params[0]?.proposal);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("applyAiProposal", async (...params: any[]) => {
        if (!hooks.aiProposalService) return rpcError(RPC_ERROR_INVALID_PARAMS, "AI proposal service is unavailable");
        try {
            return await hooks.aiProposalService.apply(params[0]?.proposal);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("getMcpStatus", async (..._params: any[]) => {
        try {
            return hooks.getMcpStatus ? hooks.getMcpStatus() : {
                supported: false,
                enabled: false,
                allowWrite: false,
                endpoint: "/mcp",
                tools: [],
                lastError: "MCP manager is unavailable",
            };
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("listMcpTargetNotebooks", async (..._params: any[]) => {
        try {
            return hooks.listMcpTargetNotebooks ? await hooks.listMcpTargetNotebooks() : [];
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("resolveMcpDocumentTarget", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.value) return rpcError(RPC_ERROR_INVALID_PARAMS, "value is required");
        try {
            return hooks.resolveMcpDocumentTarget
                ? await hooks.resolveMcpDocumentTarget(p.value)
                : rpcError(RPC_ERROR_INVALID_PARAMS, "MCP manager is unavailable");
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("resolveChildTarget", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.value) return rpcError(RPC_ERROR_INVALID_PARAMS, "value is required");
        try {
            return hooks.resolveChildTarget
                ? await hooks.resolveChildTarget(p.value)
                : rpcError(RPC_ERROR_INVALID_PARAMS, "MCP manager is unavailable");
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("getCustomFieldDiagnostics", async (..._params: any[]) => {
        try {
            return taskService.getCustomFieldDiagnostics();
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("purgeCustomField", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.fieldId) return rpcError(RPC_ERROR_INVALID_PARAMS, "fieldId is required");
        try {
            return await taskService.purgeCustomField(p.fieldId);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("purgeOrphanCustomField", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.key) return rpcError(RPC_ERROR_INVALID_PARAMS, "key is required");
        try {
            return await taskService.purgeOrphanCustomField(p.key);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("getMyDay", async (..._params: any[]) => {
        try {
            return await taskService.getMyDay();
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("addTaskToMyDay", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId is required");
        }
        try {
            return await taskService.addTaskToMyDay(p.blockId);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("removeTaskFromMyDay", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId is required");
        }
        try {
            return await taskService.removeTaskFromMyDay(p.blockId);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("reorderMyDayTask", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId is required");
        }
        try {
            return await taskService.reorderMyDayTask(p.blockId, p.afterId ?? undefined);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("setMyDaySchedule", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId is required");
        }
        try {
            return await taskService.setMyDaySchedule(p.blockId, p.start ?? null, p.end ?? null);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("removeMyDaySchedule", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId is required");
        }
        try {
            return await taskService.removeMyDaySchedule(p.blockId);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("getReviewData", async (..._params: any[]) => {
        try {
            return taskService.getReviewData();
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("markTaskReviewed", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockIds || !Array.isArray(p.blockIds) || p.blockIds.length === 0) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockIds is required and must be a non-empty array");
        }
        try {
            return await taskService.markTaskReviewed(p.blockIds);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

}
