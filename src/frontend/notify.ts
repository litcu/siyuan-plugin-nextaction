import { showMessage } from "siyuan";
import { RPC_ERROR_INVALID_PARAMS, RPC_ERROR_TASK_NOT_FOUND, RPC_ERROR_CIRCULAR_REF, RPC_ERROR_NOT_READY, RPC_ERROR_TIMEOUT, RPC_ERROR_DEP_CYCLE, RPC_ERROR_NOT_TEXT_BLOCK, RPC_ERROR_INTERNAL } from "../shared/constants";

/**
 * Map from kernel error message patterns to i18n keys.
 * Used when the error has no specific code or the code is generic.
 */
const ERROR_MESSAGE_MAP: [RegExp, string][] = [
    [/cannot depend on ancestor/i, "errDepAncestor"],
    [/due date must not be earlier than start/i, "dueBeforeStart"],
    [/invalid repeat freq/i, "errInvalidRepeatFreq"],
    [/invalid repeat interval/i, "errInvalidRepeatInterval"],
    [/invalid repeat from/i, "errInvalidRepeatFrom"],
    [/invalid repeat/i, "errInvalidRepeatJson"],
    [/invalid status/i, "errInvalidStatus"],
    [/schedule start and schedule end must both/i, "errScheduleBothOrNone"],
    [/schedule minutes out of range/i, "errScheduleOutOfRange"],
    [/schedule duration too short/i, "errScheduleTooShort"],
    [/schedule duration too long/i, "errScheduleTooLong"],
    [/task .* not found in my day/i, "errMyDayTaskNotFound"],
    [/project cannot be child/i, "errProjectAsChild"],
    [/errNotTextBlock/i, "errNotTextBlock"],
    [/circular reference/i, "errCircularRef"],
    [/kernel not ready/i, "errNotReady"],
    [/task not found/i, "errTaskNotFound"],
    [/write lock timeout/i, "errWriteTimeout"],
];

/**
 * Map from RPC error codes to i18n keys.
 */
const ERROR_CODE_MAP: Record<number, string> = {
    [RPC_ERROR_INVALID_PARAMS]: "errInvalidParams",
    [RPC_ERROR_TASK_NOT_FOUND]: "errTaskNotFound",
    [RPC_ERROR_CIRCULAR_REF]: "errCircularRef",
    [RPC_ERROR_DEP_CYCLE]: "errDepCycle",
    [RPC_ERROR_NOT_TEXT_BLOCK]: "errNotTextBlock",
    [RPC_ERROR_NOT_READY]: "errNotReady",
    [RPC_ERROR_TIMEOUT]: "errWriteTimeout",
    [RPC_ERROR_INTERNAL]: "errInvalidParams",
};

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

/**
 * Extract a user-friendly error message from an RPC error or generic error.
 */
export function formatError(e: any): string {
    if (e?.code && e?.message) {
        return e.message;
    }
    if (e?.message) {
        return e.message;
    }
    return String(e);
}

/**
 * Format an RPC error with i18n translation.
 * Tries error code mapping first, then message pattern matching.
 * Falls back to the raw error message.
 */
export function formatRpcError(e: any, i18n: any): string {
    // Try error code mapping first
    if (e?.code && ERROR_CODE_MAP[e.code]) {
        const key = ERROR_CODE_MAP[e.code];
        return i18n?.[key] || e.message || key;
    }
    // Try message pattern matching
    const msg = e?.message || e?._rpcError?.message || String(e);
    if (typeof msg === "string") {
        for (const [pattern, key] of ERROR_MESSAGE_MAP) {
            if (pattern.test(msg)) {
                return i18n?.[key] || msg;
            }
        }
    }
    return msg;
}

/**
 * Map validateSettings error messages to i18n keys.
 */
const VALIDATION_MESSAGE_MAP: [RegExp, string][] = [
    [/defaultImportance must be integer 1-7/i, "settingDefaultImportanceDesc"],
    [/defaultEffort must be integer 1-7/i, "settingDefaultEffortDesc"],
    [/dueWeight.*must equal 1\.0/i, "settingWeightDistributionDesc"],
    [/dueDecayTau must be 1-30/i, "errInvalidParams"],
    [/startHorizon must be 1-60/i, "errInvalidParams"],
    [/effortScale must be 0-0\.5/i, "errInvalidParams"],
    [/startPreviewDays must be integer 0-14/i, "errInvalidParams"],
    [/myDayResetHour must be integer 0-23/i, "settingMyDayResetHourDesc"],
    [/myDayDefaultViewMode must be/i, "errInvalidParams"],
    [/myDayDefaultDuration must be integer 15-480/i, "errInvalidParams"],
    [/customFields key must start with a letter/i, "customFieldKeyInvalid"],
    [/customFields key must be unique/i, "customFieldKeyDuplicate"],
    [/customFields label must not be empty/i, "customFieldLabelRequired"],
];

/**
 * Translate a validateSettings error message using i18n.
 */
export function formatValidationError(msg: string, i18n: any): string {
    for (const [pattern, key] of VALIDATION_MESSAGE_MAP) {
        if (pattern.test(msg)) {
            return i18n?.[key] || msg;
        }
    }
    return msg;
}
