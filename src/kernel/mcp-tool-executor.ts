import type * as kernel from "siyuan/kernel";
import { ALL_STATUSES } from "../shared/constants";
import type { PluginSettings } from "../shared/settings";
import type { MyDayState, TaskCacheEntry } from "../shared/types";
import { CREATE_TASK_DESTINATION_TYPES, CREATE_TASK_FORMATS, type CreateTaskInput } from "../shared/task-creation";
import { type TaskService } from "./task-service";
import { buildProjectSummaries } from "../shared/project-domain";
import type { SiyuanApiPort } from "./siyuan-api";
import { McpToolError, normalizeMcpToolError } from "./mcp-tool-error";
import { TaskCreationService, type TaskCreationOutcome } from "./task-creation-service";
import { TaskTargetResolver } from "./task-target-resolver";
import { McpToolCatalog } from "./mcp-tool-catalog";
import {
    WRITE_MCP_TOOL_NAMES,
    buildTaskAttrsFromMcpPatch,
    extractBlockId,
    searchTasksForMcp,
    normalizeMcpContext,
    taskToMcpDto,
    validateMcpTaskPatch,
    type McpSearchTasksInput,
    type McpTaskPatch,
    type McpToolName,
} from "./mcp-utils";

export interface McpRegisteredToolStatus {
    localName: string;
    fullName: string;
    title: string;
    source: "plugin";
    write: boolean;
}

export interface McpStatus {
    supported: boolean;
    enabled: boolean;
    allowWrite: boolean;
    endpoint: string;
    tools: McpRegisteredToolStatus[];
    lastError: string;
}

export interface McpNotebookTarget {
    id: string;
    name: string;
    icon: string;
}

export interface McpDocumentTarget {
    id: string;
    title: string;
    notebookId: string;
    notebookName?: string;
    path?: string;
    icon?: string;
}

export interface McpDocumentListItem extends McpDocumentTarget {
    path: string;
    icon: string;
    hasChildren: boolean;
}

export type ToolDefinition = {
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    handler: (input: Record<string, unknown>) => unknown | Promise<unknown>;
};

const ID_SCHEMA = { type: "string", description: "SiYuan block ID or siyuan://blocks/<id> link" };
const STATUS_SCHEMA = { type: "string", enum: [...ALL_STATUSES] };
const PRIORITY_SCHEMA = { type: "string", enum: ["critical", "high", "medium", "low", "veryLow", "none"] };
const MAX_MCP_BATCH_SIZE = 100;

export class McpToolExecutor {
    private readonly siyuan: kernel.ISiyuan;
    private readonly taskService: TaskService;
    private settings: PluginSettings;
    private readonly targets: TaskTargetResolver;
    private readonly creation: TaskCreationService;
    private catalog?: McpToolCatalog;

    constructor(
        siyuan: kernel.ISiyuan,
        taskService: TaskService,
        settings: PluginSettings,
        private readonly api: SiyuanApiPort,
        targets?: TaskTargetResolver,
        creation?: TaskCreationService,
        private readonly statusProvider: () => McpStatus = () => ({
            supported: false,
            enabled: settings.mcpSettings.enabled,
            allowWrite: settings.mcpSettings.allowWrite,
            endpoint: "/mcp",
            tools: [],
            lastError: "",
        }),
    ) {
        this.siyuan = siyuan;
        this.taskService = taskService;
        this.settings = settings;
        this.targets = targets || new TaskTargetResolver(api, () => this.settings);
        this.creation = creation || new TaskCreationService(taskService, api, this.targets, () => this.settings);
    }

    updateSettings(settings: PluginSettings): void {
        this.settings = settings;
    }

    async listTargetNotebooks() {
        return this.targets.listNotebooks();
    }
    async listTargetDocuments(notebookId: string, path = "/") {
        return this.targets.listDocuments(notebookId, path);
    }
    async searchTargetDocuments(query: string) {
        return this.targets.searchDocuments(query);
    }
    async resolveDocumentTarget(value: unknown) {
        return this.targets.resolveDocument(value);
    }

