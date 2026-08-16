import { ATTR_PREFIX, ATTR_EXT_PREFIX, ATTR_REMINDER, ATTR_PARENT, ATTR_DEPENDS, RPC_ERROR_INTERNAL, RPC_ERROR_INVALID_PARAMS, RPC_ERROR_TASK_NOT_FOUND, RPC_ERROR_CIRCULAR_REF, RPC_ERROR_NOT_READY, RPC_ERROR_TIMEOUT, RPC_ERROR_DEP_CYCLE, RPC_ERROR_NOT_TEXT_BLOCK, RPC_ERROR_PROJECT_REQUIRES_DOCUMENT } from "../shared/constants";
import { isBlockId, isBlockIdPipe } from "../shared/block-id";
import { getDefaultSiyuanApi, ProductionSiyuanApi, setDefaultSiyuanApi } from "./siyuan-api";

let siyuanRef: any = null;

export function setSiyuan(siyuan: any): void {
    siyuanRef = siyuan;
    setDefaultSiyuanApi(new ProductionSiyuanApi(siyuan));
}

export function getSiyuan(): any {
    return siyuanRef;
}

export async function siyuanFetch<T = any>(path: `/${string}`, body: object = {}): Promise<T> {
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
    return title
        .replace(/\/[a-zA-Z\u4e00-\u9fff]\S*/g, "")
        .trim();
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
                    // Old format: array of numbers — still accepted
                    if (parsed.length > 0 && typeof parsed[0] === "number") {
                        for (const item of parsed) {
                            if (!Number.isInteger(item) || item < 0) {
                                return `Invalid attribute value for ${key}: array items must be non-negative integers`;
                            }
                        }
                    } else {
                        // New format: array of ReminderItem objects
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
]);

interface RpcResult {
    _rpcError?: { code: number; message: string };
    [key: string]: any;
}

export function rpcError(code: number, message: string): RpcResult {
    return { _rpcError: { code, message } };
}

export function errorToRpcError(e: any): RpcResult {
    const code = (e && typeof e.code === "number" && KNOWN_ERROR_CODES.has(e.code))
        ? e.code
        : RPC_ERROR_INTERNAL;
    return rpcError(code, String(e.message || e));
}
