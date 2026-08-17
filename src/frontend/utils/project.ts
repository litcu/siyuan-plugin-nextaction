import type { ProjectRisk, ProjectRiskKind, ProjectSummary, TaskCacheEntry } from "../../shared/types";

const PROJECT_TYPE = "2";

export type ProjectDateBucket = "overdue" | "today" | "thisWeek" | "later" | "unscheduled";

function datePart(value: string): string {
    return value ? value.slice(0, 10) : "";
}

function localDateString(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayDifference(value: string, today: string): number {
    const target = new Date(`${value}T00:00:00`).getTime();
    const current = new Date(`${today}T00:00:00`).getTime();
    return Math.round((target - current) / 86400000);
}

function risk(kind: ProjectRiskKind, taskId: string, severity: ProjectRisk["severity"]): ProjectRisk {
    return { kind, taskId, severity };
}

function buildChildrenMap(tasks: TaskCacheEntry[]): Map<string, TaskCacheEntry[]> {
    const map = new Map<string, TaskCacheEntry[]>();
    const taskMap = new Map(tasks.map((task) => [task.blockId, task]));
    const add = (parentId: string, child: TaskCacheEntry) => {
        const children = map.get(parentId) || [];
        if (!children.some((entry) => entry.blockId === child.blockId)) children.push(child);
        map.set(parentId, children);
    };

    for (const task of tasks) {
        if (task.parentId && taskMap.has(task.parentId)) add(task.parentId, task);
    }
    // childIds is retained as a fallback for caches being updated while a parent change is broadcast.
    for (const task of tasks) {
        for (const childId of task.childIds || []) {
            const child = taskMap.get(childId);
            if (child) add(task.blockId, child);
        }
    }
    return map;
}

function collectDescendants(project: TaskCacheEntry, childrenMap: Map<string, TaskCacheEntry[]>): TaskCacheEntry[] {
    const result: TaskCacheEntry[] = [];
    const visited = new Set<string>([project.blockId]);
    const visit = (parentId: string) => {
        for (const child of childrenMap.get(parentId) || []) {
            if (visited.has(child.blockId)) continue;
            visited.add(child.blockId);
            result.push(child);
            visit(child.blockId);
        }
    };
    visit(project.blockId);
    return result;
}

function isNextAction(task: TaskCacheEntry, today: string): boolean {
    if (
        task.taskType === PROJECT_TYPE ||
        task.status === "done" ||
        task.status === "waiting" ||
        task.status === "someday" ||
        task.status === "inbox"
    )
        return false;
    if (task.blocked) return false;
    const start = datePart(task.start);
    return !start || dayDifference(start, today) <= 0;
}

function isHardBlocked(task: TaskCacheEntry): boolean {
    return task.blocked && task.blockedReason !== "inbox" && task.blockedReason !== "someday";
}

export function getProjectDateBucket(task: TaskCacheEntry, today = localDateString()): ProjectDateBucket {
    const value = datePart(task.due) || datePart(task.start);
    if (!value) return "unscheduled";
    const diff = dayDifference(value, today);
    if (diff < 0 && task.status !== "done") return "overdue";
    if (diff === 0) return "today";
    if (diff <= 7) return "thisWeek";
    return "later";
}

export function buildProjectSummaries(tasks: TaskCacheEntry[], today = localDateString()): ProjectSummary[] {
    const childrenMap = buildChildrenMap(tasks);
    const projects = tasks.filter((task) => task.taskType === PROJECT_TYPE);

    return projects.map((project) => {
        const descendants = collectDescendants(project, childrenMap);
        const workItems = descendants.filter((task) => task.taskType !== PROJECT_TYPE);
        const actionable = workItems.filter((task) => task.status !== "done");
        const doneTasks = workItems.filter((task) => task.status === "done");
        const overdueTasks = actionable.filter((task) => getProjectDateBucket(task, today) === "overdue");
        const dueSoonTasks = actionable.filter(
            (task) => getProjectDateBucket(task, today) === "thisWeek" || getProjectDateBucket(task, today) === "today",
        );
        const blockedTasks = actionable.filter(isHardBlocked);
        const waitingTasks = actionable.filter((task) => task.status === "waiting");
        const nextActions = actionable.filter((task) => isNextAction(task, today));
        const allWaiting = actionable.length > 0 && waitingTasks.length === actionable.length;
        const risks: ProjectRisk[] = [];

        for (const task of overdueTasks) risks.push(risk("overdue", task.blockId, "high"));
        for (const task of blockedTasks) risks.push(risk("blocked", task.blockId, "high"));
        for (const task of dueSoonTasks.filter(
            (task) => !overdueTasks.some((entry) => entry.blockId === task.blockId),
        )) {
            risks.push(risk("dueSoon", task.blockId, "medium"));
        }
        if (descendants.length === 0) risks.push(risk("empty", project.blockId, "medium"));
        else if (nextActions.length === 0 && descendants.length > 0 && !allWaiting)
            risks.push(risk("noNextAction", project.blockId, "medium"));
        if (allWaiting) risks.push(risk("waiting", waitingTasks[0].blockId, "low"));

        const doneCount = doneTasks.length;
        const openCount = Math.max(0, workItems.length - doneCount);
        const complete = project.status === "done" || (workItems.length > 0 && openCount === 0);
        // Older cache snapshots may still carry the former project-level
        // `children` reason. Active child work is normal project progress, not
        // a blocked project state.
        const projectBlocked = isHardBlocked(project) && project.blockedReason !== "children";
        const blocked = !complete && (projectBlocked || (nextActions.length === 0 && blockedTasks.length > 0));
        const health = complete ? "complete" : blocked ? "blocked" : risks.length > 0 ? "attention" : "onTrack";

        return {
            project,
            descendants,
            openCount,
            doneCount,
            progress: workItems.length > 0 ? Math.round((doneCount / workItems.length) * 100) : 0,
            nextActions,
            overdueTasks,
            blockedTasks,
            waitingTasks,
            risks,
            health,
        };
    });
}
