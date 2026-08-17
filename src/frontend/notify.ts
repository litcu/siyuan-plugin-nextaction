import { showMessage } from "siyuan";
import { formatOperationError, type I18nRecord } from "./error-format";
export { formatError, formatOperationError, formatRpcError, formatValidationError } from "./error-format";

/**
 * Show an error notification to the user.
 * Uses SiYuan's built-in showMessage with "error" type.
 */
export function notifyError(message: string): void {
    showMessage(`[NextAction] ${message}`, 4000, "error");
}

/**
 * Show an info notification to the user.
 */
export function notifyInfo(message: string): void {
    showMessage(`[NextAction] ${message}`, 3000, "info");
}

/** Route user-initiated operation failures without conflating RPC, transport and domain errors. */
export function notifyOperationError(error: unknown, i18n: I18nRecord): void {
    notifyError(formatOperationError(error, i18n));
}
