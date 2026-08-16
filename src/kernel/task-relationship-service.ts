import type { TaskCacheEntry } from "../shared/types";
import { ATTR_PARENT, ATTR_SORT, ATTR_TASK, RPC_ERROR_CIRCULAR_REF, RPC_ERROR_INVALID_PARAMS, RPC_ERROR_TASK_NOT_FOUND } from "../shared/constants";
import { assertBlockId } from "../shared/block-id";
import { sql } from "../shared/sql";
import { calculateOrder } from "./priority-engine";
import type { CacheManager } from "./cache-manager";
import type { SiyuanApiPort } from "./siyuan-api";
import type { TaskRepository } from "./task-repository";
import type { TaskRuntimeState } from "./task-runtime-state";

export class TaskRelationshipService {
    constructor(
        private readonly cacheManager: CacheManager,
        private readonly repository: TaskRepository,
        private readonly api: SiyuanApiPort,
        private readonly runtime: TaskRuntimeState,
    ) {}

    async recalcAllOrders(): Promise<void> {
            const allEntries = this.cacheManager.getAll();
            const cache = this.cacheManager.getCache();
            const batchSize = 50;
            const projects: TaskCacheEntry[] = [];

            // Pass 1: compute own order for all entries
            for (let i = 0; i < allEntries.length; i++) {
                allEntries[i].order = calculateOrder(allEntries[i]);
                if (allEntries[i].taskType === "2") {
                    projects.push(allEntries[i]);
                }

                if ((i + 1) % batchSize === 0) {
                    await new Promise<void>((resolve) => setTimeout(resolve, 0));
                }
            }

            // Pass 2: propagate child order to projects (deepest first)
            const depthMap = new Map<string, number>();
            const getDepth = (id: string, visited: Set<string>): number => {
                if (depthMap.has(id)) return depthMap.get(id)!;
                if (visited.has(id)) return 0;
                visited.add(id);
                const entry = cache[id];
                if (!entry || entry.childIds.length === 0) {
                    depthMap.set(id, 0);
                    return 0;
                }
                let maxChildDepth = 0;
                for (const childId of entry.childIds) {
                    const child = cache[childId];
                    if (child && child.taskType === "2") {
                        maxChildDepth = Math.max(maxChildDepth, getDepth(childId, visited));
                    }
                }
                const depth = maxChildDepth + 1;
                depthMap.set(id, depth);
                return depth;
            };

            for (const p of projects) {
                getDepth(p.blockId, new Set());
            }

            projects.sort((a, b) => (depthMap.get(b.blockId) || 0) - (depthMap.get(a.blockId) || 0));

            for (let i = 0; i < projects.length; i++) {
                projects[i].order = calculateOrder(projects[i], cache);
            }
        }

    async rebuildParentRelationships(): Promise<number> {
            const allEntries = this.cacheManager.getAll();
            const cacheIds = new Set(allEntries.map((e) => e.blockId));
            let fixed = 0;
            const fixedIds: string[] = [];

            for (let i = 0; i < allEntries.length; i++) {
                const entry = allEntries[i];
                const needsFix = await this.isParentIdInvalid(entry, cacheIds);

                if (!needsFix) continue;

                let ancestorId = "";
                try {
                    ancestorId = await this.findAncestorTask(entry.blockId);
                } catch (_error: unknown) { /* ignore */ }

                const correctParent = ancestorId || "";

                if (entry.parentId === correctParent) continue;

                // Update the block attribute
                const confirmedAttrs = await this.repository.writeAttrs(entry.blockId, { [ATTR_PARENT]: correctParent });

                // Update cache via set() which maintains childIds reverse index.
                // Must create a new object so set() can see the old vs new parentId.
                const updated = this.repository.buildEntry(entry.blockId, confirmedAttrs, entry);
                this.repository.cache(updated);
                fixedIds.push(entry.blockId);
                fixed++;

                if ((i + 1) % 20 === 0) {
                    await new Promise<void>((resolve) => setTimeout(resolve, 0));
                }
            }

            if (fixed > 0) {
                this.cacheManager.recalcBlockedStatus();
                for (const id of fixedIds) {
                    this.repository.recordChange(id, "update");
                }
                this.repository.publishChanges();
            }

            return fixed;
        }

