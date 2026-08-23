import { type TaskCacheEntry } from "../shared/types";
import {
    ATTR_PRIORITY,
    ATTR_DUE,
    ATTR_START,
    ATTR_CONTEXT,
    ATTR_EFFORT,
    ATTR_IMPORTANCE,
    ATTR_DEPENDS,
    ATTR_DEP_MODE,
    ATTR_SEQUENTIAL,
    ATTR_REPEAT,
    ATTR_REPEAT_STATE,
    ATTR_SORT,
    ATTR_COMPLETED,
    ATTR_NOTE,
    ATTR_CREATED,
    ATTR_TAGS,
    ATTR_REVIEW_INTERVAL,
    ATTR_REVIEW_DATE,
    ATTR_REMINDER,
    ATTR_EXT_PREFIX,
} from "../shared/constants";
import { DEFAULT_SETTINGS } from "../shared/settings";
import { attrToNumber } from "./utils";
import type { SiyuanApiPort } from "./siyuan-api";
import { TaskIdentityResolver, type BatchTaskAttributeReader } from "./task-identity-resolver";

export type { BatchTaskAttributeReader } from "./task-identity-resolver";

export class CacheManager {
    private cache: Record<string, TaskCacheEntry>;
    private childrenByParent: Map<string, Set<string>>;
    private dependentsByDependency: Map<string, Set<string>>;
    private pendingAffectedIds: Set<string>;
    private pendingRelationshipChangedIds: Set<string>;

    constructor(
        private readonly api: SiyuanApiPort,
        private readonly identities = new TaskIdentityResolver(api),
    ) {
        this.cache = Object.create(null) as Record<string, TaskCacheEntry>;
        this.childrenByParent = new Map();
        this.dependentsByDependency = new Map();
        this.pendingAffectedIds = new Set();
        this.pendingRelationshipChangedIds = new Set();
    }

    async loadAll(readTaskAttributes: BatchTaskAttributeReader): Promise<void> {
        const load = await this.identities.loadAll(readTaskAttributes);
        if (!load.records.length) {
            this.replaceCache(Object.create(null) as Record<string, TaskCacheEntry>);
            return;
        }

        const newCache: Record<string, TaskCacheEntry> = Object.create(null) as Record<string, TaskCacheEntry>;
        for (const record of load.records) {
            const { identity, attrs } = record;
            const entry: TaskCacheEntry = {
                blockId: identity.blockId,
                identificationSource: identity.identificationSource,
                contentBlockId: identity.contentBlockId,
                attrHostId: identity.attrHostId,
                parentId: identity.effectiveParentId,
                status: identity.defaultStatus,
                priority: attrs[ATTR_PRIORITY] || "medium",
                importance: attrToNumber(attrs[ATTR_IMPORTANCE], DEFAULT_SETTINGS.defaultImportance),
                effort: attrToNumber(attrs[ATTR_EFFORT], DEFAULT_SETTINGS.defaultEffort),
                due: attrs[ATTR_DUE] || "",
                start: attrs[ATTR_START] || "",
                context: attrs[ATTR_CONTEXT] || "",
                depends: attrs[ATTR_DEPENDS] || "",
                depMode: attrs[ATTR_DEP_MODE] || "all",
                sequential: attrs[ATTR_SEQUENTIAL] === "1",
                repeat: attrs[ATTR_REPEAT] || "",
                repeatState: attrs[ATTR_REPEAT_STATE] || "",
                sort: attrToNumber(attrs[ATTR_SORT], identity.identificationSource === "native" ? identity.sort : -1),
                completed: attrs[ATTR_COMPLETED] || "",
                note: attrs[ATTR_NOTE] || "",
                created: attrs[ATTR_CREATED] || "",
                updated: identity.updated,
                tags: attrs[ATTR_TAGS] || "",
                reviewInterval: attrToNumber(attrs[ATTR_REVIEW_INTERVAL], 0),
                reviewDate: attrs[ATTR_REVIEW_DATE] || "",
                reminder: attrs[ATTR_REMINDER] || "",
                customFields: this.extractCustomFields(attrs),
                blocked: false, // 将在 childIds 构建后统一计算
                blockedReason: "",
                taskType: identity.taskType,
                order: 0,
                childIds: [],
                title: identity.title,
            };

            newCache[entry.blockId] = entry;
        }

        // Step 3: Atomically replace the primary cache and relationship indexes.
        this.replaceCache(newCache);
    }

