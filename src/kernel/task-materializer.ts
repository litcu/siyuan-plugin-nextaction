import {
    ACTION_KIND_STAGE,
    ATTR_COMPLETED,
    ATTR_CONTEXT,
    ATTR_CREATED,
    ATTR_DEPENDS,
    ATTR_DEP_MODE,
    ATTR_DOD,
    ATTR_DUE,
    ATTR_EFFORT,
    ATTR_EXT_PREFIX,
    ATTR_IMPORTANCE,
    ATTR_KIND,
    ATTR_NOTE,
    ATTR_OUTCOME,
    ATTR_PARENT,
    ATTR_PRIORITY,
    ATTR_REMINDER,
    ATTR_REPEAT,
    ATTR_REPEAT_STATE,
    ATTR_REVIEW_DATE,
    ATTR_REVIEW_INTERVAL,
    ATTR_SEQUENTIAL,
    ATTR_SORT,
    ATTR_START,
    ATTR_STATUS,
    ATTR_TAGS,
    ATTR_TASK,
} from "../shared/constants";
import type { PluginSettings } from "../shared/settings";
import type { TaskHostIdentity } from "../shared/task-identity";
import type { TaskCacheEntry } from "../shared/types";
import { attrToNumber } from "./utils";

export type MaterializedTaskFacts = Omit<
    TaskCacheEntry,
    "blocked" | "blockedReason" | "childIds" | "order" | "_warning"
>;

export type TaskMaterializationObservation =
    | { kind: "renamed"; title: string }
    | { kind: "effective-parent-confirmed"; parentId: string }
    | { kind: "task-type-confirmed"; taskType: "1" | "2" };

export interface MaterializeTaskInput {
    blockId: string;
    confirmedAttrs: Record<string, string>;
    defaults: Pick<PluginSettings, "defaultImportance" | "defaultEffort">;
    freshIdentity?: TaskHostIdentity;
    existingTask?: TaskCacheEntry;
    observations?: readonly TaskMaterializationObservation[];
}

interface ObservationValues {
    title?: string;
    parentId?: string;
    taskType?: "1" | "2";
}

function collectObservations(observations: readonly TaskMaterializationObservation[]): ObservationValues {
    const seen = new Set<TaskMaterializationObservation["kind"]>();
    const values: ObservationValues = {};
    for (const observation of observations) {
        if (seen.has(observation.kind)) {
            throw new Error(`Duplicate task materialization observation: ${observation.kind}`);
        }
        seen.add(observation.kind);
        switch (observation.kind) {
            case "renamed":
                values.title = observation.title;
                break;
            case "effective-parent-confirmed":
                values.parentId = observation.parentId;
                break;
            case "task-type-confirmed":
                values.taskType = observation.taskType;
                break;
        }
    }
    return values;
}

function extractCustomFields(attrs: Record<string, string>): Record<string, string> {
    const result = Object.create(null) as Record<string, string>;
    for (const key of Object.keys(attrs)) {
        if (!key.startsWith(ATTR_EXT_PREFIX)) continue;
        const fieldKey = key.slice(ATTR_EXT_PREFIX.length);
        if (fieldKey && attrs[key]) result[fieldKey] = attrs[key];
    }
    return result;
}

function structuralSort(input: MaterializeTaskInput, source: "document" | "native"): number {
    if (source !== "native") return -1;
    const value = input.freshIdentity?.sort ?? input.existingTask?.sort ?? -1;
    return Number.isFinite(value) ? Math.trunc(value) : -1;
}

/**
 * Converts authoritative persisted attributes plus explicit identity evidence into
 * cache-independent task facts. Relationship indexes and derived runtime state are
 * deliberately completed by CacheManager.
 */
