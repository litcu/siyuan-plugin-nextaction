import type { TaskCacheEntry } from "../../shared/types";
import type { ProjectTreeModel, ProjectTreeRow } from "./project-tree";
import {
    buildProjectTreeParentOptions,
    buildProjectTreeReorderIntent,
    executeProjectTreeCommand,
} from "./project-tree-operations";
import type {
    ProjectTreeCommand as ProjectPlanCommand,
    ProjectTreeCommandHandlers as ProjectPlanCommandHandlers,
    ProjectTreeReorderIntent as ProjectPlanReorderIntent,
} from "./project-tree-operations";
export type {
    ProjectTreeCommand as ProjectPlanCommand,
    ProjectTreeCommandHandlers as ProjectPlanCommandHandlers,
    ProjectTreeReorderIntent as ProjectPlanReorderIntent,
} from "./project-tree-operations";

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
                visibleParentId: parentId,
                positionInSet: 1,
                setSize: 1,
                isCollapsed: false,
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
            visibleParentId: "",
            positionInSet: 1,
            setSize: 1,
            isCollapsed: false,
            subtreeProgress: undefined,
        });
        visit(task.blockId, 2);
    }
    return rows;
}

export function buildProjectPlanParentOptions(
    task: TaskCacheEntry,
    project: TaskCacheEntry,
    tasks: TaskCacheEntry[],
): TaskCacheEntry[] {
    return buildProjectTreeParentOptions(task, project, tasks);
}

export function buildProjectPlanReorderIntent(
    task: TaskCacheEntry,
    siblings: TaskCacheEntry[],
    direction: "up" | "down",
): ProjectPlanReorderIntent | null {
    return buildProjectTreeReorderIntent(task, siblings, direction);
}

export async function executeProjectPlanCommand(
    command: ProjectPlanCommand,
    handlers: ProjectPlanCommandHandlers,
): Promise<TaskCacheEntry | void> {
    return executeProjectTreeCommand(command, handlers);
}
