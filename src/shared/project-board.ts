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
import { createProjectMembershipGraph, type ProjectMembershipGraph } from "./project-membership-graph";
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

function orderedStageTasks(tasks: readonly TaskCacheEntry[], membership: ProjectMembershipGraph): TaskCacheEntry[] {
    const compare = (left: TaskCacheEntry, right: TaskCacheEntry) =>
        left.sort - right.sort || left.blockId.localeCompare(right.blockId);

    const roots = [...tasks].filter((task) => !membership.node(task.blockId)?.effectiveParent).sort(compare);
    const ordered: TaskCacheEntry[] = [];
    const visited = new Set<string>();
    const visit = (task: TaskCacheEntry) => {
        if (visited.has(task.blockId)) return;
        visited.add(task.blockId);
        ordered.push(task);
        for (const child of membership.node(task.blockId)?.children || []) visit(child);
    };
    for (const root of roots) visit(root);
    for (const task of [...tasks].sort(compare)) visit(task);
    return ordered.filter((task) => membership.node(task.blockId)?.role === "stage");
}

function stageColumnKey(stageId: string): string {
    return `stage:${stageId}`;
}

function columnTasks(
    tasks: readonly TaskCacheEntry[],
    groupBy: ProjectBoardGroupBy,
    value: string | number,
    membership: ProjectMembershipGraph,
): TaskCacheEntry[] {
    return tasks.filter((task) => {
        if (groupBy === "status") return task.status === value;
        if (groupBy === "priority") return (isBoardPriority(task.priority) ? task.priority : PRIORITY_NONE) === value;
        if (groupBy === "importance") return boardImportance(task.importance) === value;
        const stageId = membership.node(task.blockId)?.nearestStage?.blockId || PROJECT_BOARD_UNASSIGNED_STAGE;
        return stageId === value;
    });
}

export function isProjectBoardTask(task: TaskCacheEntry, membership: ProjectMembershipGraph): boolean {
    if (isProjectTask(task) || task.actionKind !== "stage") return !isProjectTask(task);
    return !(membership.node(task.blockId)?.children || []).some((candidate) => !isProjectTask(candidate));
}

export function buildProjectBoardColumns(
    tasks: readonly TaskCacheEntry[],
    groupBy: ProjectBoardGroupBy = "status",
    projectTasks: readonly TaskCacheEntry[] = tasks,
): ProjectBoardColumn[] {
    const membership = createProjectMembershipGraph(projectTasks);

    if (groupBy === "status") {
        return PROJECT_BOARD_STATUSES.map((status) => ({
            key: status,
            value: status,
            label: status,
            groupBy,
            status,
            tasks: columnTasks(tasks, groupBy, status, membership),
        }));
    }
    if (groupBy === "priority") {
        return PROJECT_BOARD_PRIORITIES.map((priority) => ({
            key: priority,
            value: priority,
            label: priority,
            groupBy,
            tasks: columnTasks(tasks, groupBy, priority, membership),
        }));
    }
    if (groupBy === "importance") {
        return PROJECT_BOARD_IMPORTANCES.map((importance) => ({
            key: String(importance),
            value: importance,
            label: String(importance),
            groupBy,
            tasks: columnTasks(tasks, groupBy, importance, membership),
        }));
    }

    const stageColumns = orderedStageTasks(projectTasks, membership).map((stage) => ({
        key: stageColumnKey(stage.blockId),
        value: stage.blockId,
        label: stage.title,
        groupBy,
        stageId: stage.blockId,
        tasks: columnTasks(tasks, groupBy, stage.blockId, membership),
    }));
    return [
        ...stageColumns,
        {
            key: PROJECT_BOARD_UNASSIGNED_STAGE,
            value: PROJECT_BOARD_UNASSIGNED_STAGE,
            label: PROJECT_BOARD_UNASSIGNED_STAGE,
            groupBy,
            tasks: columnTasks(tasks, groupBy, PROJECT_BOARD_UNASSIGNED_STAGE, membership),
        },
    ];
}
