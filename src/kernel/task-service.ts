import { type TaskCacheEntry, type StatisticsResult, type StatisticsSummary, StatisticsDistribution, StatisticsContextItem, StatisticsProjectStatus, type ReviewData, type CompletedTasksPage, type MyDayState } from "../shared/types";
import { paginateCompletedTasks, type CompletedTasksPageOptions } from "../shared/task-pagination";
import {
    ATTR_TASK,
    ATTR_STATUS,
    ATTR_PRIORITY,
    ATTR_IMPORTANCE,
    ATTR_EFFORT,
    ATTR_DUE,
    ATTR_START,
    ATTR_CONTEXT,
    ATTR_PARENT,
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
    RPC_ERROR_INVALID_PARAMS,
    RPC_ERROR_TASK_NOT_FOUND,
    RPC_ERROR_CIRCULAR_REF,
    RPC_ERROR_DEP_CYCLE,
    RPC_ERROR_NOT_TEXT_BLOCK,
    RPC_ERROR_PROJECT_REQUIRES_DOCUMENT,
    RPC_ERROR_NOT_READY,
    RPC_ERROR_TIMEOUT,
    WRITE_LOCK_TIMEOUT_MS,
    ALL_STATUSES,
    ATTR_EXT_PREFIX,
} from "../shared/constants";
import { type CacheManager } from "./cache-manager";
import { type Mutex } from "./mutex";
import type { TaskChangePublisher } from "./sync-engine";
import { attrToNumber, numberToAttr, validateTaskAttrs, cleanSlashFromTitle, errorToRpcError } from "./utils";
import { assertBlockId } from "../shared/block-id";
import { sql } from "../shared/sql";
import type { SiyuanApiPort } from "./siyuan-api";
import { calculateOrder, isNextActionCandidate, sortTasks, getBlockedReason, updatePriorityConfig, getSequentialBroadcastIds } from "./priority-engine";
import {
    advanceRepeatState,
    createRepeatState,
    normalizeRepeatRule,
    parseRepeatRule,
    parseRepeatState,
    type RepeatRuleV2,
    type RepeatStateV1,
} from "./repeat-engine";
import type { PluginSettings } from "../shared/settings";
import { DEFAULT_SETTINGS, validateSettings, mergeSettings } from "../shared/settings";
import { encodeCustomFieldValue, isCustomFieldApplicable, validateCustomFieldDefinition, type CustomFieldDef } from "../shared/custom-fields";
import { parseTaskTitleDates } from "../shared/natural-date";
import { isTaskDueOverdue, isTaskReviewDue, localDateString } from "../shared/review";

