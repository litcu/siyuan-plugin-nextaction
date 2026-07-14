import { TaskCacheEntry } from "../shared/types";
import { ATTR_PARENT, ATTR_STATUS, ATTR_PRIORITY, ATTR_DUE, ATTR_START, ATTR_CONTEXT, ATTR_TASK, ATTR_EFFORT, ATTR_IMPORTANCE, ATTR_DEPENDS, ATTR_DEP_MODE, ATTR_SEQUENTIAL, ATTR_REPEAT, ATTR_SORT, ATTR_COMPLETED, ATTR_NOTE, ATTR_CREATED, ATTR_TAGS, ATTR_REVIEW_INTERVAL, ATTR_REVIEW_DATE, ATTR_REMINDER, ATTR_EXT_PREFIX } from "../shared/constants";
import { DEFAULT_SETTINGS } from "../shared/settings";
import { siyuanFetch, attrToNumber, cleanSlashFromTitle, getSiyuan } from "./utils";
import { calculateOrder, getBlockedReason } from "./priority-engine";

interface SqlRow {
    id: string;
    parent_id: string;
    content: string;
    updated: string;
}

export class CacheManager {
    private cache: Record<string, TaskCacheEntry>;
    private lastSyncTime: string;

    constructor() {
        this.cache = Object.create(null) as Record<string, TaskCacheEntry>;
        this.lastSyncTime = "";
    }

    async loadAll(): Promise<void> {
        // Step 1: Query all na-task block IDs via SQL. The attributes table
        // is asynchronously flushed so we only trust it for block discovery,
        // not for reading the actual attribute values.
        const rows: SqlRow[] = await siyuanFetch("/api/query/sql", {
            stmt: "SELECT b.id, b.parent_id, b.content, b.updated FROM blocks b INNER JOIN attributes a ON a.block_id = b.id AND a.name = 'custom-na-task' WHERE a.value IS NOT NULL AND a.value != ''",
        });

        if (!rows || rows.length === 0) {
            this.cache = Object.create(null) as Record<string, TaskCacheEntry>;
            this.lastSyncTime = "";
            return;
        }

        // Step 2: Batch-fetch attributes for all blocks using batchGetBlockAttrs.
        // This API reads from the in-memory IAL cache (always up-to-date) and
        // returns {blockId: {key: value, ...}} — one call instead of N calls.
        const ids = rows.map((r) => r.id);
        const batchResult: Record<string, Record<string, string>> = await siyuanFetch(
            "/api/attr/batchGetBlockAttrs",
            { ids },
        );

        // Build a title lookup from SQL rows
        const titleMap: Record<string, string> = Object.create(null) as Record<string, string>;
        for (let i = 0; i < rows.length; i++) {
            titleMap[rows[i].id] = rows[i].content ? cleanSlashFromTitle(rows[i].content.substring(0, 100)) : "";
        }

        const newCache: Record<string, TaskCacheEntry> = Object.create(null) as Record<string, TaskCacheEntry>;
        let maxUpdated = "";

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const attrs = batchResult[row.id];
            if (!attrs) {
                const siyuan = getSiyuan();
                if (siyuan?.logger) {
                    siyuan.logger.warn(`Cache load: batchGetBlockAttrs missing attrs for block ${row.id}, skipping`);
                }
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
                sort: attrToNumber(attrs[ATTR_SORT], -1),
                completed: attrs[ATTR_COMPLETED] || "",
                note: attrs[ATTR_NOTE] || "",
                created: attrs[ATTR_CREATED] || "",
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

            entry.order = calculateOrder(entry);
            newCache[entry.blockId] = entry;

            if (row.updated > maxUpdated) {
                maxUpdated = row.updated;
            }
        }

        // Step 3: Build childIds reverse index
        const allIds = Object.keys(newCache);
        for (let i = 0; i < allIds.length; i++) {
            const entry = newCache[allIds[i]];
            if (entry.parentId !== "") {
                const parent = newCache[entry.parentId];
                if (parent) {
                    parent.childIds.push(entry.blockId);
                }
            }
        }

        // Step 3.1: Propagate child order to project parents
        for (let i = 0; i < allIds.length; i++) {
            const entry = newCache[allIds[i]];
            if (entry.taskType === "2") {
                entry.order = calculateOrder(entry, newCache);
            }
        }

        // Step 3.5: Compute blocked status for all entries
        for (let i = 0; i < allIds.length; i++) {
            const entry = newCache[allIds[i]];
            const reason = getBlockedReason(entry, newCache);
            entry.blocked = reason !== "";
            entry.blockedReason = reason;
        }

        // Step 4: Record lastSyncTime
        this.lastSyncTime = maxUpdated;

        // Replace cache (migration reads from this.cache, so set it first)
        this.cache = newCache;

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
        const result: TaskCacheEntry[] = [];
        const keys = Object.keys(this.cache);
        for (let i = 0; i < keys.length; i++) {
            const entry = this.cache[keys[i]];
            if (entry.parentId === parentId) {
                result.push(entry);
            }
        }
        return result;
    }

