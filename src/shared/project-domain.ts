import type {
    ProjectRisk,
    ProjectRiskKind,
    ProjectSummary,
    TaskActionKind,
    TaskBlockedReason,
    TaskCacheEntry,
} from "./types";

const PROJECT_TYPE = "2";

export function isProjectTask(task: Pick<TaskCacheEntry, "identificationSource" | "taskType">): boolean {
    return task.identificationSource === "document" && task.taskType === PROJECT_TYPE;
}

export type ProjectDateBucket = "overdue" | "today" | "thisWeek" | "later" | "unscheduled";

export interface ProjectDomainOptions {
    today?: string;
    startPreviewDays?: number;
    taskLookup?: ReadonlyMap<string, TaskCacheEntry> | Readonly<Record<string, TaskCacheEntry>>;
}

function lookupTask(tasks: ProjectDomainOptions["taskLookup"], blockId: string): TaskCacheEntry | undefined {
    if (!tasks) return undefined;
    if (typeof (tasks as ReadonlyMap<string, TaskCacheEntry>).get === "function") {
        return (tasks as ReadonlyMap<string, TaskCacheEntry>).get(blockId);
    }
    return (tasks as Readonly<Record<string, TaskCacheEntry>>)[blockId];
}

export function hasProjectAncestor(
    parentId: string,
    taskLookup: NonNullable<ProjectDomainOptions["taskLookup"]>,
): boolean {
    const visited = new Set<string>();
    let currentId = parentId;
    while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const current = lookupTask(taskLookup, currentId);
        if (!current) return false;
        if (isProjectTask(current)) return true;
        currentId = current.parentId;
    }
    return false;
}

export function normalizeActionKindForProjectScope(
    actionKind: TaskActionKind,
    hasProjectScope: boolean,
): Exclude<TaskActionKind, ""> {
    return hasProjectScope && actionKind === "stage" ? "stage" : "action";
}

export function getTaskBlockedReason(
    task: TaskCacheEntry,
    taskLookup: NonNullable<ProjectDomainOptions["taskLookup"]>,
): TaskBlockedReason {
    if (task.status === "inbox") return "inbox";
    if (task.status === "someday") return "someday";

    if (!isProjectTask(task)) {
        const hasIncompleteChild = task.childIds.some((id) => {
            const child = lookupTask(taskLookup, id);
            return child && child.status !== "done";
        });
        if (hasIncompleteChild) return "children";
    }

    const dependencyIds = task.depends.split("|").filter(Boolean);
    const dependencies = dependencyIds
        .map((id) => lookupTask(taskLookup, id))
        .filter((entry): entry is TaskCacheEntry => Boolean(entry));
    if (dependencies.length > 0) {
        if (task.depMode === "any") {
            if (dependencies.every((entry) => entry.status !== "done")) return "dependency";
        } else if (dependencies.some((entry) => entry.status !== "done")) {
            return "dependency";
        }
    }

    const parent = task.parentId ? lookupTask(taskLookup, task.parentId) : undefined;
    if (parent?.sequential) {
        const siblings = parent.childIds
            .map((id) => lookupTask(taskLookup, id))
            .filter((entry): entry is TaskCacheEntry => Boolean(entry))
            .sort((left, right) => left.sort - right.sort || left.blockId.localeCompare(right.blockId));
        const taskIndex = siblings.findIndex((entry) => entry.blockId === task.blockId);
        if (taskIndex > 0 && siblings.slice(0, taskIndex).some((entry) => entry.status !== "done")) {
            return "sequential";
        }
    }

    return "";
}

export function isTaskBlocked(
    task: TaskCacheEntry,
    taskLookup: NonNullable<ProjectDomainOptions["taskLookup"]>,
): boolean {
    return getTaskBlockedReason(task, taskLookup) !== "";
}

function localDateString(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function datePart(value: string): string {
    return value ? value.slice(0, 10) : "";
}

function addDays(value: string, days: number): string {
    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() + days);
    return localDateString(date);
}

function dayDifference(value: string, today: string): number {
    const target = new Date(`${value}T00:00:00`).getTime();
    const current = new Date(`${today}T00:00:00`).getTime();
    return Math.round((target - current) / 86400000);
}

