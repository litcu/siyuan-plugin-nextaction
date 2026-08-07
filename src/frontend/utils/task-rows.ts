import type { TaskCacheEntry } from "../../shared/types";

export interface TaskListRow {
    task: TaskCacheEntry;
    indent: number;
    hasChildren: boolean;
    childCount: number;
}

function compareRoots(a: TaskCacheEntry, b: TaskCacheEntry): number {
    if (b.order !== a.order) return b.order - a.order;
    if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    return a.blockId.localeCompare(b.blockId);
}

function compareChildren(a: TaskCacheEntry, b: TaskCacheEntry): number {
    if (a.sort !== b.sort) return a.sort - b.sort;
    return a.blockId.localeCompare(b.blockId);
}

export function buildTaskListRows(
    tasks: TaskCacheEntry[],
    collapsed: Record<string, boolean>,
    preserveOrder: boolean,
): TaskListRow[] {
    const taskIds = new Set(tasks.map((task) => task.blockId));
    const childrenByParent = new Map<string, TaskCacheEntry[]>();
    const roots: TaskCacheEntry[] = [];

    for (const task of tasks) {
        if (task.parentId && taskIds.has(task.parentId)) {
            const children = childrenByParent.get(task.parentId) || [];
            children.push(task);
            childrenByParent.set(task.parentId, children);
        } else {
            roots.push(task);
        }
    }

    if (!preserveOrder) {
        roots.sort(compareRoots);
        for (const children of childrenByParent.values()) children.sort(compareChildren);
    }

    const rows: TaskListRow[] = [];
    const visited = new Set<string>();
    const hidden = new Set<string>();

    const markDescendantsHidden = (taskId: string, path: Set<string>) => {
        if (path.has(taskId)) return;
        const nextPath = new Set(path);
        nextPath.add(taskId);
        for (const child of childrenByParent.get(taskId) || []) {
            hidden.add(child.blockId);
            markDescendantsHidden(child.blockId, nextPath);
        }
    };

    const addSubtree = (task: TaskCacheEntry, indent: number, ancestors: Set<string>) => {
        if (visited.has(task.blockId) || ancestors.has(task.blockId)) return;
        visited.add(task.blockId);

        const children = childrenByParent.get(task.blockId) || [];
        rows.push({
            task,
            indent,
            hasChildren: children.length > 0,
            childCount: children.length,
        });

        if (collapsed[task.blockId]) {
            markDescendantsHidden(task.blockId, ancestors);
            return;
        }

        const nextAncestors = new Set(ancestors);
        nextAncestors.add(task.blockId);
        for (const child of children) addSubtree(child, indent + 1, nextAncestors);
    };

    for (const root of roots) addSubtree(root, 0, new Set());

    // Corrupt or cyclic parent links may leave a component with no root. Keep
    // every task visible exactly once rather than recursing forever.
    for (const task of tasks) {
        if (!visited.has(task.blockId) && !hidden.has(task.blockId)) addSubtree(task, 0, new Set());
    }

    return rows;
}
