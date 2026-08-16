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
    ALL_STATUSES,
    ATTR_EXT_PREFIX,
} from "../shared/constants";
import { type CacheManager } from "./cache-manager";
import { numberToAttr, validateTaskAttrs, cleanSlashFromTitle } from "./utils";
import { assertBlockId } from "../shared/block-id";
import { sql } from "../shared/sql";
import type { SiyuanApiPort } from "./siyuan-api";
import { calculateOrder, isNextActionCandidate, sortTasks, getBlockedReason, getSequentialBroadcastIds } from "./priority-engine";
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
import { encodeCustomFieldValue, isCustomFieldApplicable, validateCustomFieldDefinition, type CustomFieldDef } from "../shared/custom-fields";
import { parseTaskTitleDates } from "../shared/natural-date";
import { isTaskDueOverdue, isTaskReviewDue, localDateString } from "../shared/review";
import type { TaskRepository } from "./task-repository";
import type { TaskRuntimeState } from "./task-runtime-state";
import type { TaskCustomFieldService } from "./task-custom-field-service";
import { addLocalDays } from "./task-date-utils";
import type { TaskRelationshipService } from "./task-relationship-service";

function localActionDate(date: Date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function codedError(message: string, code: number): Error & { code: number } {
    const error = new Error(message) as Error & { code: number };
    error.code = code;
    return error;
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

export class TaskLifecycleService {
    private cacheManager: CacheManager;
    private repository: TaskRepository;
    private myDayManager: MyDayTaskPort;
    constructor(
        cacheManager: CacheManager,
        repository: TaskRepository,
        myDayManager: MyDayTaskPort,
        private readonly api: SiyuanApiPort,
        private readonly runtime: TaskRuntimeState,
        private readonly customFields: TaskCustomFieldService,
        private readonly relationships: TaskRelationshipService,
    ) {
        this.cacheManager = cacheManager;
        this.repository = repository;
        this.myDayManager = myDayManager;
    }

    private get settings(): PluginSettings { return this.runtime.getSettings(); }

    setIsReady(val: boolean): void {
        this.runtime.setReady(val);
    }

    assertReady(): void {
        this.checkReady();
    }

    private checkReady(): void {
        this.runtime.assertReady();
    }

    private cacheWithRecalculatedOrder(entry: TaskCacheEntry): void {
        entry.order = calculateOrder(entry, this.cacheManager.getCache());
        this.repository.cache(entry);
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
            throw codedError("errProjectRequiresDocument", RPC_ERROR_PROJECT_REQUIRES_DOCUMENT);
        }
    }

    private assertTaskAttributeBlockType(blockType: string): void {
        if (blockType !== "p" && blockType !== "h" && blockType !== "d") {
            throw codedError("errNotTextBlock", RPC_ERROR_NOT_TEXT_BLOCK);
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
            throw codedError("Invalid task type: " + taskType, RPC_ERROR_INVALID_PARAMS);
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
        const existingAttrs = await this.repository.getBlockAttrs(blockId);
        const hintedParentId = options.parentIdHint
            ? await this.relationships.findTaskParentHint(options.parentIdHint, blockId)
            : "";

        if (existingAttrs[ATTR_TASK] && existingAttrs[ATTR_TASK] !== "") {
            const lock = await this.repository.acquireWithTimeout();
            try {
                // Already a task — update task type if it differs (e.g. task → project)
                const currentType = existingAttrs[ATTR_TASK];
                if (taskType !== currentType) {
                    Object.assign(existingAttrs, await this.repository.writeAttrs(blockId, { [ATTR_TASK]: taskType }));
                    existingAttrs[ATTR_TASK] = taskType;
                }

                // Ensure na-parent is set correctly
                const cached = this.cacheManager.get(blockId);
                const existingParent = existingAttrs[ATTR_PARENT] || (cached ? cached.parentId : "");

                if (!existingParent) {
                    // Parent not set, try to find ancestor task
                    let ancestorId = "";
                    try {
                        ancestorId = hintedParentId || await this.relationships.findAncestorTask(blockId);
                    } catch (_error: unknown) { /* ignore */ }

                    if (ancestorId) {
                        Object.assign(existingAttrs, await this.repository.writeAttrs(blockId, { [ATTR_PARENT]: ancestorId }));
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
                        this.repository.recordChange(blockId, "update");
                    }
                    if (taskType !== currentType) {
                        cached.taskType = taskType;
                        this.repository.recordChange(blockId, "update");
                    }
                    this.repository.cache(cached);
                    this.repository.publishChanges();
                    return cached;
                }

                // Not in cache (e.g. missed by sync), build and store
                const entry = this.repository.buildEntry(blockId, existingAttrs, undefined, title);
                this.repository.cache(entry);
                this.repository.recordChange(blockId, "create");
                this.repository.publishChanges();
                return entry;
            } finally {
                lock.release();
            }
        }

        const lock = await this.repository.acquireWithTimeout();
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

            let finalAttrs = await this.repository.writeAttrs(blockId, defaultAttrs);

            // Find ancestor task to set na-parent
            let parentTaskId = "";
            try {
                parentTaskId = hintedParentId || await this.relationships.findAncestorTask(blockId);
            } catch (_error: unknown) {
                // Ignore errors in finding ancestor
            }

            if (parentTaskId !== "") {
                finalAttrs = await this.repository.writeAttrs(blockId, { [ATTR_PARENT]: parentTaskId });

                // 设置默认 na-sort：排在父任务下现有子任务末尾
                const siblings = this.cacheManager.getByParent(parentTaskId);
                const maxSort = siblings.reduce((max, s) => Math.max(max, s.sort), -1);
                finalAttrs = await this.repository.writeAttrs(blockId, { [ATTR_SORT]: String(maxSort < 0 ? 0 : maxSort + 10000) });
            }

            // Find descendant tasks and update their na-parent
            try {
                await this.relationships.updateDescendantParents(blockId);
            } catch (_error: unknown) {
                // Ignore errors in updating descendants
            }

            const entry = this.repository.buildEntry(blockId, finalAttrs, undefined, title);
            entry.order = calculateOrder(entry, this.cacheManager.getCache());
            this.repository.cache(entry);
            this.cacheManager.recalcBlockedStatus();

            this.repository.recordChange(blockId, "create");
            this.repository.publishChanges();

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
            throw codedError("Invalid task type: " + taskType, RPC_ERROR_INVALID_PARAMS);
        }

        // This endpoint converts a subtree into ordinary tasks. Projects have
        // a separate single-document conversion path and must not be created
        // implicitly on descendant paragraph blocks.
        if (taskType === "2") {
            throw codedError("errProjectRequiresDocument", RPC_ERROR_PROJECT_REQUIRES_DOCUMENT);
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
            rootContainerId = await this.relationships.findParentListItem(blockId);
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
        const attrResults = await this.repository.batchGetBlockAttrs(paragraphIds);

        const lock = await this.repository.acquireWithTimeout();
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
                    parentTaskId = await this.relationships.findAncestorTask(pid);
                } catch (_error: unknown) { /* ignore */ }

                if (parentTaskId !== "") {
                    defaultAttrs[ATTR_PARENT] = parentTaskId;
                    const siblings = this.cacheManager.getByParent(parentTaskId);
                    const maxSort = siblings.reduce((max, s) => Math.max(max, s.sort), -1);
                    defaultAttrs[ATTR_SORT] = String(maxSort < 0 ? 0 : maxSort + 10000);
                }

                const finalAttrs = await this.repository.writeAttrs(pid, defaultAttrs);

                try {
                    await this.relationships.updateDescendantParents(pid);
                } catch (_error: unknown) { /* ignore */ }

                const entry = this.repository.buildEntry(pid, finalAttrs, undefined, effectiveTitle);
                entry.order = calculateOrder(entry, this.cacheManager.getCache());
                this.repository.cache(entry);

                this.repository.recordChange(pid, "create");
                converted++;
            }

            if (converted > 0) {
                this.cacheManager.recalcBlockedStatus();
                this.repository.publishChanges();
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
            throw codedError("Task not found: " + blockId, RPC_ERROR_TASK_NOT_FOUND);
        }

        const lock = await this.repository.acquireWithTimeout();
        try {
            // Re-point child tasks' na-parent to this entry's parentId
            const grandParentId = entry.parentId;
            for (let i = 0; i < entry.childIds.length; i++) {
                const childId = entry.childIds[i];
                try {
                    const childAttrs = await this.repository.writeAttrs(childId, { [ATTR_PARENT]: grandParentId || "" });

                    // Update cache for child
                    const childEntry = this.cacheManager.get(childId);
                    if (childEntry) {
                        const confirmedChild = this.repository.buildEntry(childId, childAttrs, childEntry);
                        this.repository.cache(confirmedChild);
                        // Update grandparent's childIds
                        if (grandParentId !== "") {
                            const gp = this.cacheManager.get(grandParentId);
                            if (gp && gp.childIds.indexOf(childId) === -1) {
                                gp.childIds.push(childId);
                            } else if (!gp) {
                                void this.api.log("warn", `removeTask: grandparent ${grandParentId} not in cache, child ${childId} parentId points to non-cached entry`);
                            }
                        }
                        this.repository.recordChange(childId, "update");
                    }
                } catch (_error: unknown) {
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

            const confirmedAttrs = await this.repository.writeAttrs(blockId, clearAttrs);
            if (confirmedAttrs[ATTR_TASK]) {
                throw new Error(`Failed to clear task attributes for ${blockId}`);
            }

            // Remove from My Day if present
            try {
                await this.myDayManager.removeTask(blockId);
            } catch (error: unknown) {
                void this.api.log("warn", `removeTask: failed to remove from MyDay: ${error instanceof Error ? error.message : String(error)}`);
            }

            // Remove from cache
            this.repository.removeFromCache(blockId);
            this.cacheManager.recalcBlockedStatus();

            this.repository.recordChange(blockId, "delete");
            this.repository.publishChanges();
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
            throw codedError(validationError, RPC_ERROR_INVALID_PARAMS);
        }

        if (attrs[ATTR_TASK] !== undefined && attrs[ATTR_TASK] !== "" && attrs[ATTR_TASK] !== "1" && attrs[ATTR_TASK] !== "2") {
            throw codedError("Invalid task type: " + attrs[ATTR_TASK], RPC_ERROR_INVALID_PARAMS);
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
            existingAttrsForValidation = await this.repository.getBlockAttrs(blockId);
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
                throw codedError("Invalid status: " + statusVal, RPC_ERROR_INVALID_PARAMS);
            }
        }

        const customAttrError = this.customFields.validateAttrs(blockId, attrs);
        if (customAttrError) {
            throw codedError(customAttrError, RPC_ERROR_INVALID_PARAMS);
        }

        // 依赖环路检测
        const dependsAttr = attrs[ATTR_DEPENDS];
        if (dependsAttr !== undefined && this.relationships.detectDependencyCycle(blockId, dependsAttr)) {
            throw codedError("Dependency cycle detected", RPC_ERROR_DEP_CYCLE);
        }
        // 依赖不能指向父/祖宗任务
        if (dependsAttr !== undefined && this.relationships.detectDependencyOnAncestor(blockId, dependsAttr)) {
            throw codedError("Cannot depend on ancestor task", RPC_ERROR_DEP_CYCLE);
        }
        // 顺序约束矛盾检测（警告，不阻止）
        const hasSequentialConflict = dependsAttr !== undefined && this.relationships.checkSequentialConflict(blockId, dependsAttr);

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
                    throw codedError("Due date must not be earlier than start date", RPC_ERROR_INVALID_PARAMS);
                }
            }
        }

        // na-repeat 写入验证
        const repeatAttr = attrs[ATTR_REPEAT];
        if (repeatAttr !== undefined && repeatAttr !== "") {
            if (!parseRepeatRule(repeatAttr)) {
                throw codedError("Invalid repeat rule", RPC_ERROR_INVALID_PARAMS);
            }
        } else if (repeatAttr === "") {
            attrs[ATTR_REPEAT_STATE] = "";
        }

        const lock = await this.repository.acquireWithTimeout();
        try {
            const previousEntry = this.cacheManager.get(blockId);
            let preparedRepeat: { rule: RepeatRuleV2; state: RepeatStateV1 } | null = null;
            if (attrs[ATTR_STATUS] === "done" && previousEntry && previousEntry.status !== "done") {
                const effectiveRepeat = repeatAttr !== undefined ? repeatAttr : previousEntry.repeat;
                if (effectiveRepeat) {
                    const rule = parseRepeatRule(effectiveRepeat);
                    if (!rule) {
                        throw codedError("Invalid repeat rule", RPC_ERROR_INVALID_PARAMS);
                    }
                    const effectiveStart = attrs[ATTR_START] !== undefined ? attrs[ATTR_START] : previousEntry.start;
                    const effectiveDue = attrs[ATTR_DUE] !== undefined ? attrs[ATTR_DUE] : previousEntry.due;
                    const state = parseRepeatState(previousEntry.repeatState) || createRepeatState(rule, effectiveStart, effectiveDue);
                    if (!state) {
                        throw codedError("Repeat task requires a start or due date", RPC_ERROR_INVALID_PARAMS);
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
                            throw codedError("Circular reference detected", RPC_ERROR_CIRCULAR_REF);
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
            let fullAttrs = await this.repository.writeAttrs(blockId, attrs);

            // 自动追加完成时间：status 变为 done 时（不是已经是 done）
            let existing = previousEntry;
            if (attrs[ATTR_STATUS] === "done" && existing && existing.status !== "done") {
                const existingCompleted = existing.completed || "";
                const completedAt = Date.now();
                const now = new Date(completedAt).toISOString().slice(0, 19); // YYYY-MM-DDTHH:mm:ss UTC
                const newCompleted = existingCompleted ? existingCompleted + "|" + now : now;
                fullAttrs = await this.repository.writeAttrs(blockId, { [ATTR_COMPLETED]: newCompleted });
                try {
                    await this.myDayManager.markTaskCompleted(blockId, completedAt);
                } catch (error: unknown) {
                    void this.api.log("warn", `updateTask: failed to mark My Day completion: ${error instanceof Error ? error.message : String(error)}`);
                }
            } else if (attrs[ATTR_STATUS] !== undefined && attrs[ATTR_STATUS] !== "done") {
                try {
                    await this.myDayManager.clearTaskCompleted(blockId);
                } catch (error: unknown) {
                    void this.api.log("warn", `updateTask: failed to clear My Day completion: ${error instanceof Error ? error.message : String(error)}`);
                }
            }

            // Build updated entry
            existing = this.cacheManager.get(blockId);
            const entry = this.repository.buildEntry(blockId, fullAttrs, existing);

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

            this.repository.cache(entry);

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

                const finalAttrs = await this.repository.writeAttrs(blockId, repeatAttrs);
                if (!advanced.ended && advanced.state.status === "active") {
                    try {
                        await this.myDayManager.clearTaskCompleted(blockId);
                    } catch (error: unknown) {
                        void this.api.log("warn", `updateTask: failed to clear My Day completion after repeat advancement: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
                const finalEntry = this.repository.buildEntry(blockId, finalAttrs, updatedEntry);
                this.cacheWithRecalculatedOrder(finalEntry);
            }

            // 回顾日期推算：status 变为 done 且有 review-interval 时，自动推算下次 review-date
            if (attrs[ATTR_STATUS] === "done" && updatedEntry && updatedEntry.reviewInterval > 0) {
                const td3 = new Date();
                const today = `${td3.getFullYear()}-${String(td3.getMonth() + 1).padStart(2, "0")}-${String(td3.getDate()).padStart(2, "0")}`;
                const nextReviewDate = addLocalDays(today, updatedEntry.reviewInterval);
                const reviewAttrs = await this.repository.writeAttrs(blockId, { [ATTR_REVIEW_DATE]: nextReviewDate });
                const reviewEntry = this.repository.buildEntry(blockId, reviewAttrs, this.cacheManager.get(blockId)!);
                this.repository.cache(reviewEntry);
            }

            this.cacheManager.recalcBlockedStatus();
            this.repository.recordChange(blockId, "update");

            // Broadcast entries whose blocked status changed as a side-effect of this update.
            const broadcastEntry = this.cacheManager.get(blockId);
            const affectedIds = getSequentialBroadcastIds(
                blockId, attrs, broadcastEntry ?? null, previousEntry ?? null, this.cacheManager.getCache(),
            );
            for (let i = 0; i < affectedIds.length; i++) {
                this.repository.recordChange(affectedIds[i], "update");
            }

            this.repository.publishChanges();

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
            throw codedError("title must contain 1-512 characters", RPC_ERROR_INVALID_PARAMS);
        }
        this.checkReady();
        const existing = this.cacheManager.get(blockId);
        if (!existing) {
            throw codedError("Task not found: " + blockId, RPC_ERROR_TASK_NOT_FOUND);
        }
        // MCP may rename a task immediately after create_tasks returns, before
        // SiYuan's asynchronous SQL index exposes the newly inserted block.
        const blockType = await this.getBlockType(blockId, true);
        if (blockType !== "p" && blockType !== "h" && blockType !== "d") {
            throw codedError("Only paragraph, heading, or document tasks can be renamed", RPC_ERROR_INVALID_PARAMS);
        }

        const lock = await this.repository.acquireWithTimeout();
        try {
            if (blockType === "d") {
                await this.api.request("/api/filetree/renameDocByID", { id: blockId, title });
            } else {
                const markdown = title.replace(/([\\`*_[\]{}()#+\-.!>|])/g, "\\$1");
                await this.api.request("/api/block/updateBlock", { id: blockId, dataType: "markdown", data: markdown });
            }
            existing.title = title;
            this.repository.recordChange(blockId, "update");
            this.repository.publishChanges();
            return existing;
        } finally {
            lock.release();
        }
    }

    async rebuildCache(): Promise<void> {
        await this.cacheManager.rebuild(blockIds => this.repository.batchGetBlockAttrs(blockIds));
    }

    async loadCache(): Promise<void> {
        await this.cacheManager.loadAll(blockIds => this.repository.batchGetBlockAttrs(blockIds));
    }

    updateSettings(partial: Partial<PluginSettings>): PluginSettings {
        return this.runtime.updateSettings(partial);
    }

    getSettings(): PluginSettings {
        return this.runtime.getSettings();
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
        } catch (_error: unknown) {
            // Ignore
        }
        return "";
    }
}