    async validateSettings(settings: PluginSettings): Promise<void> {
        return this.targets.validateSettings(settings);
    }

    createHandler(name: McpToolName) {
        const handler = this.getCatalog().get(name).handler;
        return async (input: Record<string, unknown> = {}) => {
            const started = Date.now();
            try {
                if (!this.settings.mcpSettings.enabled) {
                    throw new McpToolError("NOT_READY", "MCP tools are disabled");
                }
                const isWrite = (WRITE_MCP_TOOL_NAMES as readonly string[]).includes(name);
                if (isWrite && !this.settings.mcpSettings.allowWrite) {
                    throw new McpToolError("WRITE_DISABLED", "MCP write access is disabled");
                }
                this.taskService.assertReady();
                const result = await handler(input || {});
                await this.siyuan.logger.info(
                    `MCP tool [${name}] success duration=${Date.now() - started}ms${this.affectedIds(result)}`,
                );
                return result;
            } catch (error) {
                const normalized = this.normalizeError(error);
                await this.siyuan.logger.warn(
                    `MCP tool [${name}] failed duration=${Date.now() - started}ms error=${normalized.message}`,
                );
                throw normalized;
            }
        };
    }

    private affectedIds(result: unknown): string {
        const ids = new Set<string>();
        const collect = (value: unknown, depth: number) => {
            if (!value || depth > 3) return;
            if (typeof value === "string") {
                const id = extractBlockId(value);
                if (id) ids.add(id);
                return;
            }
            if (Array.isArray(value)) {
                for (const item of value.slice(0, 20)) collect(item, depth + 1);
                return;
            }
            if (typeof value === "object") {
                const record = value as Record<string, unknown>;
                for (const key of ["id", "blockId", "task", "items", "results"]) collect(record[key], depth + 1);
            }
        };
        collect(result, 0);
        return ids.size ? ` ids=${Array.from(ids).join(",")}` : "";
    }

    private normalizeError(error: unknown): Error {
        return normalizeMcpToolError(error);
    }

    private fields() {
        return this.taskService.getSettings().customFields;
    }

    private allTasks(): TaskCacheEntry[] {
        return this.taskService.getAllTasks({ sortBy: "order" });
    }

    private nextActionIds(): Set<string> {
        return new Set(this.taskService.getNextActions().map((task) => task.blockId));
    }

    private dto(task: TaskCacheEntry, nextActionIds = this.nextActionIds()) {
        return taskToMcpDto(task, this.fields(), nextActionIds.has(task.blockId));
    }

    private requireTask(value: unknown): TaskCacheEntry {
        const id = extractBlockId(value);
        if (!id) throw new McpToolError("INVALID_INPUT", "A valid task block ID is required");
        const task = this.taskService.getTask(id);
        if (!task) throw new McpToolError("TASK_NOT_FOUND", `Task not found: ${id}`);
        return task;
    }

    private attrsFromPatch(patch: McpTaskPatch, task: TaskCacheEntry): Record<string, string> {
        try {
            const all = this.allTasks();
            return buildTaskAttrsFromMcpPatch(
                patch,
                this.fields(),
                task,
                new Map(all.map((item) => [item.blockId, item])),
            );
        } catch (error) {
            throw new McpToolError("INVALID_INPUT", error instanceof Error ? error.message : String(error));
        }
    }

    private validateSchedule(value: unknown): { start: number; end: number } {
        return this.creation.validateSchedule(value);
    }

    getCatalog(): McpToolCatalog {
        if (!this.catalog) this.catalog = new McpToolCatalog(this.createDefinitions());
        return this.catalog;
    }

