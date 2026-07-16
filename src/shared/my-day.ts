import type { MyDayState, MyDayTaskEntry } from "./types";

export function isMyDayEntryDone(
    entry: MyDayTaskEntry | null | undefined,
    taskStatus: string,
): boolean {
    return entry?.completedAt !== undefined || taskStatus === "done";
}

export function setMyDayTaskCompletedAt(
    state: MyDayState,
    blockId: string,
    completedAt: number | undefined,
): MyDayState {
    const index = state.tasks.findIndex((entry) => entry.blockId === blockId);
    if (index < 0) return state;

    const current = state.tasks[index];
    if (current.completedAt === completedAt) return state;

    let updatedEntry: MyDayTaskEntry;
    if (completedAt === undefined) {
        const { completedAt: _completedAt, ...rest } = current;
        updatedEntry = rest;
    } else {
        updatedEntry = { ...current, completedAt };
    }

    const tasks = [...state.tasks];
    tasks[index] = updatedEntry;
    return {
        ...state,
        tasks,
        updatedAt: Date.now(),
    };
}
