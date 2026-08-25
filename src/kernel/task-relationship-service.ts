import type { TaskCacheEntry } from "../shared/types";
import {
    ATTR_PARENT,
    ATTR_SORT,
    RPC_ERROR_CIRCULAR_REF,
    RPC_ERROR_INVALID_PARAMS,
    RPC_ERROR_TASK_NOT_FOUND,
} from "../shared/constants";
import { isProjectTask } from "../shared/project-domain";
import { assertBlockId } from "../shared/block-id";
import { sql } from "../shared/sql";
import type { CacheManager } from "./cache-manager";
import type { SiyuanApiPort } from "./siyuan-api";
import type { ConfirmedTaskChanges, TaskRepository } from "./task-repository";
import type { TaskRuntimeState } from "./task-runtime-state";
import type { TaskIdentityResolver } from "./task-identity-resolver";

function codedError(message: string, code: number): Error & { code: number } {
    const error = new Error(message) as Error & { code: number };
    error.code = code;
    return error;
}

export class TaskRelationshipService {
    constructor(
        private readonly cacheManager: CacheManager,
        private readonly repository: TaskRepository,
        private readonly api: SiyuanApiPort,
        private readonly runtime: TaskRuntimeState,
        private readonly identities: TaskIdentityResolver,
    ) {}

    async recalcAllOrders(): Promise<void> {
        this.repository.reconcileAllDerivedState();
    }

    async validateParentChange(
        entry: Pick<TaskCacheEntry, "blockId" | "identificationSource" | "taskType">,
        parentId: string,
        nextTaskType = entry.taskType,
    ): Promise<void> {
        if (!parentId) return;
        if (parentId === entry.blockId) {
            throw codedError("Circular reference", RPC_ERROR_CIRCULAR_REF);
        }

        if (isProjectTask({ identificationSource: entry.identificationSource, taskType: nextTaskType })) {
            throw codedError("Project cannot be child of another task", RPC_ERROR_INVALID_PARAMS);
        }

        const visited = new Set<string>([entry.blockId]);
        let currentId = parentId;
        let first = true;
        while (currentId) {
            if (visited.has(currentId)) {
                throw codedError("Circular reference", RPC_ERROR_CIRCULAR_REF);
            }
            visited.add(currentId);
            const current = this.cacheManager.get(currentId);
            if (current) {
                currentId = current.parentId;
                first = false;
                continue;
            }
            try {
                const resolved = await this.identities.resolveTarget({
                    blockId: currentId,
                    taskType: "1",
                    mode: "existing",
                    readAttrs: (blockIds) => this.repository.batchGetBlockAttrs(blockIds),
                });
                if (resolved.kind === "convert-text") throw new Error("Parent task not found");
                currentId = resolved.identity.effectiveParentId;
                first = false;
            } catch (_cause: unknown) {
                if (!first) break;
                throw codedError("Parent task not found", RPC_ERROR_TASK_NOT_FOUND);
            }
        }
    }

    async clearDirectProjectParents(projectId: string, changes: ConfirmedTaskChanges): Promise<void> {
        const candidates = this.cacheManager.getByParent(projectId).filter((entry) => !isProjectTask(entry));
        if (candidates.length === 0) return;
        const attrsById = await this.repository.batchGetBlockAttrs(candidates.map((entry) => entry.blockId));

        for (const child of candidates) {
            if (attrsById[child.blockId]?.[ATTR_PARENT] !== projectId) continue;
            const resolved = await this.identities.resolveTarget({
                blockId: child.blockId,
                taskType: "1",
                mode: "existing",
                readAttrs: (blockIds) => this.repository.batchGetBlockAttrs(blockIds),
            });
            if (resolved.kind === "convert-text") continue;
            await changes.upsertAttrs({
                blockId: child.blockId,
                attrs: { [ATTR_PARENT]: "" },
                existing: child,
                identity: {
                    identificationSource: resolved.identity.identificationSource,
                    attrHostId: resolved.identity.attrHostId,
                    contentBlockId: resolved.identity.contentBlockId,
                    parentId: resolved.identity.structuralParentId,
                    taskType: resolved.identity.taskType,
                },
            });
        }
    }