    private createDefinitions(): Record<McpToolName, ToolDefinition> {
        const description = (text: string) => `[NextAction Plugin] ${text}`;
        return {
            get_task_metadata: {
                title: "NextAction · Task metadata",
                description: description(
                    "Get task enums, contexts, tags, custom fields, plugin version, permissions, and creation targets.",
                ),
                inputSchema: { type: "object", properties: {} },
                handler: () => ({
                    plugin: { name: this.siyuan.plugin.name, version: this.siyuan.plugin.version, source: "plugin" },
                    statuses: [...ALL_STATUSES],
                    priorities: ["critical", "high", "medium", "low", "veryLow", "none"],
                    contexts: [...new Set(this.taskService.getContexts().map(normalizeMcpContext).filter(Boolean))],
                    tags: this.taskService.getTags(),
                    customFields: this.fields(),
                    mcp: this.statusProvider(),
                    createTargets: ["inbox", "daily_note", "document"],
                }),
            },
            search_tasks: {
                title: "NextAction · Search tasks",
                description: description(
                    "Search and filter tasks or projects. Results are paginated and limited to 100 items.",
                ),
                inputSchema: this.searchTasksSchema(),
                handler: (input) => {
                    const nextIds = this.nextActionIds();
                    const page = searchTasksForMcp(this.allTasks(), input as McpSearchTasksInput);
                    return {
                        ...page,
                        items: page.items.map((task) => taskToMcpDto(task, this.fields(), nextIds.has(task.blockId))),
                    };
                },
            },
            get_tasks: {
                title: "NextAction · Get tasks",
                description: description(
                    "Get 1-100 tasks by ID in input order. Parent and direct-child relations are optional.",
                ),
                inputSchema: {
                    type: "object",
                    properties: {
                        ids: this.taskIdsSchema(),
                        includeRelations: {
                            type: "array",
                            uniqueItems: true,
                            items: { type: "string", enum: ["parent", "children"] },
                        },
                    },
                    required: ["ids"],
                },
                handler: (input) => this.getTasks(input),
            },
            get_next_actions: {
                title: "NextAction · Next actions",
                description: description("Get currently actionable tasks sorted by NextAction priority."),
                inputSchema: {
                    type: "object",
                    properties: {
                        contexts: { type: "array", items: { type: "string" } },
                        priorities: { type: "array", items: PRIORITY_SCHEMA },
                        limit: { type: "number", description: "1-100, default 20" },
                    },
                },
                handler: (input) => {
                    let tasks = this.taskService.getNextActions();
                    if (Array.isArray(input.contexts) && input.contexts.length) {
                        const contexts = input.contexts.map(normalizeMcpContext).filter(Boolean);
                        tasks = tasks.filter((task) =>
                            task.context
                                .split("|")
                                .map(normalizeMcpContext)
                                .some((value) => contexts.includes(value)),
                        );
                    }
                    if (Array.isArray(input.priorities) && input.priorities.length) {
                        const priorities = input.priorities;
                        tasks = tasks.filter((task) => priorities.includes(task.priority));
                    }
                    const rawLimit = typeof input.limit === "number" ? input.limit : 20;
                    const limit = Math.min(100, Math.max(1, Math.trunc(rawLimit)));
                    const ids = new Set(tasks.map((task) => task.blockId));
                    return {
                        items: tasks
                            .slice(0, limit)
                            .map((task) => taskToMcpDto(task, this.fields(), ids.has(task.blockId))),
                    };
                },
            },
            list_projects: {
                title: "NextAction · Projects",
                description: description("List projects with open descendant and next-action counts."),
                inputSchema: {
                    type: "object",
                    properties: { includeCompleted: { type: "boolean" }, limit: { type: "number" } },
                },
                handler: (input) => this.listProjects(input),
            },
            get_my_day: {
                title: "NextAction · My Day",
                description: description("Get My Day entries enriched with task details and schedules."),
                inputSchema: { type: "object", properties: {} },
                handler: async () => this.enrichMyDay(await this.taskService.getMyDay()),
            },
            get_review: {
                title: "NextAction · Review",
                description: description(
                    "Get GTD review groups: overdue, inbox, waiting, someday, active projects, and review-due tasks.",
                ),
                inputSchema: { type: "object", properties: {} },
                handler: () => {
                    const data = this.taskService.getReviewData();
                    const ids = this.nextActionIds();
                    const map = (items: TaskCacheEntry[]) =>
                        items.map((item) => taskToMcpDto(item, this.fields(), ids.has(item.blockId)));
                    return {
                        overdueTasks: map(data.overdueTasks),
                        nextActions: map(data.nextActions),
                        inboxTasks: map(data.inboxTasks),
                        waitingTasks: map(data.waitingTasks),
                        somedayTasks: map(data.somedayTasks),
                        activeProjects: map(data.activeProjects),
                        reviewDueTasks: map(data.reviewDueTasks),
                    };
                },
            },
            get_statistics: {
                title: "NextAction · Statistics",
                description: description("Get task statistics for the current week or month."),
                inputSchema: { type: "object", properties: { period: { type: "string", enum: ["week", "month"] } } },
                handler: (input) => this.taskService.getStatistics(input.period === "month" ? "month" : "week"),
            },
            create_tasks: {
                title: "NextAction · Create tasks",
                description: description(
                    "Create 1-100 tasks or projects sequentially. Each item reports success or an error independently.",
                ),
                inputSchema: {
                    type: "object",
                    properties: {
                        items: {
                            type: "array",
                            minItems: 1,
                            maxItems: MAX_MCP_BATCH_SIZE,
                            items: this.createTaskSchema(),
                        },
                    },
                    required: ["items"],
                },
                handler: (input) => this.runBatch(input.items, (item: CreateTaskInput) => this.createTask(item)),
            },
            update_tasks: {
                title: "NextAction · Update tasks",
                description: description(
                    "Update public fields on 1-100 tasks sequentially, including title, kind, status, repeat, and custom fields.",
                ),
                inputSchema: {
                    type: "object",
                    properties: {
                        items: {
                            type: "array",
                            minItems: 1,
                            maxItems: MAX_MCP_BATCH_SIZE,
                            items: {
                                type: "object",
                                properties: { id: ID_SCHEMA, patch: { type: "object", minProperties: 1 } },
                                required: ["id", "patch"],
                            },
                        },
                    },
                    required: ["items"],
                },
                handler: (input) =>
                    this.runBatch(input.items, (item: Record<string, unknown>) => this.updateTask(item)),
            },
            delete_tasks: {
                title: "NextAction · Delete tasks",
                description: description(
                    "Remove the NextAction task identity from 1-100 blocks while preserving the original SiYuan block content.",
                ),
                inputSchema: { type: "object", properties: { ids: this.taskIdsSchema() }, required: ["ids"] },
                handler: (input) =>
                    this.runBatch(
                        input.ids,
                        async (value) => {
                            const task = this.requireTask(value);
                            await this.taskService.removeTask(task.blockId);
                            return { id: task.blockId, removed: true, blockPreserved: true };
                        },
                        false,
                    ),
            },
            convert_blocks_to_tasks: {
                title: "NextAction · Convert blocks to tasks",
                description: description(
                    "Convert 1-100 existing paragraph, heading, or document blocks to tasks or projects.",
                ),
                inputSchema: {
                    type: "object",
                    properties: {
                        items: {
                            type: "array",
                            minItems: 1,
                            maxItems: MAX_MCP_BATCH_SIZE,
                            items: {
                                type: "object",
                                properties: {
                                    blockId: ID_SCHEMA,
                                    kind: { type: "string", enum: ["task", "project"] },
                                    properties: { type: "object" },
                                },
                                required: ["blockId"],
                            },
                        },
                    },
                    required: ["items"],
                },
                handler: (input) =>
                    this.runBatch(input.items, (item: Record<string, unknown>) => this.convertBlock(item)),
            },
            update_my_day: {
                title: "NextAction · Update My Day",
                description: description("Add, remove, schedule, or unschedule 1-100 tasks in My Day."),
                inputSchema: {
                    type: "object",
                    properties: {
                        items: {
                            type: "array",
                            minItems: 1,
                            maxItems: MAX_MCP_BATCH_SIZE,
                            items: {
                                type: "object",
                                properties: {
                                    id: ID_SCHEMA,
                                    action: { type: "string", enum: ["add", "remove", "schedule", "unschedule"] },
                                    start: { type: "number", description: "Minutes from midnight" },
                                    end: { type: "number", description: "Minutes from midnight" },
                                },
                                required: ["id", "action"],
                            },
                        },
                    },
                    required: ["items"],
                },
                handler: async (input) => {
                    const batch = await this.runBatch(input.items, (item: Record<string, unknown>) =>
                        this.setMyDay(item),
                    );
                    return { ...batch, myDay: await this.enrichMyDay(await this.taskService.getMyDay()) };
                },
            },
            mark_tasks_reviewed: {
                title: "NextAction · Mark reviewed",
                description: description("Mark one or more tasks as reviewed and calculate their next review date."),
                inputSchema: { type: "object", properties: { ids: this.taskIdsSchema() }, required: ["ids"] },
                handler: (input) =>
                    this.runBatch(
                        input.ids,
                        async (value) => {
                            const task = this.requireTask(value);
                            const [updated] = await this.taskService.markTaskReviewed([task.blockId]);
                            return { task: this.dto(updated) };
                        },
                        false,
                    ),
            },
        };
    }

