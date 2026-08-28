import type { ProjectBoardGroupBy } from "./project-board";
import type { TaskCacheEntry } from "./types";

export type ProjectBoardMoveResultStatus = "success" | "partial";

export interface ProjectBoardMoveInput {
    taskId: string;
    projectId: string;
    groupBy: ProjectBoardGroupBy;
    value: string | number;
    /** Visible card used as an insertion point. The task is inserted before it. */
    afterId?: string | null;
    /** Expected logical parent of afterId; never changes the moved task parent. */
    afterParentId?: string | null;
    /** Snapshot of cards visible to the user in the active board/filter. */
    visibleTaskIds?: string[];
}

export interface ProjectBoardMoveUndo {
    credential: string;
    taskId: string;
    summary: string;
}

export interface ProjectBoardMoveResult {
    status: ProjectBoardMoveResultStatus;
    task: TaskCacheEntry;
    reordered: boolean;
    undo?: ProjectBoardMoveUndo;
    warning?: string;
}

export interface ProjectBoardUndoInput {
    credential: string;
}

export interface ProjectBoardUndoResult {
    task: TaskCacheEntry;
    summary: string;
}
