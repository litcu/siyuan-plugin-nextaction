import { writable } from "svelte/store";
import type { ActionMoveUndo } from "../../shared/action-move";
import type { TaskCacheEntry } from "../../shared/types";

export interface ActionMoveUndoFeedback {
    undo: ActionMoveUndo;
    status: "available" | "working" | "error";
    error: string;
    onUndone?: (task: TaskCacheEntry) => void;
}

export const actionMoveUndoFeedback = writable<ActionMoveUndoFeedback | null>(null);

export function showActionMoveUndo(undo: ActionMoveUndo, onUndone?: (task: TaskCacheEntry) => void): void {
    actionMoveUndoFeedback.set({ undo, status: "available", error: "", onUndone });
}

export function markActionMoveUndoWorking(): void {
    actionMoveUndoFeedback.update((feedback) => (feedback ? { ...feedback, status: "working", error: "" } : null));
}

export function completeActionMoveUndo(credential: string, task: TaskCacheEntry): void {
    actionMoveUndoFeedback.update((feedback) => {
        if (feedback?.undo.credential !== credential) return feedback;
        feedback.onUndone?.(task);
        return null;
    });
}

export function failActionMoveUndo(credential: string, error: string): void {
    actionMoveUndoFeedback.update((feedback) =>
        feedback?.undo.credential === credential ? { ...feedback, status: "error", error } : feedback,
    );
}

export function dismissActionMoveUndo(): void {
    actionMoveUndoFeedback.set(null);
}