    set(entry: TaskCacheEntry): void {
        const existing = this.cache[entry.blockId];
        const oldParentId = existing ? existing.parentId : "";
        const newParentId = entry.parentId;

        if (oldParentId !== "" && oldParentId !== newParentId) {
            const oldParent = this.cache[oldParentId];
            if (oldParent) {
                const idx = oldParent.childIds.indexOf(entry.blockId);
                if (idx !== -1) {
                    oldParent.childIds.splice(idx, 1);
                }
            }
        }

        if (newParentId !== "") {
            const newParent = this.cache[newParentId];
            if (newParent) {
                const idx = newParent.childIds.indexOf(entry.blockId);
                if (idx === -1) {
                    newParent.childIds.push(entry.blockId);
                }
            }
        }

        this.cache[entry.blockId] = entry;
    }

    remove(blockId: string): void {
        const entry = this.cache[blockId];
        if (!entry) return;

        if (entry.parentId !== "") {
            const parent = this.cache[entry.parentId];
            if (parent) {
                const idx = parent.childIds.indexOf(blockId);
                if (idx !== -1) {
                    parent.childIds.splice(idx, 1);
                }
            }
        }

        delete this.cache[blockId];
    }

    async rebuild(): Promise<void> {
        this.cache = Object.create(null) as Record<string, TaskCacheEntry>;
        this.lastSyncTime = "";
        await this.loadAll();
    }

    /**
     * Verify cache integrity after loadAll().
     * Compares the cache entry count against a fresh SQL count query.
     * Returns the number of missing entries (0 = healthy).
     */
    async verifyIntegrity(): Promise<number> {
        try {
            const rows: Array<{ count: number }> = await siyuanFetch("/api/query/sql", {
                stmt: "SELECT COUNT(*) as count FROM attributes WHERE name = 'custom-na-task' AND value IS NOT NULL AND value != ''",
            });
            const dbCount = (rows && rows.length > 0) ? rows[0].count : 0;
            const cacheCount = Object.keys(this.cache).length;
            if (dbCount !== cacheCount) {
                const siyuan = getSiyuan();
                if (siyuan?.logger) {
                    siyuan.logger.warn(`Cache integrity check: DB has ${dbCount} tasks, cache has ${cacheCount}. Rebuilding...`);
                }
                return Math.abs(dbCount - cacheCount);
            }
            return 0;
        } catch (_e: any) {
            return 0;
        }
    }

    getLastSyncTime(): string {
        return this.lastSyncTime;
    }

    setLastSyncTime(time: string): void {
        this.lastSyncTime = time;
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

    recalcBlockedStatus(): void {
        const keys = Object.keys(this.cache);
        for (let i = 0; i < keys.length; i++) {
            const entry = this.cache[keys[i]];
            const reason = getBlockedReason(entry, this.cache);
            entry.blocked = reason !== "";
            entry.blockedReason = reason;
        }
    }
}
