import {
    ATTR_PREFIX,
    ATTR_EXT_PREFIX,
    ATTR_REMINDER,
    ATTR_PARENT,
    ATTR_DEPENDS,
    ATTR_OUTCOME,
    ATTR_DOD,
    ATTR_KIND,
    RPC_ERROR_INTERNAL,
    RPC_ERROR_INVALID_PARAMS,
    RPC_ERROR_TASK_NOT_FOUND,
    RPC_ERROR_CIRCULAR_REF,
    RPC_ERROR_NOT_READY,
    RPC_ERROR_TIMEOUT,
    RPC_ERROR_DEP_CYCLE,
    RPC_ERROR_NOT_TEXT_BLOCK,
    RPC_ERROR_PROJECT_REQUIRES_DOCUMENT,
    RPC_ERROR_ACTION_MOVE_NOT_MOVED,
    RPC_ERROR_ACTION_MOVE_RECOVERED,
    RPC_ERROR_ACTION_MOVE_RECOVERY_FAILED,
    RPC_ERROR_ACTION_MOVE_TARGET_CHANGED,
    RPC_ERROR_ACTION_MOVE_UNDO_INVALID,
    RPC_ERROR_ACTION_MOVE_UNDO_UNSAFE,
    RPC_ERROR_PROJECT_BOARD_MOVE_INVALID_TARGET,
    RPC_ERROR_PROJECT_BOARD_MOVE_UNDO_INVALID,
    RPC_ERROR_PROJECT_BOARD_MOVE_UNDO_UNSAFE,
} from "../shared/constants";
import { isBlockId, isBlockIdPipe } from "../shared/block-id";
import type { RpcFailure } from "../shared/rpc-methods";
import { McpToolError } from "./mcp-tool-error";
import { getDefaultSiyuanApi, ProductionSiyuanApi, setDefaultSiyuanApi } from "./siyuan-api";
import type * as kernel from "siyuan/kernel";

let siyuanRef: kernel.ISiyuan | null = null;

export function setSiyuan(siyuan: kernel.ISiyuan): void {
    siyuanRef = siyuan;
    setDefaultSiyuanApi(new ProductionSiyuanApi(siyuan));
}

export function getSiyuan(): kernel.ISiyuan {
    if (!siyuanRef) throw new Error("SiYuan kernel API is not initialized");
    return siyuanRef;
}

export async function siyuanFetch<T = unknown>(path: `/${string}`, body: object = {}): Promise<T> {
    return getDefaultSiyuanApi().request<T>(path, body);
}

export function attrToNumber(value: string | undefined | null, defaultVal: number): number {
    if (value === undefined || value === null || value === "") {
        return defaultVal;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return defaultVal;
    }
    return Math.trunc(num);
}

export function numberToAttr(val: number): string {
    return String(val);
}

/**
 * Strip slash command remnants from a title string.
 * Catches patterns like /ntask, /nproject, /转..., /新..., or any /word at the start.
 */
export function cleanSlashFromTitle(title: string): string {
    return title.replace(/\/[a-zA-Z\u4e00-\u9fff]\S*/g, "").trim();
}

