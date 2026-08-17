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
    RPC_ERROR_TIMEOUT,
    WRITE_LOCK_TIMEOUT_MS,
} from "../shared/constants";
import type { PluginSettings } from "../shared/settings";
import type { TaskCacheEntry } from "../shared/types";
import type { CacheManager } from "./cache-manager";
import type { Mutex } from "./mutex";
import type { SiyuanApiPort } from "./siyuan-api";
import type { TaskChangePublisher } from "./sync-engine";
import { TaskDerivedStateService } from "./task-derived-state-service";
import { attrToNumber } from "./utils";

export type TaskChangeType = "create" | "update" | "delete";

export interface BatchWriteResult {
    attrsByBlockId: Record<string, Record<string, string>>;
    failedBlockIds: string[];
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

export function buildTaskEntryFromAttrs(
    blockId: string,
    attrs: Record<string, string>,
    defaults: Pick<PluginSettings, "defaultImportance" | "defaultEffort">,
    existing?: TaskCacheEntry,
    titleOverride?: string,
): TaskCacheEntry {
    const entry: TaskCacheEntry = {
        blockId,
        parentId: attrs[ATTR_PARENT] || "",
        status: attrs[ATTR_STATUS] || "todo",
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
        created: attrs[ATTR_CREATED] || "",
        tags: attrs[ATTR_TAGS] || "",
        reviewInterval: attrToNumber(attrs[ATTR_REVIEW_INTERVAL], 0),
        reviewDate: attrs[ATTR_REVIEW_DATE] || "",
        reminder: attrs[ATTR_REMINDER] || "",
        customFields: extractCustomFields(attrs),
        blocked: false,
        blockedReason: "",
        taskType: attrs[ATTR_TASK] || "1",
        order: 0,
        childIds: existing ? existing.childIds : [],
        title: titleOverride ?? (existing ? existing.title : ""),
    };
    return entry;
}

export class TaskRepository {
    private settings: Pick<PluginSettings, "defaultImportance" | "defaultEffort">;
    private readonly derivedState: TaskDerivedStateService;
    private readonly pendingDirectChanges = new Set<string>();

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

    async acquireWithTimeout(): Promise<{ release: () => void }> {
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

    async writeAttrs(blockId: string, attrs: Record<string, string>): Promise<Record<string, string>> {
        await this.api.setBlockAttrs(blockId, attrs);
        return this.api.getBlockAttrs(blockId);
    }

    async batchWriteAttrs(blockAttrs: Array<{ id: string; attrs: Record<string, string> }>): Promise<BatchWriteResult> {
        if (blockAttrs.length === 0) return { attrsByBlockId: {}, failedBlockIds: [] };
        try {
            await this.api.batchSetBlockAttrs(blockAttrs);
            const attrsByBlockId = await this.api.batchGetBlockAttrs(blockAttrs.map((item) => item.id));
            const failedBlockIds = blockAttrs.map((item) => item.id).filter((blockId) => !attrsByBlockId[blockId]);
            return { attrsByBlockId, failedBlockIds };
        } catch (batchError: unknown) {
            void this.api.log(
                "warn",
                `TaskRepository: batch attribute write failed, using compatibility fallback: ${this.errorMessage(batchError)}`,
            );
            const attrsByBlockId: Record<string, Record<string, string>> = {};
            const failedBlockIds: string[] = [];
            for (const item of blockAttrs) {
                try {
                    attrsByBlockId[item.id] = await this.writeAttrs(item.id, item.attrs);
                } catch (error: unknown) {
                    failedBlockIds.push(item.id);
                    void this.api.log(
                        "warn",
                        `TaskRepository: attribute write failed for ${item.id}: ${this.errorMessage(error)}`,
                    );
                }
            }
            return { attrsByBlockId, failedBlockIds };
        }
    }

    buildEntry(
        blockId: string,
        attrs: Record<string, string>,
        existing?: TaskCacheEntry,
        titleOverride?: string,
    ): TaskCacheEntry {
        return buildTaskEntryFromAttrs(blockId, attrs, this.settings, existing, titleOverride);
    }

    cache(entry: TaskCacheEntry): void {
        this.cacheManager.set(entry);
    }

    removeFromCache(blockId: string): void {
        this.cacheManager.remove(blockId);
    }

    recordChange(blockId: string, type: TaskChangeType): void {
        this.pendingDirectChanges.add(blockId);
        this.changePublisher.addPendingChange(blockId, type);
    }

    publishChanges(): void {
        try {
            const relationshipChanges = this.cacheManager.consumeRelationshipChangedIds();
            const derivedChanges = this.derivedState.reconcile(this.cacheManager.consumeAffectedIds());
            for (const blockId of new Set([...relationshipChanges, ...derivedChanges])) {
                if (!this.pendingDirectChanges.has(blockId)) {
                    this.changePublisher.addPendingChange(blockId, "update");
                }
            }
            this.changePublisher.broadcastChanges();
        } catch (error: unknown) {
            void this.api.log(
                "error",
                `TaskRepository: failed to broadcast confirmed task changes: ${this.errorMessage(error)}`,
            );
        } finally {
            this.pendingDirectChanges.clear();
        }
    }

    reconcileAllDerivedState(): string[] {
        return this.derivedState.reconcileAll();
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