    private searchTasksSchema() {
        return {
            type: "object",
            properties: {
                query: { type: "string" },
                kind: { type: "string", enum: ["task", "project", "all"] },
                statuses: { type: "array", items: STATUS_SCHEMA },
                priorities: { type: "array", items: PRIORITY_SCHEMA },
                contexts: { type: "array", items: { type: "string" } },
                tags: { type: "array", items: { type: "string" } },
                parentId: ID_SCHEMA,
                projectId: ID_SCHEMA,
                startFrom: { type: "string" },
                startTo: { type: "string" },
                dueFrom: { type: "string" },
                dueTo: { type: "string" },
                sortBy: { type: "string", enum: ["order", "due", "importance", "priority", "created"] },
                offset: { type: "number" },
                limit: { type: "number" },
            },
        };
    }

    private createTaskSchema() {
        return {
            type: "object",
            properties: {
                title: { type: "string", description: "Single-line plain text, 1-512 characters" },
                kind: {
                    type: "string",
                    enum: ["task", "project"],
                    description: "Projects are created as child documents under a document-class destination",
                },
                destination: {
                    type: "object",
                    properties: {
                        type: { type: "string", enum: [...CREATE_TASK_DESTINATION_TYPES] },
                        notebookId: { type: "string" },
                        documentId: ID_SCHEMA,
                        parentBlockId: ID_SCHEMA,
                        format: {
                            type: "string",
                            enum: [...CREATE_TASK_FORMATS],
                            description:
                                "Task block form: paragraph or child document. Child block targets always use paragraph. Projects always create a document",
                        },
                    },
                    required: ["type"],
                },
                properties: { type: "object" },
                addToMyDay: { type: "boolean" },
                schedule: {
                    type: "object",
                    properties: { start: { type: "number" }, end: { type: "number" } },
                    required: ["start", "end"],
                },
            },
            required: ["title"],
        };
    }

