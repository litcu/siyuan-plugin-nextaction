import { type TaskCacheEntry } from "../shared/types";
import {
    ATTR_PARENT,
    ATTR_STATUS,
    ATTR_PRIORITY,
    ATTR_DUE,
    ATTR_START,
    ATTR_CONTEXT,
    ATTR_TASK,
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
import { attrToNumber, cleanSlashFromTitle } from "./utils";
import { sql } from "../shared/sql";
import type { SiyuanApiPort } from "./siyuan-api";

interface SqlRow {
    id: string;
    parent_id: string;
    content_block_id: string;
    title_content: string;
    markdown: string;
    structural_parent_id: string;
    source: "document" | "native";
    sort: number;
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
        // Discover document tasks/projects and all native task list items through
        // one stable cursor. Native tasks do not require custom-na-task.
        const rows: SqlRow[] = [];
        let lastBlockId = "";
        for (;;) {
            const stmt = sql`WITH RECURSIVE native_tasks(id) AS (
                    SELECT task.id
                      FROM blocks task
                      LEFT JOIN blocks task_list
                        ON task_list.id = task.parent_id
                       AND task_list.type = 'l'
                     WHERE task.type = 'i'
                       AND (
                            task.subtype = 't'
                            OR task_list.subtype = 't'
                       )
                ), ancestor_walk(task_id, ancestor_id, parent_id, type, subtype, depth, path) AS (
                    SELECT task.id,
                           parent.id,
                           parent.parent_id,
                           parent.type,
                           parent.subtype,
                           1,
                           ',' || parent.id || ','
                      FROM native_tasks task
                      INNER JOIN blocks child ON child.id = task.id
                      INNER JOIN blocks parent ON parent.id = child.parent_id
                    UNION ALL
                    SELECT walk.task_id,
                           parent.id,
                           parent.parent_id,
                           parent.type,
                           parent.subtype,
                           walk.depth + 1,
                           walk.path || parent.id || ','
                      FROM ancestor_walk walk
                      INNER JOIN blocks parent ON parent.id = walk.parent_id
                     WHERE walk.type != 'd'
                       AND INSTR(walk.path, ',' || parent.id || ',') = 0
                ), task_ancestors(task_id, ancestor_id, depth) AS (
                    SELECT walk.task_id, walk.ancestor_id, walk.depth
                      FROM ancestor_walk walk
                     WHERE walk.type = 'i'
                       AND (
                            walk.subtype = 't'
                            OR EXISTS (
                                SELECT 1 FROM blocks ancestor_list
                                 WHERE ancestor_list.id = walk.parent_id
                                   AND ancestor_list.type = 'l'
                                   AND ancestor_list.subtype = 't'
                            )
                       )
                ), structural_parents(task_id, ancestor_id) AS (
                    SELECT candidate.task_id, candidate.ancestor_id
                      FROM task_ancestors candidate
                     WHERE candidate.depth = (
                            SELECT MIN(nearest.depth)
                              FROM task_ancestors nearest
                             WHERE nearest.task_id = candidate.task_id
                       )
                ) SELECT * FROM (
                    SELECT b.id,
                           b.parent_id,
                           '' AS content_block_id,
                           b.content AS title_content,
                           b.markdown,
                           '' AS structural_parent_id,
                           'document' AS source,
                           b.sort,
                           b.updated
                      FROM blocks b
                      INNER JOIN attributes a
                        ON a.block_id = b.id
                       AND a.name = 'custom-na-task'
                     WHERE a.value IS NOT NULL
                       AND a.value != ''
                       AND b.type = 'd'
                    UNION ALL
                    SELECT task.id,
                           task.parent_id,
                           COALESCE((SELECT child.id FROM blocks child
                                      WHERE child.parent_id = task.id
                                        AND child.type IN ('p', 'h')
                                      ORDER BY child.sort LIMIT 1), '') AS content_block_id,
                           COALESCE((SELECT child.content FROM blocks child
                                      WHERE child.parent_id = task.id
                                        AND child.type IN ('p', 'h')
                                      ORDER BY child.sort LIMIT 1), task.content) AS title_content,
                           task.markdown,
                           COALESCE(structural_parent.ancestor_id, '') AS structural_parent_id,
                           'native' AS source,
                           task.sort,
                           task.updated
                      FROM native_tasks discovered_task
                      INNER JOIN blocks task ON task.id = discovered_task.id
                      LEFT JOIN structural_parents structural_parent
                        ON structural_parent.task_id = task.id
                ) task
                WHERE (${lastBlockId} = '' OR task.id > ${lastBlockId})
                ORDER BY task.id`;
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

        const newCache: Record<string, TaskCacheEntry> = Object.create(null) as Record<string, TaskCacheEntry>;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const attrs = batchResult[row.id] || {};

            if (row.source === "document" && (!attrs[ATTR_TASK] || attrs[ATTR_TASK] === "")) {
                continue;
            }

            const marker = row.markdown?.match(/\[(.)\]/s)?.[1] || " ";
            const defaultNativeStatus = marker === " " ? "inbox" : "done";

            const entry: TaskCacheEntry = {
                blockId: row.id,
                identificationSource: row.source,
                contentBlockId: row.source === "native" ? row.content_block_id || undefined : undefined,
                attrHostId: row.id,
                parentId: attrs[ATTR_PARENT] || (row.source === "native" ? row.structural_parent_id || "" : ""),
                status: attrs[ATTR_STATUS] || (row.source === "native" ? defaultNativeStatus : "todo"),
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
                sort: attrToNumber(attrs[ATTR_SORT], row.source === "native" ? Number(row.sort ?? -1) : -1),
                completed: attrs[ATTR_COMPLETED] || "",
                note: attrs[ATTR_NOTE] || "",
                created: attrs[ATTR_CREATED] || "",
                updated: row.updated || "",
                tags: attrs[ATTR_TAGS] || "",
                reviewInterval: attrToNumber(attrs[ATTR_REVIEW_INTERVAL], 0),
                reviewDate: attrs[ATTR_REVIEW_DATE] || "",
                reminder: attrs[ATTR_REMINDER] || "",
                customFields: this.extractCustomFields(attrs),
                blocked: false, // 将在 childIds 构建后统一计算
                blockedReason: "",
                taskType: row.source === "native" ? "1" : attrs[ATTR_TASK] || "1",
                order: 0,
                childIds: [],
                title: row.title_content ? cleanSlashFromTitle(row.title_content.substring(0, 100)) : "",
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
