import { type TaskCacheEntry } from "../shared/types";
import { ATTR_PARENT, ATTR_STATUS, ATTR_PRIORITY, ATTR_DUE, ATTR_START, ATTR_CONTEXT, ATTR_TASK, ATTR_EFFORT, ATTR_IMPORTANCE, ATTR_DEPENDS, ATTR_DEP_MODE, ATTR_SEQUENTIAL, ATTR_REPEAT, ATTR_REPEAT_STATE, ATTR_SORT, ATTR_COMPLETED, ATTR_NOTE, ATTR_CREATED, ATTR_TAGS, ATTR_REVIEW_INTERVAL, ATTR_REVIEW_DATE, ATTR_REMINDER, ATTR_EXT_PREFIX } from "../shared/constants";
import { DEFAULT_SETTINGS } from "../shared/settings";
import { attrToNumber, cleanSlashFromTitle } from "./utils";
import { sql } from "../shared/sql";
import type { SiyuanApiPort } from "./siyuan-api";

interface SqlRow {
    id: string;
    parent_id: string;
    content: string;
    updated: string;
}

export type BatchTaskAttributeReader = (blockIds: string[]) => Promise<Record<string, Record<string, string>>>;

export class CacheManager {
    private cache: Record<string, TaskCacheEntry>;
    private childrenByParent: Map<string, Set<string>>;
    private dependentsByDependency: Map<string, Set<string>>;
    private pendingAffectedIds: Set<string>;
    private pendingRelationshipChangedIds: Set<string>;

    constructor(private readonly api: SiyuanApiPort) {
        this.cache = Object.create(null) as Record<string, TaskCacheEntry>;
        this.childrenByParent = new Map();
        this.dependentsByDependency = new Map();
        this.pendingAffectedIds = new Set();
        this.pendingRelationshipChangedIds = new Set();
    }

    async loadAll(readTaskAttributes: BatchTaskAttributeReader): Promise<void> {
        // Step 1: Query na-task block IDs in stable cursor pages. There is no
        // explicit LIMIT so SiYuan applies its current search-result limit to
        // every request. Continue after the last ID until no rows remain.
        const rows: SqlRow[] = [];
        let lastBlockId = "";
        for (;;) {
            const stmt = lastBlockId
                ? sql`SELECT DISTINCT b.id, b.parent_id, b.content, b.updated
                    FROM blocks b
                    INNER JOIN attributes a
                      ON a.block_id = b.id
                     AND a.name = 'custom-na-task'
                    WHERE a.value IS NOT NULL
                      AND a.value != ''
                      AND b.type IN ('p', 'h', 'd')
                      AND b.id > ${lastBlockId}
                    ORDER BY b.id`
                : `SELECT DISTINCT b.id, b.parent_id, b.content, b.updated
                    FROM blocks b
                    INNER JOIN attributes a
                      ON a.block_id = b.id
                     AND a.name = 'custom-na-task'
                    WHERE a.value IS NOT NULL
                      AND a.value != ''
                      AND b.type IN ('p', 'h', 'd')
                    ORDER BY b.id`;
            const page = await this.api.query<SqlRow>(stmt);
            if (!page || page.length === 0) break;
            rows.push(...page);
            const nextBlockId = page[page.length - 1].id;
            if (!nextBlockId || nextBlockId <= lastBlockId) {
                throw new Error("Task cache discovery cursor did not advance");
            }
            lastBlockId = nextBlockId;
        }

        if (!rows || rows.length === 0) {
            this.replaceCache(Object.create(null) as Record<string, TaskCacheEntry>);
            return;
        }

        // Step 2: Batch-fetch attributes for all blocks using batchGetBlockAttrs.
        // This API reads from the in-memory IAL cache (always up-to-date) and
        // returns {blockId: {key: value, ...}} — one call instead of N calls.
        const ids = rows.map((r) => r.id);
        const batchResult = await readTaskAttributes(ids);

        // Build a title lookup from SQL rows
        const titleMap: Record<string, string> = Object.create(null) as Record<string, string>;
        for (let i = 0; i < rows.length; i++) {
            titleMap[rows[i].id] = rows[i].content ? cleanSlashFromTitle(rows[i].content.substring(0, 100)) : "";
        }

        const newCache: Record<string, TaskCacheEntry> = Object.create(null) as Record<string, TaskCacheEntry>;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const attrs = batchResult[row.id];
            if (!attrs) {
                void this.api.log("warn", `Cache load: batchGetBlockAttrs missing attrs for block ${row.id}, skipping`);
                continue;
            }

            if (!attrs[ATTR_TASK] || attrs[ATTR_TASK] === "") {
                continue;
            }

            const entry: TaskCacheEntry = {
                blockId: row.id,
                parentId: attrs[ATTR_PARENT] || "",
                status: attrs[ATTR_STATUS] || "todo",
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
                sort: attrToNumber(attrs[ATTR_SORT], -1),
                completed: attrs[ATTR_COMPLETED] || "",
                note: attrs[ATTR_NOTE] || "",
                created: attrs[ATTR_CREATED] || "",
                updated: row.updated || "",
                tags: attrs[ATTR_TAGS] || "",
                reviewInterval: attrToNumber(attrs[ATTR_REVIEW_INTERVAL], 0),
                reviewDate: attrs[ATTR_REVIEW_DATE] || "",
                reminder: attrs[ATTR_REMINDER] || "",
                customFields: this.extractCustomFields(attrs),
                blocked: false,  // 将在 childIds 构建后统一计算
                blockedReason: "",
                taskType: attrs[ATTR_TASK] || "1",
                order: 0,
                childIds: [],
                title: titleMap[row.id] || "",
            };

            newCache[entry.blockId] = entry;

        }

        // Step 3: Atomically replace the primary cache and relationship indexes.
        this.replaceCache(newCache);
        // na-sort 迁移：为 sort=-1 的现有子任务分配间距编号
        this.migrateSortValues();
    }

    get(blockId: string): TaskCacheEntry | undefined {
        return this.cache[blockId];
    }

    private migrateSortValues(): void {
        const parents = new Set<string>();
        for (const entry of Object.values(this.cache) as TaskCacheEntry[]) {
            if (entry.parentId) parents.add(entry.parentId);
        }
        for (const parentId of parents) {
            const children = this.getByParent(parentId).filter(c => c.sort === -1);
            if (children.length === 0) continue;
            children.sort((a, b) => a.blockId.localeCompare(b.blockId));
            for (let i = 0; i < children.length; i++) {
                children[i].sort = i * 10000;
            }
        }
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
                `SELECT COUNT(DISTINCT a.block_id) as count
                    FROM attributes a
                    INNER JOIN blocks b ON b.id = a.block_id
                    WHERE a.name = 'custom-na-task'
                      AND a.value IS NOT NULL
                      AND a.value != ''
                      AND b.type IN ('p', 'h', 'd')`,
            );
            const dbCount = (rows && rows.length > 0) ? rows[0].count : 0;
            const cacheCount = Object.keys(this.cache).length;
            if (dbCount !== cacheCount) {
                void this.api.log("warn", `Cache integrity check: DB has ${dbCount} tasks, cache has ${cacheCount}. Rebuilding...`);
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
        if (parent.childIds.length === childIds.length && parent.childIds.every((childId, index) => childId === childIds[index])) return;
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