    private taskIdsSchema() {
        return {
            type: "array",
            minItems: 1,
            maxItems: MAX_MCP_BATCH_SIZE,
            items: ID_SCHEMA,
        };
    }

    private async runBatch<T = unknown, R = unknown>(
        values: unknown,
        operation: (item: T, index: number) => R | Promise<R>,
        requireObject = true,
    ) {
        if (!Array.isArray(values) || values.length === 0 || values.length > MAX_MCP_BATCH_SIZE) {
            throw new McpToolError("INVALID_INPUT", `items must contain 1-${MAX_MCP_BATCH_SIZE} operations`);
        }
        const results: Array<Record<string, unknown>> = [];
        for (let index = 0; index < values.length; index++) {
            const item = values[index];
            if (requireObject && (!item || typeof item !== "object" || Array.isArray(item))) {
                results.push({
                    index,
                    success: false,
                    error: { code: "INVALID_INPUT", message: "Batch item must be an object" },
                });
                continue;
            }
            try {
                results.push({ index, success: true, result: await operation(item as T, index) });
            } catch (error) {
                const normalized = this.normalizeError(error);
                results.push({
                    index,
                    success: false,
                    error: {
                        code: normalized instanceof McpToolError ? normalized.mcpCode : "SIYUAN_API_ERROR",
                        message: normalized.message,
                    },
                });
            }
        }
        const succeeded = results.filter((item) => item.success).length;
        return {
            total: results.length,
            succeeded,
            failed: results.length - succeeded,
            results,
        };
    }

