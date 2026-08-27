import type { TaskActionKind, TaskCacheEntry } from "./types";

export interface ExtractActionInput {
    sourceBlockId: string;
    title: string;
    status: string;
    actionKind: Exclude<TaskActionKind, "">;
    start?: string;
    due?: string;
    projectId?: string | null;
}

export interface ExtractActionResult {
    task: TaskCacheEntry;
    sourceBlockId: string;
    projectId: string;
}
