import { ATTR_KIND } from "../../shared/constants";
import type { TaskActionKind, TaskCacheEntry } from "../../shared/types";
import type { ProjectTreeModel, ProjectTreeRow } from "./project-tree";

export interface ProjectPlanReorderIntent {
    blockId: string;
    parentId: string;
    afterId?: string;
}

export interface ProjectPlanCommandHandlers {
    renameTask?: (task: TaskCacheEntry, title: string) => Promise<TaskCacheEntry>;
    updateTask?: (task: TaskCacheEntry, attrs: Record<string, string>) => Promise<TaskCacheEntry>;
    reorderTask?: (blockId: string, parentId: string, afterId?: string) => Promise<void>;
}

export type ProjectPlanCommand =
    | { type: "rename"; task: TaskCacheEntry; title: string }
    | { type: "setKind"; task: TaskCacheEntry; actionKind: Exclude<TaskActionKind, ""> }
    | { type: "reorder"; task: TaskCacheEntry; parentId: string; afterId?: string };

function compareManualOrder(left: TaskCacheEntry, right: TaskCacheEntry): number {
    return left.sort - right.sort || left.blockId.localeCompare(right.blockId);
}

export function buildProjectPlanRows(model: ProjectTreeModel, projectId: string): ProjectTreeRow[] {
    const rows: ProjectTreeRow[] = [];
    const visited = new Set<string>([projectId]);
    const visit = (parentId: string, depth: number): void => {
        const children = [...(model.childrenByParent.get(parentId) || [])].sort(compareManualOrder);
        for (const child of children) {
            if (visited.has(child.blockId) || !model.includedIds.has(child.blockId)) continue;
            visited.add(child.blockId);
            rows.push({
                task: child,
                depth,
                hasChildren: (model.childrenByParent.get(child.blockId) || []).some((entry) =>
                    model.includedIds.has(entry.blockId),
                ),
                childCount: (model.childrenByParent.get(child.blockId) || []).filter((entry) =>
                    model.includedIds.has(entry.blockId),
                ).length,
                subtreeProgress: undefined,
            });
            visit(child.blockId, depth + 1);
        }
    };

    visit(projectId, 1);
    const disconnected = [...model.taskById.values()]
        .filter(
            (task) => task.blockId !== projectId && model.includedIds.has(task.blockId) && !visited.has(task.blockId),
        )
        .sort(compareManualOrder);
    for (const task of disconnected) {
        if (visited.has(task.blockId)) continue;
        visited.add(task.blockId);
        rows.push({
            task,
            depth: 1,
            hasChildren: (model.childrenByParent.get(task.blockId) || []).some((entry) =>
                model.includedIds.has(entry.blockId),
            ),
            childCount: (model.childrenByParent.get(task.blockId) || []).filter((entry) =>
                model.includedIds.has(entry.blockId),
            ).length,
            subtreeProgress: undefined,
        });
        visit(task.blockId, 2);
    }
    return rows;
}

function collectDescendantIds(task: TaskCacheEntry, tasks: TaskCacheEntry[]): Set<string> {
    const childrenByParent = new Map<string, TaskCacheEntry[]>();
    for (const entry of tasks) {
        const children = childrenByParent.get(entry.parentId) || [];
        children.push(entry);
        childrenByParent.set(entry.parentId, children);
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

export function buildProjectPlanParentOptions(
    task: TaskCacheEntry,
    project: TaskCacheEntry,
    tasks: TaskCacheEntry[],
): TaskCacheEntry[] {
    const excludedIds = collectDescendantIds(task, tasks);
    excludedIds.add(task.blockId);
    return [project, ...tasks]
        .filter(
            (entry) => !excludedIds.has(entry.blockId) && (entry.blockId === project.blockId || entry.taskType !== "2"),
        )
        .filter(
            (entry, index, entries) => entries.findIndex((candidate) => candidate.blockId === entry.blockId) === index,
        );
}

export function buildProjectPlanReorderIntent(
    task: TaskCacheEntry,
    siblings: TaskCacheEntry[],
    direction: "up" | "down",
): ProjectPlanReorderIntent | null {
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

export async function executeProjectPlanCommand(
    command: ProjectPlanCommand,
    handlers: ProjectPlanCommandHandlers,
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
