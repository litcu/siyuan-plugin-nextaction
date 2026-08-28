import {
    ALL_STATUSES,
    PRIORITY_CRITICAL,
    PRIORITY_HIGH,
    PRIORITY_LOW,
    PRIORITY_MEDIUM,
    PRIORITY_NONE,
    PRIORITY_VERY_LOW,
} from "./constants";
import { isProjectTask } from "./project-domain";
import type { TaskCacheEntry } from "./types";

export const PROJECT_BOARD_STATUSES = ALL_STATUSES;
export const PROJECT_BOARD_PRIORITIES = [
    PRIORITY_CRITICAL,
    PRIORITY_HIGH,
    PRIORITY_MEDIUM,
    PRIORITY_LOW,
    PRIORITY_VERY_LOW,
    PRIORITY_NONE,
] as const;
export const PROJECT_BOARD_IMPORTANCES = [1, 2, 3, 4, 5, 6, 7] as const;
export const PROJECT_BOARD_UNASSIGNED_STAGE = "unassigned" as const;

export type ProjectBoardStatus = (typeof PROJECT_BOARD_STATUSES)[number];
export type ProjectBoardPriority = (typeof PROJECT_BOARD_PRIORITIES)[number];
export type ProjectBoardImportance = (typeof PROJECT_BOARD_IMPORTANCES)[number];
export type ProjectBoardGroupBy = "status" | "stage" | "priority" | "importance";

export interface ProjectBoardColumn {
    key: string;
    value: string | number;
    label: string;
    groupBy: ProjectBoardGroupBy;
    tasks: TaskCacheEntry[];
    status?: ProjectBoardStatus;
    stageId?: string;
}

function isBoardPriority(value: string): value is ProjectBoardPriority {
    return (PROJECT_BOARD_PRIORITIES as readonly string[]).includes(value);
}

function boardImportance(value: number): ProjectBoardImportance {
    if (Number.isInteger(value) && value >= 1 && value <= 7) return value as ProjectBoardImportance;
    return 4;
}

function buildEffectiveParentMap(tasks: readonly TaskCacheEntry[]): Map<string, string> {
    const taskById = new Map(tasks.map((task) => [task.blockId, task]));
    const parentByChild = new Map<string, string>();

    for (const task of tasks) {
        if (task.parentId && task.parentId !== task.blockId && taskById.has(task.parentId)) {
            parentByChild.set(task.blockId, task.parentId);
        }
    }
    for (const parent of tasks) {
        for (const childId of parent.childIds || []) {
            const child = taskById.get(childId);
            if (child && child.blockId !== parent.blockId && !parentByChild.has(child.blockId)) {
                parentByChild.set(child.blockId, parent.blockId);
            }
        }
    }
    return parentByChild;
}

function orderedStageTasks(
    tasks: readonly TaskCacheEntry[],
    parentByChild: ReadonlyMap<string, string>,
): TaskCacheEntry[] {
    const taskById = new Map(tasks.map((task) => [task.blockId, task]));
    const childrenByParent = new Map<string, TaskCacheEntry[]>();
    for (const [childId, parentId] of parentByChild) {
        const child = taskById.get(childId);
        if (!child) continue;
        const children = childrenByParent.get(parentId) || [];
        children.push(child);
        childrenByParent.set(parentId, children);
    }
    const compare = (left: TaskCacheEntry, right: TaskCacheEntry) =>
        left.sort - right.sort || left.blockId.localeCompare(right.blockId);
    for (const children of childrenByParent.values()) children.sort(compare);

    const roots = [...tasks].filter((task) => !parentByChild.has(task.blockId)).sort(compare);
    const ordered: TaskCacheEntry[] = [];
    const visited = new Set<string>();
    const visit = (task: TaskCacheEntry, path = new Set<string>()) => {
        if (visited.has(task.blockId) || path.has(task.blockId)) return;
        visited.add(task.blockId);
        const nextPath = new Set(path).add(task.blockId);
        ordered.push(task);
        for (const child of childrenByParent.get(task.blockId) || []) visit(child, nextPath);
    };
    for (const root of roots) visit(root);
    for (const task of [...tasks].sort(compare)) visit(task);
    return ordered.filter(
        (task) =>
            !isProjectTask(task) &&
            task.actionKind === "stage" &&
            (parentChain(task, taskById, parentByChild)?.some((parent) => isProjectTask(parent)) ?? false),
    );
}

