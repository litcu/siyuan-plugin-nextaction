import type { CompletedTasksPage, TaskCacheEntry } from "./types";

export interface CompletedTasksPageOptions {
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortAsc?: boolean;
}

export const DEFAULT_COMPLETED_PAGE_SIZE = 50;
export const MAX_COMPLETED_PAGE_SIZE = 200;

const PRIORITY_WEIGHT: Record<string, number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    veryLow: 1,
    none: 1,
};

function compareOptionalText(a: string, b: string): number {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function completedTime(entry: TaskCacheEntry): string {
    return entry.completed || entry.updated || entry.created || "";
}

function isMissingSortValue(entry: TaskCacheEntry, sortBy: string): boolean {
    if (sortBy === "completed") return !completedTime(entry);
    if (sortBy === "due") return !entry.due;
    if (sortBy.startsWith("custom:")) {
        const key = sortBy.slice("custom:".length);
        return !entry.customFields?.[key];
    }
    return false;
}

function compareField(a: TaskCacheEntry, b: TaskCacheEntry, sortBy: string): number {
    switch (sortBy) {
        case "completed":
            return compareOptionalText(completedTime(a), completedTime(b));
        case "due":
            return compareOptionalText(a.due, b.due);
        case "importance":
            return a.importance - b.importance;
        case "priority":
            return (PRIORITY_WEIGHT[a.priority] || 0) - (PRIORITY_WEIGHT[b.priority] || 0);
        case "order":
            return a.order - b.order;
        default:
            if (sortBy.startsWith("custom:")) {
                const key = sortBy.slice("custom:".length);
                return compareOptionalText(a.customFields?.[key] || "", b.customFields?.[key] || "");
            }
            return compareOptionalText(completedTime(a), completedTime(b));
    }
}

export function sortCompletedTasks(
    tasks: TaskCacheEntry[],
    sortBy: string = "completed",
    sortAsc: boolean = false,
): TaskCacheEntry[] {
    const direction = sortAsc ? 1 : -1;
    return [...tasks].sort((a, b) => {
        const aMissing = isMissingSortValue(a, sortBy);
        const bMissing = isMissingSortValue(b, sortBy);
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        const result = compareField(a, b, sortBy);
        if (result !== 0) return result * direction;
        return a.blockId.localeCompare(b.blockId);
    });
}

export function paginateCompletedTasks(
    tasks: TaskCacheEntry[],
    options: CompletedTasksPageOptions = {},
): CompletedTasksPage {
    const pageSize = Math.min(
        MAX_COMPLETED_PAGE_SIZE,
        Math.max(1, Math.trunc(options.pageSize || DEFAULT_COMPLETED_PAGE_SIZE)),
    );
    const requestedPage = Math.max(1, Math.trunc(options.page || 1));
    const sorted = sortCompletedTasks(
        tasks.filter((task) => task.status === "done"),
        options.sortBy,
        options.sortAsc,
    );
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const start = (page - 1) * pageSize;
    const items = sorted.slice(start, start + pageSize);

    return {
        items,
        total,
        page,
        pageSize,
        hasMore: start + items.length < total,
    };
}