    private async getTasks(input: Record<string, unknown>) {
        const relations = input.includeRelations === undefined ? [] : input.includeRelations;
        if (!Array.isArray(relations) || relations.some((value) => value !== "parent" && value !== "children")) {
            throw new McpToolError("INVALID_INPUT", "includeRelations may only contain parent and children");
        }
        const includeParent = relations.includes("parent");
        const includeChildren = relations.includes("children");
        const nextIds = this.nextActionIds();
        return this.runBatch(
            input.ids,
            (value) => {
                const task = this.requireTask(value);
                const result: Record<string, unknown> = {
                    task: taskToMcpDto(task, this.fields(), nextIds.has(task.blockId)),
                };
                if (includeParent) {
                    const parent = task.parentId ? this.taskService.getTask(task.parentId) : null;
                    result.parent = parent ? taskToMcpDto(parent, this.fields(), nextIds.has(parent.blockId)) : null;
                }
                if (includeChildren) {
                    result.children = this.taskService
                        .getTasksByParent(task.blockId)
                        .map((child) => taskToMcpDto(child, this.fields(), nextIds.has(child.blockId)));
                }
                return result;
            },
            false,
        );
    }

    private listProjects(input: Record<string, any>) {
        const all = this.allTasks();
        const limit = Math.min(100, Math.max(1, Math.trunc(input.limit || 50)));
        const summaries = buildProjectSummaries(all, {
            startPreviewDays: this.taskService.getSettings().priorityEngine.startPreviewDays,
        })
            .filter((summary) => input.includeCompleted || summary.project.status !== "done")
            .slice(0, limit);
        return {
            items: summaries.map((summary) => ({
                project: taskToMcpDto(summary.project, this.fields(), false),
                openDescendantCount: summary.openCount,
                nextActionCount: summary.nextActions.length,
            })),
        };
    }

    private async enrichMyDay(state: MyDayState) {
        const nextIds = this.nextActionIds();
        return {
            schema: state.schema,
            dayKey: state.dayKey,
            updatedAt: state.updatedAt,
            items: state.tasks.map((entry) => {
                const task = this.taskService.getTask(entry.blockId);
                return {
                    ...entry,
                    scheduleStartText: this.minuteText(entry.scheduleStart),
                    scheduleEndText: this.minuteText(entry.scheduleEnd),
                    task: task ? taskToMcpDto(task, this.fields(), nextIds.has(task.blockId)) : null,
                };
            }),
        };
    }

    private minuteText(value: number | null): string | null {
        if (value === null) return null;
        return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    }