function risk(kind: ProjectRiskKind, taskId: string, severity: ProjectRisk["severity"]): ProjectRisk {
    return { kind, taskId, severity };
}

function effectiveBlockedReason(
    task: TaskCacheEntry,
    taskLookup: NonNullable<ProjectDomainOptions["taskLookup"]>,
): TaskBlockedReason {
    return getTaskBlockedReason(task, taskLookup) || task.blockedReason;
}

function isHardBlocked(task: TaskCacheEntry, taskLookup: NonNullable<ProjectDomainOptions["taskLookup"]>): boolean {
    const reason = effectiveBlockedReason(task, taskLookup);
    return (Boolean(reason) || task.blocked) && reason !== "inbox" && reason !== "someday";
}

export function isNextActionCandidate(
    task: TaskCacheEntry,
    options: Pick<ProjectDomainOptions, "today" | "startPreviewDays" | "taskLookup"> = {},
): boolean {
    if (
        isProjectTask(task) ||
        task.status === "done" ||
        task.status === "waiting" ||
        task.status === "someday" ||
        task.status === "inbox"
    ) {
        return false;
    }
    const blocked = options.taskLookup ? isTaskBlocked(task, options.taskLookup) || task.blocked : task.blocked;
    if (blocked) return false;

    const start = datePart(task.start);
    if (!start) return true;
    const today = options.today || localDateString();
    const cutoff = addDays(today, Math.max(0, options.startPreviewDays || 0));
    return start <= cutoff;
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

function buildChildrenMap(tasks: TaskCacheEntry[]): Map<string, TaskCacheEntry[]> {
    const childrenByParent = new Map<string, TaskCacheEntry[]>();
    const taskById = new Map(tasks.map((task) => [task.blockId, task]));
    const assignedChildren = new Set<string>();
    const add = (parentId: string, child: TaskCacheEntry) => {
        if (parentId === child.blockId) return;
        const children = childrenByParent.get(parentId) || [];
        if (!children.some((entry) => entry.blockId === child.blockId)) children.push(child);
        childrenByParent.set(parentId, children);
        assignedChildren.add(child.blockId);
    };

    for (const task of tasks) {
        if (task.parentId && taskById.has(task.parentId)) add(task.parentId, task);
    }
    // childIds is only a fallback while a parent relationship update is being broadcast.
    for (const parent of tasks) {
        for (const childId of parent.childIds || []) {
            const child = taskById.get(childId);
            if (child && !assignedChildren.has(child.blockId)) add(parent.blockId, child);
        }
    }
    return childrenByParent;
}

function collectProjectActions(
    project: TaskCacheEntry,
    childrenByParent: Map<string, TaskCacheEntry[]>,
): TaskCacheEntry[] {
    const actions: TaskCacheEntry[] = [];
    const visited = new Set<string>([project.blockId]);
    const visit = (parentId: string) => {
        for (const child of childrenByParent.get(parentId) || []) {
            if (visited.has(child.blockId)) continue;
            visited.add(child.blockId);
            if (isProjectTask(child)) continue;
            actions.push(child);
            visit(child.blockId);
        }
    };
    visit(project.blockId);
    return actions;
}

function buildSubtreeProgress(
    actions: TaskCacheEntry[],
    childrenByParent: Map<string, TaskCacheEntry[]>,
): { leafActions: TaskCacheEntry[]; subtreeProgress: ProjectSummary["subtreeProgress"] } {
    const actionIds = new Set(actions.map((task) => task.blockId));
    const leafActions = actions.filter(
        (task) => !(childrenByParent.get(task.blockId) || []).some((child) => actionIds.has(child.blockId)),
    );
    const leafIds = new Set(leafActions.map((task) => task.blockId));
    const subtreeProgress: ProjectSummary["subtreeProgress"] = {};

    const collectLeaves = (taskId: string, visiting: ReadonlySet<string>): Set<string> => {
        if (visiting.has(taskId)) return new Set();
        if (leafIds.has(taskId)) return new Set([taskId]);
        const nextVisiting = new Set(visiting).add(taskId);
        const result = new Set<string>();
        for (const child of childrenByParent.get(taskId) || []) {
            if (!actionIds.has(child.blockId)) continue;
            for (const leafId of collectLeaves(child.blockId, nextVisiting)) result.add(leafId);
        }
        return result;
    };

    const actionById = new Map(actions.map((task) => [task.blockId, task]));
    for (const action of actions) {
        const subtreeLeafIds = collectLeaves(action.blockId, new Set());
        const total = subtreeLeafIds.size;
        const done = Array.from(subtreeLeafIds).filter((id) => actionById.get(id)?.status === "done").length;
        subtreeProgress[action.blockId] = {
            done,
            total,
            percent: total > 0 ? Math.round((done / total) * 100) : 0,
        };
    }

    return { leafActions, subtreeProgress };
}

export function buildProjectSummaries(tasks: TaskCacheEntry[], options: ProjectDomainOptions = {}): ProjectSummary[] {
    const today = options.today || localDateString();
    const childrenByParent = buildChildrenMap(tasks);
    const taskById = new Map(tasks.map((task) => [task.blockId, task]));
    const projects = tasks.filter(isProjectTask);

    return projects.map((project) => {
        const descendants = collectProjectActions(project, childrenByParent);
        const { leafActions, subtreeProgress } = buildSubtreeProgress(descendants, childrenByParent);
        const actionable = descendants.filter((task) => task.status !== "done");
        const doneLeaves = leafActions.filter((task) => task.status === "done");
        const overdueTasks = actionable.filter((task) => getProjectDateBucket(task, today) === "overdue");
        const dueSoonTasks = actionable.filter(
            (task) => getProjectDateBucket(task, today) === "thisWeek" || getProjectDateBucket(task, today) === "today",
        );
        const blockedTasks = actionable.filter((task) => isHardBlocked(task, taskById));
        const waitingTasks = actionable.filter((task) => task.status === "waiting");
        const nextActions = actionable.filter((task) =>
            isNextActionCandidate(task, {
                today,
                startPreviewDays: options.startPreviewDays,
                taskLookup: taskById,
            }),
        );
        const allWaiting = actionable.length > 0 && waitingTasks.length === actionable.length;
        const empty = descendants.length === 0;
        const completionCandidate =
            project.status !== "done" && leafActions.length > 0 && doneLeaves.length === leafActions.length;
        const leafActionIds = new Set(leafActions.map((task) => task.blockId));
        const incompleteNonLeafActions = descendants.filter(
            (task) => !leafActionIds.has(task.blockId) && task.status !== "done",
        );
        const complete = project.status === "done";
        const projectBlocked =
            isHardBlocked(project, taskById) && effectiveBlockedReason(project, taskById) !== "children";
        const risks: ProjectRisk[] = [];

        if (!complete && projectBlocked) risks.push(risk("blocked", project.blockId, "high"));
        for (const task of overdueTasks) risks.push(risk("overdue", task.blockId, "high"));
        for (const task of blockedTasks) risks.push(risk("blocked", task.blockId, "high"));
        for (const task of dueSoonTasks.filter(
            (task) => !overdueTasks.some((entry) => entry.blockId === task.blockId),
        )) {
            risks.push(risk("dueSoon", task.blockId, "medium"));
        }
        if (empty && (project.status === "todo" || project.status === "doing")) {
            risks.push(risk("empty", project.blockId, "medium"));
        } else if (!empty && !completionCandidate && nextActions.length === 0 && !allWaiting) {
            risks.push(risk("noNextAction", project.blockId, "medium"));
        }
        if (allWaiting) risks.push(risk("waiting", waitingTasks[0].blockId, "low"));

        const doneCount = doneLeaves.length;
        const openCount = Math.max(0, leafActions.length - doneCount);
        const blocked = !complete && (projectBlocked || (nextActions.length === 0 && blockedTasks.length > 0));
        const health = complete ? "complete" : blocked ? "blocked" : risks.length > 0 ? "attention" : "onTrack";

        return {
            project,
            descendants,
            leafActions,
            subtreeProgress,
            empty,
            clarificationNeeded: empty,
            completionCandidate,
            incompleteNonLeafActions,
            openCount,
            doneCount,
            progress: leafActions.length > 0 ? Math.round((doneCount / leafActions.length) * 100) : 0,
            nextActions,
            overdueTasks,
            blockedTasks,
            waitingTasks,
            risks,
            health,
        };
    });
}
