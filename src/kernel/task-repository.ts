import {
    ATTR_COMPLETED,
    ATTR_CONTEXT,
    ATTR_CREATED,
    ATTR_DEPENDS,
    ATTR_DEP_MODE,
    ATTR_DUE,
    ATTR_EFFORT,
    ATTR_EXT_PREFIX,
    ATTR_IMPORTANCE,
    ATTR_NOTE,
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
    ATTR_OUTCOME,
    ATTR_DOD,
    ATTR_KIND,
    ACTION_KIND_STAGE,
    RPC_ERROR_TIMEOUT,
    WRITE_LOCK_TIMEOUT_MS,
} from "../shared/constants";
import type { PluginSettings } from "../shared/settings";
import type { TaskCacheEntry } from "../shared/types";
import { sql } from "../shared/sql";
import type { CacheManager } from "./cache-manager";
import type { Mutex } from "./mutex";
import type { SiyuanApiPort } from "./siyuan-api";
import type { TaskChangePublisher } from "./sync-engine";
import { TaskDerivedStateService } from "./task-derived-state-service";
import { attrToNumber, numberToAttr } from "./utils";

type TaskEntryIdentity = Pick<TaskCacheEntry, "identificationSource" | "attrHostId"> &
    Partial<Pick<TaskCacheEntry, "contentBlockId" | "status" | "parentId" | "taskType">>;

export interface TaskAttrUpsert {
    blockId: string;
    attrs: Record<string, string>;
    existing?: TaskCacheEntry;
    titleOverride?: string;
    identity?: TaskEntryIdentity;
}

export interface ConfirmedTaskBatchResult {
    entries: TaskCacheEntry[];
    failedBlockIds: string[];
}

export interface ConfirmedTaskChanges {
    upsertAttrs(request: TaskAttrUpsert): Promise<TaskCacheEntry>;
    upsertAttrsBatch(requests: TaskAttrUpsert[]): Promise<ConfirmedTaskBatchResult>;
    upsertAttrsWithConfirmedRollback(requests: TaskAttrUpsert[]): Promise<TaskCacheEntry[]>;
    refreshEntry(request: TaskAttrUpsert & { attrs: Record<string, string> }): TaskCacheEntry;
    upsertEntry(entry: TaskCacheEntry): void;
    deleteEntry(blockId: string): void;
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

function buildTaskEntryFromAttrs(
    blockId: string,
    attrs: Record<string, string>,
    defaults: Pick<PluginSettings, "defaultImportance" | "defaultEffort">,
    existing?: TaskCacheEntry,
    titleOverride?: string,
    identity?: TaskEntryIdentity,
): TaskCacheEntry {
    const taskType = identity?.taskType || attrs[ATTR_TASK] || existing?.taskType || "1";
    const entry: TaskCacheEntry = {
        blockId,
        identificationSource: identity?.identificationSource || existing?.identificationSource || "document",
        contentBlockId: identity?.contentBlockId ?? existing?.contentBlockId,
        attrHostId: identity?.attrHostId || existing?.attrHostId || blockId,
        parentId:
            attrs[ATTR_PARENT] || (identity?.parentId !== undefined ? identity.parentId : existing?.parentId || ""),
        status: attrs[ATTR_STATUS] || identity?.status || "todo",
        priority: attrs[ATTR_PRIORITY] || "medium",
        importance: attrToNumber(attrs[ATTR_IMPORTANCE], defaults.defaultImportance),
        effort: attrToNumber(attrs[ATTR_EFFORT], defaults.defaultEffort),
        due: attrs[ATTR_DUE] || "",
        start: attrs[ATTR_START] || "",
        context: attrs[ATTR_CONTEXT] || "",
        depends: attrs[ATTR_DEPENDS] || "",
        depMode: attrs[ATTR_DEP_MODE] || "all",
        sequential: attrs[ATTR_SEQUENTIAL] === "1",
        repeat: attrs[ATTR_REPEAT] || "",
        repeatState: attrs[ATTR_REPEAT_STATE] || "",
        sort: attrToNumber(attrs[ATTR_SORT], -1),
        completed: attrs[ATTR_COMPLETED] || "",
        note: attrs[ATTR_NOTE] || "",
        outcome: attrs[ATTR_OUTCOME] || "",
        dod: attrs[ATTR_DOD] || "",
        actionKind: taskType === "2" ? "" : attrs[ATTR_KIND] === ACTION_KIND_STAGE ? "stage" : "action",
        created: attrs[ATTR_CREATED] || "",
        tags: attrs[ATTR_TAGS] || "",
        reviewInterval: attrToNumber(attrs[ATTR_REVIEW_INTERVAL], 0),
        reviewDate: attrs[ATTR_REVIEW_DATE] || "",
        reminder: attrs[ATTR_REMINDER] || "",
        customFields: extractCustomFields(attrs),
        blocked: false,
        blockedReason: "",
        taskType,
        order: 0,
        childIds: existing ? existing.childIds : [],
        title: titleOverride ?? (existing ? existing.title : ""),
    };
    return entry;
}

export class TaskRepository {
    private settings: Pick<PluginSettings, "defaultImportance" | "defaultEffort">;
    private readonly derivedState: TaskDerivedStateService;