function parentChain(
    task: TaskCacheEntry,
    taskById: ReadonlyMap<string, TaskCacheEntry>,
    parentByChild: ReadonlyMap<string, string>,
): TaskCacheEntry[] | null {
    const chain: TaskCacheEntry[] = [];
    const visited = new Set<string>();
    let currentId = task.blockId;
    while (true) {
        if (visited.has(currentId)) return null;
        visited.add(currentId);
        const parentId = parentByChild.get(currentId);
        if (!parentId) return chain;
        const parent = taskById.get(parentId);
        if (!parent) return null;
        chain.push(parent);
        if (isProjectTask(parent)) return chain;
        currentId = parent.blockId;
    }
}

function nearestStageAncestor(
    task: TaskCacheEntry,
    taskById: ReadonlyMap<string, TaskCacheEntry>,
    parentByChild: ReadonlyMap<string, string>,
): string {
    const chain = parentChain(task, taskById, parentByChild);
    if (!chain) return PROJECT_BOARD_UNASSIGNED_STAGE;
    return chain.find((parent) => parent.actionKind === "stage")?.blockId || PROJECT_BOARD_UNASSIGNED_STAGE;
}

function stageColumnKey(stageId: string): string {
    return `stage:${stageId}`;
}

function columnTasks(
    tasks: readonly TaskCacheEntry[],
    groupBy: ProjectBoardGroupBy,
    value: string | number,
    taskById: ReadonlyMap<string, TaskCacheEntry>,
    parentByChild: ReadonlyMap<string, string>,
): TaskCacheEntry[] {
    return tasks.filter((task) => {
        if (groupBy === "status") return task.status === value;
        if (groupBy === "priority") return (isBoardPriority(task.priority) ? task.priority : PRIORITY_NONE) === value;
        if (groupBy === "importance") return boardImportance(task.importance) === value;
        const stageId = nearestStageAncestor(task, taskById, parentByChild);
        return stageId === value;
    });
}

export function isProjectBoardTask(task: TaskCacheEntry, projectActions: readonly TaskCacheEntry[]): boolean {
    if (isProjectTask(task) || task.actionKind !== "stage") return !isProjectTask(task);
    return !projectActions.some(
        (candidate) =>
            !isProjectTask(candidate) &&
            (candidate.parentId === task.blockId || task.childIds.includes(candidate.blockId)),
    );
}

export function buildProjectBoardColumns(
    tasks: readonly TaskCacheEntry[],
    groupBy: ProjectBoardGroupBy = "status",
    projectTasks: readonly TaskCacheEntry[] = tasks,
): ProjectBoardColumn[] {
    const taskById = new Map(projectTasks.map((task) => [task.blockId, task]));
    const parentByChild = buildEffectiveParentMap(projectTasks);

    if (groupBy === "status") {
        return PROJECT_BOARD_STATUSES.map((status) => ({
            key: status,
            value: status,
            label: status,
            groupBy,
            status,
            tasks: columnTasks(tasks, groupBy, status, taskById, parentByChild),
        }));
    }
    if (groupBy === "priority") {
        return PROJECT_BOARD_PRIORITIES.map((priority) => ({
            key: priority,
            value: priority,
            label: priority,
            groupBy,
            tasks: columnTasks(tasks, groupBy, priority, taskById, parentByChild),
        }));
    }
    if (groupBy === "importance") {
        return PROJECT_BOARD_IMPORTANCES.map((importance) => ({
            key: String(importance),
            value: importance,
            label: String(importance),
            groupBy,
            tasks: columnTasks(tasks, groupBy, importance, taskById, parentByChild),
        }));
    }

    const stageColumns = orderedStageTasks(projectTasks, parentByChild).map((stage) => ({
        key: stageColumnKey(stage.blockId),
        value: stage.blockId,
        label: stage.title,
        groupBy,
        stageId: stage.blockId,
        tasks: columnTasks(tasks, groupBy, stage.blockId, taskById, parentByChild),
    }));
    return [
        ...stageColumns,
        {
            key: PROJECT_BOARD_UNASSIGNED_STAGE,
            value: PROJECT_BOARD_UNASSIGNED_STAGE,
            label: PROJECT_BOARD_UNASSIGNED_STAGE,
            groupBy,
            tasks: columnTasks(tasks, groupBy, PROJECT_BOARD_UNASSIGNED_STAGE, taskById, parentByChild),
        },
    ];
}