export function validateTaskAttrs(attrs: Record<string, string>): string | null {
    for (const key of Object.keys(attrs)) {
        if (!key.startsWith(ATTR_PREFIX)) {
            return `Invalid attribute key: ${key}, must start with ${ATTR_PREFIX}`;
        }
        if (typeof attrs[key] !== "string") {
            return `Invalid attribute value for ${key}: must be string`;
        }
        if (key === ATTR_PARENT && attrs[key] !== "" && !isBlockId(attrs[key])) {
            return `Invalid attribute value for ${key}: must be a raw SiYuan block ID`;
        }
        if (key === ATTR_DEPENDS && !isBlockIdPipe(attrs[key])) {
            return `Invalid attribute value for ${key}: must contain raw SiYuan block IDs`;
        }
        if (key === ATTR_OUTCOME && (/\r|\n/.test(attrs[key]) || attrs[key].length > 500)) {
            return `Invalid attribute value for ${key}: must be single-line plain text <= 500 characters`;
        }
        if (key === ATTR_DOD && attrs[key].length > 4000) {
            return `Invalid attribute value for ${key}: must be plain text <= 4000 characters`;
        }
        if (key === ATTR_KIND && attrs[key] !== "" && attrs[key] !== "action" && attrs[key] !== "stage") {
            return `Invalid attribute value for ${key}: must be action or stage`;
        }
        if (key === ATTR_REMINDER) {
            const val = attrs[key];
            if (val.trim() !== "") {
                try {
                    const parsed = JSON.parse(val);
                    if (!Array.isArray(parsed)) {
                        return `Invalid attribute value for ${key}: must be a JSON array`;
                    }
                    if (parsed.length > 7) {
                        return `Invalid attribute value for ${key}: array length must be <= 7`;
                    }
                    for (const item of parsed) {
                        if (!item || typeof item !== "object") {
                            return `Invalid attribute value for ${key}: array items must be objects`;
                        }
                        if (item.type === "relative") {
                            if (!Number.isInteger(item.minutes) || item.minutes < 1) {
                                return `Invalid attribute value for ${key}: relative.minutes must be positive integer`;
                            }
                        } else if (item.type === "absolute") {
                            if (typeof item.time !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(item.time)) {
                                return `Invalid attribute value for ${key}: absolute.time must be YYYY-MM-DDTHH:mm`;
                            }
                        } else {
                            return `Invalid attribute value for ${key}: unknown type "${item.type}"`;
                        }
                    }
                } catch {
                    return `Invalid attribute value for ${key}: must be valid JSON`;
                }
            }
        }
    }
    return null;
}

const KNOWN_ERROR_CODES = new Set([
    RPC_ERROR_INVALID_PARAMS,
    RPC_ERROR_TASK_NOT_FOUND,
    RPC_ERROR_CIRCULAR_REF,
    RPC_ERROR_NOT_READY,
    RPC_ERROR_TIMEOUT,
    RPC_ERROR_DEP_CYCLE,
    RPC_ERROR_NOT_TEXT_BLOCK,
    RPC_ERROR_PROJECT_REQUIRES_DOCUMENT,
    RPC_ERROR_ACTION_MOVE_NOT_MOVED,
    RPC_ERROR_ACTION_MOVE_RECOVERED,
    RPC_ERROR_ACTION_MOVE_RECOVERY_FAILED,
    RPC_ERROR_ACTION_MOVE_TARGET_CHANGED,
    RPC_ERROR_ACTION_MOVE_UNDO_INVALID,
    RPC_ERROR_ACTION_MOVE_UNDO_UNSAFE,
    RPC_ERROR_PROJECT_BOARD_MOVE_INVALID_TARGET,
    RPC_ERROR_PROJECT_BOARD_MOVE_UNDO_INVALID,
    RPC_ERROR_PROJECT_BOARD_MOVE_UNDO_UNSAFE,
]);

const MCP_INVALID_PARAMS_CODES = new Set([
    "INVALID_INPUT",
    "TARGET_NOT_CONFIGURED",
    "TARGET_NOT_DOCUMENT",
    "TARGET_NOT_FOUND",
    "TARGET_UNSUPPORTED",
]);

export function rpcError(code: number, message: string): RpcFailure {
    return { _rpcError: { code, message } };
}

export function errorToRpcError(error: unknown): RpcFailure {
    if (error instanceof McpToolError) {
        if (error.mcpCode === "NOT_READY") return rpcError(RPC_ERROR_NOT_READY, error.detail);
        if (error.mcpCode === "TASK_NOT_FOUND") return rpcError(RPC_ERROR_TASK_NOT_FOUND, error.detail);
        if (MCP_INVALID_PARAMS_CODES.has(error.mcpCode)) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, error.detail);
        }
        return rpcError(RPC_ERROR_INTERNAL, "Internal error");
    }
    const candidate = error && typeof error === "object" ? (error as { code?: unknown; message?: unknown }) : null;
    const code =
        typeof candidate?.code === "number" && KNOWN_ERROR_CODES.has(candidate.code)
            ? candidate.code
            : RPC_ERROR_INTERNAL;
    const message = code === RPC_ERROR_INTERNAL ? "Internal error" : String(candidate?.message || error);
    return rpcError(code, message);
}