export function materializeTask(input: MaterializeTaskInput): MaterializedTaskFacts {
    const { blockId, confirmedAttrs: attrs, freshIdentity, existingTask } = input;
    if (!blockId) throw new Error("Task materialization requires a block ID");
    if (!freshIdentity && !existingTask) {
        throw new Error(`Task materialization requires identity evidence for ${blockId}`);
    }
    if (freshIdentity && freshIdentity.blockId !== blockId) {
        throw new Error(`Task identity block ID mismatch: expected ${blockId}, received ${freshIdentity.blockId}`);
    }
    if (existingTask && existingTask.blockId !== blockId) {
        throw new Error(`Existing task block ID mismatch: expected ${blockId}, received ${existingTask.blockId}`);
    }

    const observations = collectObservations(input.observations || []);
    const identificationSource = freshIdentity?.identificationSource ?? existingTask?.identificationSource;
    if (identificationSource !== "document" && identificationSource !== "native") {
        throw new Error(`Invalid task identification source for ${blockId}: ${String(identificationSource)}`);
    }
    const attrHostId = freshIdentity?.attrHostId ?? existingTask?.attrHostId;
    if (!attrHostId) throw new Error(`Task materialization requires an attribute host for ${blockId}`);

    const persistedTaskType = attrs[ATTR_TASK] === "2" ? "2" : attrs[ATTR_TASK] === "1" ? "1" : undefined;
    const nativeProjectEvidence =
        observations.taskType === "2" || freshIdentity?.taskType === "2" || existingTask?.taskType === "2";
    const evidencedTaskType =
        identificationSource === "native"
            ? "1"
            : (observations.taskType ?? freshIdentity?.taskType ?? persistedTaskType ?? existingTask?.taskType ?? "1");
    if (evidencedTaskType !== "1" && evidencedTaskType !== "2") {
        throw new Error(`Invalid task type evidence for ${blockId}: ${evidencedTaskType}`);
    }
    if (identificationSource === "native" && nativeProjectEvidence) {
        throw new Error(`Native task cannot be materialized as a Project: ${blockId}`);
    }
    const taskType = identificationSource === "native" ? "1" : evidencedTaskType;

    const identityParentId = freshIdentity ? freshIdentity.structuralParentId : existingTask?.parentId || "";
    const parentId = observations.parentId ?? (attrs[ATTR_PARENT] || identityParentId);
    const fallbackSort = structuralSort(input, identificationSource);

    return {
        blockId,
        identificationSource,
        contentBlockId: freshIdentity ? freshIdentity.contentBlockId : existingTask?.contentBlockId,
        attrHostId,
        parentId,
        status: attrs[ATTR_STATUS] || freshIdentity?.defaultStatus || existingTask?.status || "todo",
        priority: attrs[ATTR_PRIORITY] || "medium",
        importance: attrToNumber(attrs[ATTR_IMPORTANCE], input.defaults.defaultImportance),
        effort: attrToNumber(attrs[ATTR_EFFORT], input.defaults.defaultEffort),
        due: attrs[ATTR_DUE] || "",
        start: attrs[ATTR_START] || "",
        context: attrs[ATTR_CONTEXT] || "",
        taskType,
        title: observations.title ?? freshIdentity?.title ?? existingTask?.title ?? "",
        depends: attrs[ATTR_DEPENDS] || "",
        depMode: attrs[ATTR_DEP_MODE] || "all",
        sequential: attrs[ATTR_SEQUENTIAL] === "1",
        repeat: attrs[ATTR_REPEAT] || "",
        repeatState: attrs[ATTR_REPEAT_STATE] || "",
        sort: attrToNumber(attrs[ATTR_SORT], fallbackSort),
        completed: attrs[ATTR_COMPLETED] || "",
        note: attrs[ATTR_NOTE] || "",
        outcome: attrs[ATTR_OUTCOME] || "",
        dod: attrs[ATTR_DOD] || "",
        actionKind: taskType === "2" ? "" : attrs[ATTR_KIND] === ACTION_KIND_STAGE ? "stage" : "action",
        created: attrs[ATTR_CREATED] || "",
        updated: freshIdentity?.updated ?? existingTask?.updated,
        tags: attrs[ATTR_TAGS] || "",
        reviewInterval: attrToNumber(attrs[ATTR_REVIEW_INTERVAL], 0),
        reviewDate: attrs[ATTR_REVIEW_DATE] || "",
        reminder: attrs[ATTR_REMINDER] || "",
        customFields: extractCustomFields(attrs),
    };
}