    async createTaskForPlugin(input: CreateTaskInput) {
        return this.createTask(input);
    }

    async convertTaskForPlugin(input: Record<string, unknown>) {
        return this.convertBlock(input);
    }

    async resolveChildTarget(value: unknown) {
        return this.targets.resolveChildTarget(value);
    }

    applyTaskProperties(task: TaskCacheEntry, properties: Record<string, unknown>): Promise<TaskCacheEntry> {
        return this.applyTaskPatch(task, properties);
    }

    adaptTaskCreationOutcome(outcome: TaskCreationOutcome) {
        return { task: this.dto(outcome.task), destination: outcome.destination, warnings: outcome.warnings };
    }

    adaptConvertedTaskOutcome(outcome: { task: TaskCacheEntry; warnings: string[] }) {
        return { task: this.dto(outcome.task), warnings: outcome.warnings };
    }

    private async createTask(input: CreateTaskInput) {
        const outcome = await this.creation.create(input, (task, properties) => this.applyTaskPatch(task, properties));
        return this.adaptTaskCreationOutcome(outcome);
    }

    private async convertBlock(input: Record<string, unknown>) {
        const outcome = await this.creation.convertExisting(input, (task, properties) =>
            this.applyTaskPatch(task, properties),
        );
        return this.adaptConvertedTaskOutcome(outcome);
    }

    private async updateTask(input: Record<string, unknown>) {
        const task = this.requireTask(input.id);
        return { task: this.dto(await this.applyTaskPatch(task, input.patch)) };
    }

    private async applyTaskPatch(task: TaskCacheEntry, rawPatch: unknown): Promise<TaskCacheEntry> {
        try {
            validateMcpTaskPatch(rawPatch);
        } catch (error) {
            throw new McpToolError("INVALID_INPUT", error instanceof Error ? error.message : String(error));
        }
        const patch = rawPatch as McpTaskPatch;
        const title = patch.title;
        const status = patch.status;
        const repeat = patch.repeat;
        const attributePatch = { ...patch };
        delete attributePatch.title;
        delete attributePatch.status;
        delete attributePatch.repeat;

        let updated = task;
        if (Object.keys(attributePatch).length) {
            updated = await this.taskService.updateTask(updated.blockId, this.attrsFromPatch(attributePatch, updated));
        }
        if (repeat !== undefined) {
            if (repeat === null) {
                updated = await this.taskService.updateTask(
                    updated.blockId,
                    this.attrsFromPatch({ repeat: null }, updated),
                );
            } else {
                updated = await this.taskService.setRepeatRule(updated.blockId, repeat);
            }
        }
        if (status !== undefined) {
            updated = await this.taskService.updateTask(updated.blockId, this.attrsFromPatch({ status }, updated));
        }
        if (title !== undefined) {
            updated = await this.taskService.updateTaskTitle(updated.blockId, title);
        }
        return updated;
    }

    private async setMyDay(input: Record<string, unknown>) {
        const task = this.requireTask(input.id);
        let state: MyDayState;
        if (input.action === "add") state = await this.taskService.addTaskToMyDay(task.blockId);
        else if (input.action === "remove") state = await this.taskService.removeTaskFromMyDay(task.blockId);
        else if (input.action === "unschedule") state = await this.taskService.removeMyDaySchedule(task.blockId);
        else if (input.action === "schedule") {
            const schedule = this.validateSchedule({ start: input.start, end: input.end });
            const current = await this.taskService.getMyDay();
            if (!current.tasks.some((item) => item.blockId === task.blockId))
                await this.taskService.addTaskToMyDay(task.blockId);
            state = await this.taskService.setMyDaySchedule(task.blockId, schedule.start, schedule.end);
        } else throw new McpToolError("INVALID_INPUT", "action is invalid");
        const entry = state.tasks.find((item) => item.blockId === task.blockId) || null;
        return { id: task.blockId, action: input.action, entry };
    }
}
