import { ATTR_KIND } from "../../shared/constants";
import type { TaskActionKind, TaskCacheEntry } from "../../shared/types";

export interface ProjectTreeReorderIntent {
    blockId: string;
    parentId: string;
    afterId?: string;
}

export interface ProjectTreeCommandHandlers {
    renameTask?: (task: TaskCacheEntry, title: string) => Promise<TaskCacheEntry>;
    updateTask?: (task: TaskCacheEntry, attrs: Record<string, string>) => Promise<TaskCacheEntry>;
    reorderTask?: (blockId: string, parentId: string, afterId?: string) => Promise<void>;
}

export type ProjectTreeCommand =
    | { type: "rename"; task: TaskCacheEntry; title: string }
    | { type: "setKind"; task: TaskCacheEntry; actionKind: Exclude<TaskActionKind, ""> }
    | { type: "reorder"; task: TaskCacheEntry; parentId: string; afterId?: string };

export type ProjectTreeDropPosition = "before" | "inside" | "after";

function compareManualOrder(left: TaskCacheEntry, right: TaskCacheEntry): number {
    return left.sort - right.sort || left.blockId.localeCompare(right.blockId);
}

function buildEffectiveParentByChild(tasks: TaskCacheEntry[]): Map<string, string> {
    const taskIds = new Set(tasks.map((task) => task.blockId));
    const parentByChild = new Map<string, string>();
    for (const task of tasks) {
        if (task.parentId && task.parentId !== task.blockId) {
            parentByChild.set(task.blockId, task.parentId);
        }
    }
    for (const parent of tasks) {
        for (const childId of parent.childIds || []) {
            if (taskIds.has(childId) && childId !== parent.blockId && !parentByChild.has(childId)) {
                parentByChild.set(childId, parent.blockId);
            }
        }
    }
    return parentByChild;
}

function collectDescendantIds(task: TaskCacheEntry, tasks: TaskCacheEntry[]): Set<string> {
    const parentByChild = buildEffectiveParentByChild(tasks);
    const childrenByParent = new Map<string, TaskCacheEntry[]>();
    for (const entry of tasks) {
        const parentId = parentByChild.get(entry.blockId) || "";
        const children = childrenByParent.get(parentId) || [];
        children.push(entry);
        childrenByParent.set(parentId, children);
    }
    const descendants = new Set<string>();
    const pending = [task.blockId];
    while (pending.length > 0) {
        const parentId = pending.pop()!;
        for (const child of childrenByParent.get(parentId) || []) {
            if (descendants.has(child.blockId) || child.blockId === task.blockId) continue;
            descendants.add(child.blockId);
            pending.push(child.blockId);
        }
    }
    return descendants;
}

export function buildProjectTreeParentOptions(
    task: TaskCacheEntry,
    project: TaskCacheEntry,
    tasks: TaskCacheEntry[],
    visibleTaskIds?: ReadonlySet<string>,
): TaskCacheEntry[] {
    const excludedIds = collectDescendantIds(task, tasks);
    excludedIds.add(task.blockId);
    return [project, ...tasks]
        .filter(
            (entry) =>
                !excludedIds.has(entry.blockId) &&
                (entry.blockId === project.blockId || entry.taskType !== "2") &&
                (!visibleTaskIds || entry.blockId === project.blockId || visibleTaskIds.has(entry.blockId)),
        )
        .filter(
            (entry, index, entries) => entries.findIndex((candidate) => candidate.blockId === entry.blockId) === index,
        );
}

export function buildProjectTreeReorderIntent(
    task: TaskCacheEntry,
    siblings: TaskCacheEntry[],
    direction: "up" | "down",
): ProjectTreeReorderIntent | null {
    const ordered = siblings
        .filter((entry) => entry.blockId !== task.blockId)
        .concat(task)
        .sort(compareManualOrder);
    const index = ordered.findIndex((entry) => entry.blockId === task.blockId);
    if (index < 0 || (direction === "up" && index === 0) || (direction === "down" && index === ordered.length - 1)) {
        return null;
    }
    const afterId = direction === "up" ? ordered[index - 2]?.blockId : ordered[index + 1]?.blockId;
    return { blockId: task.blockId, parentId: task.parentId, afterId };
}

export function buildProjectTreeDropIntent(
    moving: TaskCacheEntry,
    target: TaskCacheEntry,
    position: ProjectTreeDropPosition,
    project: TaskCacheEntry,
    tasks: TaskCacheEntry[],
): ProjectTreeReorderIntent | null {
    if (moving.taskType === "2" || moving.blockId === target.blockId) return null;
    if (collectDescendantIds(moving, tasks).has(target.blockId)) return null;

    if (position === "inside") {
        const parentByChild = buildEffectiveParentByChild(tasks);
        const children = tasks
            .filter((task) => parentByChild.get(task.blockId) === target.blockId && task.blockId !== moving.blockId)
            .sort(compareManualOrder);
        return {
            blockId: moving.blockId,
            parentId: target.blockId,
            afterId: children[children.length - 1]?.blockId,
        };
    }

    const parentByChild = buildEffectiveParentByChild(tasks);
    const parentId = parentByChild.get(target.blockId) || target.parentId || project.blockId;
    const siblings = tasks
        .filter((task) => parentByChild.get(task.blockId) === parentId && task.blockId !== moving.blockId)
        .sort(compareManualOrder);
    const targetIndex = siblings.findIndex((task) => task.blockId === target.blockId);
    if (targetIndex < 0) return null;
    return {
        blockId: moving.blockId,
        parentId,
        afterId: position === "after" ? target.blockId : siblings[targetIndex - 1]?.blockId,
    };
}

export async function executeProjectTreeCommand(
    command: ProjectTreeCommand,
    handlers: ProjectTreeCommandHandlers,
): Promise<TaskCacheEntry | void> {
    if (command.type === "rename") {
        if (!handlers.renameTask) throw new Error("Task rename is unavailable");
        return handlers.renameTask(command.task, command.title);
    }
    if (command.type === "setKind") {
        if (!handlers.updateTask) throw new Error("Task update is unavailable");
        return handlers.updateTask(command.task, { [ATTR_KIND]: command.actionKind });
    }
    if (!handlers.reorderTask) throw new Error("Task reorder is unavailable");
    await handlers.reorderTask(command.task.blockId, command.parentId, command.afterId);
}
