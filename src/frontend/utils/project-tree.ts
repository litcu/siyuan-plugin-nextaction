import type { ProjectProgress, ProjectSummary, TaskCacheEntry } from "../../shared/types";

export interface ProjectTreeRow {
    task: TaskCacheEntry;
    depth: number;
    hasChildren: boolean;
    childCount: number;
    subtreeProgress?: ProjectProgress;
}

export interface ProjectTreeModel {
    rows: ProjectTreeRow[];
    includedTasks: TaskCacheEntry[];
    includedIds: Set<string>;
    taskById: Map<string, TaskCacheEntry>;
    childrenByParent: Map<string, TaskCacheEntry[]>;
    parentByChild: Map<string, string>;
}

export interface ProjectTreeOptions {
    showCompleted: boolean;
    matchedTaskIds?: ReadonlySet<string> | null;
    sortMode?: ProjectTreeSortMode;
}

export type ProjectTreeSortMode = "manual" | "timeline";

export function shouldShowSubtreeProgress(row: ProjectTreeRow): boolean {
    return row.task.taskType !== "2" && row.hasChildren && (row.subtreeProgress?.total || 0) > 0;
}

function compareTreeOrder(a: TaskCacheEntry, b: TaskCacheEntry): number {
    if (a.sort !== b.sort) return a.sort - b.sort;
    return a.blockId.localeCompare(b.blockId);
}

function compareTimelineOrder(a: TaskCacheEntry, b: TaskCacheEntry): number {
    const aStart = (a.start || a.due || "").slice(0, 10);
    const bStart = (b.start || b.due || "").slice(0, 10);
    if (aStart !== bStart) {
        if (!aStart) return 1;
        if (!bStart) return -1;
        return aStart.localeCompare(bStart);
    }
    const aDue = (a.due || "").slice(0, 10);
    const bDue = (b.due || "").slice(0, 10);
    if (aDue !== bDue) {
        if (!aDue) return 1;
        if (!bDue) return -1;
        return aDue.localeCompare(bDue);
    }
    return compareTreeOrder(a, b);
}

export function buildProjectTreeModel(
    summary: ProjectSummary,
    collapseState: ReadonlySet<string>,
    options: ProjectTreeOptions,
): ProjectTreeModel {
    const allTasks = [summary.project, ...summary.descendants];
    const taskById = new Map(allTasks.map((task) => [task.blockId, task]));
    const allowedIds = new Set(summary.descendants.map((task) => task.blockId));
    const childrenByParent = new Map<string, TaskCacheEntry[]>();
    const parentByChild = new Map<string, string>();

    const addEdge = (parentId: string, child: TaskCacheEntry, prefer = false) => {
        if (!taskById.has(parentId) || !allowedIds.has(child.blockId) || parentId === child.blockId) return;
        const children = childrenByParent.get(parentId) || [];
        if (!children.some((entry) => entry.blockId === child.blockId)) children.push(child);
        childrenByParent.set(parentId, children);
        if (prefer || !parentByChild.has(child.blockId)) parentByChild.set(child.blockId, parentId);
    };

    for (const task of summary.descendants) {
        if (task.parentId) addEdge(task.parentId, task, true);
    }
    for (const parent of allTasks) {
        for (const childId of parent.childIds || []) {
            const child = taskById.get(childId);
            if (child) addEdge(parent.blockId, child);
        }
    }
    const compareChildren = options.sortMode === "timeline" ? compareTimelineOrder : compareTreeOrder;
    for (const children of childrenByParent.values()) children.sort(compareChildren);

    const connectedIds = new Set<string>([summary.project.blockId]);
    const markConnected = (parentId: string) => {
        for (const child of childrenByParent.get(parentId) || []) {
            if (connectedIds.has(child.blockId)) continue;
            connectedIds.add(child.blockId);
            markConnected(child.blockId);
        }
    };
    markConnected(summary.project.blockId);

    const matchedTaskIds = options.matchedTaskIds;
    const includedIds = new Set<string>([summary.project.blockId]);
    if (!matchedTaskIds) {
        for (const task of summary.descendants) {
            if (options.showCompleted || task.status !== "done") includedIds.add(task.blockId);
        }
    } else {
        for (const taskId of matchedTaskIds) {
            const task = taskById.get(taskId);
            if (!task || (!options.showCompleted && task.status === "done")) continue;
            let currentId = taskId;
            const pathVisited = new Set<string>();
            while (currentId && !pathVisited.has(currentId)) {
                pathVisited.add(currentId);
                includedIds.add(currentId);
                if (currentId === summary.project.blockId) break;
                currentId = parentByChild.get(currentId) || "";
            }
        }
    }

    const includedDescendantMemo = new Map<string, boolean>();
    const hasIncludedDescendant = (taskId: string, visiting = new Set<string>()): boolean => {
        if (includedDescendantMemo.has(taskId)) return includedDescendantMemo.get(taskId) || false;
        if (visiting.has(taskId)) return false;
        const nextVisiting = new Set(visiting).add(taskId);
        const result = (childrenByParent.get(taskId) || []).some(
            (child) => includedIds.has(child.blockId) || hasIncludedDescendant(child.blockId, nextVisiting),
        );
        includedDescendantMemo.set(taskId, result);
        return result;
    };

    const rowMeta = (task: TaskCacheEntry, depth: number): ProjectTreeRow => {
        const includedChildren = (childrenByParent.get(task.blockId) || []).filter(
            (child) => includedIds.has(child.blockId) || hasIncludedDescendant(child.blockId),
        );
        return {
            task,
            depth,
            hasChildren: includedChildren.length > 0,
            childCount: includedChildren.length,
            subtreeProgress: summary.subtreeProgress[task.blockId],
        };
    };

    const rows: ProjectTreeRow[] = [rowMeta(summary.project, 0)];
    const visited = new Set<string>([summary.project.blockId]);
    const visit = (parentId: string, depth: number) => {
        for (const child of childrenByParent.get(parentId) || []) {
            if (visited.has(child.blockId)) continue;
            if (!includedIds.has(child.blockId) && !hasIncludedDescendant(child.blockId)) continue;
            visited.add(child.blockId);
            if (!options.showCompleted && child.status === "done") {
                visit(child.blockId, depth);
                continue;
            }
            rows.push(rowMeta(child, depth));
            if (!collapseState.has(child.blockId)) visit(child.blockId, depth + 1);
        }
    };

    if (!collapseState.has(summary.project.blockId)) visit(summary.project.blockId, 1);
    for (const task of summary.descendants) {
        if (connectedIds.has(task.blockId) || visited.has(task.blockId) || !includedIds.has(task.blockId)) continue;
        if (!options.showCompleted && task.status === "done") continue;
        rows.push(rowMeta(task, 0));
        visited.add(task.blockId);
        if (!collapseState.has(task.blockId)) visit(task.blockId, 1);
    }

    const includedTasks = allTasks.filter(
        (task) =>
            includedIds.has(task.blockId) &&
            (task.blockId === summary.project.blockId || options.showCompleted || task.status !== "done"),
    );

    return {
        rows,
        includedTasks,
        includedIds,
        taskById,
        childrenByParent,
        parentByChild,
    };
}
