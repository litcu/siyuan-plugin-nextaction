import { isProjectTask } from "../../shared/project-domain";
import type { TaskCacheEntry } from "../../shared/types";

export type TaskMoveDirection = "up" | "down" | "in" | "out";

export interface TaskReorderIntent {
    blockId: string;
    parentId: string;
    afterId?: string;
}

export interface TaskMoveDescription {
    taskTitle: string;
    parentTitle: string | null;
    position: number;
    setSize: number;
}

function compareManualOrder(left: TaskCacheEntry, right: TaskCacheEntry): number {
    return left.sort - right.sort || left.blockId.localeCompare(right.blockId);
}

function siblingsOf(task: TaskCacheEntry, tasks: readonly TaskCacheEntry[]): TaskCacheEntry[] {
    return tasks.filter((entry) => entry.parentId === task.parentId).sort(compareManualOrder);
}

export function buildTaskMoveIntent(
    blockId: string,
    tasks: readonly TaskCacheEntry[],
    direction: TaskMoveDirection,
): TaskReorderIntent | null {
    const task = tasks.find((entry) => entry.blockId === blockId);
    if (!task) return null;

    const siblings = siblingsOf(task, tasks);
    const index = siblings.findIndex((entry) => entry.blockId === blockId);
    if (index < 0) return null;

    if (direction === "up") {
        if (index === 0) return null;
        return {
            blockId,
            parentId: task.parentId,
            afterId: siblings[index - 2]?.blockId,
        };
    }

    if (direction === "down") {
        if (index === siblings.length - 1) return null;
        return {
            blockId,
            parentId: task.parentId,
            afterId: siblings[index + 1].blockId,
        };
    }

    if (direction === "in") {
        if (index === 0 || isProjectTask(task)) return null;
        const parent = siblings[index - 1];
        const children = tasks
            .filter((entry) => entry.parentId === parent.blockId && entry.blockId !== blockId)
            .sort(compareManualOrder);
        return {
            blockId,
            parentId: parent.blockId,
            afterId: children[children.length - 1]?.blockId,
        };
    }

    if (!task.parentId) return null;
    const parent = tasks.find((entry) => entry.blockId === task.parentId);
    if (!parent || parent.blockId === task.blockId) return null;
    return {
        blockId,
        parentId: parent.parentId,
        afterId: parent.blockId,
    };
}

export function describeTaskMove(
    blockId: string,
    intent: TaskReorderIntent,
    tasks: readonly TaskCacheEntry[],
): TaskMoveDescription {
    const task = tasks.find((entry) => entry.blockId === blockId);
    const parent = intent.parentId ? tasks.find((entry) => entry.blockId === intent.parentId) : undefined;
    const siblings = tasks
        .filter((entry) => entry.blockId !== blockId && entry.parentId === intent.parentId)
        .sort(compareManualOrder);
    const afterIndex = intent.afterId ? siblings.findIndex((entry) => entry.blockId === intent.afterId) : -1;

    return {
        taskTitle: task?.title || blockId,
        parentTitle: parent?.title || null,
        position: afterIndex < 0 ? 1 : afterIndex + 2,
        setSize: siblings.length + 1,
    };
}