    /**
         * Determine whether a task's current parentId is invalid and should be
         * rebuilt. Returns true when:
         * 1. parentId is empty (never assigned) — needs initial fill
         * 2. parentId points to a non-existent task (orphaned reference)
         * 3. parentId points to itself (self-reference)
         * 4. parentId creates a cycle
         * 5. parentId points to a sibling paragraph inside the same list item
         *
         * Returns false when the parentId is valid and should be preserved.
         */
        private async isParentIdInvalid(entry: TaskCacheEntry, cacheIds: Set<string>): Promise<boolean> {
            const pid = entry.parentId;
            // Case 1: no parent — needs initial fill
            if (!pid) return true;

            // Case 3: self-reference
            if (pid === entry.blockId) return true;

            // Case 2: parent task doesn't exist in cache
            if (!cacheIds.has(pid)) return true;

            // Case 4: cycle detection
            const visited = new Set<string>([entry.blockId]);
            let current = pid;
            while (current) {
                if (visited.has(current)) return true; // cycle found
                visited.add(current);
                const parent = this.cacheManager.get(current);
                if (!parent || !parent.parentId) break;
                current = parent.parentId;
            }

            // Case 5: sibling paragraph — same list item parent
            // Query both blocks' parent_id from the blocks table; if they share
            // the same list item as parent, they are peers, not parent-child.
            const rows = await this.api.query<{ id: string; parent_id: string }>(
                sql`SELECT id, parent_id FROM blocks WHERE id IN (${entry.blockId}, ${pid})`,
            );
            if (rows && rows.length === 2) {
                const myParent = rows.find((r) => r.id === entry.blockId)?.parent_id;
                const theirParent = rows.find((r) => r.id === pid)?.parent_id;
                if (myParent && myParent === theirParent) return true;
            }

            return false;
        }

