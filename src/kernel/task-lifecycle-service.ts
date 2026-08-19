import {
    type TaskCacheEntry,
    type StatisticsResult,
    type StatisticsSummary,
    StatisticsDistribution,
    StatisticsContextItem,
    StatisticsProjectStatus,
    type ReviewData,
    type CompletedTasksPage,
    type MyDayState,
} from "../shared/types";
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
import { isNextActionCandidate, sortTasks } from "./priority-engine";
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
import {
    encodeCustomFieldValue,
    isCustomFieldApplicable,
    validateCustomFieldDefinition,
    type CustomFieldDef,
} from "../shared/custom-fields";
import { parseTaskTitleDates } from "../shared/natural-date";
import { isTaskDueOverdue, isTaskReviewDue, localDateString } from "../shared/review";
import type { TaskRepository } from "./task-repository";
import type { TaskRuntimeState } from "./task-runtime-state";
import type { TaskCustomFieldService } from "./task-custom-field-service";
import { addLocalDays } from "./task-date-utils";
import type { TaskRelationshipService } from "./task-relationship-service";
import { escapeMarkdownText, extractInsertedBlockMeta } from "./mcp-utils";

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
    /** The caller has just inserted and verified a native task list item. */
    knownNativeTask?: boolean;
    /** Direct text child of a native task list item. */
    contentBlockId?: string;
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

    private get settings(): PluginSettings {
        return this.runtime.getSettings();
    }

    setIsReady(val: boolean): void {
        this.runtime.setReady(val);
    }

    assertReady(): void {
        this.checkReady();
    }

    private checkReady(): void {
        this.runtime.assertReady();
    }

    private cacheConfirmedEntry(entry: TaskCacheEntry): void {
        this.repository.cache(entry);
    }

    private async getBlockType(blockId: string, waitForIndex = false): Promise<string> {
        const attempts = waitForIndex ? 20 : 1;
        for (let attempt = 0; attempt < attempts; attempt++) {
            const rows = await this.api.query<{ type?: string }>(
                sql`SELECT type FROM blocks WHERE id = ${blockId} LIMIT 1`,
            );
            const blockType = rows?.[0]?.type || "";
            if (blockType || attempt === attempts - 1) return blockType;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return "";
    }

    private async getBlockInfo(
        blockId: string,
        waitForIndex = false,
    ): Promise<{ id: string; type: string; subtype: string; parent_id: string; content: string; markdown: string }> {
        const attempts = waitForIndex ? 20 : 1;
        for (let attempt = 0; attempt < attempts; attempt++) {
            const rows = await this.api.query<{
                id?: string;
                type?: string;
                subtype?: string;
                parent_id?: string;
                content?: string;
                markdown?: string;
            }>(sql`SELECT id, type, subtype, parent_id, content, markdown FROM blocks WHERE id = ${blockId} LIMIT 1`);
            const row = rows?.[0];
            if (row?.type || attempt === attempts - 1) {
                return {
                    id: row?.id || blockId,
                    type: row?.type || "",
                    subtype: row?.subtype || "",
                    parent_id: row?.parent_id || "",
                    content: row?.content || "",
                    markdown: row?.markdown || "",
                };
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return { id: blockId, type: "", subtype: "", parent_id: "", content: "", markdown: "" };
    }

    private nativeStatusFromMarkdown(markdown: string): string {
        const marker = markdown.match(/\[(.)\]/s)?.[1] || " ";
        return marker === " " ? "inbox" : "done";
    }

    private statusMarker(status: string): " " | "X" {
        return status === "done" ? "X" : " ";
    }

    private async getDirectTextChildId(listItemId: string): Promise<string> {
        const children = await this.api.request<Array<{ id?: string; type?: string }>>("/api/block/getChildBlocks", {
            id: listItemId,
        });
        const child = Array.isArray(children)
            ? children.find((item) => item?.id && (item.type === "p" || item.type === "h"))
            : undefined;
        return child?.id || "";
    }

    private buildDefaultAttrs(title: string, status: string, taskType?: string): Record<string, string> {
        const attrs: Record<string, string> = {
            [ATTR_STATUS]: status,
            [ATTR_PRIORITY]: "medium",
            [ATTR_IMPORTANCE]: numberToAttr(this.settings.defaultImportance),
            [ATTR_EFFORT]: numberToAttr(this.settings.defaultEffort),
            [ATTR_CREATED]: new Date().toISOString().slice(0, 19),
        };
        if (taskType) attrs[ATTR_TASK] = taskType;
        if (this.settings.semanticDateParsingEnabled) {
            const parsedDates = parseTaskTitleDates(title, new Date());
            if (parsedDates.start) attrs[ATTR_START] = parsedDates.start.value;
            if (parsedDates.due) attrs[ATTR_DUE] = parsedDates.due.value;
        }
        return attrs;
    }

    private fillMissingDefaults(
        existingAttrs: Record<string, string>,
        defaults: Record<string, string>,
    ): Record<string, string> {
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(defaults)) {
            if (!existingAttrs[key]) result[key] = value;
        }
        return result;
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
            const children = await this.api.request<Array<{ id?: string; type?: string }>>(
                "/api/block/getChildBlocks",
                { id: blockId },
            );
            const textChild = Array.isArray(children)
                ? children.find((child) => child?.id && (child.type === "p" || child.type === "h"))
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
        if (options.contentBlockId) assertBlockId(options.contentBlockId, "contentBlockId");
        this.checkReady();
        if (taskType !== "1" && taskType !== "2") {
            throw codedError("Invalid task type: " + taskType, RPC_ERROR_INVALID_PARAMS);
        }

        let info = options.knownNativeTask
            ? { id: blockId, type: "i", subtype: "t", parent_id: "", content: cleanTitle || "", markdown: "- [ ]" }
            : options.knownTextBlock
              ? {
                    id: blockId,
                    type: options.knownTextBlockType || "p",
                    subtype: "",
                    parent_id: "",
                    content: cleanTitle || "",
                    markdown: "",
                }
              : await this.getBlockInfo(blockId);

        let contentBlockId = options.contentBlockId || "";
        if (taskType === "1" && (info.type === "p" || info.type === "h") && info.parent_id) {
            const parentInfo = await this.getBlockInfo(info.parent_id);
            if (parentInfo.type === "i" && parentInfo.subtype === "t") {
                contentBlockId = blockId;
                blockId = parentInfo.id;
                info = parentInfo;
            }
        }

        if (taskType === "2" && info.type !== "d") {
            throw codedError("errProjectRequiresDocument", RPC_ERROR_PROJECT_REQUIRES_DOCUMENT);
        }
        if (taskType === "1" && info.type !== "d" && info.type !== "p" && info.type !== "h" && info.type !== "i") {
            throw codedError("errNotTextBlock", RPC_ERROR_NOT_TEXT_BLOCK);
        }
        if (info.type === "i" && info.subtype !== "t") {
            throw codedError("errNotTextBlock", RPC_ERROR_NOT_TEXT_BLOCK);
        }

        let title = cleanTitle || info.content || "";
        let structuralParentId = "";
        const hintedParentId = options.parentIdHint
            ? await this.relationships.findTaskParentHint(options.parentIdHint, blockId)
            : "";
        try {
            structuralParentId = hintedParentId || (await this.relationships.findAncestorTask(blockId));
        } catch {
            structuralParentId = hintedParentId;
        }

        const lock = await this.repository.acquireWithTimeout();
        let convertedRootId = "";
        try {
            if (taskType === "1" && (info.type === "p" || info.type === "h")) {
                title = cleanTitle || (await this.fetchBlockTitle(blockId));
                const result = await this.api.request<unknown[]>("/api/block/updateBlock", {
                    id: blockId,
                    dataType: "markdown",
                    data: `- [ ] ${escapeMarkdownText(title)}`,
                    lockType: false,
                });
                const meta = extractInsertedBlockMeta(result);
                if (!meta.id || meta.nodeType !== "NodeListItem") {
                    throw new Error("SiYuan did not return the converted native task item");
                }
                convertedRootId = meta.rootId || blockId;
                blockId = meta.id;
                contentBlockId = meta.contentBlockId || (await this.getDirectTextChildId(blockId));
                info = { id: blockId, type: "i", subtype: "t", parent_id: "", content: title, markdown: "- [ ]" };
            }

            const existingAttrs = await this.repository.getBlockAttrs(blockId);
            const isNative = info.type === "i";
            if (isNative && !contentBlockId) contentBlockId = await this.getDirectTextChildId(blockId);
            if (isNative && !title && contentBlockId) title = await this.fetchBlockTitle(contentBlockId);
            if (!isNative && !title) title = await this.fetchBlockTitle(blockId);

            const defaultStatus = isNative ? this.nativeStatusFromMarkdown(info.markdown) : "inbox";
            const defaults = this.buildDefaultAttrs(title, defaultStatus, isNative ? undefined : taskType);
            const missingDefaults = this.fillMissingDefaults(existingAttrs, defaults);
            if (!existingAttrs[ATTR_PARENT] && structuralParentId) {
                missingDefaults[ATTR_PARENT] = structuralParentId;
                const siblings = this.cacheManager.getByParent(structuralParentId);
                const maxSort = siblings.reduce((max, sibling) => Math.max(max, sibling.sort), -1);
                missingDefaults[ATTR_SORT] = String(maxSort < 0 ? 0 : maxSort + 10000);
            }
            if (isNative && existingAttrs[ATTR_TASK]) missingDefaults[ATTR_TASK] = "";
            if (!isNative && existingAttrs[ATTR_TASK] !== taskType) missingDefaults[ATTR_TASK] = taskType;

            const finalAttrs = Object.keys(missingDefaults).length
                ? await this.repository.writeAttrs(blockId, missingDefaults)
                : existingAttrs;
            const existing = this.cacheManager.get(blockId);
            const entry = this.repository.buildEntry(blockId, finalAttrs, existing, title, {
                identificationSource: isNative ? "native" : "document",
                attrHostId: blockId,
                contentBlockId: isNative ? contentBlockId || undefined : undefined,
                status: defaultStatus,
                parentId: structuralParentId,
                taskType: isNative ? "1" : taskType,
            });
            this.repository.cache(entry);
            this.repository.recordChange(blockId, existing ? "update" : "create");
            this.repository.publishChanges();
            return entry;
        } catch (error: unknown) {
            if (convertedRootId) {
                try {
                    await this.api.request("/api/block/updateBlock", {
                        id: convertedRootId,
                        dataType: "markdown",
                        data: escapeMarkdownText(title),
                        lockType: false,
                    });
                } catch {
                    // Preserve the original conversion error; rollback is best effort.
                }
            }
            throw error;
        } finally {
            lock.release();
        }
    }

    async convertToTaskWithChildren(
        blockId: string,
        cleanTitle?: string,
        taskType: string = "1",
    ): Promise<{ converted: number; skipped: number }> {
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

        const rows = await this.api.query<{
            id: string;
            parent_id: string;
            type: string;
            subtype: string;
            sort: number;
        }>(sql`WITH RECURSIVE selected(id, parent_id, type, subtype, sort) AS (
                SELECT id, parent_id, type, subtype, sort FROM blocks WHERE id = ${blockId}
                UNION ALL
                SELECT b.id, b.parent_id, b.type, b.subtype, b.sort
                  FROM blocks b INNER JOIN selected s ON b.parent_id = s.id
            ) SELECT id, parent_id, type, subtype, sort FROM selected ORDER BY sort, id`);
        if (!rows?.length) return { converted: 0, skipped: 0 };

        const nativeTextChildren = new Set(
            rows
                .filter((row) => row.type === "i" && row.subtype === "t")
                .flatMap((row) => rows.filter((candidate) => candidate.parent_id === row.id).map((child) => child.id)),
        );
        let converted = 0;
        let skipped = 0;

        for (const row of rows) {
            if (row.type === "i" && row.subtype === "t") {
                skipped++;
                continue;
            }
            if ((row.type !== "p" && row.type !== "h") || nativeTextChildren.has(row.id)) continue;
            await this.convertToTask(row.id, row.id === blockId ? cleanTitle : undefined, "1");
            converted++;
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
                    const childAttrs = await this.repository.writeAttrs(childId, {
                        [ATTR_PARENT]: grandParentId || "",
                    });

                    // Update cache for child
                    const childEntry = this.cacheManager.get(childId);
                    if (childEntry) {
                        const confirmedChild = this.repository.buildEntry(childId, childAttrs, childEntry);
                        this.repository.cache(confirmedChild);
                        this.repository.recordChange(childId, "update");
                    }
                } catch (_error: unknown) {
                    // Continue with other children even if one fails
                }
            }

            if (entry.identificationSource === "native") {
                const blockDom = await this.api.request<{ dom?: string }>("/api/block/getBlockDOM", { id: blockId });
                const originalDom = blockDom?.dom || "";
                if (!originalDom || !/data-type=["']NodeListItem["']/i.test(originalDom)) {
                    throw new Error(`Native task list item DOM unavailable: ${blockId}`);
                }
                const unorderedDom = originalDom
                    .replace(/data-subtype=(["'])t\1/i, 'data-subtype="u"')
                    .replace(/\sdata-task=(["'])[^"']*\1/i, "")
                    .replace(/\sprotyle-task--done\b/g, "")
                    .replace(/protyle-action--task\b/g, "")
                    .replace(/#icon(?:Uncheck|Check)/g, "#iconDot");
                if (unorderedDom === originalDom) {
                    throw new Error(`Native task list item could not be converted to an unordered item: ${blockId}`);
                }
                await this.api.request("/api/block/updateBlock", {
                    id: blockId,
                    dataType: "dom",
                    data: unorderedDom,
                    lockType: false,
                });
            }

            // Clear all na-* attributes on the authoritative attribute host.
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

            const confirmedAttrs = await this.repository.writeAttrs(entry.attrHostId, clearAttrs);
            if (confirmedAttrs[ATTR_TASK]) {
                throw new Error(`Failed to clear task attributes for ${blockId}`);
            }

            // Remove from My Day if present
            try {
                await this.myDayManager.removeTask(blockId);
            } catch (error: unknown) {
                void this.api.log(
                    "warn",
                    `removeTask: failed to remove from MyDay: ${error instanceof Error ? error.message : String(error)}`,
                );
            }

            // Remove from cache
            this.repository.removeFromCache(blockId);

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

        if (
            attrs[ATTR_TASK] !== undefined &&
            attrs[ATTR_TASK] !== "" &&
            attrs[ATTR_TASK] !== "1" &&
            attrs[ATTR_TASK] !== "2"
        ) {
            throw codedError("Invalid task type: " + attrs[ATTR_TASK], RPC_ERROR_INVALID_PARAMS);
        }

        this.checkReady();
        let cachedTask = this.cacheManager.get(blockId);
        // The editor can issue a write before the incremental cache catches up.
        // In that window an existing task is still a valid update target even
        // though it is not present in the cache yet. Read the authoritative
        // attributes before rejecting the block based on the eventually-
        // consistent SQL type index.
        let existingAttrsForValidation: Record<string, string> | null = null;
        let uncachedBlockInfo: {
            id: string;
            type: string;
            subtype: string;
            parent_id: string;
            content: string;
            markdown: string;
        } | null = null;
        if (!cachedTask) {
            existingAttrsForValidation = await this.repository.getBlockAttrs(blockId);
            uncachedBlockInfo = await this.getBlockInfo(blockId);
            if (uncachedBlockInfo.type === "i" && uncachedBlockInfo.subtype === "t") {
                await this.cacheManager.rebuild((blockIds) => this.repository.batchGetBlockAttrs(blockIds));
                this.repository.reconcileAllDerivedState();
                cachedTask = this.cacheManager.get(blockId);
            }
        }
        // Cache entries can only come from the filtered p/h/d discovery query or
        // convertToTask's validated target. Reuse that invariant for immediate
        // post-create patches because SiYuan's SQL block index may still lag.
        // Uncached targets and project conversions still require a fresh type check.
        const hasExistingTaskAttrs = !!existingAttrsForValidation?.[ATTR_TASK];
        if (attrs[ATTR_TASK] === "2" || (!cachedTask && !hasExistingTaskAttrs)) {
            const blockType = uncachedBlockInfo?.type || (await this.getBlockType(blockId));
            if (blockType === "i" && uncachedBlockInfo?.subtype === "t" && attrs[ATTR_TASK] !== "2") {
                // Native task list items are valid without custom-na-task.
            } else {
                if (attrs[ATTR_TASK] === "2") this.assertProjectBlockType("2", blockType);
                this.assertTaskAttributeBlockType(blockType);
            }
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
        const hasSequentialConflict =
            dependsAttr !== undefined && this.relationships.checkSequentialConflict(blockId, dependsAttr);

        // 开始/截止时间校验：截止时间必须 >= 开始时间
        const dueAttr = attrs[ATTR_DUE];
        const startAttr = attrs[ATTR_START];
        if (dueAttr !== undefined || startAttr !== undefined) {
            const existing = this.cacheManager.get(blockId);
            const effectiveStart = startAttr !== undefined ? startAttr : existing?.start || "";
            const effectiveDue = dueAttr !== undefined ? dueAttr : existing?.due || "";
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
            const authoritativeOldAttrs = await this.repository.getBlockAttrs(blockId);
            if (previousEntry?.identificationSource === "native") {
                const defaults = this.buildDefaultAttrs(previousEntry.title, previousEntry.status);
                const requestedAttrs = { ...attrs };
                Object.assign(attrs, this.fillMissingDefaults(authoritativeOldAttrs, defaults), requestedAttrs);
                if (!authoritativeOldAttrs[ATTR_PARENT] && previousEntry.parentId && attrs[ATTR_PARENT] === undefined) {
                    attrs[ATTR_PARENT] = previousEntry.parentId;
                }
                if (!authoritativeOldAttrs[ATTR_SORT] && previousEntry.sort >= 0 && attrs[ATTR_SORT] === undefined) {
                    attrs[ATTR_SORT] = String(previousEntry.sort);
                }
                if (authoritativeOldAttrs[ATTR_TASK]) attrs[ATTR_TASK] = "";
                else delete attrs[ATTR_TASK];
            }
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
                    const state =
                        parseRepeatState(previousEntry.repeatState) ||
                        createRepeatState(rule, effectiveStart, effectiveDue);
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

            // Native status is a two-phase projection: marker first, then attrs.
            // If attribute persistence fails, restore the authoritative old marker.
            let oldNativeMarker = " ";
            let markerChanged = false;
            if (previousEntry?.identificationSource === "native" && attrs[ATTR_STATUS] !== undefined) {
                const authoritativeInfo = await this.getBlockInfo(blockId);
                oldNativeMarker = authoritativeInfo.markdown.match(/\[(.)\]/s)?.[1] || " ";
                const nextMarker = this.statusMarker(attrs[ATTR_STATUS]);
                if (nextMarker !== oldNativeMarker) {
                    await this.api.updateTaskListItemMarker(blockId, nextMarker);
                    markerChanged = true;
                }
            }

            let fullAttrs: Record<string, string>;
            try {
                fullAttrs = await this.repository.writeAttrs(blockId, attrs);
            } catch (error: unknown) {
                const rollbackAttrs: Record<string, string> = {};
                for (const key of Object.keys(attrs)) rollbackAttrs[key] = authoritativeOldAttrs[key] || "";
                try {
                    await this.repository.restoreAttrs(blockId, rollbackAttrs);
                } catch (rollbackError: unknown) {
                    void this.api.log(
                        "error",
                        `updateTask: attribute rollback failed for ${blockId}: ${String(rollbackError)}`,
                    );
                }
                if (markerChanged) {
                    try {
                        await this.api.updateTaskListItemMarker(blockId, oldNativeMarker);
                    } catch (rollbackError: unknown) {
                        void this.api.log(
                            "error",
                            `updateTask: marker rollback failed for ${blockId}: ${String(rollbackError)}`,
                        );
                    }
                }
                throw error;
            }

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
                    void this.api.log(
                        "warn",
                        `updateTask: failed to mark My Day completion: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            } else if (attrs[ATTR_STATUS] !== undefined && attrs[ATTR_STATUS] !== "done") {
                try {
                    await this.myDayManager.clearTaskCompleted(blockId);
                } catch (error: unknown) {
                    void this.api.log(
                        "warn",
                        `updateTask: failed to clear My Day completion: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }

            // Build updated entry
            existing = this.cacheManager.get(blockId);
            const entry = this.repository.buildEntry(blockId, fullAttrs, existing);

            // Fill missing title
            if (!entry.title) {
                entry.title = await this.fetchBlockTitle(blockId);
            }

            this.repository.cache(entry);

            // 循环/重复任务：完成当前发生后推进轻量状态，不生成新块。
            const updatedEntry = this.cacheManager.get(blockId);
            if (updatedEntry && preparedRepeat) {
                const advanced = advanceRepeatState(
                    preparedRepeat.rule,
                    preparedRepeat.state,
                    localActionDate(),
                    "complete",
                );
                const repeatAttrs: Record<string, string> = {
                    [ATTR_REPEAT_STATE]: JSON.stringify(advanced.state),
                };

                if (!advanced.ended && advanced.state.status === "active") {
                    repeatAttrs[ATTR_STATUS] = "todo";
                    if (advanced.state.currentDue) repeatAttrs[ATTR_DUE] = advanced.state.currentDue;
                    if (advanced.state.currentStart) repeatAttrs[ATTR_START] = advanced.state.currentStart;
                }

                const repeatResetsNativeMarker =
                    updatedEntry.identificationSource === "native" && repeatAttrs[ATTR_STATUS] === "todo";
                if (repeatResetsNativeMarker) await this.api.updateTaskListItemMarker(blockId, " ");
                let finalAttrs: Record<string, string>;
                try {
                    finalAttrs = await this.repository.writeAttrs(blockId, repeatAttrs);
                } catch (error: unknown) {
                    const rollbackRepeatAttrs: Record<string, string> = {};
                    for (const key of Object.keys(repeatAttrs)) rollbackRepeatAttrs[key] = fullAttrs[key] || "";
                    try {
                        await this.repository.restoreAttrs(blockId, rollbackRepeatAttrs);
                    } catch {
                        // Preserve the repeat persistence error.
                    }
                    if (repeatResetsNativeMarker) {
                        try {
                            await this.api.updateTaskListItemMarker(blockId, "X");
                        } catch {
                            // Preserve the attribute error.
                        }
                    }
                    throw error;
                }
                const finalEntry = this.repository.buildEntry(blockId, finalAttrs, updatedEntry);
                this.cacheConfirmedEntry(finalEntry);
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

            this.repository.recordChange(blockId, "update");

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
        const lock = await this.repository.acquireWithTimeout();
        try {
            let baseEntry = existing;
            if (existing.identificationSource === "native") {
                const contentBlockId = existing.contentBlockId || (await this.getDirectTextChildId(blockId));
                if (!contentBlockId) {
                    throw codedError("Native task text block not found", RPC_ERROR_TASK_NOT_FOUND);
                }
                const markdown = escapeMarkdownText(title);
                await this.api.request("/api/block/updateBlock", {
                    id: contentBlockId,
                    dataType: "markdown",
                    data: markdown,
                    lockType: true,
                });
                const confirmedAttrs = await this.repository.writeAttrs(blockId, {});
                baseEntry = { ...this.repository.buildEntry(blockId, confirmedAttrs, existing), contentBlockId };
            } else {
                const blockType = await this.getBlockType(blockId, true);
                if (blockType !== "d") {
                    throw codedError("Only document tasks can be renamed directly", RPC_ERROR_INVALID_PARAMS);
                }
                await this.api.request("/api/filetree/renameDocByID", { id: blockId, title });
            }
            const updated = { ...baseEntry, title };
            this.repository.cache(updated);
            this.repository.recordChange(blockId, "update");
            this.repository.publishChanges();
            return updated;
        } finally {
            lock.release();
        }
    }

    async rebuildCache(): Promise<void> {
        await this.cacheManager.rebuild((blockIds) => this.repository.batchGetBlockAttrs(blockIds));
        this.repository.reconcileAllDerivedState();
    }

    async loadCache(): Promise<void> {
        await this.cacheManager.loadAll((blockIds) => this.repository.batchGetBlockAttrs(blockIds));
        this.repository.reconcileAllDerivedState();
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
        const entry = this.cacheManager.get(blockId);
        if (entry?.identificationSource === "native" && !entry.created) {
            const lock = await this.repository.acquireWithTimeout();
            try {
                const confirmedAttrs = await this.repository.writeAttrs(blockId, {});
                this.repository.cache(this.repository.buildEntry(blockId, confirmedAttrs, entry));
                this.repository.recordChange(blockId, "update");
                this.repository.publishChanges();
            } finally {
                lock.release();
            }
        }
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
