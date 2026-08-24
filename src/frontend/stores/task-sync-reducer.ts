import type { TaskCacheEntry, TaskChangeSetV2, TaskSnapshotV2 } from "../../shared/types";
import { countReviewAttentionTasks } from "../../shared/review";
import { isProjectTask } from "../../shared/project-domain";

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
            isProjectTask(entry) &&
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

    const entries = [...byId.values()];
    const childIdsByParent = new Map<string, string[]>();
    for (const entry of entries) {
        if (!entry.parentId) continue;
        const childIds = childIdsByParent.get(entry.parentId);
        if (childIds) childIds.push(entry.blockId);
        else childIdsByParent.set(entry.parentId, [entry.blockId]);
    }
    const allTasks = entries.map((task) => {
        const childIds = childIdsByParent.get(task.blockId) || [];
        const childIdsUnchanged =
            task.childIds.length === childIds.length &&
            task.childIds.every((childId, index) => childId === childIds[index]);
        return childIdsUnchanged ? task : { ...task, childIds };
    });
    const afterDone = changes.upserts.some((entry) => entry.status === "done");
    return {
        collection: buildTaskCollection(allTasks),
        completedChanged: beforeDone || afterDone,
    };
}

function isTaskEntry(value: unknown, allowLegacyIdentity = false): value is TaskCacheEntry {
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
    const hasCurrentIdentity =
        (task.identificationSource === "document" || task.identificationSource === "native") &&
        typeof task.attrHostId === "string";
    const hasLegacyIdentity =
        allowLegacyIdentity && task.identificationSource === undefined && task.attrHostId === undefined;
    return (
        stringFields.every((field) => typeof task[field] === "string") &&
        (hasCurrentIdentity || hasLegacyIdentity) &&
        (task.contentBlockId === undefined || typeof task.contentBlockId === "string") &&
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

function normalizeTaskEntry(value: unknown): TaskCacheEntry | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    if (typeof source.blockId !== "string" || source.blockId.length === 0) return null;
    // A payload containing only an id is not a task snapshot entry. These
    // fields have existed since V2 and distinguish malformed data from an
    // older, otherwise usable entry missing newer metadata.
    if (["status", "taskType", "title", "childIds"].some((field) => source[field] === undefined)) return null;

    // V2 snapshots can be served by a kernel bundle that was loaded just before
    // the current fields were introduced. Keep the wire contract stable by
    // filling only fields whose absence has a deterministic domain default.
    const defaults: Record<string, unknown> = {
        identificationSource: "document",
        attrHostId: source.blockId,
        parentId: "",
        status: "todo",
        priority: "medium",
        importance: 0,
        effort: 0,
        due: "",
        start: "",
        context: "",
        taskType: "1",
        order: 0,
        childIds: [],
        title: "",
        depends: "",
        depMode: "all",
        sequential: false,
        repeat: "",
        repeatState: "",
        sort: -1,
        completed: "",
        note: "",
        created: "",
        tags: "",
        blocked: false,
        blockedReason: "",
        reviewInterval: 0,
        reviewDate: "",
        reminder: "",
        customFields: {},
    };
    const present = Object.fromEntries(
        Object.entries(source).filter(([, fieldValue]) => fieldValue !== undefined && fieldValue !== null),
    );
    const normalized = { ...defaults, ...present } as Partial<TaskCacheEntry>;
    if (!isTaskEntry(normalized, true)) return null;
    return normalized as TaskCacheEntry;
}

function hasValidTaskSet(tasks: unknown): tasks is TaskCacheEntry[] {
    if (!Array.isArray(tasks) || !tasks.every((task) => isTaskEntry(task))) return false;
    return new Set(tasks.map((task) => task.blockId)).size === tasks.length;
}

export function isTaskSnapshotV2(value: unknown): value is TaskSnapshotV2 {
    return normalizeTaskSnapshotV2(value) !== null;
}

/**
 * Accept snapshots emitted by a kernel that predates the native-task identity
 * fields while the plugin is being hot-reloaded. The wire contract remains V2;
 * missing identity metadata is deterministically treated as a document task.
 */
export function normalizeTaskSnapshotV2(value: unknown): TaskSnapshotV2 | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const snapshot = value as Partial<TaskSnapshotV2>;
    if (
        snapshot.schema === 2 &&
        typeof snapshot.streamId === "string" &&
        snapshot.streamId.length > 0 &&
        Number.isSafeInteger(snapshot.revision) &&
        Number(snapshot.revision) >= 0 &&
        Array.isArray(snapshot.tasks)
    ) {
        const streamId = snapshot.streamId;
        const revision = snapshot.revision as number;
        const tasks = snapshot.tasks.map(normalizeTaskEntry);
        if (tasks.some((task) => task === null)) return null;
        const entries = tasks as TaskCacheEntry[];
        if (new Set(entries.map((task) => task.blockId)).size !== entries.length) return null;
        return {
            schema: 2,
            streamId,
            revision,
            tasks: entries,
        };
    }
    return null;
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