    get(blockId: string): TaskCacheEntry | undefined {
        return this.cache[blockId];
    }

    getAll(): TaskCacheEntry[] {
        const result: TaskCacheEntry[] = [];
        const keys = Object.keys(this.cache);
        for (let i = 0; i < keys.length; i++) {
            result.push(this.cache[keys[i]]);
        }
        return result;
    }

    getByParent(parentId: string): TaskCacheEntry[] {
        const childIds = this.childrenByParent.get(parentId);
        if (!childIds) return [];
        const result: TaskCacheEntry[] = [];
        for (const childId of childIds) {
            const child = this.cache[childId];
            if (child) result.push(child);
        }
        return result;
    }

    getDependents(dependencyId: string): TaskCacheEntry[] {
        const dependentIds = this.dependentsByDependency.get(dependencyId);
        if (!dependentIds) return [];
        const result: TaskCacheEntry[] = [];
        for (const dependentId of dependentIds) {
            const dependent = this.cache[dependentId];
            if (dependent) result.push(dependent);
        }
        return result;
    }

    set(entry: TaskCacheEntry): void {
        const existing = this.cache[entry.blockId];
        const oldParentId = existing?.parentId || "";
        this.markRelationshipImpact(entry.blockId, existing?.parentId, entry.parentId);
        this.removeFromRelationshipIndexes(existing);

        const stored = entry;
        stored.childIds = this.childIdsFor(entry.blockId);
        this.cache[entry.blockId] = stored;
        this.addToRelationshipIndexes(stored);

        this.syncParentEntry(oldParentId);
        this.syncParentEntry(stored.parentId);
        this.syncParentEntry(stored.blockId);
        this.markRelationshipImpact(entry.blockId, oldParentId, stored.parentId);
    }

    remove(blockId: string): void {
        const entry = this.cache[blockId];
        if (!entry) return;

        this.markRelationshipImpact(blockId, entry.parentId);
        this.removeFromRelationshipIndexes(entry);
        delete this.cache[blockId];
        this.syncParentEntry(entry.parentId);
    }

    async rebuild(readTaskAttributes: BatchTaskAttributeReader): Promise<void> {
        await this.loadAll(readTaskAttributes);
    }

    /**
     * Verify cache integrity after loadAll().
     * Compares the cache entry count against a fresh SQL count query.
     * Returns the number of missing entries (0 = healthy).
     */
    async verifyIntegrity(): Promise<number> {
        try {
            const rows = await this.api.query<{ count: number }>(
                `SELECT (
                    SELECT COUNT(DISTINCT a.block_id)
                      FROM attributes a
                      INNER JOIN blocks b ON b.id = a.block_id
                     WHERE a.name = 'custom-na-task'
                       AND a.value IS NOT NULL
                       AND a.value != ''
                       AND b.type = 'd'
                ) + (
                    SELECT COUNT(*) FROM blocks task
                     LEFT JOIN blocks task_list
                       ON task_list.id = task.parent_id
                      AND task_list.type = 'l'
                    WHERE task.type = 'i'
                      AND (task.subtype = 't' OR task_list.subtype = 't')
                ) AS count`,
            );
            const dbCount = rows && rows.length > 0 ? rows[0].count : 0;
            const cacheCount = Object.keys(this.cache).length;
            if (dbCount !== cacheCount) {
                void this.api.log(
                    "warn",
                    `Cache integrity check: DB has ${dbCount} tasks, cache has ${cacheCount}. Rebuilding...`,
                );
                return Math.abs(dbCount - cacheCount);
            }
            return 0;
        } catch (_e: any) {
            return 0;
        }
    }

