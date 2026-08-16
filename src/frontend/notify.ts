import { showMessage } from "siyuan";
export { formatError, formatRpcError } from "./error-format";

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
    [/custom field key must use lowercase/i, "customFieldKeyInvalid"],
    [/custom field key must be unique/i, "customFieldKeyDuplicate"],
    [/custom field label must not be empty/i, "customFieldLabelRequired"],
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
