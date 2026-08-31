import type { ProjectProgress, ProjectSummary, TaskCacheEntry } from "../../shared/types";
import { createProjectMembershipGraph } from "../../shared/project-membership-graph";

export interface ProjectTreeRow {
    task: TaskCacheEntry;
    depth: number;
    hasChildren: boolean;
    childCount: number;
    visibleParentId?: string;
    positionInSet?: number;
    setSize?: number;
    isCollapsed?: boolean;
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
    revealedTaskIds?: ReadonlySet<string> | null;
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
    const membership = createProjectMembershipGraph(allTasks);
    const childrenByParent = new Map<string, TaskCacheEntry[]>();
    const parentByChild = new Map<string, string>();

    for (const parent of allTasks) {
        const children = (membership.node(parent.blockId)?.children || []).filter((child) =>
            allowedIds.has(child.blockId),
        );
        if (children.length > 0) childrenByParent.set(parent.blockId, [...children]);
        for (const child of children) parentByChild.set(child.blockId, parent.blockId);
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
    const revealedTaskIds = options.revealedTaskIds;
    const includedIds = new Set<string>([summary.project.blockId]);
    const walkAncestors = (taskId: string, target: Set<string>) => {
        let currentId = taskId;
        const pathVisited = new Set<string>();
        while (currentId && !pathVisited.has(currentId)) {
            pathVisited.add(currentId);
            target.add(currentId);
            if (currentId === summary.project.blockId) break;
            currentId = parentByChild.get(currentId) || "";
        }
    };
    if (!matchedTaskIds) {
        for (const task of summary.descendants) {
            if (options.showCompleted || task.status !== "done") includedIds.add(task.blockId);
        }
    } else {
        for (const taskId of matchedTaskIds) {
            const task = taskById.get(taskId);
            if (!task || (!options.showCompleted && task.status === "done")) continue;
            walkAncestors(taskId, includedIds);
        }
    }

    for (const taskId of revealedTaskIds || []) {
        const task = taskById.get(taskId);
        if (!task || (!options.showCompleted && task.status === "done")) continue;
        walkAncestors(taskId, includedIds);
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

    const forcedExpandedIds = new Set<string>();
    for (const taskId of [...(matchedTaskIds || []), ...(revealedTaskIds || [])]) {
        walkAncestors(parentByChild.get(taskId) || "", forcedExpandedIds);
    }

    const isDisplayable = (task: TaskCacheEntry): boolean =>
        includedIds.has(task.blockId) &&
        (task.blockId === summary.project.blockId || options.showCompleted || task.status !== "done");
    const visibleChildren = (parentId: string, path = new Set<string>()): TaskCacheEntry[] => {
        if (path.has(parentId)) return [];
        const nextPath = new Set(path).add(parentId);
        const result: TaskCacheEntry[] = [];
        for (const child of childrenByParent.get(parentId) || []) {
            if (parentByChild.get(child.blockId) !== parentId) continue;
            if (!includedIds.has(child.blockId) && !hasIncludedDescendant(child.blockId)) continue;
            if (isDisplayable(child)) result.push(child);
            else result.push(...visibleChildren(child.blockId, nextPath));
        }
        return result.filter(
            (task, index, tasks) => tasks.findIndex((candidate) => candidate.blockId === task.blockId) === index,
        );
    };

    const rows: ProjectTreeRow[] = [];
    const visited = new Set<string>();
    const addRow = (
        task: TaskCacheEntry,
        depth: number,
        visibleParentId: string,
        siblings: TaskCacheEntry[],
        position: number,
    ): void => {
        if (visited.has(task.blockId)) return;
        visited.add(task.blockId);
        const children = visibleChildren(task.blockId);
        const isCollapsed = collapseState.has(task.blockId) && !forcedExpandedIds.has(task.blockId);
        rows.push({
            task,
            depth,
            hasChildren: children.length > 0,
            childCount: children.length,
            visibleParentId,
            positionInSet: position + 1,
            setSize: siblings.length,
            isCollapsed,
            subtreeProgress: summary.subtreeProgress[task.blockId],
        });
        if (isCollapsed) return;
        children.forEach((child, index) => addRow(child, depth + 1, task.blockId, children, index));
    };

    addRow(summary.project, 0, "", [summary.project], 0);
    const disconnected = summary.descendants.filter(
        (task) => !connectedIds.has(task.blockId) && !visited.has(task.blockId) && isDisplayable(task),
    );
    disconnected.forEach((task, index) => addRow(task, 0, "", disconnected, index));

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