function localActionDate(date: Date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface ConvertToTaskOptions {
    /** The caller has just created the block and verified its text DOM. */
    knownTextBlock?: boolean;
    /** Verified short block type for a newly inserted text block. */
    knownTextBlockType?: "p" | "h" | "d";
    /** Direct parent returned by SiYuan's insert transaction. */
    parentIdHint?: string;
}

export interface MyDayTaskPort {
    updateSettings(settings: PluginSettings): void;
    getState(): Promise<MyDayState>;
    addTask(blockId: string): Promise<MyDayState>;
    removeTask(blockId: string): Promise<MyDayState>;
    reorderTask(blockId: string, afterId?: string): Promise<MyDayState>;
    setSchedule(blockId: string, start: number | null, end: number | null): Promise<MyDayState>;
    removeSchedule(blockId: string): Promise<MyDayState>;
    markTaskCompleted(blockId: string, completedAt: number): Promise<MyDayState>;
    clearTaskCompleted(blockId: string): Promise<MyDayState>;
}

export class TaskService {
    private cacheManager: CacheManager;
    private mutex: Mutex;
    private syncEngine: TaskChangePublisher;
    private myDayManager: MyDayTaskPort;
    private isReady: boolean;
    private settings: PluginSettings;

    constructor(
        cacheManager: CacheManager,
        mutex: Mutex,
        syncEngine: TaskChangePublisher,
        myDayManager: MyDayTaskPort,
        private readonly api: SiyuanApiPort,
    ) {
        this.cacheManager = cacheManager;
        this.mutex = mutex;
        this.syncEngine = syncEngine;
        this.myDayManager = myDayManager;
        this.isReady = false;
        this.settings = { ...DEFAULT_SETTINGS };
    }

    setIsReady(val: boolean): void {
        this.isReady = val;
    }

    assertReady(): void {
        this.checkReady();
    }

    private checkReady(): void {
        if (!this.isReady) {
            const err: any = new Error("Task service is not ready");
            err.code = RPC_ERROR_NOT_READY;
            throw err;
        }
    }

    private async acquireWithTimeout(): Promise<{ release: () => void }> {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const { promise: acquirePromise, cancel: cancelAcquire } = this.mutex.acquire();
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                const err: any = new Error("Write lock timeout");
                err.code = RPC_ERROR_TIMEOUT;
                reject(err);
            }, WRITE_LOCK_TIMEOUT_MS);
        });
        try {
            const lock = await Promise.race([acquirePromise, timeoutPromise]);
            if (timeoutId !== null) clearTimeout(timeoutId);
            return lock;
        } catch (e) {
            if (timeoutId !== null) clearTimeout(timeoutId);
            // Cancel the pending acquire. If the lock was already handed to us
            // (resolve called before we could cancel), release it immediately.
            cancelAcquire();
            acquirePromise.then(lock => lock.release(), () => {});
            throw e;
        }
    }

    private cacheWithRecalculatedOrder(entry: TaskCacheEntry): void {
        entry.order = calculateOrder(entry, this.cacheManager.getCache());
        this.cacheManager.set(entry);
        if (!entry.parentId) return;
        const parentEntry = this.cacheManager.get(entry.parentId);
        if (parentEntry?.taskType === "2") {
            parentEntry.order = calculateOrder(parentEntry, this.cacheManager.getCache());
        }
    }

    private async getBlockType(blockId: string, waitForIndex = false): Promise<string> {
        const attempts = waitForIndex ? 20 : 1;
        for (let attempt = 0; attempt < attempts; attempt++) {
            const rows = await this.api.query<{ type?: string }>(
                sql`SELECT type FROM blocks WHERE id = ${blockId} LIMIT 1`,
            );
            const blockType = rows?.[0]?.type || "";
            if (blockType || attempt === attempts - 1) return blockType;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return "";
    }

    private assertProjectBlockType(taskType: string, blockType: string): void {
        if (taskType === "2" && blockType !== "d") {
            const err: any = new Error("errProjectRequiresDocument");
            err.code = RPC_ERROR_PROJECT_REQUIRES_DOCUMENT;
            throw err;
        }
    }

    private assertTaskAttributeBlockType(blockType: string): void {
        if (blockType !== "p" && blockType !== "h" && blockType !== "d") {
            const err: any = new Error("errNotTextBlock");
            err.code = RPC_ERROR_NOT_TEXT_BLOCK;
            throw err;
        }
    }

    /**
     * Resolve a logical list item to the text block that may carry task attrs.
     * Lists and other non-text blocks remain unsupported because they may contain
     * multiple or no text blocks and therefore have no unambiguous task identity.
     */
    private async resolveTaskAttributeBlock(blockId: string): Promise<{ id: string; type: string }> {
        const blockType = await this.getBlockType(blockId);
        if (blockType === "p" || blockType === "h" || blockType === "d") {
            return { id: blockId, type: blockType };
        }
        if (blockType === "i") {
            const children = await this.api.request<Array<{ id?: string; type?: string }>>("/api/block/getChildBlocks", { id: blockId });
            const textChild = Array.isArray(children)
                ? children.find(child => child?.id && (child.type === "p" || child.type === "h"))
                : undefined;
            if (textChild?.id && textChild.type) return { id: textChild.id, type: textChild.type };
        }
        this.assertTaskAttributeBlockType(blockType);
        return { id: blockId, type: blockType };
    }

    // ---- Write operations ----

    async convertToTask(
        blockId: string,
        cleanTitle?: string,
        taskType: string = "1",
        options: ConvertToTaskOptions = {},
    ): Promise<TaskCacheEntry> {
        blockId = assertBlockId(blockId);
        if (options.parentIdHint) assertBlockId(options.parentIdHint, "parentIdHint");
        this.checkReady();

        if (taskType !== "1" && taskType !== "2") {
            const err: any = new Error("Invalid task type: " + taskType);
            err.code = RPC_ERROR_INVALID_PARAMS;
            throw err;
        }

        // Newly inserted blocks are already present in SiYuan's block tree when
        // appendBlock returns. Their SQL index may lag behind, so trusted callers
        // provide the verified inserted type. Other callers resolve list items to
        // their direct text child and reject all remaining non-text block types.
        let blockType = "";
        if (taskType === "2" && options.knownTextBlock) {
            blockType = await this.getBlockType(blockId);
            this.assertTaskAttributeBlockType(blockType);
        } else if (options.knownTextBlock) {
            blockType = options.knownTextBlockType || "p";
            this.assertTaskAttributeBlockType(blockType);
        } else {
            const target = await this.resolveTaskAttributeBlock(blockId);
            blockId = target.id;
            blockType = target.type;
        }
        this.assertProjectBlockType(taskType, blockType);

        // A caller-provided title is authoritative and avoids an unnecessary SQL
        // read for blocks that were just inserted.
        const title = cleanTitle || await this.fetchBlockTitle(blockId);

        // Check if already a task
        const existingAttrs = await this.api.getBlockAttrs(blockId);
        const hintedParentId = options.parentIdHint
            ? await this.findTaskParentHint(options.parentIdHint, blockId)
            : "";

        if (existingAttrs[ATTR_TASK] && existingAttrs[ATTR_TASK] !== "") {
            const lock = await this.acquireWithTimeout();
            try {
                // Already a task — update task type if it differs (e.g. task → project)
                const currentType = existingAttrs[ATTR_TASK];
                if (taskType !== currentType) {
                    await this.api.setBlockAttrs(blockId, { [ATTR_TASK]: taskType });
                    existingAttrs[ATTR_TASK] = taskType;
                }

                // Ensure na-parent is set correctly
                const cached = this.cacheManager.get(blockId);
                const existingParent = existingAttrs[ATTR_PARENT] || (cached ? cached.parentId : "");

                if (!existingParent) {
                    // Parent not set, try to find ancestor task
                    let ancestorId = "";
                    try {
                        ancestorId = hintedParentId || await this.findAncestorTask(blockId);
                    } catch (_e: any) { /* ignore */ }

                    if (ancestorId) {
                        await this.api.setBlockAttrs(blockId, { [ATTR_PARENT]: ancestorId });
                        existingAttrs[ATTR_PARENT] = ancestorId;
                    }
                }

                if (cached) {
                    if (!cached.title && title) {
                        cached.title = title;
                    }
                    if (existingAttrs[ATTR_PARENT] && cached.parentId !== existingAttrs[ATTR_PARENT]) {
                        const oldParentId = cached.parentId;
                        // Remove from old parent's childIds
                        if (oldParentId) {
                            const oldParent = this.cacheManager.get(oldParentId);
                            if (oldParent) {
                                const idx = oldParent.childIds.indexOf(blockId);
                                if (idx !== -1) {
                                    oldParent.childIds.splice(idx, 1);
                                }
                            }
                        }
                        // Assign new parentId
                        cached.parentId = existingAttrs[ATTR_PARENT];
                        // Add to new parent's childIds
                        const newParent = this.cacheManager.get(existingAttrs[ATTR_PARENT]);
                        if (newParent && newParent.childIds.indexOf(blockId) === -1) {
                            newParent.childIds.push(blockId);
                        }
                        // Broadcast na-parent change
                        this.syncEngine.addPendingChange(blockId, "update");
                        this.syncEngine.broadcastChanges();
                    }
                    if (taskType !== currentType) {
                        cached.taskType = taskType;
                        this.syncEngine.addPendingChange(blockId, "update");
                        this.syncEngine.broadcastChanges();
                    }
                    return cached;
                }

                // Not in cache (e.g. missed by sync), build and store
                const entry = this.buildEntryFromAttrs(blockId, existingAttrs);
                entry.title = title;
                this.cacheManager.set(entry);
                this.syncEngine.addPendingChange(blockId, "create");
                this.syncEngine.broadcastChanges();
                return entry;
            } finally {
                lock.release();
            }
        }

        const lock = await this.acquireWithTimeout();
        try {
            // Set default task attributes
            const defaultAttrs: Record<string, string> = {};
            defaultAttrs[ATTR_TASK] = taskType;
            defaultAttrs[ATTR_STATUS] = "inbox";
            defaultAttrs[ATTR_PRIORITY] = "medium";
            defaultAttrs[ATTR_IMPORTANCE] = numberToAttr(this.settings.defaultImportance);
            defaultAttrs[ATTR_EFFORT] = numberToAttr(this.settings.defaultEffort);
            defaultAttrs[ATTR_CREATED] = new Date().toISOString().slice(0, 19);
            if (this.settings.semanticDateParsingEnabled) {
                const parsedDates = parseTaskTitleDates(title, new Date());
                if (!existingAttrs[ATTR_START] && parsedDates.start) defaultAttrs[ATTR_START] = parsedDates.start.value;
                if (!existingAttrs[ATTR_DUE] && parsedDates.due) defaultAttrs[ATTR_DUE] = parsedDates.due.value;
            }

            await this.api.setBlockAttrs(blockId, defaultAttrs);

            // Find ancestor task to set na-parent
            let parentTaskId = "";
            try {
                parentTaskId = hintedParentId || await this.findAncestorTask(blockId);
            } catch (_e: any) {
                // Ignore errors in finding ancestor
            }

            if (parentTaskId !== "") {
                await this.api.setBlockAttrs(blockId, { [ATTR_PARENT]: parentTaskId });

                // 设置默认 na-sort：排在父任务下现有子任务末尾
                const siblings = this.cacheManager.getByParent(parentTaskId);
                const maxSort = siblings.reduce((max, s) => Math.max(max, s.sort), -1);
                await this.api.setBlockAttrs(blockId, { [ATTR_SORT]: String(maxSort < 0 ? 0 : maxSort + 10000) });
            }

            // Find descendant tasks and update their na-parent
            try {
                await this.updateDescendantParents(blockId);
            } catch (_e: any) {
                // Ignore errors in updating descendants
            }

            // Re-fetch attrs after all updates
            const finalAttrs = await this.api.getBlockAttrs(blockId);

            const entry = this.buildEntryFromAttrs(blockId, finalAttrs);
            entry.title = title;
            entry.order = calculateOrder(entry, this.cacheManager.getCache());
            this.cacheManager.set(entry);
            this.cacheManager.recalcBlockedStatus();

            this.syncEngine.addPendingChange(blockId, "create");
            this.syncEngine.broadcastChanges();

            return entry;
        } finally {
            lock.release();
        }
    }

    /**
     * Convert a block and all descendant paragraphs in its list subtree to tasks.
     * Only paragraph blocks (type="p") are converted — list items and list containers
     * are skipped. Paragraphs that are already tasks are left unchanged.
     * Parent relationships are derived from the list nesting hierarchy.
     */
    async convertToTaskWithChildren(blockId: string, cleanTitle?: string, taskType: string = "1"): Promise<{ converted: number; skipped: number }> {
        blockId = assertBlockId(blockId);
        this.checkReady();

        if (taskType !== "1" && taskType !== "2") {
            const err: any = new Error("Invalid task type: " + taskType);
            err.code = RPC_ERROR_INVALID_PARAMS;
            throw err;
        }

        // This endpoint converts a subtree into ordinary tasks. Projects have
        // a separate single-document conversion path and must not be created
        // implicitly on descendant paragraph blocks.
        if (taskType === "2") {
            const err: any = new Error("errProjectRequiresDocument");
            err.code = RPC_ERROR_PROJECT_REQUIRES_DOCUMENT;
            throw err;
        }

        // Determine the root container for subtree collection.
        // If blockId itself is a list item, use it directly.
        // If blockId is a paragraph inside a list item, find the containing list item.
        // If blockId is a list block, use it as the container but only convert
        // descendant paragraphs. List/list-item blocks must not receive task attrs.
        // Otherwise, just convert the block itself.
        let rootContainerId = "";
        const blockRows = await this.api.query<{ id: string; type: string }>(
            sql`SELECT id, type FROM blocks WHERE id = ${blockId}`,
        );
        const blockType = (blockRows && blockRows.length > 0) ? blockRows[0].type : "";
        if (blockType === "i") {
            // blockId is a list item — use it as root
            rootContainerId = blockId;
        } else if (blockType === "p") {
            // Paragraph — find its containing list item
            rootContainerId = await this.findParentListItem(blockId);
        } else if (blockType === "l") {
            // List block — collect taskable paragraph descendants below it.
            rootContainerId = blockId;
        }

        // Collect ALL descendant paragraph IDs under the list/list item or document
        let paragraphIds: string[];
        if (rootContainerId) {
            // Direct paragraph children of the container
            const directRows = await this.api.query<{ id: string }>(
                sql`SELECT id FROM blocks WHERE parent_id = ${rootContainerId} AND type = 'p'`,
            );
            // All paragraphs in the full subtree (excluding container blocks)
            const rows = await this.api.query<{ id: string }>(
                sql`WITH RECURSIVE descendants(id, parent_id, type) AS (
                    SELECT id, parent_id, type FROM blocks WHERE parent_id = ${rootContainerId}
                    UNION ALL
                    SELECT b.id, b.parent_id, b.type FROM blocks b INNER JOIN descendants d ON b.parent_id = d.id
                ) SELECT id FROM descendants WHERE type = 'p'`,
            );
            const allIds = new Set((rows || []).map(r => r.id));
            for (const r of (directRows || [])) {
                allIds.add(r.id);
            }
            paragraphIds = [...allIds];
        } else if (blockType === "d") {
            // Document block — collect all paragraphs in the document
            const rootId = blockRows[0].id;
            const rows = await this.api.query<{ id: string }>(
                sql`WITH RECURSIVE descendants(id, parent_id, type) AS (
                    SELECT id, parent_id, type FROM blocks WHERE parent_id = ${rootId}
                    UNION ALL
                    SELECT b.id, b.parent_id, b.type FROM blocks b INNER JOIN descendants d ON b.parent_id = d.id
                ) SELECT id FROM descendants WHERE type = 'p'`,
            );
            paragraphIds = (rows || []).map(r => r.id);
        } else {
            // Not in a list — just convert the block itself (only if it's a paragraph)
            if (blockType === "p") {
                paragraphIds = [blockId];
            } else {
                return { converted: 0, skipped: 0 };
            }
        }

        if (paragraphIds.length === 0) return { converted: 0, skipped: 0 };

        // Batch check which paragraphs are already tasks
        const attrResults = await this.api.batchGetBlockAttrs(paragraphIds);

        const lock = await this.acquireWithTimeout();
        let converted = 0;
        let skipped = 0;
        const semanticDateReference = new Date();

        try {
            for (const pid of paragraphIds) {
                const attrs = attrResults[pid];
                if (attrs && attrs[ATTR_TASK] && attrs[ATTR_TASK] !== "") {
                    skipped++;
                    continue;
                }

                const title = await this.fetchBlockTitle(pid);
                const effectiveTitle = (pid === blockId && cleanTitle) ? cleanTitle : title;

                const defaultAttrs: Record<string, string> = {};
                defaultAttrs[ATTR_TASK] = taskType;
                defaultAttrs[ATTR_STATUS] = "inbox";
                defaultAttrs[ATTR_PRIORITY] = "medium";
                defaultAttrs[ATTR_IMPORTANCE] = numberToAttr(this.settings.defaultImportance);
                defaultAttrs[ATTR_EFFORT] = numberToAttr(this.settings.defaultEffort);
                defaultAttrs[ATTR_CREATED] = new Date().toISOString().slice(0, 19);
                if (this.settings.semanticDateParsingEnabled) {
                    const parsedDates = parseTaskTitleDates(effectiveTitle, semanticDateReference);
                    if (!attrs?.[ATTR_START] && parsedDates.start) defaultAttrs[ATTR_START] = parsedDates.start.value;
                    if (!attrs?.[ATTR_DUE] && parsedDates.due) defaultAttrs[ATTR_DUE] = parsedDates.due.value;
                }

                let parentTaskId = "";
                try {
                    parentTaskId = await this.findAncestorTask(pid);
                } catch (_e: any) { /* ignore */ }

                if (parentTaskId !== "") {
                    defaultAttrs[ATTR_PARENT] = parentTaskId;
                    const siblings = this.cacheManager.getByParent(parentTaskId);
                    const maxSort = siblings.reduce((max, s) => Math.max(max, s.sort), -1);
                    defaultAttrs[ATTR_SORT] = String(maxSort < 0 ? 0 : maxSort + 10000);
                }

                await this.api.setBlockAttrs(pid, defaultAttrs);

                try {
                    await this.updateDescendantParents(pid);
                } catch (_e: any) { /* ignore */ }

                const finalAttrs = await this.api.getBlockAttrs(pid);
                const entry = this.buildEntryFromAttrs(pid, finalAttrs);
                entry.title = effectiveTitle;
                entry.order = calculateOrder(entry, this.cacheManager.getCache());
                this.cacheManager.set(entry);

                this.syncEngine.addPendingChange(pid, "create");
                converted++;
            }

            if (converted > 0) {
                this.cacheManager.recalcBlockedStatus();
                this.syncEngine.broadcastChanges();
            }
        } finally {
            lock.release();
        }

        return { converted, skipped };
    }

    async removeTask(blockId: string): Promise<void> {
        blockId = assertBlockId(blockId);
        this.checkReady();

        const entry = this.cacheManager.get(blockId);
        if (!entry) {
            const err: any = new Error("Task not found: " + blockId);
            err.code = RPC_ERROR_TASK_NOT_FOUND;
            throw err;
        }

        const lock = await this.acquireWithTimeout();
        try {
            // Re-point child tasks' na-parent to this entry's parentId
            const grandParentId = entry.parentId;
            for (let i = 0; i < entry.childIds.length; i++) {
                const childId = entry.childIds[i];
                try {
                    await this.api.setBlockAttrs(childId, { [ATTR_PARENT]: grandParentId || "" });

                    // Update cache for child
                    const childEntry = this.cacheManager.get(childId);
                    if (childEntry) {
                        childEntry.parentId = grandParentId;
                        // Update grandparent's childIds
                        if (grandParentId !== "") {
                            const gp = this.cacheManager.get(grandParentId);
                            if (gp && gp.childIds.indexOf(childId) === -1) {
                                gp.childIds.push(childId);
                            } else if (!gp) {
                                void this.api.log("warn", `removeTask: grandparent ${grandParentId} not in cache, child ${childId} parentId points to non-cached entry`);
                            }
                        }
                        this.syncEngine.addPendingChange(childId, "update");
                    }
                } catch (_e: any) {
                    // Continue with other children even if one fails
                }
            }

            // Clear all na-* attributes on the block
            const clearAttrs: Record<string, string> = {};
            clearAttrs[ATTR_TASK] = "";
            clearAttrs[ATTR_STATUS] = "";
            clearAttrs[ATTR_PRIORITY] = "";
            clearAttrs[ATTR_IMPORTANCE] = "";
            clearAttrs[ATTR_EFFORT] = "";
            clearAttrs[ATTR_DUE] = "";
            clearAttrs[ATTR_START] = "";
            clearAttrs[ATTR_CONTEXT] = "";
            clearAttrs[ATTR_PARENT] = "";
            clearAttrs[ATTR_DEPENDS] = "";
            clearAttrs[ATTR_DEP_MODE] = "";
            clearAttrs[ATTR_SEQUENTIAL] = "";
            clearAttrs[ATTR_REPEAT] = "";
            clearAttrs[ATTR_REPEAT_STATE] = "";
            clearAttrs[ATTR_SORT] = "";
            clearAttrs[ATTR_COMPLETED] = "";
            clearAttrs[ATTR_NOTE] = "";
            clearAttrs[ATTR_CREATED] = "";
            clearAttrs[ATTR_TAGS] = "";
            clearAttrs[ATTR_REVIEW_INTERVAL] = "";
            clearAttrs[ATTR_REVIEW_DATE] = "";
            clearAttrs[ATTR_REMINDER] = "";

            // Clear custom extension fields
            if (entry.customFields) {
                for (const fieldKey of Object.keys(entry.customFields)) {
                    clearAttrs[ATTR_EXT_PREFIX + fieldKey] = "";
                }
            }

            await this.api.setBlockAttrs(blockId, clearAttrs);
            const confirmedAttrs = await this.api.getBlockAttrs(blockId);
            if (confirmedAttrs[ATTR_TASK]) {
                throw new Error(`Failed to clear task attributes for ${blockId}`);
            }

            // Remove from My Day if present
            try {
                await this.myDayManager.removeTask(blockId);
            } catch (e: any) {
                void this.api.log("warn", `removeTask: failed to remove from MyDay: ${e.message || e}`);
            }

            // Remove from cache
            this.cacheManager.remove(blockId);
            this.cacheManager.recalcBlockedStatus();

            this.syncEngine.addPendingChange(blockId, "delete");
            this.syncEngine.broadcastChanges();
        } finally {
            lock.release();
        }
    }

    async updateTask(blockId: string, rawAttrs: Record<string, string>): Promise<TaskCacheEntry> {
        blockId = assertBlockId(blockId);

        // Normalize na-* keys to custom-na-* for convenience
        const attrs: Record<string, string> = {};
        for (const key of Object.keys(rawAttrs)) {
            if (key.startsWith("na-") && !key.startsWith("custom-")) {
                attrs["custom-" + key] = rawAttrs[key];
            } else {
                attrs[key] = rawAttrs[key];
            }
        }
        const validationError = validateTaskAttrs(attrs);
        if (validationError) {
            const err: any = new Error(validationError);
            err.code = RPC_ERROR_INVALID_PARAMS;
            throw err;
        }

        if (attrs[ATTR_TASK] !== undefined && attrs[ATTR_TASK] !== "" && attrs[ATTR_TASK] !== "1" && attrs[ATTR_TASK] !== "2") {
            const err: any = new Error("Invalid task type: " + attrs[ATTR_TASK]);
            err.code = RPC_ERROR_INVALID_PARAMS;
            throw err;
        }

        this.checkReady();
        const cachedTask = this.cacheManager.get(blockId);
        // The editor can issue a write before the incremental cache catches up.
        // In that window an existing task is still a valid update target even
        // though it is not present in the cache yet. Read the authoritative
        // attributes before rejecting the block based on the eventually-
        // consistent SQL type index.
        let existingAttrsForValidation: Record<string, string> | null = null;
        if (!cachedTask) {
            existingAttrsForValidation = await this.api.getBlockAttrs(blockId);
        }
        // Cache entries can only come from the filtered p/h/d discovery query or
        // convertToTask's validated target. Reuse that invariant for immediate
        // post-create patches because SiYuan's SQL block index may still lag.
        // Uncached targets and project conversions still require a fresh type check.
        const hasExistingTaskAttrs = !!existingAttrsForValidation?.[ATTR_TASK];
        if (attrs[ATTR_TASK] === "2" || (!cachedTask && !hasExistingTaskAttrs)) {
            const blockType = await this.getBlockType(blockId);
            this.assertTaskAttributeBlockType(blockType);
            if (attrs[ATTR_TASK] === "2") this.assertProjectBlockType("2", blockType);
        }

        // Validate status if provided
        if (attrs[ATTR_STATUS] !== undefined) {
            const statusVal = attrs[ATTR_STATUS];
            let statusValid = false;
            for (let i = 0; i < ALL_STATUSES.length; i++) {
                if (ALL_STATUSES[i] === statusVal) {
                    statusValid = true;
                    break;
                }
            }
            if (!statusValid) {
                const err: any = new Error("Invalid status: " + statusVal);
                err.code = RPC_ERROR_INVALID_PARAMS;
                throw err;
            }
        }

        const customAttrError = this.validateCustomExtensionAttrs(blockId, attrs);
        if (customAttrError) {
            const err: any = new Error(customAttrError);
            err.code = RPC_ERROR_INVALID_PARAMS;
            throw err;
        }

        // 依赖环路检测
        const dependsAttr = attrs[ATTR_DEPENDS];
        if (dependsAttr !== undefined && this.detectDependencyCycle(blockId, dependsAttr)) {
            const err: any = new Error("Dependency cycle detected");
            err.code = RPC_ERROR_DEP_CYCLE;
            throw err;
        }
        // 依赖不能指向父/祖宗任务
        if (dependsAttr !== undefined && this.detectDependencyOnAncestor(blockId, dependsAttr)) {
            const err: any = new Error("Cannot depend on ancestor task");
            err.code = RPC_ERROR_DEP_CYCLE;
            throw err;
        }
        // 顺序约束矛盾检测（警告，不阻止）
        const hasSequentialConflict = dependsAttr !== undefined && this.checkSequentialConflict(blockId, dependsAttr);

        // 开始/截止时间校验：截止时间必须 >= 开始时间
        const dueAttr = attrs[ATTR_DUE];
        const startAttr = attrs[ATTR_START];
        if (dueAttr !== undefined || startAttr !== undefined) {
            const existing = this.cacheManager.get(blockId);
            const effectiveStart = startAttr !== undefined ? startAttr : (existing?.start || "");
            const effectiveDue = dueAttr !== undefined ? dueAttr : (existing?.due || "");
            if (effectiveStart && effectiveDue) {
                const startDate = new Date(effectiveStart.includes("T") ? effectiveStart : effectiveStart + "T00:00");
                const dueDate = new Date(effectiveDue.includes("T") ? effectiveDue : effectiveDue + "T23:59");
                if (dueDate < startDate) {
                    const err: any = new Error("Due date must not be earlier than start date");
                    err.code = RPC_ERROR_INVALID_PARAMS;
                    throw err;
                }
            }
        }

        // na-repeat 写入验证
        const repeatAttr = attrs[ATTR_REPEAT];
        if (repeatAttr !== undefined && repeatAttr !== "") {
            if (!parseRepeatRule(repeatAttr)) {
                const err: any = new Error("Invalid repeat rule");
                err.code = RPC_ERROR_INVALID_PARAMS;
                throw err;
            }
        } else if (repeatAttr === "") {
            attrs[ATTR_REPEAT_STATE] = "";
        }

        const lock = await this.acquireWithTimeout();
        try {
            const previousEntry = this.cacheManager.get(blockId);
            let preparedRepeat: { rule: RepeatRuleV2; state: RepeatStateV1 } | null = null;
            if (attrs[ATTR_STATUS] === "done" && previousEntry && previousEntry.status !== "done") {
                const effectiveRepeat = repeatAttr !== undefined ? repeatAttr : previousEntry.repeat;
                if (effectiveRepeat) {
                    const rule = parseRepeatRule(effectiveRepeat);
                    if (!rule) {
                        const err: any = new Error("Invalid repeat rule");
                        err.code = RPC_ERROR_INVALID_PARAMS;
                        throw err;
                    }
                    const effectiveStart = attrs[ATTR_START] !== undefined ? attrs[ATTR_START] : previousEntry.start;
                    const effectiveDue = attrs[ATTR_DUE] !== undefined ? attrs[ATTR_DUE] : previousEntry.due;
                    const state = parseRepeatState(previousEntry.repeatState) || createRepeatState(rule, effectiveStart, effectiveDue);
                    if (!state) {
                        const err: any = new Error("Repeat task requires a start or due date");
                        err.code = RPC_ERROR_INVALID_PARAMS;
                        throw err;
                    }
                    preparedRepeat = { rule, state };
                }
            }

            // Circular reference detection for na-parent changes
            if (attrs[ATTR_PARENT] !== undefined) {
                const newParentId = attrs[ATTR_PARENT];
                if (newParentId !== "") {
                    let currentId = newParentId;
                    let depth = 0;
                    while (currentId !== "" && depth < 100) {
                        if (currentId === blockId) {
                            const err: any = new Error("Circular reference detected");
                            err.code = RPC_ERROR_CIRCULAR_REF;
                            throw err;
                        }
                        const parentEntry = this.cacheManager.get(currentId);
                        if (!parentEntry) {
                            void this.api.log("warn", `Circular ref check: parent ${currentId} not in cache, skipping`);
                            break;
                        }
                        currentId = parentEntry.parentId;
                        depth++;
                    }
                }
            }

            // Update attributes in SiYuan
            await this.api.setBlockAttrs(blockId, attrs);

            // 自动追加完成时间：status 变为 done 时（不是已经是 done）
            let existing = previousEntry;
            if (attrs[ATTR_STATUS] === "done" && existing && existing.status !== "done") {
                const existingCompleted = existing.completed || "";
                const completedAt = Date.now();
                const now = new Date(completedAt).toISOString().slice(0, 19); // YYYY-MM-DDTHH:mm:ss UTC
                const newCompleted = existingCompleted ? existingCompleted + "|" + now : now;
                await this.api.setBlockAttrs(blockId, { [ATTR_COMPLETED]: newCompleted });
                try {
                    await this.myDayManager.markTaskCompleted(blockId, completedAt);
                } catch (e: any) {
                    void this.api.log("warn", `updateTask: failed to mark My Day completion: ${e.message || e}`);
                }
            } else if (attrs[ATTR_STATUS] !== undefined && attrs[ATTR_STATUS] !== "done") {
                try {
                    await this.myDayManager.clearTaskCompleted(blockId);
                } catch (e: any) {
                    void this.api.log("warn", `updateTask: failed to clear My Day completion: ${e.message || e}`);
                }
            }

            // Re-fetch full attrs
            const fullAttrs = await this.api.getBlockAttrs(blockId);

            // Build updated entry
            existing = this.cacheManager.get(blockId);
            const entry = this.buildEntryFromAttrs(blockId, fullAttrs, existing);

            // Fill missing title
            if (!entry.title) {
                entry.title = await this.fetchBlockTitle(blockId);
            }

            // Check if order-impacting fields changed
            const orderFields = [ATTR_IMPORTANCE, ATTR_EFFORT, ATTR_PRIORITY, ATTR_DUE, ATTR_START, ATTR_STATUS];
            let needRecalcOrder = false;
            for (let i = 0; i < orderFields.length; i++) {
                if (attrs[orderFields[i]] !== undefined) {
                    needRecalcOrder = true;
                    break;
                }
            }
            if (needRecalcOrder || !existing) {
                entry.order = calculateOrder(entry, this.cacheManager.getCache());
            }

            this.cacheManager.set(entry);

            // Recalculate parent project order (propagation) when child order may have changed
            if (entry.parentId !== "" && needRecalcOrder) {
                const parentEntry = this.cacheManager.get(entry.parentId);
                if (parentEntry && parentEntry.taskType === "2") {
                    parentEntry.order = calculateOrder(parentEntry, this.cacheManager.getCache());
                }
            }

            // 循环/重复任务：完成当前发生后推进轻量状态，不生成新块。
            const updatedEntry = this.cacheManager.get(blockId);
            if (updatedEntry && preparedRepeat) {
                const advanced = advanceRepeatState(preparedRepeat.rule, preparedRepeat.state, localActionDate(), "complete");
                const repeatAttrs: Record<string, string> = {
                    [ATTR_REPEAT_STATE]: JSON.stringify(advanced.state),
                };

                if (!advanced.ended && advanced.state.status === "active") {
                    repeatAttrs[ATTR_STATUS] = "todo";
                    if (advanced.state.currentDue) repeatAttrs[ATTR_DUE] = advanced.state.currentDue;
                    if (advanced.state.currentStart) repeatAttrs[ATTR_START] = advanced.state.currentStart;
                }

                await this.api.setBlockAttrs(blockId, repeatAttrs);
                if (!advanced.ended && advanced.state.status === "active") {
                    try {
                        await this.myDayManager.clearTaskCompleted(blockId);
                    } catch (e: any) {
                        void this.api.log("warn", `updateTask: failed to clear My Day completion after repeat advancement: ${e.message || e}`);
                    }
                }
                const finalAttrs = await this.api.getBlockAttrs(blockId);
                const finalEntry = this.buildEntryFromAttrs(blockId, finalAttrs, updatedEntry);
                this.cacheWithRecalculatedOrder(finalEntry);
            }

            // 回顾日期推算：status 变为 done 且有 review-interval 时，自动推算下次 review-date
            if (attrs[ATTR_STATUS] === "done" && updatedEntry && updatedEntry.reviewInterval > 0) {
                const td3 = new Date();
                const today = `${td3.getFullYear()}-${String(td3.getMonth() + 1).padStart(2, "0")}-${String(td3.getDate()).padStart(2, "0")}`;
                const nextReviewDate = this.addDays(today, updatedEntry.reviewInterval);
                await this.api.setBlockAttrs(blockId, { [ATTR_REVIEW_DATE]: nextReviewDate });
                const reviewAttrs = await this.api.getBlockAttrs(blockId);
                const reviewEntry = this.buildEntryFromAttrs(blockId, reviewAttrs, this.cacheManager.get(blockId)!);
                this.cacheManager.set(reviewEntry);
            }

            this.cacheManager.recalcBlockedStatus();
            this.syncEngine.addPendingChange(blockId, "update");

            // Broadcast entries whose blocked status changed as a side-effect of this update.
            const broadcastEntry = this.cacheManager.get(blockId);
            const affectedIds = getSequentialBroadcastIds(
                blockId, attrs, broadcastEntry ?? null, previousEntry ?? null, this.cacheManager.getCache(),
            );
            for (let i = 0; i < affectedIds.length; i++) {
                this.syncEngine.addPendingChange(affectedIds[i], "update");
            }

            this.syncEngine.broadcastChanges();

            const result = this.cacheManager.get(blockId)!;
            if (hasSequentialConflict) {
                return { ...result, _warning: "sequentialConflict" };
            }
            return result;
        } finally {
            lock.release();
        }
    }

    async updateTaskTitle(blockId: string, rawTitle: string): Promise<TaskCacheEntry> {
        blockId = assertBlockId(blockId);
        const title = typeof rawTitle === "string" ? rawTitle.replace(/[\r\n]+/g, " ").trim() : "";
        if (!title || title.length > 512) {
            const err: any = new Error("title must contain 1-512 characters");
            err.code = RPC_ERROR_INVALID_PARAMS;
            throw err;
        }
        this.checkReady();
        const existing = this.cacheManager.get(blockId);
        if (!existing) {
            const err: any = new Error("Task not found: " + blockId);
            err.code = RPC_ERROR_TASK_NOT_FOUND;
            throw err;
        }
        // MCP may rename a task immediately after create_tasks returns, before
        // SiYuan's asynchronous SQL index exposes the newly inserted block.
        const blockType = await this.getBlockType(blockId, true);
        if (blockType !== "p" && blockType !== "h" && blockType !== "d") {
            const err: any = new Error("Only paragraph, heading, or document tasks can be renamed");
            err.code = RPC_ERROR_INVALID_PARAMS;
            throw err;
        }

        const lock = await this.acquireWithTimeout();
        try {
            if (blockType === "d") {
                await this.api.request("/api/filetree/renameDocByID", { id: blockId, title });
            } else {
                const markdown = title.replace(/([\\`*_[\]{}()#+\-.!>|])/g, "\\$1");
                await this.api.request("/api/block/updateBlock", { id: blockId, dataType: "markdown", data: markdown });
            }
            existing.title = title;
            this.syncEngine.addPendingChange(blockId, "update");
            this.syncEngine.broadcastChanges();
            return existing;
        } finally {
            lock.release();
        }
    }

    async setRepeatRule(blockId: string, rawRule: unknown): Promise<TaskCacheEntry> {
        blockId = assertBlockId(blockId);
        const rule = normalizeRepeatRule(rawRule);
        if (!rule) {
            const err: any = new Error("Invalid repeat rule");
            err.code = RPC_ERROR_INVALID_PARAMS;
            throw err;
        }
        this.checkReady();

        const lock = await this.acquireWithTimeout();
        try {
            const entry = this.cacheManager.get(blockId);
            if (!entry) {
                const err: any = new Error("Task not found");
                err.code = RPC_ERROR_TASK_NOT_FOUND;
                throw err;
            }
            const state = createRepeatState(rule, entry.start, entry.due);
            if (!state) {
                const err: any = new Error("Repeat task requires a start or due date");
                err.code = RPC_ERROR_INVALID_PARAMS;
                throw err;
            }

            const attrs: Record<string, string> = {
                [ATTR_REPEAT]: JSON.stringify(rule),
                [ATTR_REPEAT_STATE]: JSON.stringify(state),
            };
            if (entry.status === "done") attrs[ATTR_STATUS] = "todo";
            await this.api.setBlockAttrs(blockId, attrs);

            const finalAttrs = await this.api.getBlockAttrs(blockId);
            const finalEntry = this.buildEntryFromAttrs(blockId, finalAttrs, entry);
            this.cacheWithRecalculatedOrder(finalEntry);
            this.cacheManager.recalcBlockedStatus();
            this.syncEngine.addPendingChange(blockId, "update");
            this.syncEngine.broadcastChanges();
            return finalEntry;
        } finally {
            lock.release();
        }
    }

    async skipRepeatOccurrence(blockId: string): Promise<TaskCacheEntry> {
        blockId = assertBlockId(blockId);
        this.checkReady();

        const lock = await this.acquireWithTimeout();
        try {
            const entry = this.cacheManager.get(blockId);
            if (!entry) {
                const err: any = new Error("Task not found");
                err.code = RPC_ERROR_TASK_NOT_FOUND;
                throw err;
            }
            const rule = parseRepeatRule(entry.repeat);
            const state = rule && (parseRepeatState(entry.repeatState) || createRepeatState(rule, entry.start, entry.due));
            if (!rule || !state) {
                const err: any = new Error("Invalid repeat rule or state");
                err.code = RPC_ERROR_INVALID_PARAMS;
                throw err;
            }
            if (state.status !== "active") {
                const err: any = new Error(state.status === "paused" ? "Repeat series is paused" : "Repeat series has ended");
                err.code = RPC_ERROR_INVALID_PARAMS;
                throw err;
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
            await this.api.setBlockAttrs(blockId, attrs);
            try {
                await this.myDayManager.clearTaskCompleted(blockId);
            } catch (e: any) {
                void this.api.log("warn", `skipRepeatOccurrence: failed to clear My Day completion: ${e.message || e}`);
            }

            const finalAttrs = await this.api.getBlockAttrs(blockId);
            const finalEntry = this.buildEntryFromAttrs(blockId, finalAttrs, entry);
            this.cacheWithRecalculatedOrder(finalEntry);
            this.cacheManager.recalcBlockedStatus();
            this.syncEngine.addPendingChange(blockId, "update");
            this.syncEngine.broadcastChanges();
            return finalEntry;
        } finally {
            lock.release();
        }
    }

    async setRepeatPaused(blockId: string, paused: boolean): Promise<TaskCacheEntry> {
        blockId = assertBlockId(blockId);
        if (typeof paused !== "boolean") {
            const err: any = new Error("paused is required");
            err.code = RPC_ERROR_INVALID_PARAMS;
            throw err;
        }
        this.checkReady();

        const lock = await this.acquireWithTimeout();
        try {
            const entry = this.cacheManager.get(blockId);
            if (!entry) {
                const err: any = new Error("Task not found");
                err.code = RPC_ERROR_TASK_NOT_FOUND;
                throw err;
            }
            const rule = parseRepeatRule(entry.repeat);
            const state = rule && (parseRepeatState(entry.repeatState) || createRepeatState(rule, entry.start, entry.due));
            if (!rule || !state) {
                const err: any = new Error("Invalid repeat rule or state");
                err.code = RPC_ERROR_INVALID_PARAMS;
                throw err;
            }
            if (!paused && state.status === "ended") {
                const err: any = new Error("Repeat series has ended; edit the rule to restart it");
                err.code = RPC_ERROR_INVALID_PARAMS;
                throw err;
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
            await this.api.setBlockAttrs(blockId, attrs);
            if (!paused && entry.status === "done") {
                try {
                    await this.myDayManager.clearTaskCompleted(blockId);
                } catch (e: any) {
                    void this.api.log("warn", `setRepeatPaused: failed to clear My Day completion: ${e.message || e}`);
                }
            }

            const finalAttrs = await this.api.getBlockAttrs(blockId);
            const finalEntry = this.buildEntryFromAttrs(blockId, finalAttrs, entry);
            this.cacheWithRecalculatedOrder(finalEntry);
            this.cacheManager.recalcBlockedStatus();
            this.syncEngine.addPendingChange(blockId, "update");
            this.syncEngine.broadcastChanges();
            return finalEntry;
        } finally {
            lock.release();
        }
    }

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
            } catch (_e: any) { /* ignore */ }

            const correctParent = ancestorId || "";

            if (entry.parentId === correctParent) continue;

            // Update the block attribute
            await this.api.setBlockAttrs(entry.blockId, { [ATTR_PARENT]: correctParent });

            // Update cache via set() which maintains childIds reverse index.
            // Must create a new object so set() can see the old vs new parentId.
            const updated = Object.assign({}, entry, { parentId: correctParent });
            this.cacheManager.set(updated);
            fixedIds.push(entry.blockId);
            fixed++;

            if ((i + 1) % 20 === 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
        }

        if (fixed > 0) {
            this.cacheManager.recalcBlockedStatus();
            for (const id of fixedIds) {
                this.syncEngine.addPendingChange(id, "update");
            }
            this.syncEngine.broadcastChanges();
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

    async reorderTask(blockId: string, newParentId?: string, afterId?: string): Promise<any> {
        blockId = assertBlockId(blockId);
        if (newParentId) assertBlockId(newParentId, "newParentId");
        if (afterId) assertBlockId(afterId, "afterId");
        if (!this.isReady) return { _rpcError: { code: RPC_ERROR_NOT_READY, message: "Kernel not ready" } };

        const entry = this.cacheManager.get(blockId);
        if (!entry) return { _rpcError: { code: RPC_ERROR_TASK_NOT_FOUND, message: "Task not found" } };

        const parentId = newParentId !== undefined ? newParentId : entry.parentId;

        // 循环引用检测
        if (parentId) {
            let current: string | undefined = parentId;
            const visited = new Set<string>();
            while (current && !visited.has(current)) {
                if (current === blockId) return { _rpcError: { code: RPC_ERROR_CIRCULAR_REF, message: "Circular reference" } };
                visited.add(current);
                const parentEntry = this.cacheManager.get(current);
                current = parentEntry?.parentId;
            }
        }

        // 项目不能成为普通任务的子任务
        if (entry.taskType === "2" && parentId) {
            const parentEntry = this.cacheManager.get(parentId);
            if (parentEntry && parentEntry.taskType === "1") {
                return { _rpcError: { code: RPC_ERROR_INVALID_PARAMS, message: "Project cannot be child of task" } };
            }
        }

        const lock = await this.acquireWithTimeout();
        try {
            // 更新 na-parent
            if (newParentId !== undefined && newParentId !== entry.parentId) {
                await this.api.setBlockAttrs(blockId, { [ATTR_PARENT]: newParentId ?? "" });
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
                await Promise.all(siblings.map(s =>
                    this.api.setBlockAttrs(s.blockId, { [ATTR_SORT]: String(s.sort) }).catch((e: any) => {
                        void this.api.log("warn", `reorderTask: failed to setBlockAttrs for ${s.blockId}: ${e.message || e}`);
                    })
                ));
                // 更新缓存中的 sort
                for (const s of siblings) {
                    const cached = this.cacheManager.get(s.blockId);
                    if (cached) cached.sort = s.sort;
                }
                newSort = insertIndex * step;
            }

            await this.api.setBlockAttrs(blockId, { [ATTR_SORT]: String(newSort) });

            const finalAttrs = await this.api.getBlockAttrs(blockId);
            const finalEntry = this.buildEntryFromAttrs(blockId, finalAttrs, entry);
            this.cacheManager.set(finalEntry);
            this.cacheManager.recalcBlockedStatus();
            this.syncEngine.addPendingChange(blockId, "update");

            // In a sequential parent, reordering changes which siblings are blocked.
            if (parentId) {
                const parentEntry = this.cacheManager.get(parentId);
                if (parentEntry && parentEntry.sequential) {
                    for (let i = 0; i < parentEntry.childIds.length; i++) {
                        if (parentEntry.childIds[i] !== blockId) {
                            this.syncEngine.addPendingChange(parentEntry.childIds[i], "update");
                        }
                    }
                }
            }

            this.syncEngine.broadcastChanges();
            return finalEntry;
        } catch (e: any) {
            return errorToRpcError(e);
        } finally {
            lock.release();
        }
    }

    // ---- Read operations ----

    getTask(blockId: string): TaskCacheEntry | null {
        blockId = assertBlockId(blockId);
        const entry = this.cacheManager.get(blockId);
        return entry || null;
    }

    getNextActions(): TaskCacheEntry[] {
        const allEntries = this.cacheManager.getAll();

        const cacheRecord: Record<string, TaskCacheEntry> = Object.create(null) as Record<string, TaskCacheEntry>;
        for (let i = 0; i < allEntries.length; i++) {
            cacheRecord[allEntries[i].blockId] = allEntries[i];
        }

        const candidates: TaskCacheEntry[] = [];
        for (let i = 0; i < allEntries.length; i++) {
            const entry = allEntries[i];
            if (!isNextActionCandidate(entry, cacheRecord)) continue;
            candidates.push(entry);
        }

        return sortTasks(candidates);
    }

    getAllTasks(filters?: {
        status?: string;
        sortBy?: string;
    }): TaskCacheEntry[] {
        let entries = this.cacheManager.getAll();

        if (filters) {
            if (filters.status) {
                entries = entries.filter((e) => e.status === filters.status);
            }
        }

        // Sort
        if (filters && filters.sortBy) {
            switch (filters.sortBy) {
                case "order":
                    entries = sortTasks(entries);
                    break;
                case "due":
                    entries.sort((a, b) => {
                        if (!a.due && !b.due) return 0;
                        if (!a.due) return 1;
                        if (!b.due) return -1;
                        return a.due.localeCompare(b.due);
                    });
                    break;
                case "importance":
                    entries.sort((a, b) => b.importance - a.importance);
                    break;
                case "priority":
                    entries.sort((a, b) => {
                        const pw = [5, 4, 3, 2, 1];
                        const priorityOrder = ["critical", "high", "medium", "low", "veryLow"];
                        const aPriority = a.priority === "none" ? "veryLow" : a.priority;
                        const bPriority = b.priority === "none" ? "veryLow" : b.priority;
                        const aIdx = priorityOrder.indexOf(aPriority);
                        const bIdx = priorityOrder.indexOf(bPriority);
                        return (pw[bIdx] || 0) - (pw[aIdx] || 0);
                    });
                    break;
                default:
                    entries = sortTasks(entries);
            }
        } else {
            entries = sortTasks(entries);
        }

        return entries;
    }

    getCompletedTasksPage(options: CompletedTasksPageOptions = {}): CompletedTasksPage {
        return paginateCompletedTasks(this.cacheManager.getAll(), options);
    }

    getTasksByParent(parentBlockId: string): TaskCacheEntry[] {
        parentBlockId = assertBlockId(parentBlockId, "parentBlockId");
        return this.cacheManager.getByParent(parentBlockId);
    }

    getDoneTaskCount(): number {
        return this.cacheManager.getAll().filter((e) => e.status === "done").length;
    }

    getProjectReminders(): TaskCacheEntry[] {
        this.checkReady();
        const all = this.cacheManager.getAll();
        return all.filter(entry => {
            if (entry.taskType !== "2") return false;
            if (entry.status === "done") return false;
            if (entry.childIds.length === 0) return false;
            return entry.childIds.every(id => {
                const child = this.cacheManager.get(id);
                return child && child.status === "done";
            });
        });
    }

    async rebuildCache(): Promise<void> {
        await this.cacheManager.rebuild();
    }

    getContexts(): string[] {
        const allEntries = this.cacheManager.getAll();
        const contextSet: Record<string, boolean> = Object.create(null) as Record<string, boolean>;

        for (let i = 0; i < allEntries.length; i++) {
            const entry = allEntries[i];
            if (entry.context) {
                const parts = entry.context.split("|");
                for (let j = 0; j < parts.length; j++) {
                    const ctx = parts[j].trim();
                    if (ctx) {
                        contextSet[ctx] = true;
                    }
                }
            }
        }

        return Object.keys(contextSet);
    }

    getTags(): string[] {
        const allEntries = this.cacheManager.getAll();
        const tagSet: Record<string, boolean> = Object.create(null) as Record<string, boolean>;

        for (let i = 0; i < allEntries.length; i++) {
            const entry = allEntries[i];
            if (entry.tags) {
                const parts = entry.tags.split("|");
                for (let j = 0; j < parts.length; j++) {
                    const tag = parts[j].trim();
                    if (tag) {
                        tagSet[tag] = true;
                    }
                }
            }
        }

        return Object.keys(tagSet);
    }

    updateSettings(partial: Partial<PluginSettings>): PluginSettings | { _rpcError: { code: number; message: string } } {
        const normalized: Partial<PluginSettings> = {
            ...partial,
            customFieldSchemaVersion: 2,
            customFields: partial.customFields ? mergeSettings(DEFAULT_SETTINGS, partial).customFields : partial.customFields,
        };
        const error = validateSettings(normalized);
        if (error) {
            return { _rpcError: { code: RPC_ERROR_INVALID_PARAMS, message: error } };
        }
        this.settings = mergeSettings(this.settings, normalized);
        // Propagate priority engine params
        if (partial.priorityEngine) {
            updatePriorityConfig(partial.priorityEngine);
        }
        this.myDayManager.updateSettings(this.settings);
        return this.settings;
    }

    getSettings(): PluginSettings {
        return this.settings;
    }

    getCustomFieldDiagnostics(): { fields: Array<{ fieldId: string; key: string; status: string; count: number }>; orphans: Array<{ key: string; count: number; sampleBlockIds: string[] }> } {
        const definitions = new Map(this.settings.customFields.map(field => [field.key, field]));
        const counts = new Map<string, number>();
        const orphanSamples = new Map<string, string[]>();
        for (const entry of this.cacheManager.getAll()) {
            for (const key of Object.keys(entry.customFields || {})) {
                if (definitions.has(key)) {
                    counts.set(key, (counts.get(key) || 0) + 1);
                } else {
                    const samples = orphanSamples.get(key) || [];
                    if (samples.length < 5) samples.push(entry.blockId);
                    orphanSamples.set(key, samples);
                }
            }
        }
        return {
            fields: this.settings.customFields.map(field => ({ fieldId: field.id, key: field.key, status: field.status, count: counts.get(field.key) || 0 })),
            orphans: [...orphanSamples.entries()].map(([key, sampleBlockIds]) => ({ key, count: this.cacheManager.getAll().filter(entry => Object.prototype.hasOwnProperty.call(entry.customFields || {}, key)).length, sampleBlockIds })),
        };
    }

    async purgeCustomField(fieldId: string): Promise<{ cleared: number; failedBlockIds: string[] }> {
        const field = this.settings.customFields.find(item => item.id === fieldId);
        if (!field) throw new Error("Custom field not found: " + fieldId);
        if (field.status !== "archived") throw new Error("Only archived custom fields can be purged");
        return this.clearCustomFieldValues(field.key);
    }

    async purgeOrphanCustomField(key: string): Promise<{ cleared: number; failedBlockIds: string[] }> {
        const fieldKey = key?.startsWith(ATTR_EXT_PREFIX) ? key.slice(ATTR_EXT_PREFIX.length) : key;
        if (!fieldKey) throw new Error("key is required");
        return this.clearCustomFieldValues(fieldKey);
    }

    getStatistics(period: "week" | "month" = "week"): StatisticsResult {
        const allEntries = this.cacheManager.getAll();
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

        // === Summary ===
        const tasks = allEntries.filter(e => e.taskType !== "2");
        const total = tasks.length;
        const open = tasks.filter(e => e.status !== "done").length;

        // 逾期未完成：有截止日且截止日 < 今天且未完成
        const overdue = tasks.filter(e => isTaskDueOverdue(e, todayStr)).length;

        const doneCount = total - open;

        // 当前周期边界
        const periodStart = this.getPeriodStart(today, period);
        const periodEnd = this.getPeriodEnd(today, period);

        // 统计本周/月内完成的任务数：优先用 na-completed 时间戳，
        // 仅统计 status=done 的任务，避免历史完成记录干扰
        let completedInPeriod = 0;
        for (let i = 0; i < tasks.length; i++) {
            if (tasks[i].status !== "done") continue;
            const times = this.parseCompletedTimes(tasks[i].completed);
            const hasTimeInPeriod = times.some(t => t >= periodStart && t <= periodEnd);
            if (hasTimeInPeriod) {
                completedInPeriod++;
            } else if (times.length === 0) {
                // na-completed 为空但 status=done（老数据），视为完成
                completedInPeriod++;
            }
        }

        const completionRate = total > 0 ? Math.round((doneCount / total) * 100) : 0;

        // 下一步行动候选数 & 将来/也许任务数
        const nextAction = tasks.filter(e => isNextActionCandidate(e, this.cacheManager.getCache())).length;
        const someday = tasks.filter(e => e.status === "someday").length;

        const summary: StatisticsSummary = { total, open, nextAction, someday, overdue, completedInPeriod, completionRate };

        // === Status Distribution ===
        const statusCounts: Record<string, number> = Object.create(null) as Record<string, number>;
        const statusOrder = ["inbox", "todo", "doing", "waiting", "someday", "done"];
        for (let i = 0; i < statusOrder.length; i++) statusCounts[statusOrder[i]] = 0;
        for (let i = 0; i < tasks.length; i++) {
            const s = tasks[i].status;
            if (statusCounts[s] !== undefined) statusCounts[s]++;
            else statusCounts[s] = 1;
        }
        const statusDistribution = statusOrder.map(s => ({
            key: s,
            count: statusCounts[s] || 0,
            percent: total > 0 ? Math.round(((statusCounts[s] || 0) / total) * 100) / 100 : 0,
        }));

        // === Priority Distribution ===
        const priorityOrder = ["critical", "high", "medium", "low", "veryLow"];
        const priorityCounts: Record<string, number> = Object.create(null) as Record<string, number>;
        for (let i = 0; i < priorityOrder.length; i++) priorityCounts[priorityOrder[i]] = 0;
        for (let i = 0; i < tasks.length; i++) {
            const p = tasks[i].priority === "none" ? "veryLow" : tasks[i].priority;
            if (priorityCounts[p] !== undefined) priorityCounts[p]++;
            else priorityCounts[p] = 1;
        }
        const priorityDistribution = priorityOrder.map(p => ({
            key: p,
            count: priorityCounts[p] || 0,
            percent: total > 0 ? Math.round(((priorityCounts[p] || 0) / total) * 100) / 100 : 0,
        }));

        // === Context Distribution ===
        const contextCounts: Record<string, number> = Object.create(null) as Record<string, number>;
        for (let i = 0; i < tasks.length; i++) {
            const ctx = tasks[i].context;
            if (!ctx) continue;
            const parts = ctx.split("|");
            for (let j = 0; j < parts.length; j++) {
                const c = parts[j].trim();
                if (c) {
                    if (contextCounts[c] !== undefined) contextCounts[c]++;
                    else contextCounts[c] = 1;
                }
            }
        }
        const contextDistribution = Object.keys(contextCounts)
            .map(c => ({ context: c, count: contextCounts[c] }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8);

        // === Project Status Distribution ===
        const projectStatusCounts: Record<string, number> = Object.create(null) as Record<string, number>;
        const projectStatusOrder = ["inbox", "todo", "doing", "waiting", "done"];
        for (let i = 0; i < projectStatusOrder.length; i++) projectStatusCounts[projectStatusOrder[i]] = 0;
        let projectTotal = 0;
        for (let i = 0; i < allEntries.length; i++) {
            const entry = allEntries[i];
            if (entry.taskType !== "2") continue;
            projectTotal++;
            const s = entry.status;
            if (projectStatusCounts[s] !== undefined) projectStatusCounts[s]++;
            else projectStatusCounts[s] = 1;
        }
        const projectStatus = projectStatusOrder.map(s => ({
            status: s,
            count: projectStatusCounts[s] || 0,
            percent: projectTotal > 0 ? Math.round(((projectStatusCounts[s] || 0) / projectTotal) * 100) / 100 : 0,
        }));

        return {
            summary,
            statusDistribution,
            priorityDistribution,
            contextDistribution,
            projectStatus,
        };
    }

    getReviewData(): ReviewData {
        this.checkReady();
        const allEntries = this.cacheManager.getAll();
        const td = new Date();
        const todayStr = `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, "0")}-${String(td.getDate()).padStart(2, "0")}`;
        const cache = this.cacheManager.getCache();

        const overdueTasks: TaskCacheEntry[] = [];
        const nextActions: TaskCacheEntry[] = [];
        const inboxTasks: TaskCacheEntry[] = [];
        const waitingTasks: TaskCacheEntry[] = [];
        const somedayTasks: TaskCacheEntry[] = [];
        const activeProjects: TaskCacheEntry[] = [];
        const reviewDueTasks: TaskCacheEntry[] = [];

        for (let i = 0; i < allEntries.length; i++) {
            const entry = allEntries[i];

            // 回顾到期
            if (isTaskReviewDue(entry, todayStr)) {
                reviewDueTasks.push(entry);
            }

            // 逾期
            if (isTaskDueOverdue(entry, todayStr)) {
                overdueTasks.push(entry);
            }

            // 下一步行动
            if (isNextActionCandidate(entry, cache)) {
                nextActions.push(entry);
            }

            // 等待中
            if (entry.status === "waiting") {
                waitingTasks.push(entry);
            }

            // 收集箱
            if (entry.status === "inbox") {
                inboxTasks.push(entry);
            }

            // 将来/也许
            if (entry.status === "someday") {
                somedayTasks.push(entry);
            }

            // 活跃项目
            if (entry.taskType === "2" && entry.status !== "done" && entry.childIds.some(id => {
                const child = cache[id];
                return child && child.status !== "done";
            })) {
                activeProjects.push(entry);
            }
        }

        return {
            lastReviewAt: this.settings.lastReviewAt,
            overdueTasks,
            nextActions,
            inboxTasks,
            waitingTasks,
            somedayTasks,
            activeProjects,
            reviewDueTasks,
        };
    }

    async markTaskReviewed(blockIds: string[]): Promise<TaskCacheEntry[]> {
        this.checkReady();
        if (!blockIds || blockIds.length === 0) return [];
        blockIds = blockIds.map((blockId, index) => assertBlockId(blockId, `blockIds[${index}]`));

        const lock = await this.acquireWithTimeout();
        try {
            const results: TaskCacheEntry[] = [];
            const td4 = new Date();
            const today = `${td4.getFullYear()}-${String(td4.getMonth() + 1).padStart(2, "0")}-${String(td4.getDate()).padStart(2, "0")}`;

            for (const blockId of blockIds) {
                const entry = this.cacheManager.get(blockId);
                if (!entry || entry.reviewInterval <= 0) continue;

                const nextReviewDate = this.addDays(today, entry.reviewInterval);
                await this.api.setBlockAttrs(blockId, { [ATTR_REVIEW_DATE]: nextReviewDate });

                const finalAttrs = await this.api.getBlockAttrs(blockId);
                const updated = this.buildEntryFromAttrs(blockId, finalAttrs, entry);
                this.cacheManager.set(updated);
                this.syncEngine.addPendingChange(blockId, "update");
                results.push(updated);
            }

            this.syncEngine.broadcastChanges();
            return results;
        } finally {
            lock.release();
        }
    }

    async getMyDay(): Promise<MyDayState> {
        this.checkReady();
        return this.myDayManager.getState();
    }

    async addTaskToMyDay(blockId: string): Promise<MyDayState> {
        blockId = assertBlockId(blockId);
        this.checkReady();
        return this.myDayManager.addTask(blockId);
    }

    async removeTaskFromMyDay(blockId: string): Promise<MyDayState> {
        blockId = assertBlockId(blockId);
        this.checkReady();
        return this.myDayManager.removeTask(blockId);
    }

    async reorderMyDayTask(blockId: string, afterId?: string): Promise<MyDayState> {
        blockId = assertBlockId(blockId);
        if (afterId) assertBlockId(afterId, "afterId");
        this.checkReady();
        return this.myDayManager.reorderTask(blockId, afterId);
    }

    async setMyDaySchedule(blockId: string, start: number | null, end: number | null): Promise<MyDayState> {
        blockId = assertBlockId(blockId);
        this.checkReady();
        return this.myDayManager.setSchedule(blockId, start, end);
    }

    async removeMyDaySchedule(blockId: string): Promise<MyDayState> {
        blockId = assertBlockId(blockId);
        this.checkReady();
        return this.myDayManager.removeSchedule(blockId);
    }

    private parseCompletedTimes(completed: string): string[] {
        if (!completed) return [];
        const parts = completed.split("|");
        const valid: string[] = [];
        for (let i = 0; i < parts.length; i++) {
            const t = parts[i].trim();
            if (t && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(t)) {
                valid.push(t);
            }
        }
        return valid;
    }

    private getPeriodStart(date: Date, period: "week" | "month"): string {
        if (period === "week") {
            const d = new Date(date);
            const day = d.getUTCDay();
            const diff = day === 0 ? 6 : day - 1;
            d.setUTCDate(d.getUTCDate() - diff);
            d.setUTCHours(0, 0, 0, 0);
            return d.toISOString().slice(0, 19);
        } else {
            return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00`;
        }
    }

    private getPeriodEnd(date: Date, period: "week" | "month"): string {
        if (period === "week") {
            const d = new Date(date);
            const day = d.getUTCDay();
            const diff = day === 0 ? 0 : 7 - day;
            d.setUTCDate(d.getUTCDate() + diff);
            d.setUTCHours(23, 59, 59, 0);
            return d.toISOString().slice(0, 19);
        } else {
            const year = date.getUTCFullYear();
            const month = date.getUTCMonth();
            const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
            return `${year}-${String(month + 1).padStart(2, "0")}-${lastDay}T23:59:59`;
        }
    }

    // ---- Helper methods ----

    private detectDependencyCycle(blockId: string, dependsStr: string): boolean {
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

    private detectDependencyOnAncestor(blockId: string, dependsStr: string): boolean {
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

    private checkSequentialConflict(blockId: string, dependsStr: string): boolean {
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

    private async fetchBlockTitle(blockId: string): Promise<string> {
        try {
            const rows = await this.api.query<{ content: string }>(
                sql`SELECT content FROM blocks WHERE id = ${blockId}`,
            );
            if (rows && rows.length > 0 && rows[0].content) {
                let title = rows[0].content.substring(0, 100);
                // Strip slash command text that may not have been synced yet
                title = cleanSlashFromTitle(title);
                return title;
            }
        } catch (_e: any) {
            // Ignore
        }
        return "";
    }

    private validateCustomExtensionAttrs(blockId: string, attrs: Record<string, string>): string | null {
        const extensionKeys = Object.keys(attrs).filter(key => key.startsWith(ATTR_EXT_PREFIX));
        if (extensionKeys.length === 0) return null;
        const entry = this.cacheManager.get(blockId);
        const taskMap = new Map(this.cacheManager.getAll().map(item => [item.blockId, item]));
        for (const key of extensionKeys) {
            const fieldKey = key.slice(ATTR_EXT_PREFIX.length);
            const field = this.settings.customFields.find(item => item.key === fieldKey);
            const rawValue = attrs[key];
            // Empty values are allowed for cleanup, including archived and orphaned fields.
            if (rawValue === "") continue;
            if (!field) return `Unknown custom field: ${fieldKey}`;
            const definitionError = validateCustomFieldDefinition(field);
            if (definitionError) return definitionError;
            if (field.status !== "active") return `Custom field is archived: ${fieldKey}`;
            if (entry && !isCustomFieldApplicable(field, entry, taskMap)) return `Custom field is not applicable to task: ${fieldKey}`;
            try {
                encodeCustomFieldValue(field, rawValue);
            } catch (error: any) {
                return `${fieldKey}: ${error.message || error}`;
            }
        }
        return null;
    }

    private async clearCustomFieldValues(fieldKey: string): Promise<{ cleared: number; failedBlockIds: string[] }> {
        this.checkReady();
        const targets = this.cacheManager.getAll().filter(entry => Object.prototype.hasOwnProperty.call(entry.customFields || {}, fieldKey));
        if (targets.length === 0) return { cleared: 0, failedBlockIds: [] };
        const lock = await this.acquireWithTimeout();
        const failedBlockIds: string[] = [];
        const clearedIds: string[] = [];
        try {
            const blockAttrs = targets.map(entry => ({ id: entry.blockId, attrs: { [ATTR_EXT_PREFIX + fieldKey]: "" } }));
            try {
                await this.api.batchSetBlockAttrs(blockAttrs);
                clearedIds.push(...targets.map(entry => entry.blockId));
            } catch (_batchError: any) {
                // The endpoint is available in current kernels but is not present in all older API documents.
                // Fall back to idempotent single-block writes so partial failures are observable.
                for (const entry of targets) {
                    try {
                        await this.api.setBlockAttrs(entry.blockId, { [ATTR_EXT_PREFIX + fieldKey]: "" });
                        clearedIds.push(entry.blockId);
                    } catch (_singleError: any) {
                        failedBlockIds.push(entry.blockId);
                    }
                }
            }
            for (const blockId of clearedIds) {
                const entry = this.cacheManager.get(blockId);
                if (!entry) continue;
                const next = { ...entry, customFields: { ...entry.customFields } };
                delete next.customFields[fieldKey];
                this.cacheManager.set(next);
                this.syncEngine.addPendingChange(blockId, "update");
            }
            if (clearedIds.length > 0) this.syncEngine.broadcastChanges();
            return { cleared: clearedIds.length, failedBlockIds };
        } finally {
            lock.release();
        }
    }

    private buildEntryFromAttrs(
        blockId: string,
        attrs: Record<string, string>,
        existing?: TaskCacheEntry,
    ): TaskCacheEntry {
        const parentId = attrs[ATTR_PARENT] || "";

        const entry: TaskCacheEntry = {
            blockId: blockId,
            parentId: parentId,
            status: attrs[ATTR_STATUS] || "todo",
            priority: attrs[ATTR_PRIORITY] || "medium",
            importance: attrToNumber(attrs[ATTR_IMPORTANCE], this.settings.defaultImportance),
            effort: attrToNumber(attrs[ATTR_EFFORT], this.settings.defaultEffort),
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
            customFields: this.extractCustomFieldsFromAttrs(attrs),
            blocked: false,
            blockedReason: "",
            taskType: attrs[ATTR_TASK] || "1",
            order: 0,
            childIds: existing ? existing.childIds : [],
            title: existing ? existing.title : "",
        };

        entry.order = calculateOrder(entry, this.cacheManager.getCache());
        return entry;
    }

    private extractCustomFieldsFromAttrs(attrs: Record<string, string>): Record<string, string> {
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

    private async findTaskParentHint(parentId: string, blockId: string): Promise<string> {
        if (!parentId || parentId === blockId) return "";
        const attrs = await this.api.getBlockAttrs(parentId);
        return attrs[ATTR_TASK] ? parentId : "";
    }

    private async findAncestorTask(blockId: string): Promise<string> {
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
        const byId: Record<string, { id: string; parent_id: string; type: string }> = Object.create(null) as any;
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
            const attrs = await this.api.getBlockAttrs(ancestorId);
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
            const attrs = await this.api.getBlockAttrs(rows[i].id);
            if (attrs[ATTR_TASK] && attrs[ATTR_TASK] !== "") {
                return rows[i].id;
            }
        }

        return "";
    }

    private async updateDescendantParents(blockId: string): Promise<void> {
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
                await this.api.setBlockAttrs(childId, { [ATTR_PARENT]: blockId });
                // Update parentId
                childEntry.parentId = blockId;
                // Add to new parent's childIds
                const newParent = this.cacheManager.get(blockId);
                if (newParent && newParent.childIds.indexOf(childId) === -1) {
                    newParent.childIds.push(childId);
                }
                this.syncEngine.addPendingChange(childId, "update");
            }
        }
        this.syncEngine.broadcastChanges();
    }

    private addDays(dateStr: string, days: number): string {
        const d = new Date(dateStr + "T00:00:00");
        d.setDate(d.getDate() + days);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    /**
     * Walk up from a paragraph block to find its containing list item (type="i").
     * Returns the list item blockId, or empty string if not found.
     */
    private async findParentListItem(blockId: string): Promise<string> {
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

        const byId: Record<string, { id: string; parent_id: string; type: string }> = Object.create(null) as any;
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
