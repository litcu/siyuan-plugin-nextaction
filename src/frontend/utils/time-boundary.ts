const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_MS = 3 * DAY_MS;

export interface DuePresentation {
    isOverdue: boolean;
    isDueSoon: boolean;
}

export interface DueDateI18n {
    overdueDays?: string;
    overdueToday?: string;
    dueToday?: string;
    dueTomorrow?: string;
    dueInDays?: string;
    dueDateFormat?: string;
}

function parseLocalDateOnly(value: string): Date {
    const datePart = value.split("T")[0];
    const [year, month, day] = datePart.split("-").map(Number);
    return new Date(year, month - 1, day);
}

function dueComparisonTime(due: string): number {
    if (!due) return Number.NaN;
    if (due.includes("T")) return new Date(due).getTime();

    const endOfDay = parseLocalDateOnly(due);
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay.getTime();
}

export function getDuePresentation(due: string, nowMs: number): DuePresentation {
    const dueMs = dueComparisonTime(due);
    if (!Number.isFinite(dueMs)) {
        return { isOverdue: false, isDueSoon: false };
    }

    const diffMs = dueMs - nowMs;
    const isOverdue = diffMs <= 0;
    return {
        isOverdue,
        isDueSoon: !isOverdue && diffMs <= DUE_SOON_MS,
    };
}

export function formatDueDate(due: string, nowMs: number, i18n?: DueDateI18n): string {
    if (!due) return "";

    const hasTime = due.includes("T");
    const dueDate = hasTime ? new Date(due) : parseLocalDateOnly(due);
    if (!Number.isFinite(dueDate.getTime())) return due;

    const dueDay = parseLocalDateOnly(due);
    const timeStr = hasTime ? due.split("T")[1] : "";
    const dueMs = dueComparisonTime(due);

    if (hasTime && nowMs >= dueMs) {
        const diffDays = Math.floor((nowMs - dueMs) / DAY_MS);
        const base = diffDays > 0
            ? (i18n?.overdueDays || "{n} days overdue").replace("{n}", String(diffDays))
            : i18n?.overdueToday || "Overdue today";
        return timeStr ? `${base} ${timeStr}` : base;
    }

    const now = new Date(nowMs);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((dueDay.getTime() - today.getTime()) / DAY_MS);
    if (diffDays < 0) {
        const base = (i18n?.overdueDays || "{n} days overdue").replace("{n}", String(Math.abs(diffDays)));
        return timeStr ? `${base} ${timeStr}` : base;
    }
    if (diffDays === 0) {
        const base = i18n?.dueToday || "Due today";
        return timeStr ? `${base} ${timeStr}` : base;
    }
    if (diffDays === 1) {
        const base = i18n?.dueTomorrow || "Due tomorrow";
        return timeStr ? `${base} ${timeStr}` : base;
    }
    if (diffDays <= 7) {
        const base = (i18n?.dueInDays || "Due in {n} days").replace("{n}", String(diffDays));
        return timeStr ? `${base} ${timeStr}` : base;
    }

    const month = dueDate.getMonth() + 1;
    const day = dueDate.getDate();
    const base = (i18n?.dueDateFormat || "{m}/{d}")
        .replace("{m}", String(month))
        .replace("{d}", String(day));
    return timeStr ? `${base} ${timeStr}` : base;
}

/** Returns the next due-specific instant at which presentation may change. */
export function getNextDueBoundary(due: string, nowMs: number): number | null {
    const dueMs = dueComparisonTime(due);
    if (!Number.isFinite(dueMs)) return null;

    const candidates: number[] = [];
    const dueSoonMs = dueMs - DUE_SOON_MS;
    if (dueSoonMs > nowMs) candidates.push(dueSoonMs);
    if (dueMs > nowMs) candidates.push(dueMs);

    // Datetime labels change from "overdue today" to an overdue-day count
    // whenever another full 24-hour period has elapsed since the due instant.
    if (due.includes("T") && dueMs <= nowMs) {
        const elapsedDays = Math.floor((nowMs - dueMs) / DAY_MS);
        candidates.push(dueMs + (elapsedDays + 1) * DAY_MS);
    }

    if (candidates.length === 0) return null;
    return Math.min(...candidates);
}

export function getNextLocalMidnight(nowMs: number): number {
    const now = new Date(nowMs);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
}

/** Finds the next relevant boundary for the currently mounted due labels. */
export function findNextTimeBoundary(dueValues: Iterable<string>, nowMs: number): number | null {
    let next: number | null = null;
    let hasValidDue = false;

    for (const due of dueValues) {
        if (!Number.isFinite(dueComparisonTime(due))) continue;
        hasValidDue = true;
        const boundary = getNextDueBoundary(due, nowMs);
        if (boundary !== null && (next === null || boundary < next)) {
            next = boundary;
        }
    }

    if (!hasValidDue) return null;
    const midnight = getNextLocalMidnight(nowMs);
    return next === null ? midnight : Math.min(next, midnight);
}