    async rebuildParentRelationships(): Promise<number> {
        return this.repository.withConfirmedChanges(async (changes) => {
            const allEntries = this.cacheManager.getAll();
            const cacheIds = new Set(allEntries.map((e) => e.blockId));
            let fixed = 0;

            for (let i = 0; i < allEntries.length; i++) {
                const entry = allEntries[i];
                const needsFix = await this.isParentIdInvalid(entry, cacheIds);

                if (!needsFix) continue;

                let ancestorId = "";
                try {
                    const resolved = await this.identities.resolveTarget({
                        blockId: entry.blockId,
                        taskType: "1",
                        mode: "conversion",
                        readAttrs: (blockIds) => this.repository.batchGetBlockAttrs(blockIds),
                    });
                    ancestorId =
                        resolved.kind === "convert-text"
                            ? resolved.structuralParentId
                            : resolved.identity.structuralParentId;
                } catch (_error: unknown) {
                    /* ignore */
                }

                const correctParent = ancestorId || "";
                if (entry.parentId === correctParent) continue;

                await changes.upsertAttrs({
                    blockId: entry.blockId,
                    attrs: { [ATTR_PARENT]: correctParent },
                    existing: entry,
                });
                fixed++;

                if ((i + 1) % 20 === 0) {
                    await new Promise<void>((resolve) => setTimeout(resolve, 0));
                }
            }

            return fixed;
        });
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

        await this.validateParentChange(entry, parentId);

        return this.repository.withConfirmedChanges(async (changes) => {
            // 更新 na-parent
            if (newParentId !== undefined && newParentId !== entry.parentId) {
                await changes.upsertAttrs({
                    blockId,
                    attrs: { [ATTR_PARENT]: newParentId ?? "" },
                    existing: entry,
                });
            }

            // 获取目标位置的兄弟列表（排除被拖任务自身）
            const siblings = parentId
                ? this.cacheManager.getByParent(parentId).filter((s) => s.blockId !== blockId)
                : this.cacheManager.getAll().filter((s) => !s.parentId && s.blockId !== blockId);
            siblings.sort((a, b) => a.sort - b.sort || a.blockId.localeCompare(b.blockId));

            // 计算插入位置的索引
            let insertIndex: number;
            if (!afterId || afterId === "") {
                insertIndex = 0;
            } else {
                const afterIndex = siblings.findIndex((s) => s.blockId === afterId);
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
                const plannedSiblings = siblings.map((sibling, index) => ({
                    sibling,
                    sort: index < insertIndex ? index * step : (index + 1) * step,
                }));
                for (const { sibling, sort } of plannedSiblings) {
                    try {
                        const cachedSibling = this.cacheManager.get(sibling.blockId);
                        if (cachedSibling) {
                            await changes.upsertAttrs({
                                blockId: sibling.blockId,
                                attrs: { [ATTR_SORT]: String(sort) },
                                existing: cachedSibling,
                            });
                        }
                    } catch (error: unknown) {
                        const message = error instanceof Error ? error.message : String(error);
                        void this.api.log(
                            "warn",
                            `reorderTask: failed to write sort for ${sibling.blockId}: ${message}`,
                        );
                    }
                }
                newSort = insertIndex * step;
            }

            return changes.upsertAttrs({
                blockId,
                attrs: { [ATTR_SORT]: String(newSort) },
                existing: this.cacheManager.get(blockId) ?? entry,
            });
        });
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

        await this.repository.withConfirmedChanges(async (changes) => {
            for (let i = 0; i < rows.length; i++) {
                const childId = rows[i].id;
                const childEntry = this.cacheManager.get(childId);

                if (childEntry && (!childEntry.parentId || childEntry.parentId === "")) {
                    await changes.upsertAttrs({
                        blockId: childId,
                        attrs: { [ATTR_PARENT]: blockId },
                        existing: childEntry,
                    });
                }
            }
        });
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
