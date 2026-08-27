import type { TaskCacheEntry } from "./types";

export interface ActionMoveInput {
    actionId: string;
    projectId: string;
    destination?: ActionMoveDestination;
}

export interface ActionMoveDestination {
    previousId: string;
    nextId: string;
}

export interface ActionMovePlacement {
    id: string;
    destination: ActionMoveDestination;
    previousTitle: string;
    nextTitle: string;
    documentEnd: boolean;
}

export interface ActionMovePreview {
    actionId: string;
    actionTitle: string;
    source: {
        documentId: string;
        title: string;
    };
    target: {
        projectId: string;
        title: string;
    };
    placements: ActionMovePlacement[];
    destination: ActionMoveDestination;
    currentEffectiveParentId: string;
    nextEffectiveParentId: string;
    effectiveParentWillChange: boolean;
    explicitParentPreserved: boolean;
}

export interface ActionMoveResult {
    task: TaskCacheEntry;
    preview: ActionMovePreview;
    undo: ActionMoveUndo;
}

export interface ActionMoveUndo {
    credential: string;
    actionId: string;
    summary: string;
}

export interface ActionMoveUndoInput {
    credential: string;
}

export interface ActionMoveUndoResult {
    task: TaskCacheEntry;
    summary: string;
}
