import { writable } from "svelte/store";
import type { ActionMoveUndo } from "../../shared/action-move";
import type { TaskCacheEntry } from "../../shared/types";

export interface ActionMoveUndoFeedback {
    undo: ActionMoveUndo;
    status: "available" | "working" | "success" | "error";
    resultSummary: string;
    error: string;
    onUndone?: (task: TaskCacheEntry) => void;
}

export const actionMoveUndoFeedback = writable<ActionMoveUndoFeedback | null>(null);

export function showActionMoveUndo(undo: ActionMoveUndo, onUndone?: (task: TaskCacheEntry) => void): void {
    actionMoveUndoFeedback.set({ undo, status: "available", resultSummary: "", error: "", onUndone });
}

export function markActionMoveUndoWorking(): void {
    actionMoveUndoFeedback.update((feedback) => (feedback ? { ...feedback, status: "working", error: "" } : null));
}

export function completeActionMoveUndo(task: TaskCacheEntry, summary: string): void {
    actionMoveUndoFeedback.update((feedback) => {
        feedback?.onUndone?.(task);
        return feedback ? { ...feedback, status: "success", resultSummary: summary, error: "" } : null;
    });
}

export function failActionMoveUndo(error: string): void {
    actionMoveUndoFeedback.update((feedback) =>
        feedback ? { ...feedback, status: "error", error, resultSummary: "" } : null,
    );
}

export function dismissActionMoveUndo(): void {
    actionMoveUndoFeedback.set(null);
}
