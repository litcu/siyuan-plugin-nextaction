// src/frontend/utils/filter.ts
import type { TaskCacheEntry } from "../../shared/types";
import { PRIORITY_LIST } from "../constants";

const PRIORITY_OFFSET: Record<string, number> = {
    critical: 1.5,
    high: 0.8,
    medium: 0,
    low: -0.8,
    none: -1.2,
};

function effectiveImportance(importance: number, priority: string): number {
    const offset = PRIORITY_OFFSET[priority] ?? 0;
    return Math.max(0.5, Math.min(8.5, importance + offset));
}

export interface FilterState {
    searchText: string;
    contexts: string[];
    priorities: string[];
    statuses: string[];
    tags: string[];
    sortBy: string; // "order" | "due" | "importance" | "priority"
    sortAsc: boolean;
}

export const DEFAULT_FILTER_STATE: FilterState = {
    searchText: "",
    contexts: [],
    priorities: [],
    statuses: [],
    tags: [],
    sortBy: "order",
    sortAsc: false,
};

export function isNextActionCandidate(entry: TaskCacheEntry, startPreviewDays: number = 0): boolean {
    if (entry.status === "done") return false;
    if (entry.status === "waiting") return false;
    if (entry.status === "inbox") return false;
    if (entry.start) {
        const startDate = entry.start.slice(0, 10);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + startPreviewDays);
        const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
        if (startDate > cutoffStr) return false;
    }
    if (entry.taskType === "2") return false;
    if (entry.blocked) return false;
    return true;
}

export function applyFilters(tasks: TaskCacheEntry[], filters: FilterState): TaskCacheEntry[] {
    let result = tasks;

    // 1. Text search on title and tags
    if (filters.searchText) {
        const q = filters.searchText.toLowerCase();
        result = result.filter(t => {
            if (t.title.toLowerCase().includes(q)) return true;
            if (t.tags && t.tags.replace(/\|/g, ', ').toLowerCase().includes(q)) return true;
            return false;
        });
    }

    // 2. Context filter (OR within dimension)
    if (filters.contexts.length > 0) {
        result = result.filter(t => {
            if (!t.context) return false;
            const taskContexts = t.context.split("|").map(c => c.trim());
            return taskContexts.some(c => filters.contexts.includes(c));
        });
    }

    // 3. Priority filter (OR within dimension)
    if (filters.priorities.length > 0) {
        result = result.filter(t => filters.priorities.includes(t.priority));
    }

    // 4. Status filter (OR within dimension)
    if (filters.statuses.length > 0) {
        result = result.filter(t => filters.statuses.includes(t.status));
    }

    // 5. Tag filter (OR within dimension)
    if (filters.tags.length > 0) {
        result = result.filter(t => {
            if (!t.tags) return false;
            const taskTags = t.tags.split("|").map(tag => tag.trim());
            return taskTags.some(tag => filters.tags.includes(tag));
        });
    }

    // 6. Sort
    result = sortTasksBy(result, filters.sortBy, filters.sortAsc);

    return result;
}

export function sortTasksBy(tasks: TaskCacheEntry[], sortBy: string, sortAsc: boolean): TaskCacheEntry[] {
    const arr = [...tasks];
    const dir = sortAsc ? 1 : -1;

    switch (sortBy) {
        case "due":
            arr.sort((a, b) => {
                if (!a.due && !b.due) return 0;
                if (!a.due) return 1;
                if (!b.due) return -1;
                return dir * a.due.localeCompare(b.due);
            });
            break;
        case "importance":
            arr.sort((a, b) => dir * (a.importance - b.importance));
            break;
        case "priority":
            arr.sort((a, b) => {
                const pw = [5, 4, 3, 2, 1];
                const aIdx = PRIORITY_LIST.indexOf(a.priority as any);
                const bIdx = PRIORITY_LIST.indexOf(b.priority as any);
                return dir * ((pw[aIdx] || 0) - (pw[bIdx] || 0));
            });
            break;
        case "order":
        default:
            arr.sort((a, b) => {
                if (b.order !== a.order) return b.order - a.order;
                if (a.due && b.due) {
                    if (a.due !== b.due) return a.due.localeCompare(b.due);
                } else if (a.due) {
                    return -1;
                } else if (b.due) {
                    return 1;
                }
                const aEff = effectiveImportance(a.importance, a.priority);
                const bEff = effectiveImportance(b.importance, b.priority);
                if (bEff !== aEff) return bEff - aEff;
                return a.blockId.localeCompare(b.blockId);
            });
            break;
    }
    return arr;
}
