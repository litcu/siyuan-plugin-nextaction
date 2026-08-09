import type { TaskCacheEntry } from "./types";

export function localDateString(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/** Supports both date-only values and local date-time values. */
export function isTaskDueOverdue(
    task: Pick<TaskCacheEntry, "due" | "status">,
    today = localDateString(),
    now: Date = new Date(),
): boolean {
    if (task.status === "done" || !task.due) return false;
    if (task.due.includes("T")) return new Date(task.due).getTime() < now.getTime();
    return task.due < today;
}

export function isTaskReviewDue(
    task: Pick<TaskCacheEntry, "reviewInterval" | "reviewDate" | "status">,
    today = localDateString(),
): boolean {
    return task.status !== "done"
        && task.reviewInterval > 0
        && Boolean(task.reviewDate)
        && task.reviewDate <= today;
}

/** Count unique tasks that need attention on the Review page. */
export function countReviewAttentionTasks(
    tasks: TaskCacheEntry[],
    today = localDateString(),
    now: Date = new Date(),
): number {
    let count = 0;
    for (const task of tasks) {
        if (isTaskReviewDue(task, today) || isTaskDueOverdue(task, today, now)) count++;
    }
    return count;
}