    async reorderTask(blockId: string, newParentId?: string, afterId?: string): Promise<TaskCacheEntry> {
            blockId = assertBlockId(blockId);
            if (newParentId) assertBlockId(newParentId, "newParentId");
            if (afterId) assertBlockId(afterId, "afterId");
            this.runtime.assertReady();

            const entry = this.cacheManager.get(blockId);
            if (!entry) {
                const error = new Error("Task not found") as Error & { code: number };
                error.code = RPC_ERROR_TASK_NOT_FOUND;
                throw error;
            }

            const parentId = newParentId !== undefined ? newParentId : entry.parentId;

            // 循环引用检测
            if (parentId) {
                let current: string | undefined = parentId;
                const visited = new Set<string>();
                while (current && !visited.has(current)) {
                    if (current === blockId) {
                        const error = new Error("Circular reference") as Error & { code: number };
                        error.code = RPC_ERROR_CIRCULAR_REF;
                        throw error;
                    }
                    visited.add(current);
                    const parentEntry = this.cacheManager.get(current);
                    current = parentEntry?.parentId;
                }
            }

            // 项目不能成为普通任务的子任务
            if (entry.taskType === "2" && parentId) {
                const parentEntry = this.cacheManager.get(parentId);
                if (parentEntry && parentEntry.taskType === "1") {
                    const error = new Error("Project cannot be child of task") as Error & { code: number };
                    error.code = RPC_ERROR_INVALID_PARAMS;
                    throw error;
                }
            }

            const lock = await this.repository.acquireWithTimeout();
            try {
                // 更新 na-parent
                if (newParentId !== undefined && newParentId !== entry.parentId) {
                    await this.repository.writeAttrs(blockId, { [ATTR_PARENT]: newParentId ?? "" });
                }

                // 获取目标位置的兄弟列表（排除被拖任务自身）
                const siblings = parentId
                    ? this.cacheManager.getByParent(parentId).filter(s => s.blockId !== blockId)
                    : this.cacheManager.getAll().filter(s => !s.parentId && s.blockId !== blockId);
                siblings.sort((a, b) => a.sort - b.sort || a.blockId.localeCompare(b.blockId));

                // 计算插入位置的索引
                let insertIndex: number;
                if (!afterId || afterId === "") {
                    insertIndex = 0;
                } else {
                    const afterIndex = siblings.findIndex(s => s.blockId === afterId);
                    if (afterIndex === -1) {
                        insertIndex = siblings.length;
                    } else {
                        insertIndex = afterIndex + 1;
                    }
                }

                // 尝试在现有 sort 间距中插入
                let newSort: number | null = null;
                if (insertIndex === 0) {
                    if (siblings.length === 0) {
                        newSort = 0;
                    } else if (siblings[0].sort > 0) {
                        newSort = Math.floor(siblings[0].sort / 2);
                    }
                } else if (insertIndex >= siblings.length) {
                    newSort = siblings[siblings.length - 1].sort + 10000;
                } else {
                    const prevSort = siblings[insertIndex - 1].sort;
                    const nextSort = siblings[insertIndex].sort;
                    const gap = nextSort - prevSort;
                    if (gap >= 10) {
                        newSort = prevSort + Math.floor(gap / 2);
                    }
                }

                // 间距不够，重新编号所有兄弟后插入
                if (newSort === null) {
                    // 给兄弟分配均匀间距，为插入位置留出空位
                    const step = 10000;
                    for (let i = 0; i < siblings.length; i++) {
                        const sort = i < insertIndex ? i * step : (i + 1) * step;
                        siblings[i].sort = sort;
                    }
                    for (const sibling of siblings) {
                        try {
                            const siblingAttrs = await this.repository.writeAttrs(sibling.blockId, { [ATTR_SORT]: String(sibling.sort) });
                            const cachedSibling = this.cacheManager.get(sibling.blockId);
                            if (cachedSibling) this.repository.cache(this.repository.buildEntry(sibling.blockId, siblingAttrs, cachedSibling));
                        } catch (error: unknown) {
                            const message = error instanceof Error ? error.message : String(error);
                            void this.api.log("warn", `reorderTask: failed to write sort for ${sibling.blockId}: ${message}`);
                        }
                    }
                    // 更新缓存中的 sort
                    for (const s of siblings) {
                        const cached = this.cacheManager.get(s.blockId);
                        if (cached) cached.sort = s.sort;
                    }
                    newSort = insertIndex * step;
                }

                const finalAttrs = await this.repository.writeAttrs(blockId, { [ATTR_SORT]: String(newSort) });
                const finalEntry = this.repository.buildEntry(blockId, finalAttrs, entry);
                this.repository.cache(finalEntry);
                this.cacheManager.recalcBlockedStatus();
                this.repository.recordChange(blockId, "update");

                // In a sequential parent, reordering changes which siblings are blocked.
                if (parentId) {
                    const parentEntry = this.cacheManager.get(parentId);
                    if (parentEntry && parentEntry.sequential) {
                        for (let i = 0; i < parentEntry.childIds.length; i++) {
                            if (parentEntry.childIds[i] !== blockId) {
                                this.repository.recordChange(parentEntry.childIds[i], "update");
                            }
                        }
                    }
                }

                this.repository.publishChanges();
                return finalEntry;
            } finally {
                lock.release();
            }
        }

    // ---- Helper methods ----

        detectDependencyCycle(blockId: string, dependsStr: string): boolean {
            if (!dependsStr) return false;
            const depIds = dependsStr.split("|").filter(Boolean);
            const visited = new Set<string>();
            const queue = [...depIds];
            let depth = 0;
            while (queue.length > 0 && depth < 100) {
                const currentId = queue.shift()!;
                if (currentId === blockId) return true;
                if (visited.has(currentId)) continue;
                visited.add(currentId);
                const entry = this.cacheManager.get(currentId);
                if (entry?.depends) {
                    queue.push(...entry.depends.split("|").filter(Boolean));
                }
                depth++;
            }
            return false;
        }

