import type { TaskCacheEntry } from "./types";

export interface ActionMoveInput {
    actionId: string;
    projectId: string;
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
    currentEffectiveParentId: string;
    nextEffectiveParentId: string;
    effectiveParentWillChange: boolean;
    explicitParentPreserved: boolean;
}

export interface ActionMoveResult {
    task: TaskCacheEntry;
    preview: ActionMovePreview;
}