    constructor(
        private readonly api: SiyuanApiPort,
        private readonly cacheManager: CacheManager,
        private readonly mutex: Mutex,
        private readonly changePublisher: TaskChangePublisher,
        settings: Pick<PluginSettings, "defaultImportance" | "defaultEffort">,
        private readonly writeLockTimeoutMs: number = WRITE_LOCK_TIMEOUT_MS,
    ) {
        this.settings = settings;
        this.derivedState = new TaskDerivedStateService(cacheManager);
    }

    updateSettings(settings: Pick<PluginSettings, "defaultImportance" | "defaultEffort">): void {
        this.settings = settings;
    }

    async withConfirmedChanges<T>(work: (changes: ConfirmedTaskChanges) => Promise<T>): Promise<T> {
        const lock = await this.acquireWithTimeout();
        const changedIds = new Set<string>();
        const changes: ConfirmedTaskChanges = {
            upsertAttrs: (request) => this.upsertAttrs(request, changedIds),
            upsertAttrsBatch: (requests) => this.upsertAttrsBatch(requests, changedIds),
            upsertAttrsWithConfirmedRollback: (requests) => this.upsertAttrsWithConfirmedRollback(requests, changedIds),
            refreshEntry: (request) => {
                const entry = buildTaskEntryFromAttrs(
                    request.blockId,
                    request.attrs,
                    this.settings,
                    request.existing ?? this.cacheManager.get(request.blockId),
                    request.titleOverride,
                    request.identity,
                );
                this.cacheManager.set(entry);
                changedIds.add(entry.blockId);
                return entry;
            },
            upsertEntry: (entry) => {
                this.cacheManager.set(entry);
                changedIds.add(entry.blockId);
            },
            deleteEntry: (blockId) => {
                this.cacheManager.remove(blockId);
                changedIds.add(blockId);
            },
        };
        try {
            const result = await work(changes);
            if (changedIds.size > 0) this.publishConfirmedChanges(changedIds);
            return result;
        } catch (error: unknown) {
            try {
                this.discardUnpublishedChanges();
            } catch (discardError: unknown) {
                void this.api.log(
                    "error",
                    `TaskRepository: failed to discard unpublished task changes: ${this.errorMessage(discardError)}`,
                );
            }
            throw error;
        } finally {
            lock.release();
        }
    }

