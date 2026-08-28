import { isProjectTask } from "./project-domain";
import type { TaskCacheEntry } from "./types";

export const PROJECT_BOARD_STATUSES = ["inbox", "todo", "doing", "waiting", "someday", "done"] as const;

export type ProjectBoardStatus = (typeof PROJECT_BOARD_STATUSES)[number];

export interface ProjectBoardColumn {
    status: ProjectBoardStatus;
    tasks: TaskCacheEntry[];
}

export function isProjectBoardTask(task: TaskCacheEntry, projectActions: readonly TaskCacheEntry[]): boolean {
    if (isProjectTask(task) || task.actionKind !== "stage") return !isProjectTask(task);
    return !projectActions.some(
        (candidate) =>
            !isProjectTask(candidate) &&
            (candidate.parentId === task.blockId || task.childIds.includes(candidate.blockId)),
    );
}

export function buildProjectBoardColumns(tasks: readonly TaskCacheEntry[]): ProjectBoardColumn[] {
    return PROJECT_BOARD_STATUSES.map((status) => ({
        status,
        tasks: tasks.filter((task) => task.status === status),
    }));
}
