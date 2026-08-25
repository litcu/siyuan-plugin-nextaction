import type { ProjectReviewItem, ProjectSummary, ReviewData, TaskCacheEntry } from "./types";
import { buildProjectSummaries, isProjectTask } from "./project-domain";

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
    return task.status !== "done" && task.reviewInterval > 0 && Boolean(task.reviewDate) && task.reviewDate <= today;
}

export function buildProjectReviewQueue(
    summaries: ProjectSummary[],
    today = localDateString(),
): { queue: ProjectReviewItem[]; reviewableProjects: ProjectSummary[] } {
    const reviewableProjects = summaries.filter((summary) => summary.project.status !== "done");
    const queue = reviewableProjects.flatMap((summary): ProjectReviewItem[] => {
        const reviewDue = isTaskReviewDue(summary.project, today);
        const riskDue = summary.risks.length > 0;
        const completionDue = summary.completionCandidate;
        if (!reviewDue && !riskDue && !completionDue) return [];
        return [
            {
                summary,
                triggers: [
                    reviewDue ? "schedule" : null,
                    riskDue ? "risk" : null,
                    completionDue ? "completionCandidate" : null,
                ].filter((trigger): trigger is "schedule" | "risk" | "completionCandidate" => trigger !== null),
                schedule: reviewDue ? (summary.project.reviewDate < today ? "overdue" : "due") : "none",
            },
        ];
    });
    return { queue, reviewableProjects };
}

export function mergeManualProjectReviews(
    queue: ProjectReviewItem[],
    reviewableProjects: ProjectSummary[],
    manualProjectIds: readonly string[],
): ProjectReviewItem[] {
    const items = new Map(
        queue.map((item) => [
            item.summary.project.blockId,
            { ...item, triggers: [...item.triggers] } satisfies ProjectReviewItem,
        ]),
    );
    const summaries = new Map(reviewableProjects.map((summary) => [summary.project.blockId, summary]));
    for (const projectId of manualProjectIds) {
        const existing = items.get(projectId);
        if (existing) {
            if (!existing.triggers.includes("manual")) existing.triggers.push("manual");
            continue;
        }
        const summary = summaries.get(projectId);
        if (summary) items.set(projectId, { summary, triggers: ["manual"], schedule: "none" });
    }
    return Array.from(items.values());
}

export function projectReviewPlanTasks(summary: ProjectSummary): TaskCacheEntry[] {
    return summary.descendants.filter((task) => task.status !== "done");
}

export function projectReviewAggregateIds(items: readonly ProjectReviewItem[]): Set<string> {
    const ids = new Set<string>();
    for (const item of items) {
        ids.add(item.summary.project.blockId);
        for (const task of item.summary.descendants) ids.add(task.blockId);
    }
    return ids;
}

export function excludeManualProjectReviewTasks(
    reviewData: ReviewData,
    manualProjectIds: readonly string[],
): ReviewData {
    const manualItems = mergeManualProjectReviews([], reviewData.reviewableProjects, manualProjectIds);
    const excludedIds = projectReviewAggregateIds(manualItems);
    if (excludedIds.size === 0) return reviewData;
    const exclude = (tasks: TaskCacheEntry[]) => tasks.filter((task) => !excludedIds.has(task.blockId));
    return {
        ...reviewData,
        overdueTasks: exclude(reviewData.overdueTasks),
        nextActions: exclude(reviewData.nextActions),
        inboxTasks: exclude(reviewData.inboxTasks),
        waitingTasks: exclude(reviewData.waitingTasks),
        somedayTasks: exclude(reviewData.somedayTasks),
        reviewDueTasks: exclude(reviewData.reviewDueTasks),
    };
}

/** Count unique tasks that need attention on the Review page. */
export function countReviewAttentionTasks(
    tasks: TaskCacheEntry[],
    today = localDateString(),
    now: Date = new Date(),
): number {
    // Snapshot accessor-backed entries once before the domain summary revisits
    // relationships for progress, blocking, and risk calculations.
    const stableTasks = tasks.map((task) => ({ ...task }));
    const projectReviews = buildProjectReviewQueue(buildProjectSummaries(stableTasks, { today }), today).queue;
    const aggregatedIds = projectReviewAggregateIds(projectReviews);
    let count = projectReviews.length;
    for (const task of stableTasks) {
        if (isProjectTask(task) || aggregatedIds.has(task.blockId)) continue;
        if (isTaskReviewDue(task, today) || isTaskDueOverdue(task, today, now)) count++;
    }
    return count;
}
