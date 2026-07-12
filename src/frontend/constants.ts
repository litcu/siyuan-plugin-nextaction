export const PRIORITY_COLORS: Record<string, string> = {
    critical: "var(--na-priority-critical)",
    high: "var(--na-priority-high)",
    medium: "var(--na-priority-medium)",
    low: "var(--na-priority-low)",
    none: "transparent",
};

// Fallback hex colors for inline style computations (NaBadge bg, priority dot)
export const PRIORITY_HEX_COLORS: Record<string, string> = {
    critical: "#e74c3c",
    high: "#f39c12",
    medium: "#5dade2",
    low: "#95a5a6",
    none: "",
};

export const VIEW_INBOX = "inbox";
export const VIEW_SOMEDAY = "someday";
export const VIEW_WAITING = "waiting";
export const VIEW_MY_DAY = "myDay";
export const VIEW_NEXT_ACTION = "nextAction";
export const VIEW_ALL_TASKS = "all";
export const VIEW_BY_PROJECT = "byProject";
export const VIEW_STATISTICS = "statistics";
export const VIEW_REVIEW = "review";
export const VIEW_REMINDER = "reminder";
export type ViewType = typeof VIEW_INBOX | typeof VIEW_NEXT_ACTION | typeof VIEW_ALL_TASKS | typeof VIEW_BY_PROJECT | typeof VIEW_SOMEDAY | typeof VIEW_WAITING | typeof VIEW_MY_DAY | typeof VIEW_STATISTICS | typeof VIEW_REVIEW | typeof VIEW_REMINDER;

export const STATUS_LIST = ["inbox", "todo", "doing", "waiting", "someday", "done"] as const;
export const PRIORITY_LIST = ["critical", "high", "medium", "low", "none"] as const;
