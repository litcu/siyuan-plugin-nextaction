import {
    RPC_ERROR_CIRCULAR_REF,
    RPC_ERROR_DEP_CYCLE,
    RPC_ERROR_INTERNAL,
    RPC_ERROR_INVALID_PARAMS,
    RPC_ERROR_NOT_READY,
    RPC_ERROR_NOT_TEXT_BLOCK,
    RPC_ERROR_PROJECT_REQUIRES_DOCUMENT,
    RPC_ERROR_TASK_NOT_FOUND,
    RPC_ERROR_TIMEOUT,
} from "../shared/constants";

const ERROR_MESSAGE_MAP: [RegExp, string][] = [
    [/cannot depend on ancestor/i, "errDepAncestor"],
    [/due date must not be earlier than start/i, "dueBeforeStart"],
    [/invalid repeat freq/i, "errInvalidRepeatFreq"],
    [/invalid repeat interval/i, "errInvalidRepeatInterval"],
    [/invalid repeat from/i, "errInvalidRepeatFrom"],
    [/repeat task requires a start or due date/i, "repeatNeedsDate"],
    [/repeat series is paused/i, "errRepeatSeriesPaused"],
    [/repeat series has ended/i, "errRepeatSeriesEnded"],
    [/invalid repeat/i, "errInvalidRepeatJson"],
    [/invalid status/i, "errInvalidStatus"],
    [/schedule start and schedule end must both/i, "errScheduleBothOrNone"],
    [/schedule minutes out of range/i, "errScheduleOutOfRange"],
    [/schedule duration too short/i, "errScheduleTooShort"],
    [/schedule duration too long/i, "errScheduleTooLong"],
    [/task .* not found in my day/i, "errMyDayTaskNotFound"],
    [/project cannot be child/i, "errProjectAsChild"],
    [/errNotTextBlock/i, "errNotTextBlock"],
    [/errProjectRequiresDocument/i, "errProjectRequiresDocument"],
    [/circular reference/i, "errCircularRef"],
    [/kernel not ready/i, "errNotReady"],
    [/task not found/i, "errTaskNotFound"],
    [/write lock timeout/i, "errWriteTimeout"],
];

const ERROR_CODE_MAP: Record<number, string> = {
    [RPC_ERROR_INVALID_PARAMS]: "errInvalidParams",
    [RPC_ERROR_TASK_NOT_FOUND]: "errTaskNotFound",
    [RPC_ERROR_CIRCULAR_REF]: "errCircularRef",
    [RPC_ERROR_DEP_CYCLE]: "errDepCycle",
    [RPC_ERROR_NOT_TEXT_BLOCK]: "errNotTextBlock",
    [RPC_ERROR_PROJECT_REQUIRES_DOCUMENT]: "errProjectRequiresDocument",
    [RPC_ERROR_NOT_READY]: "errNotReady",
    [RPC_ERROR_TIMEOUT]: "errWriteTimeout",
    [RPC_ERROR_INTERNAL]: "errInternal",
};

export type I18nRecord = Record<string, string> | null | undefined;

export function formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (error && typeof error === "object" && "message" in error) return String(error.message);
    return String(error);
}

export function formatRpcError(error: unknown, i18n: I18nRecord): string {
    const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
    const nested = record?._rpcError && typeof record._rpcError === "object"
        ? record._rpcError as Record<string, unknown>
        : null;
    const message = String(record?.message ?? nested?.message ?? error);
    for (const [pattern, key] of ERROR_MESSAGE_MAP) {
        if (pattern.test(message)) return i18n?.[key] || message;
    }
    const code = Number(record?.code ?? nested?.code);
    const key = ERROR_CODE_MAP[code];
    return key ? (i18n?.[key] || message || key) : message;
}

export function formatOperationError(error: unknown, i18n: I18nRecord): string {
    const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
    if (record?.kind === "transport") {
        return i18n?.errTransport || "Unable to reach the kernel service. Please retry.";
    }
    if (record?.name === "RpcCallError" || typeof record?.code === "number" || record?._rpcError) {
        return formatRpcError(error, i18n);
    }
    if (error instanceof Error && error.message) return error.message;
    return i18n?.errInternal || "Operation failed";
}
