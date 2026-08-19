import type { TaskCacheEntry } from "../shared/types";
import {
    ATTR_DUE,
    ATTR_CREATED,
    ATTR_EFFORT,
    ATTR_IMPORTANCE,
    ATTR_PARENT,
    ATTR_PRIORITY,
    ATTR_REPEAT,
    ATTR_REPEAT_STATE,
    ATTR_START,
    ATTR_STATUS,
    ATTR_SORT,
    RPC_ERROR_INVALID_PARAMS,
    RPC_ERROR_TASK_NOT_FOUND,
} from "../shared/constants";
import { assertBlockId } from "../shared/block-id";
import {
    advanceRepeatState,
    createRepeatState,
    normalizeRepeatRule,
    parseRepeatRule,
    parseRepeatState,
    type RepeatStateV1,
} from "./repeat-engine";
import type { CacheManager } from "./cache-manager";
import type { SiyuanApiPort } from "./siyuan-api";
import type { TaskRepository } from "./task-repository";
import type { TaskRuntimeState } from "./task-runtime-state";
import type { MyDayTaskPort } from "./task-lifecycle-service";
import { sql } from "../shared/sql";

function localActionDate(date: Date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function codedError(message: string, code: number): Error & { code: number } {
    const error = new Error(message) as Error & { code: number };
    error.code = code;
    return error;
}

export class RepeatTaskService {
    constructor(
        private readonly cacheManager: CacheManager,
        private readonly repository: TaskRepository,
        private readonly myDayManager: MyDayTaskPort,
        private readonly api: SiyuanApiPort,
        private readonly runtime: TaskRuntimeState,
    ) {}

    private cacheConfirmedEntry(entry: TaskCacheEntry): void {
        this.repository.cache(entry);
    }

    private async writeAttrsWithNativeMarker(
        entry: TaskCacheEntry,
        attrs: Record<string, string>,
    ): Promise<Record<string, string>> {
        if (entry.identificationSource !== "native" || attrs[ATTR_STATUS] === undefined) {
            return this.repository.writeAttrs(entry.blockId, attrs);
        }
        const rows = await this.api.query<{ markdown?: string }>(
            sql`SELECT markdown FROM blocks WHERE id = ${entry.blockId} LIMIT 1`,
        );
        const oldMarker = rows?.[0]?.markdown?.match(/\[(.)\]/s)?.[1] || (entry.status === "done" ? "X" : " ");
        const nextMarker = attrs[ATTR_STATUS] === "done" ? "X" : " ";
        const markerChanged = oldMarker !== nextMarker;
        const oldAttrs = await this.repository.getBlockAttrs(entry.blockId);
        if (markerChanged) await this.api.updateTaskListItemMarker(entry.blockId, nextMarker);
        try {
            return await this.repository.writeAttrs(entry.blockId, attrs);
        } catch (error: unknown) {
            const rollbackAttrs: Record<string, string> = {};
            for (const key of new Set([
                ...Object.keys(attrs),
                ATTR_STATUS,
                ATTR_PRIORITY,
                ATTR_IMPORTANCE,
                ATTR_EFFORT,
                ATTR_CREATED,
                ATTR_PARENT,
                ATTR_SORT,
            ])) {
                rollbackAttrs[key] = oldAttrs[key] || "";
            }
            try {
                await this.repository.restoreAttrs(entry.blockId, rollbackAttrs);
            } catch {
                // Preserve the original write error.
            }
            if (markerChanged) {
                try {
                    await this.api.updateTaskListItemMarker(entry.blockId, oldMarker);
                } catch {
                    // Preserve the attribute persistence error.
                }
            }
            throw error;
        }
    }

    async setRepeatRule(blockId: string, rawRule: unknown): Promise<TaskCacheEntry> {
        blockId = assertBlockId(blockId);
        const rule = normalizeRepeatRule(rawRule);
        if (!rule) {
            throw codedError("Invalid repeat rule", RPC_ERROR_INVALID_PARAMS);
        }
        this.runtime.assertReady();

        const lock = await this.repository.acquireWithTimeout();
        try {
            const entry = this.cacheManager.get(blockId);
            if (!entry) {
                throw codedError("Task not found", RPC_ERROR_TASK_NOT_FOUND);
            }
            const state = createRepeatState(rule, entry.start, entry.due);
            if (!state) {
                throw codedError("Repeat task requires a start or due date", RPC_ERROR_INVALID_PARAMS);
            }

            const attrs: Record<string, string> = {
                [ATTR_REPEAT]: JSON.stringify(rule),
                [ATTR_REPEAT_STATE]: JSON.stringify(state),
            };
            if (entry.status === "done") attrs[ATTR_STATUS] = "todo";
            const finalAttrs = await this.writeAttrsWithNativeMarker(entry, attrs);
            const finalEntry = this.repository.buildEntry(blockId, finalAttrs, entry);
            this.cacheConfirmedEntry(finalEntry);
            this.repository.recordChange(blockId, "update");
            this.repository.publishChanges();
            return finalEntry;
        } finally {
            lock.release();
        }
    }

    async skipRepeatOccurrence(blockId: string): Promise<TaskCacheEntry> {
        blockId = assertBlockId(blockId);
        this.runtime.assertReady();

        const lock = await this.repository.acquireWithTimeout();
        try {
            const entry = this.cacheManager.get(blockId);
            if (!entry) {
                throw codedError("Task not found", RPC_ERROR_TASK_NOT_FOUND);
            }
            const rule = parseRepeatRule(entry.repeat);
            const state =
                rule && (parseRepeatState(entry.repeatState) || createRepeatState(rule, entry.start, entry.due));
            if (!rule || !state) {
                throw codedError("Invalid repeat rule or state", RPC_ERROR_INVALID_PARAMS);
            }
            if (state.status !== "active") {
                throw codedError(
                    state.status === "paused" ? "Repeat series is paused" : "Repeat series has ended",
                    RPC_ERROR_INVALID_PARAMS,
                );
            }

            const advanced = advanceRepeatState(rule, state, localActionDate(), "skip");
            const attrs: Record<string, string> = {
                [ATTR_REPEAT_STATE]: JSON.stringify(advanced.state),
                [ATTR_STATUS]: advanced.ended ? "done" : "todo",
            };
            if (!advanced.ended) {
                if (advanced.state.currentDue) attrs[ATTR_DUE] = advanced.state.currentDue;
                if (advanced.state.currentStart) attrs[ATTR_START] = advanced.state.currentStart;
            }
            const finalAttrs = await this.writeAttrsWithNativeMarker(entry, attrs);
            try {
                await this.myDayManager.clearTaskCompleted(blockId);
            } catch (error: unknown) {
                void this.api.log(
                    "warn",
                    `skipRepeatOccurrence: failed to clear My Day completion: ${error instanceof Error ? error.message : String(error)}`,
                );
            }

            const finalEntry = this.repository.buildEntry(blockId, finalAttrs, entry);
            this.cacheConfirmedEntry(finalEntry);
            this.repository.recordChange(blockId, "update");
            this.repository.publishChanges();
            return finalEntry;
        } finally {
            lock.release();
        }
    }

    async setRepeatPaused(blockId: string, paused: boolean): Promise<TaskCacheEntry> {
        blockId = assertBlockId(blockId);
        if (typeof paused !== "boolean") {
            throw codedError("paused is required", RPC_ERROR_INVALID_PARAMS);
        }
        this.runtime.assertReady();

        const lock = await this.repository.acquireWithTimeout();
        try {
            const entry = this.cacheManager.get(blockId);
            if (!entry) {
                throw codedError("Task not found", RPC_ERROR_TASK_NOT_FOUND);
            }
            const rule = parseRepeatRule(entry.repeat);
            const state =
                rule && (parseRepeatState(entry.repeatState) || createRepeatState(rule, entry.start, entry.due));
            if (!rule || !state) {
                throw codedError("Invalid repeat rule or state", RPC_ERROR_INVALID_PARAMS);
            }
            if (!paused && state.status === "ended") {
                throw codedError("Repeat series has ended; edit the rule to restart it", RPC_ERROR_INVALID_PARAMS);
            }

            const nextState: RepeatStateV1 = { ...state, status: paused ? "paused" : "active" };
            const attrs: Record<string, string> = {
                [ATTR_REPEAT_STATE]: JSON.stringify(nextState),
            };
            if (!paused && entry.status === "done") {
                attrs[ATTR_STATUS] = "todo";
                if (nextState.currentDue) attrs[ATTR_DUE] = nextState.currentDue;
                if (nextState.currentStart) attrs[ATTR_START] = nextState.currentStart;
            }
            const finalAttrs = await this.writeAttrsWithNativeMarker(entry, attrs);
            if (!paused && entry.status === "done") {
                try {
                    await this.myDayManager.clearTaskCompleted(blockId);
                } catch (error: unknown) {
                    void this.api.log(
                        "warn",
                        `setRepeatPaused: failed to clear My Day completion: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }

            const finalEntry = this.repository.buildEntry(blockId, finalAttrs, entry);
            this.cacheConfirmedEntry(finalEntry);
            this.repository.recordChange(blockId, "update");
            this.repository.publishChanges();
            return finalEntry;
        } finally {
            lock.release();
        }
    }
}