    private async acquireWithTimeout(): Promise<{ release: () => void }> {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const { promise: acquirePromise, cancel: cancelAcquire } = this.mutex.acquire();
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                const error = new Error("Write lock timeout") as Error & { code: number };
                error.code = RPC_ERROR_TIMEOUT;
                reject(error);
            }, this.writeLockTimeoutMs);
        });
        try {
            const lock = await Promise.race([acquirePromise, timeoutPromise]);
            if (timeoutId !== null) clearTimeout(timeoutId);
            return lock;
        } catch (error: unknown) {
            if (timeoutId !== null) clearTimeout(timeoutId);
            cancelAcquire();
            acquirePromise.then(
                (lock) => lock.release(),
                () => {},
            );
            throw error;
        }
    }

    getBlockAttrs(blockId: string): Promise<Record<string, string>> {
        return this.api.getBlockAttrs(blockId);
    }

    batchGetBlockAttrs(blockIds: string[]): Promise<Record<string, Record<string, string>>> {
        return this.api.batchGetBlockAttrs(blockIds);
    }

    private async upsertAttrs(request: TaskAttrUpsert, changedIds: Set<string>): Promise<TaskCacheEntry> {
        const { blockId, attrs } = request;
        const entry = request.existing ?? this.cacheManager.get(blockId);
        const currentAttrs = await this.api.getBlockAttrs(blockId);
        let persistedAttrs = { ...attrs };
        const clearingNativeTask = attrs[ATTR_TASK] === "" && attrs[ATTR_STATUS] === "";
        if (entry?.identificationSource === "native" && !clearingNativeTask) {
            const defaults: Record<string, string> = {};
            const addDefault = (key: string, value: string): void => {
                if (!currentAttrs[key] && attrs[key] === undefined) defaults[key] = value;
            };
            addDefault(ATTR_STATUS, entry.status || "inbox");
            addDefault(ATTR_PRIORITY, entry.priority || "medium");
            addDefault(ATTR_IMPORTANCE, numberToAttr(entry.importance || this.settings.defaultImportance));
            addDefault(ATTR_EFFORT, numberToAttr(entry.effort || this.settings.defaultEffort));
            addDefault(ATTR_CREATED, entry.created || new Date().toISOString().slice(0, 19));
            if (entry.sort >= 0) addDefault(ATTR_SORT, String(entry.sort));
            persistedAttrs = {
                ...defaults,
                ...attrs,
            };
            if (attrs[ATTR_TASK] !== "") delete persistedAttrs[ATTR_TASK];
        }

        const identificationSource = request.identity?.identificationSource ?? entry?.identificationSource;
        let oldMarker = " ";
        let markerChanged = false;
        if (identificationSource === "native" && attrs[ATTR_STATUS] !== undefined) {
            const rows = await this.api.query<{ markdown?: string }>(
                sql`SELECT markdown FROM blocks WHERE id = ${blockId} LIMIT 1`,
            );
            oldMarker = rows?.[0]?.markdown?.match(/\[(.)\]/s)?.[1] || (entry?.status === "done" ? "X" : " ");
            const nextMarker = attrs[ATTR_STATUS] === "done" ? "X" : " ";
            if (nextMarker !== oldMarker) {
                await this.api.updateTaskListItemMarker(blockId, nextMarker);
                markerChanged = true;
            }
        }

        try {
            await this.api.setBlockAttrs(blockId, persistedAttrs);
            const confirmedAttrs = await this.api.getBlockAttrs(blockId);
            for (const [key, value] of Object.entries(persistedAttrs)) {
                if ((confirmedAttrs[key] || "") !== value) {
                    throw new Error(`Task attribute confirmation failed for ${blockId}: ${key}`);
                }
            }
            const confirmedEntry = buildTaskEntryFromAttrs(
                blockId,
                confirmedAttrs,
                this.settings,
                entry,
                request.titleOverride,
                request.identity,
            );
            this.cacheManager.set(confirmedEntry);
            changedIds.add(blockId);
            return confirmedEntry;
        } catch (error: unknown) {
            const rollbackAttrs: Record<string, string> = {};
            for (const key of Object.keys(persistedAttrs)) rollbackAttrs[key] = currentAttrs[key] || "";
            try {
                await this.api.setBlockAttrs(blockId, rollbackAttrs);
            } catch (rollbackError: unknown) {
                void this.api.log(
                    "error",
                    `TaskRepository: attribute rollback failed for ${blockId}: ${this.errorMessage(rollbackError)}`,
                );
            }
            if (markerChanged) {
                try {
                    await this.api.updateTaskListItemMarker(blockId, oldMarker);
                } catch (rollbackError: unknown) {
                    void this.api.log(
                        "error",
                        `TaskRepository: marker rollback failed for ${blockId}: ${this.errorMessage(rollbackError)}`,
                    );
                }
            }
            throw error;
        }
    }

    private async upsertAttrsBatch(
        requests: TaskAttrUpsert[],
        changedIds: Set<string>,
    ): Promise<ConfirmedTaskBatchResult> {
        if (requests.length === 0) return { entries: [], failedBlockIds: [] };
        if (
            requests.some((request) => {
                const existing = request.existing ?? this.cacheManager.get(request.blockId);
                return existing?.identificationSource === "native" && request.attrs[ATTR_STATUS] !== undefined;
            })
        ) {
            return this.upsertAttrsIndividually(requests, changedIds);
        }

        try {
            await this.api.batchSetBlockAttrs(
                requests.map((request) => ({ id: request.blockId, attrs: request.attrs })),
            );
            const attrsByBlockId = await this.api.batchGetBlockAttrs(requests.map((request) => request.blockId));
            const entries: TaskCacheEntry[] = [];
            const failedBlockIds: string[] = [];
            for (const request of requests) {
                const attrs = attrsByBlockId[request.blockId];
                const confirmed =
                    attrs && Object.entries(request.attrs).every(([key, value]) => (attrs[key] || "") === value);
                if (!confirmed) {
                    failedBlockIds.push(request.blockId);
                    continue;
                }
                const entry = buildTaskEntryFromAttrs(
                    request.blockId,
                    attrs,
                    this.settings,
                    request.existing ?? this.cacheManager.get(request.blockId),
                    request.titleOverride,
                    request.identity,
                );
                this.cacheManager.set(entry);
                changedIds.add(entry.blockId);
                entries.push(entry);
            }
            return { entries, failedBlockIds };
        } catch (batchError: unknown) {
            void this.api.log(
                "warn",
                `TaskRepository: batch attribute write failed, using compatibility fallback: ${this.errorMessage(batchError)}`,
            );
            return this.upsertAttrsIndividually(requests, changedIds);
        }
    }

    private async upsertAttrsWithConfirmedRollback(
        requests: TaskAttrUpsert[],
        changedIds: Set<string>,
    ): Promise<TaskCacheEntry[]> {
        if (requests.length === 0) return [];
        const uniqueBlockIds = new Set(requests.map((request) => request.blockId));
        if (uniqueBlockIds.size !== requests.length) {
            throw new Error("Rollback-confirmed task attribute batch contains duplicate block IDs");
        }

        const blockIds = requests.map((request) => request.blockId);
        const previousAttrsByBlockId = await this.api.batchGetBlockAttrs(blockIds);
        const rollbackRequests = requests.map((request) => {
            const previousAttrs = previousAttrsByBlockId[request.blockId] || {};
            return {
                id: request.blockId,
                attrs: Object.fromEntries(Object.keys(request.attrs).map((key) => [key, previousAttrs[key] || ""])),
            };
        });

        let confirmedAttrsByBlockId: Record<string, Record<string, string>>;
        try {
            await this.api.batchSetBlockAttrs(
                requests.map((request) => ({ id: request.blockId, attrs: request.attrs })),
            );
            confirmedAttrsByBlockId = await this.api.batchGetBlockAttrs(blockIds);
            for (const request of requests) {
                const confirmedAttrs = confirmedAttrsByBlockId[request.blockId];
                const confirmed =
                    confirmedAttrs &&
                    Object.entries(request.attrs).every(([key, value]) => (confirmedAttrs[key] || "") === value);
                if (!confirmed) throw new Error(`Task attribute confirmation failed for ${request.blockId}`);
            }
        } catch (cause: unknown) {
            try {
                await this.api.batchSetBlockAttrs(rollbackRequests);
                const rolledBackAttrsByBlockId = await this.api.batchGetBlockAttrs(blockIds);
                for (const rollback of rollbackRequests) {
                    const rolledBackAttrs = rolledBackAttrsByBlockId[rollback.id];
                    const confirmed =
                        rolledBackAttrs &&
                        Object.entries(rollback.attrs).every(([key, value]) => (rolledBackAttrs[key] || "") === value);
                    if (!confirmed) throw new Error(`Task attribute rollback confirmation failed for ${rollback.id}`);
                }
            } catch (rollbackError: unknown) {
                const message = this.errorMessage(rollbackError);
                void this.api.log("error", `TaskRepository: confirmed attribute rollback failed: ${message}`);
                const error = new Error(
                    `Task update failed and rollback could not be confirmed: ${message}`,
                ) as Error & {
                    cause?: unknown;
                };
                error.cause = cause;
                throw error;
            }
            throw cause;
        }

        const entries = requests.map((request) => {
            const entry = buildTaskEntryFromAttrs(
                request.blockId,
                confirmedAttrsByBlockId[request.blockId],
                this.settings,
                request.existing ?? this.cacheManager.get(request.blockId),
                request.titleOverride,
                request.identity,
            );
            this.cacheManager.set(entry);
            changedIds.add(entry.blockId);
            return entry;
        });
        return entries;
    }

    private async upsertAttrsIndividually(
        requests: TaskAttrUpsert[],
        changedIds: Set<string>,
    ): Promise<ConfirmedTaskBatchResult> {
        const entries: TaskCacheEntry[] = [];
        const failedBlockIds: string[] = [];
        for (const request of requests) {
            try {
                entries.push(await this.upsertAttrs(request, changedIds));
            } catch (error: unknown) {
                failedBlockIds.push(request.blockId);
                void this.api.log(
                    "warn",
                    `TaskRepository: attribute write failed for ${request.blockId}: ${this.errorMessage(error)}`,
                );
            }
        }
        return { entries, failedBlockIds };
    }

    private publishConfirmedChanges(directChanges: Set<string>): void {
        try {
            const relationshipChanges = this.cacheManager.consumeRelationshipChangedIds();
            const derivedChanges = this.derivedState.reconcile(this.cacheManager.consumeAffectedIds());
            this.changePublisher.publishChanges([
                ...new Set([...directChanges, ...relationshipChanges, ...derivedChanges]),
            ]);
        } catch (error: unknown) {
            void this.api.log(
                "error",
                `TaskRepository: failed to broadcast confirmed task changes: ${this.errorMessage(error)}`,
            );
        }
    }

    private discardUnpublishedChanges(): void {
        this.cacheManager.consumeRelationshipChangedIds();
        this.derivedState.reconcile(this.cacheManager.consumeAffectedIds());
    }

    reconcileAllDerivedState(): string[] {
        return this.derivedState.reconcileAll();
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
