import type { TaskCacheEntry, TaskChangeSetV2, TaskSnapshotV2 } from "../../shared/types";
import { countReviewAttentionTasks } from "../../shared/review";

export interface TaskCollectionState {
    allTasks: TaskCacheEntry[];
    contexts: string[];
    tags: string[];
    doneCount: number;
    projectReminders: TaskCacheEntry[];
    reviewDueCount: number;
}

export interface TaskCollectionChanges {
    upserts: TaskCacheEntry[];
    deletedBlockIds: string[];
}

export interface TaskCollectionReduction {
    collection: TaskCollectionState;
    completedChanged: boolean;
}

function deriveContexts(allTasks: TaskCacheEntry[]): string[] {
    const values = new Set<string>();
    for (const task of allTasks) {
        for (const context of task.context.split("|")) {
            const trimmed = context.trim();
            if (trimmed) values.add(trimmed);
        }
    }
    return [...values];
}

function deriveTags(allTasks: TaskCacheEntry[]): string[] {
    const values = new Set<string>();
    for (const task of allTasks) {
        for (const tag of task.tags.split("|")) {
            const trimmed = tag.trim();
            if (trimmed) values.add(trimmed);
        }
    }
    return [...values];
}

function deriveProjectReminders(allTasks: TaskCacheEntry[]): TaskCacheEntry[] {
    const taskMap = new Map(allTasks.map((task) => [task.blockId, task]));
    return allTasks.filter(
        (entry) =>
            entry.taskType === "2" &&
            entry.status !== "done" &&
            entry.childIds.length > 0 &&
            entry.childIds.every((childId) => taskMap.get(childId)?.status === "done"),
    );
}

export function buildTaskCollection(allTasks: TaskCacheEntry[]): TaskCollectionState {
    return {
        allTasks,
        contexts: deriveContexts(allTasks),
        tags: deriveTags(allTasks),
        doneCount: allTasks.reduce((count, task) => count + (task.status === "done" ? 1 : 0), 0),
        projectReminders: deriveProjectReminders(allTasks),
        reviewDueCount: countReviewAttentionTasks(allTasks),
    };
}

export function reduceTaskChanges(
    current: Pick<TaskCollectionState, "allTasks">,
    changes: TaskCollectionChanges,
): TaskCollectionReduction {
    const byId = new Map(current.allTasks.map((task) => [task.blockId, task]));
    const affectedIds = new Set(changes.deletedBlockIds);
    for (const entry of changes.upserts) affectedIds.add(entry.blockId);
    const beforeDone = [...affectedIds].some((blockId) => byId.get(blockId)?.status === "done");

    for (const blockId of changes.deletedBlockIds) byId.delete(blockId);
    for (const entry of changes.upserts) byId.set(entry.blockId, entry);

    const deletedIds = new Set(changes.deletedBlockIds);
    const allTasks = [...byId.values()].map((task) =>
        task.childIds.some((childId) => deletedIds.has(childId))
            ? { ...task, childIds: task.childIds.filter((childId) => !deletedIds.has(childId)) }
            : task,
    );
    const afterDone = changes.upserts.some((entry) => entry.status === "done");
    return {
        collection: buildTaskCollection(allTasks),
        completedChanged: beforeDone || afterDone,
    };
}

function isTaskEntry(value: unknown): value is TaskCacheEntry {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const task = value as Partial<TaskCacheEntry>;
    const stringFields: Array<keyof TaskCacheEntry> = [
        "blockId",
        "parentId",
        "status",
        "priority",
        "due",
        "start",
        "context",
        "taskType",
        "title",
        "depends",
        "depMode",
        "repeat",
        "repeatState",
        "completed",
        "note",
        "created",
        "tags",
        "blockedReason",
        "reviewDate",
        "reminder",
    ];
    const numberFields: Array<keyof TaskCacheEntry> = ["importance", "effort", "order", "sort", "reviewInterval"];
    const booleanFields: Array<keyof TaskCacheEntry> = ["sequential", "blocked"];
    return (
        stringFields.every((field) => typeof task[field] === "string") &&
        numberFields.every((field) => typeof task[field] === "number" && Number.isFinite(task[field] as number)) &&
        booleanFields.every((field) => typeof task[field] === "boolean") &&
        Array.isArray(task.childIds) &&
        task.childIds.every((blockId) => typeof blockId === "string") &&
        !!task.customFields &&
        typeof task.customFields === "object" &&
        !Array.isArray(task.customFields) &&
        Object.values(task.customFields).every((fieldValue) => typeof fieldValue === "string")
    );
}

function hasValidTaskSet(tasks: unknown): tasks is TaskCacheEntry[] {
    if (!Array.isArray(tasks) || !tasks.every(isTaskEntry)) return false;
    return new Set(tasks.map((task) => task.blockId)).size === tasks.length;
}

export function isTaskSnapshotV2(value: unknown): value is TaskSnapshotV2 {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const snapshot = value as Partial<TaskSnapshotV2>;
    return (
        snapshot.schema === 2 &&
        typeof snapshot.streamId === "string" &&
        snapshot.streamId.length > 0 &&
        Number.isSafeInteger(snapshot.revision) &&
        Number(snapshot.revision) >= 0 &&
        hasValidTaskSet(snapshot.tasks)
    );
}

export function isTaskChangeSetV2(value: unknown): value is TaskChangeSetV2 {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const changeSet = value as Partial<TaskChangeSetV2>;
    if (
        changeSet.schema !== 2 ||
        typeof changeSet.streamId !== "string" ||
        changeSet.streamId.length === 0 ||
        !Number.isSafeInteger(changeSet.revision) ||
        Number(changeSet.revision) < 0
    )
        return false;
    if (changeSet.type === "reset") return true;
    if (
        changeSet.type !== "delta" ||
        !Number.isSafeInteger(changeSet.fromRevision) ||
        Number(changeSet.fromRevision) < 0 ||
        Number(changeSet.fromRevision) >= Number(changeSet.revision) ||
        !hasValidTaskSet(changeSet.upserts) ||
        !Array.isArray(changeSet.deletedBlockIds) ||
        !changeSet.deletedBlockIds.every((blockId) => typeof blockId === "string")
    )
        return false;
    const deletedIds = new Set(changeSet.deletedBlockIds);
    return (
        deletedIds.size === changeSet.deletedBlockIds.length &&
        changeSet.upserts.every((task) => !deletedIds.has(task.blockId))
    );
}
