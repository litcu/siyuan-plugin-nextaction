import { type PluginSettings, DEFAULT_SETTINGS } from "../shared/settings";
import { type TaskCacheEntry } from "../shared/types";
import type { SiyuanApiPort } from "./siyuan-api";
import { materializeTask, type MaterializedTaskFacts } from "./task-materializer";
import { TaskIdentityResolver, type BatchTaskAttributeReader } from "./task-identity-resolver";

export type { BatchTaskAttributeReader } from "./task-identity-resolver";

export class CacheManager {
    private cache: Record<string, TaskCacheEntry>;
    private childrenByParent: Map<string, Set<string>>;
    private dependentsByDependency: Map<string, Set<string>>;
    private pendingAffectedIds: Set<string>;
    private pendingRelationshipChangedIds: Set<string>;
    private materializationDefaults: Pick<PluginSettings, "defaultImportance" | "defaultEffort">;

    constructor(
        private readonly api: SiyuanApiPort,
        private readonly identities = new TaskIdentityResolver(api),
    ) {
        this.cache = Object.create(null) as Record<string, TaskCacheEntry>;
        this.childrenByParent = new Map();
        this.dependentsByDependency = new Map();
        this.pendingAffectedIds = new Set();
        this.pendingRelationshipChangedIds = new Set();
        this.materializationDefaults = DEFAULT_SETTINGS;
    }

    updateMaterializationDefaults(defaults: Pick<PluginSettings, "defaultImportance" | "defaultEffort">): void {
        this.materializationDefaults = defaults;
    }

    async loadAll(readTaskAttributes: BatchTaskAttributeReader): Promise<void> {
        const load = await this.identities.loadAll(readTaskAttributes);
        if (!load.records.length) {
            this.replaceCache(Object.create(null) as Record<string, TaskCacheEntry>);
            return;
        }

        this.replaceMaterialized(
            load.records.map(({ identity, attrs }) =>
                materializeTask({
                    blockId: identity.blockId,
                    confirmedAttrs: attrs,
                    freshIdentity: identity,
                    defaults: this.materializationDefaults,
                }),
            ),
        );
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

    setMaterialized(facts: MaterializedTaskFacts): TaskCacheEntry {
        const entry = this.completeMaterialized(facts, this.cache[facts.blockId]);
        this.set(entry);
        return entry;
    }

    replaceMaterialized(facts: readonly MaterializedTaskFacts[]): void {
        const nextCache = Object.create(null) as Record<string, TaskCacheEntry>;
        for (const item of facts) {
            if (nextCache[item.blockId]) throw new Error(`Duplicate materialized task: ${item.blockId}`);
            nextCache[item.blockId] = this.completeMaterialized(item);
        }
        this.replaceCache(nextCache);
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

    private completeMaterialized(facts: MaterializedTaskFacts, existing?: TaskCacheEntry): TaskCacheEntry {
        return {
            ...facts,
            blocked: existing?.blocked ?? false,
            blockedReason: existing?.blockedReason ?? "",
            order: existing?.order ?? 0,
            childIds: existing ? [...existing.childIds] : [],
        };
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