    size(): number {
        return Object.keys(this.cache).length;
    }

    getCache(): Record<string, TaskCacheEntry> {
        return this.cache;
    }

    private extractCustomFields(attrs: Record<string, string>): Record<string, string> {
        const result: Record<string, string> = Object.create(null) as Record<string, string>;
        for (const key of Object.keys(attrs)) {
            if (key.startsWith(ATTR_EXT_PREFIX)) {
                const fieldKey = key.slice(ATTR_EXT_PREFIX.length);
                if (fieldKey && attrs[key]) {
                    result[fieldKey] = attrs[key];
                }
            }
        }
        return result;
    }

    consumeAffectedIds(): string[] {
        const affectedIds = [...this.pendingAffectedIds];
        this.pendingAffectedIds.clear();
        return affectedIds;
    }

    consumeRelationshipChangedIds(): string[] {
        const changedIds = [...this.pendingRelationshipChangedIds];
        this.pendingRelationshipChangedIds.clear();
        return changedIds;
    }

    private replaceCache(nextCache: Record<string, TaskCacheEntry>): void {
        this.cache = nextCache;
        this.childrenByParent = new Map();
        this.dependentsByDependency = new Map();
        this.pendingAffectedIds.clear();
        this.pendingRelationshipChangedIds.clear();

        for (const entry of Object.values(this.cache)) {
            this.addToRelationshipIndexes(entry);
        }
        for (const entry of Object.values(this.cache)) {
            entry.childIds = this.childIdsFor(entry.blockId);
        }
    }

    private addToRelationshipIndexes(entry: TaskCacheEntry): void {
        if (entry.parentId) this.addIndexValue(this.childrenByParent, entry.parentId, entry.blockId);
        for (const dependencyId of this.dependencyIds(entry)) {
            this.addIndexValue(this.dependentsByDependency, dependencyId, entry.blockId);
        }
    }

    private removeFromRelationshipIndexes(entry: TaskCacheEntry | undefined): void {
        if (!entry) return;
        if (entry.parentId) this.removeIndexValue(this.childrenByParent, entry.parentId, entry.blockId);
        for (const dependencyId of this.dependencyIds(entry)) {
            this.removeIndexValue(this.dependentsByDependency, dependencyId, entry.blockId);
        }
    }

    private dependencyIds(entry: TaskCacheEntry): string[] {
        return entry.depends ? [...new Set(entry.depends.split("|").filter(Boolean))] : [];
    }

    private childIdsFor(parentId: string): string[] {
        return [...(this.childrenByParent.get(parentId) || [])];
    }

    private syncParentEntry(parentId: string): void {
        if (!parentId) return;
        const parent = this.cache[parentId];
        if (!parent) return;
        const childIds = this.childIdsFor(parentId);
        if (
            parent.childIds.length === childIds.length &&
            parent.childIds.every((childId, index) => childId === childIds[index])
        )
            return;
        parent.childIds = childIds;
        this.pendingRelationshipChangedIds.add(parentId);
    }

    private markRelationshipImpact(blockId: string, ...parentIds: Array<string | undefined>): void {
        this.pendingAffectedIds.add(blockId);
        for (const parentId of parentIds) {
            if (!parentId) continue;
            this.pendingAffectedIds.add(parentId);
            for (const sibling of this.getByParent(parentId)) {
                this.pendingAffectedIds.add(sibling.blockId);
            }
        }
        for (const child of this.getByParent(blockId)) {
            this.pendingAffectedIds.add(child.blockId);
        }
        for (const dependent of this.getDependents(blockId)) {
            this.pendingAffectedIds.add(dependent.blockId);
        }
    }

    private addIndexValue(index: Map<string, Set<string>>, key: string, value: string): void {
        let values = index.get(key);
        if (!values) {
            values = new Set();
            index.set(key, values);
        }
        values.add(value);
    }

    private removeIndexValue(index: Map<string, Set<string>>, key: string, value: string): void {
        const values = index.get(key);
        if (!values) return;
        values.delete(value);
        if (values.size === 0) index.delete(key);
    }
}