    detectDependencyOnAncestor(blockId: string, dependsStr: string): boolean {
            if (!dependsStr) return false;
            const depIds = new Set(dependsStr.split("|").filter(Boolean));
            // Walk up the parent chain
            let current = this.cacheManager.get(blockId)?.parentId;
            let depth = 0;
            while (current && depth < 20) {
                if (depIds.has(current)) return true;
                const entry = this.cacheManager.get(current);
                current = entry?.parentId || "";
                depth++;
            }
            return false;
        }

    checkSequentialConflict(blockId: string, dependsStr: string): boolean {
            if (!dependsStr) return false;
            const entry = this.cacheManager.get(blockId);
            if (!entry?.parentId) return false;
            const parent = this.cacheManager.get(entry.parentId);
            if (!parent?.sequential) return false;
            const depIds = dependsStr.split("|").filter(Boolean);
            for (const depId of depIds) {
                const depEntry = this.cacheManager.get(depId);
                if (depEntry && depEntry.parentId === entry.parentId && depEntry.sort > entry.sort) {
                    return true;
                }
            }
            return false;
        }

    async findTaskParentHint(parentId: string, blockId: string): Promise<string> {
            if (!parentId || parentId === blockId) return "";
            const attrs = await this.repository.getBlockAttrs(parentId);
            return attrs[ATTR_TASK] ? parentId : "";
        }

    async findAncestorTask(blockId: string): Promise<string> {
            // Use a recursive CTE to fetch the entire ancestor chain in one SQL call,
            // then walk it in memory. Include the starting block itself so we can
            // read its parent_id as the entry point for the upward walk.
            const rows = await this.api.query<{ id: string; parent_id: string; type: string }>(
                sql`WITH RECURSIVE ancestors(id, parent_id, type) AS (
                    SELECT id, parent_id, type FROM blocks WHERE id = ${blockId}
                    UNION ALL
                    SELECT b.id, b.parent_id, b.type FROM blocks b INNER JOIN ancestors a ON b.id = a.parent_id
                ) SELECT id, parent_id, type FROM ancestors`,
            );

            if (!rows || rows.length === 0) return "";

            // Build a lookup by id
            const byId = Object.create(null) as Record<string, { id: string; parent_id: string; type: string }>;
            for (let i = 0; i < rows.length; i++) {
                byId[rows[i].id] = rows[i];
            }

            // Walk upward starting from the starting block's parent_id
            const startBlock = byId[blockId];
            if (!startBlock || !startBlock.parent_id) return "";

            // The starting block's direct parent is its container (e.g. the list item it
            // lives in). Sibling paragraphs inside the same container are NOT ancestors —
            // they are peers at the same level. We must skip this container when looking
            // for a parent task; otherwise a peer paragraph would be incorrectly set as
            // the parent.
            const directParentId = startBlock.parent_id;

            let currentId = directParentId;
            for (let depth = 0; depth < 50; depth++) {
                const ancestor = byId[currentId];
                if (!ancestor) break;

                const ancestorId = ancestor.id;

                // Check if this ancestor itself is a task (works for paragraphs, list items, and document blocks)
                const attrs = await this.repository.getBlockAttrs(ancestorId);
                if (attrs[ATTR_TASK] && attrs[ATTR_TASK] !== "") {
                    return ancestorId;
                }

                // If this ancestor is a list item, check its child paragraphs for na-task.
                // Skip the starting block's direct container — paragraphs inside it are
                // peers, not parents.
                if (ancestor.type === "i" && ancestorId !== directParentId) {
                    const taskParagraph = await this.findTaskParagraphInListItem(ancestorId, blockId);
                    if (taskParagraph && taskParagraph !== blockId) {
                        return taskParagraph;
                    }
                }

                if (!ancestor.parent_id) break;
                currentId = ancestor.parent_id;
            }

            return "";
        }

