import {
    RPC_ERROR_INVALID_PARAMS,
    RPC_ERROR_NOT_READY,
    RPC_ERROR_PROJECT_REQUIRES_DOCUMENT,
    RPC_ERROR_TASK_NOT_FOUND,
} from "../shared/constants";

export class McpToolError extends Error {
    readonly mcpCode: string;

    constructor(code: string, message: string) {
        super(`NEXTACTION_${code}: ${message}`);
        this.name = "McpToolError";
        this.mcpCode = code;
    }
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (error && typeof error === "object" && "message" in error) return String(error.message);
    return String(error);
}

export function normalizeMcpToolError(error: unknown): Error {
    if (error instanceof McpToolError) return error;
    const details = error && typeof error === "object" ? (error as { code?: unknown; message?: unknown }) : {};
    const code = details.code;
    if (code === RPC_ERROR_NOT_READY)
        return new McpToolError("NOT_READY", String(details.message || "Kernel is not ready"));
    if (code === RPC_ERROR_TASK_NOT_FOUND)
        return new McpToolError("TASK_NOT_FOUND", String(details.message || "Task not found"));
    if (code === RPC_ERROR_INVALID_PARAMS)
        return new McpToolError("INVALID_INPUT", String(details.message || "Invalid input"));
    if (code === RPC_ERROR_PROJECT_REQUIRES_DOCUMENT) {
        return new McpToolError(
            "INVALID_INPUT",
            String(details.message || "Only document blocks can be converted to projects"),
        );
    }
    const message = getErrorMessage(error) || "Unknown error";
    if (message.startsWith("NEXTACTION_")) return new Error(message);
    return new McpToolError("SIYUAN_API_ERROR", message);
}
