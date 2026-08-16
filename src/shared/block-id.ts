import { RPC_ERROR_INVALID_PARAMS } from "./constants";

export const BLOCK_ID_SOURCE = String.raw`\d{14}-[0-9a-z]{7}`;
const BLOCK_ID_RE = new RegExp(`^${BLOCK_ID_SOURCE}$`);
const BLOCK_URI_RE = new RegExp(`^siyuan://blocks/(${BLOCK_ID_SOURCE})$`);

export function isBlockId(value: unknown): value is string {
    return typeof value === "string" && BLOCK_ID_RE.test(value);
}

export function extractBlockId(value: unknown): string {
    if (isBlockId(value)) return value;
    if (typeof value !== "string") return "";
    return BLOCK_URI_RE.exec(value)?.[1] ?? "";
}

export function assertBlockId(value: unknown, fieldName = "blockId"): string {
    if (isBlockId(value)) return value;
    const error = new Error(`${fieldName} must be a raw SiYuan block ID`) as Error & { code: number };
    error.code = RPC_ERROR_INVALID_PARAMS;
    throw error;
}

export function isOptionalBlockId(value: unknown): boolean {
    return value === undefined || value === null || value === "" || isBlockId(value);
}

export function areBlockIds(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(isBlockId);
}

export function isBlockIdPipe(value: unknown): boolean {
    return typeof value === "string" && (value === "" || value.split("|").every(isBlockId));
}