    /**
         * Check if a list item (type="i") contains a paragraph with na-task set.
         * Returns the paragraph blockId if found, empty string otherwise.
         * @param excludeId A blockId to skip (typically the block we just came from).
         */
        private async findTaskParagraphInListItem(listItemId: string, excludeId?: string): Promise<string> {
            const stmt = excludeId
                ? sql`SELECT id FROM blocks WHERE parent_id = ${listItemId} AND type = 'p' AND id != ${excludeId}`
                : sql`SELECT id FROM blocks WHERE parent_id = ${listItemId} AND type = 'p'`;

            const rows = await this.api.query<{ id: string }>(stmt);

            if (!rows || rows.length === 0) return "";

            for (let i = 0; i < rows.length; i++) {
                const attrs = await this.repository.getBlockAttrs(rows[i].id);
                if (attrs[ATTR_TASK] && attrs[ATTR_TASK] !== "") {
                    return rows[i].id;
                }
            }

            return "";
        }

    async updateDescendantParents(blockId: string): Promise<void> {
            // Find the list item that contains this paragraph block.
            // Structure: NodeParagraph → NodeListItem → NodeList → ...
            const listItemId = await this.findParentListItem(blockId);
            if (!listItemId) return;

            // Find all task paragraphs nested under this list item (1 level deep).
            // Structure: NodeListItem → NodeList → NodeListItem → NodeParagraph (has na-task)
            const rows = await this.api.query<{ id: string }>(
                sql`SELECT p.id FROM blocks p WHERE p.type = 'p' AND p.parent_id IN (
                    SELECT li.id FROM blocks li WHERE li.type = 'i' AND li.parent_id IN (
                        SELECT nl.id FROM blocks nl WHERE nl.type = 'l' AND nl.parent_id = ${listItemId}
                    )
                ) AND EXISTS (SELECT 1 FROM attributes a WHERE a.block_id = p.id AND a.name = 'custom-na-task' AND a.value IS NOT NULL AND a.value != '')`,
            );

            if (!rows || rows.length === 0) return;

            for (let i = 0; i < rows.length; i++) {
                const childId = rows[i].id;
                const childEntry = this.cacheManager.get(childId);

                if (childEntry && (!childEntry.parentId || childEntry.parentId === "")) {
                    const attrs = await this.repository.writeAttrs(childId, { [ATTR_PARENT]: blockId });
                    // Update parentId
                    this.repository.cache(this.repository.buildEntry(childId, attrs, childEntry));
                    // Add to new parent's childIds
                    const newParent = this.cacheManager.get(blockId);
                    if (newParent && newParent.childIds.indexOf(childId) === -1) {
                        newParent.childIds.push(childId);
                    }
                    this.repository.recordChange(childId, "update");
                }
            }
        }

    /**
         * Walk up from a paragraph block to find its containing list item (type="i").
         * Returns the list item blockId, or empty string if not found.
         */
        async findParentListItem(blockId: string): Promise<string> {
            // Use recursive CTE to fetch ancestor chain in one call.
            // Include the starting block itself so we can read its parent_id as the
            // entry point for the upward walk.
            const rows = await this.api.query<{ id: string; parent_id: string; type: string }>(
                sql`WITH RECURSIVE ancestors(id, parent_id, type) AS (
                    SELECT id, parent_id, type FROM blocks WHERE id = ${blockId}
                    UNION ALL
                    SELECT b.id, b.parent_id, b.type FROM blocks b INNER JOIN ancestors a ON b.id = a.parent_id
                ) SELECT id, parent_id, type FROM ancestors`,
            );

            if (!rows || rows.length === 0) return "";

            const byId = Object.create(null) as Record<string, { id: string; parent_id: string; type: string }>;
            for (let i = 0; i < rows.length; i++) {
                byId[rows[i].id] = rows[i];
            }

            // Walk upward starting from the starting block's parent_id
            const startBlock = byId[blockId];
            if (!startBlock || !startBlock.parent_id) return "";

            let currentId = startBlock.parent_id;
            for (let depth = 0; depth < 10; depth++) {
                const ancestor = byId[currentId];
                if (!ancestor) break;
                if (ancestor.type === "i") return ancestor.id;
                currentId = ancestor.parent_id;
            }

            return "";
        }
}
