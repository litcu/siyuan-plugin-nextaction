import type * as kernel from "siyuan/kernel";
import {
    ALL_STATUSES,
    RPC_ERROR_INVALID_PARAMS,
    RPC_ERROR_NOT_READY,
    RPC_ERROR_TASK_NOT_FOUND,
    RPC_ERROR_PROJECT_REQUIRES_DOCUMENT,
} from "../shared/constants";
import type { PluginSettings } from "../shared/settings";
import type { MyDayState, TaskCacheEntry } from "../shared/types";
import {
    CREATE_TASK_DESTINATION_TYPES,
    CREATE_TASK_FORMATS,
    type CreateTaskFormat,
} from "../shared/task-creation";
import { TaskService } from "./task-service";
import { siyuanFetch } from "./utils";
import {
    WRITE_MCP_TOOL_NAMES,
    buildTaskAttrsFromMcpPatch,
    escapeMarkdownText,
    extractBlockId,
    extractDocumentIdFromPath,
    extractInsertedBlockMeta,
    type InsertedBlockMeta,
    searchTasksForMcp,
    getDesiredMcpToolNames,
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
    hasChildren: boolean;
}

type ToolDefinition = {
    title: string;
    description: string;
    inputSchema: Record<string, any>;
    handler: (input: Record<string, any>) => any | Promise<any>;
};

class McpToolError extends Error {
    readonly mcpCode: string;

    constructor(code: string, message: string) {
        super(`NEXTACTION_${code}: ${message}`);
        this.name = "McpToolError";
        this.mcpCode = code;
    }
}

const ID_SCHEMA = { type: "string", description: "SiYuan block ID or siyuan://blocks/<id> link" };
const STATUS_SCHEMA = { type: "string", enum: [...ALL_STATUSES] };
const PRIORITY_SCHEMA = { type: "string", enum: ["critical", "high", "medium", "low", "veryLow", "none"] };
const MAX_MCP_BATCH_SIZE = 100;

export class McpToolManager {
    private readonly siyuan: kernel.ISiyuan;
    private readonly taskService: TaskService;
    private settings: PluginSettings;
    private readonly registered = new Map<string, McpRegisteredToolStatus>();
    private lastError = "";

    constructor(siyuan: kernel.ISiyuan, taskService: TaskService, settings: PluginSettings) {
        this.siyuan = siyuan;
        this.taskService = taskService;
        this.settings = settings;
    }

    isSupported(): boolean {
        return !!(this.siyuan as any).mcp?.registerTool;
    }

    getStatus(): McpStatus {
        return {
            supported: this.isSupported(),
            enabled: this.settings.mcpSettings.enabled,
            allowWrite: this.settings.mcpSettings.allowWrite,
            endpoint: "/mcp",
            tools: Array.from(this.registered.values()),
            lastError: this.lastError,
        };
    }

    async listTargetNotebooks(): Promise<McpNotebookTarget[]> {
        const data = await siyuanFetch<{ notebooks?: Array<{ id: string; name: string; icon?: string; closed?: boolean }> }>(
            "/api/notebook/lsNotebooks",
            {},
        );
        return (data?.notebooks || [])
            .filter(notebook => !notebook.closed)
            .map(notebook => ({ id: notebook.id, name: notebook.name, icon: notebook.icon || "" }));
    }

    async listTargetDocuments(notebookId: string, path = "/"): Promise<{ notebookId: string; path: string; items: McpDocumentListItem[] }> {
        if (typeof notebookId !== "string" || !notebookId.trim()) throw new McpToolError("INVALID_INPUT", "notebookId is required");
        if (typeof path !== "string" || !path.startsWith("/")) throw new McpToolError("INVALID_INPUT", "path must start with /");
        const data = await siyuanFetch<{ box?: string; path?: string; files?: Array<{ id?: string; name?: string; icon?: string; path?: string; subFileCount?: number }> }>(
            "/api/filetree/listDocsByPath",
            { notebook: notebookId, path, maxListCount: 200, ignoreMaxListHint: true },
        );
        const items = (data?.files || [])
            .filter(file => !!file?.id)
            .map(file => ({
                id: file.id!,
                title: file.name || "",
                notebookId,
                path: file.path || "",
                icon: file.icon || "",
                hasChildren: Number(file.subFileCount || 0) > 0,
            }));
        return { notebookId, path: data?.path || path, items };
    }

    async searchTargetDocuments(query: string): Promise<McpDocumentListItem[]> {
        const keyword = typeof query === "string" ? query.trim() : "";
        if (!keyword) return [];
        const results = await siyuanFetch<Array<{ path?: string; hPath?: string; box?: string; boxIcon?: string }>>(
            "/api/filetree/searchDocs",
            { k: keyword, flashcard: false },
        );
        const notebooks = new Map((await this.listTargetNotebooks()).map(notebook => [notebook.id, notebook]));
        return (results || []).flatMap(result => {
            const notebookId = result.box || "";
            const notebook = notebooks.get(notebookId);
            const id = extractDocumentIdFromPath(result.path);
            if (!notebook || !id || !result.hPath) return [];
            const path = result.hPath.startsWith(notebook.name)
                ? result.hPath.slice(notebook.name.length) || "/"
                : result.hPath;
            return [{
                id,
                title: path.split("/").filter(Boolean).pop() || path,
                notebookId,
                notebookName: notebook.name,
                path,
                icon: result.boxIcon || "",
                hasChildren: false,
            }];
        }).slice(0, 50);
    }

    async resolveDocumentTarget(value: unknown): Promise<McpDocumentTarget> {
        const id = extractBlockId(value);
        if (!id) throw new McpToolError("INVALID_INPUT", "Invalid SiYuan document ID or block link");
        const rows = await siyuanFetch<Array<{ id: string; type: string; content: string; box: string; hpath: string }>>(
            "/api/query/sql",
            { stmt: `SELECT id, type, content, box, hpath FROM blocks WHERE id = '${id}' LIMIT 1` },
        );
        if (!rows?.length) throw new McpToolError("TARGET_NOT_FOUND", `Document not found: ${id}`);
        if (rows[0].type !== "d") throw new McpToolError("TARGET_NOT_DOCUMENT", `Block is not a document: ${id}`);
        const notebooks = await this.listTargetNotebooks();
        if (!notebooks.some(notebook => notebook.id === rows[0].box)) {
            throw new McpToolError("TARGET_NOT_FOUND", `Document notebook is closed or unavailable: ${id}`);
        }
        return { id, title: rows[0].content || "", notebookId: rows[0].box || "", path: rows[0].hpath || "" };
    }

    private async createChildDocument(title: string, destination: Record<string, any>): Promise<{
        document: McpDocumentTarget;
        parent: McpDocumentTarget;
    }> {
        let parent: McpDocumentTarget;
        if (destination.type === "daily_note") {
            const notebookId = destination.notebookId || this.settings.taskCreationSettings.dailyNoteNotebookId;
            if (!notebookId) throw new McpToolError("TARGET_NOT_CONFIGURED", "Daily note notebook is not configured");
            const notebooks = await this.listTargetNotebooks();
            if (!notebooks.some(item => item.id === notebookId)) {
                throw new McpToolError("TARGET_NOT_FOUND", `Notebook unavailable: ${notebookId}`);
            }
            const dailyNote = await siyuanFetch<{ id?: string }>("/api/filetree/createDailyNote", { notebook: notebookId });
            if (!dailyNote?.id) throw new McpToolError("SIYUAN_API_ERROR", "SiYuan did not return the daily note document ID");
            parent = await this.resolveDocumentTarget(dailyNote.id);
        } else {
            const rawDocumentId = destination.type === "document"
                ? destination.documentId
                : this.settings.taskCreationSettings.inboxDocumentId;
            if (!rawDocumentId) throw new McpToolError("TARGET_NOT_CONFIGURED", "Inbox document is not configured");
            parent = await this.resolveDocumentTarget(rawDocumentId);
        }

        if (!parent.path) throw new McpToolError("TARGET_NOT_FOUND", `Document path is unavailable: ${parent.id}`);
        const baseTitle = title.replace(/\//g, "／");
        let documentTitle = baseTitle;
        let documentPath = "";
        for (let suffix = 1; suffix <= 100; suffix++) {
            documentTitle = suffix === 1 ? baseTitle : `${baseTitle} (${suffix})`;
            documentPath = `${parent.path.replace(/\/$/, "")}/${documentTitle}`;
            const existing = await siyuanFetch<string[]>("/api/filetree/getIDsByHPath", {
                notebook: parent.notebookId,
                path: documentPath,
            });
            if (!existing?.length) break;
            documentPath = "";
        }
        if (!documentPath) throw new McpToolError("SIYUAN_API_ERROR", "Could not allocate a unique task document path");

        const id = await siyuanFetch<string>("/api/filetree/createDocWithMd", {
            notebook: parent.notebookId,
            path: documentPath,
            parentID: parent.id,
            markdown: "",
        });
        if (!id) throw new McpToolError("SIYUAN_API_ERROR", "SiYuan did not return the created task document ID");
        return {
            document: { id, title: documentTitle, notebookId: parent.notebookId, path: documentPath },
            parent,
        };
    }

    async validateSettings(settings: PluginSettings): Promise<void> {
        const mcp = settings.mcpSettings;
        if (!mcp.enabled || !mcp.allowWrite) return;
        const creation = settings.taskCreationSettings;
        if (creation.defaultCreateTarget === "inbox") {
            if (!creation.inboxDocumentId) throw new McpToolError("TARGET_NOT_CONFIGURED", "MCP inbox document is required");
            await this.resolveDocumentTarget(creation.inboxDocumentId);
        } else {
            if (!creation.dailyNoteNotebookId) throw new McpToolError("TARGET_NOT_CONFIGURED", "Daily note notebook is required");
            const notebooks = await this.listTargetNotebooks();
            if (!notebooks.some(item => item.id === creation.dailyNoteNotebookId)) {
                throw new McpToolError("TARGET_NOT_FOUND", `Notebook is closed or unavailable: ${creation.dailyNoteNotebookId}`);
            }
        }
    }

    async reconcile(settings: PluginSettings): Promise<void> {
        this.settings = settings;
        this.lastError = "";
        const mcpApi = (this.siyuan as any).mcp;
        if (!this.isSupported()) {
            this.lastError = "siyuan.mcp is unavailable in this SiYuan version";
            return;
        }

        const desired = new Set<string>(getDesiredMcpToolNames(
            settings.mcpSettings.enabled,
            settings.mcpSettings.allowWrite,
        ));

        for (const name of Array.from(this.registered.keys())) {
            if (!desired.has(name)) {
                try {
                    await mcpApi.unregisterTool(name);
                    this.registered.delete(name);
                } catch (error: any) {
                    this.lastError = String(error?.message || error);
                    await this.siyuan.logger.warn(`MCP tool unregister failed [${name}]: ${this.lastError}`);
                }
            }
        }

        const definitions = this.createDefinitions();
        for (const name of desired) {
            if (this.registered.has(name)) continue;
            const definition = definitions[name as McpToolName];
            if (!definition) continue;
            try {
                const result = await mcpApi.registerTool(
                    name,
                    {
                        title: definition.title,
                        description: definition.description,
                        inputSchema: definition.inputSchema,
                        outputSchema: { type: "object" },
                    },
                    this.wrapHandler(name, definition.handler),
                );
                this.registered.set(name, {
                    localName: name,
                    fullName: result?.name || this.expectedFullName(name),
                    title: definition.title,
                    source: "plugin",
                    write: (WRITE_MCP_TOOL_NAMES as readonly string[]).includes(name),
                });
            } catch (error: any) {
                this.lastError = String(error?.message || error);
                await this.siyuan.logger.error(`MCP tool registration failed [${name}]: ${this.lastError}`);
            }
        }
    }

    async unload(): Promise<void> {
        if (!this.isSupported()) return;
        const mcpApi = (this.siyuan as any).mcp;
        for (const name of Array.from(this.registered.keys())) {
            try {
                await mcpApi.unregisterTool(name);
            } catch (error: any) {
                await this.siyuan.logger.warn(`MCP tool unregister failed [${name}]: ${String(error?.message || error)}`);
            }
        }
        this.registered.clear();
    }

    private expectedFullName(localName: string): string {
        const plugin = this.siyuan.plugin.name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
        const tool = localName.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
        return `plugin__${plugin}__${tool}`;
    }

    private wrapHandler(name: string, handler: ToolDefinition["handler"]) {
        return async (input: Record<string, any> = {}) => {
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
                await this.siyuan.logger.info(`MCP tool [${name}] success duration=${Date.now() - started}ms${this.affectedIds(result)}`);
                return result;
            } catch (error: any) {
                const normalized = this.normalizeError(error);
                await this.siyuan.logger.warn(`MCP tool [${name}] failed duration=${Date.now() - started}ms error=${normalized.message}`);
                throw normalized;
            }
        };
    }

    private affectedIds(result: any): string {
        const ids = new Set<string>();
        const collect = (value: any, depth: number) => {
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
                for (const key of ["id", "blockId", "task", "items", "results"]) collect(value[key], depth + 1);
            }
        };
        collect(result, 0);
        return ids.size ? ` ids=${Array.from(ids).join(",")}` : "";
    }

    private normalizeError(error: any): Error {
        if (error instanceof McpToolError) return error;
        const code = error?.code;
        if (code === RPC_ERROR_NOT_READY) return new McpToolError("NOT_READY", String(error.message || "Kernel is not ready"));
        if (code === RPC_ERROR_TASK_NOT_FOUND) return new McpToolError("TASK_NOT_FOUND", String(error.message || "Task not found"));
        if (code === RPC_ERROR_INVALID_PARAMS) return new McpToolError("INVALID_INPUT", String(error.message || "Invalid input"));
        if (code === RPC_ERROR_PROJECT_REQUIRES_DOCUMENT) return new McpToolError("INVALID_INPUT", String(error.message || "Only document blocks can be converted to projects"));
        const message = String(error?.message || error || "Unknown error");
        if (message.startsWith("NEXTACTION_")) return new Error(message);
        return new McpToolError("SIYUAN_API_ERROR", message);
    }

    private fields() {
        return this.taskService.getSettings().customFields;
    }

    private allTasks(): TaskCacheEntry[] {
        return this.taskService.getAllTasks({ sortBy: "order" });
    }

    private nextActionIds(): Set<string> {
        return new Set(this.taskService.getNextActions().map(task => task.blockId));
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
                new Map(all.map(item => [item.blockId, item])),
            );
        } catch (error: any) {
            throw new McpToolError("INVALID_INPUT", String(error?.message || error));
        }
    }

    private validateSchedule(value: unknown): { start: number; end: number } {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new McpToolError("INVALID_INPUT", "schedule must be an object");
        }
        const { start, end } = value as Record<string, unknown>;
        if (!Number.isInteger(start) || !Number.isInteger(end)) {
            throw new McpToolError("INVALID_INPUT", "schedule start and end must be integer minutes");
        }
        if ((start as number) < 0 || (end as number) > 1440 || (end as number) <= (start as number)) {
            throw new McpToolError("INVALID_INPUT", "schedule must be within 0-1440 minutes and end after start");
        }
        const duration = (end as number) - (start as number);
        if (duration < 15 || duration > 720) {
            throw new McpToolError("INVALID_INPUT", "schedule duration must be 15-720 minutes");
        }
        return { start: start as number, end: end as number };
    }

    private createDefinitions(): Record<McpToolName, ToolDefinition> {
        const description = (text: string) => `[NextAction Plugin] ${text}`;
        return {
            get_task_metadata: {
                title: "NextAction · Task metadata",
                description: description("Get task enums, contexts, tags, custom fields, plugin version, permissions, and creation targets."),
                inputSchema: { type: "object", properties: {} },
                handler: () => ({
                    plugin: { name: this.siyuan.plugin.name, version: this.siyuan.plugin.version, source: "plugin" },
                    statuses: [...ALL_STATUSES],
                    priorities: ["critical", "high", "medium", "low", "veryLow", "none"],
                    contexts: [...new Set(this.taskService.getContexts().map(normalizeMcpContext).filter(Boolean))],
                    tags: this.taskService.getTags(),
                    customFields: this.fields(),
                    mcp: this.getStatus(),
                    createTargets: ["inbox", "daily_note", "document"],
                }),
            },
            search_tasks: {
                title: "NextAction · Search tasks",
                description: description("Search and filter tasks or projects. Results are paginated and limited to 100 items."),
                inputSchema: this.searchTasksSchema(),
                handler: (input) => {
                    const nextIds = this.nextActionIds();
                    const page = searchTasksForMcp(this.allTasks(), input as McpSearchTasksInput);
                    return { ...page, items: page.items.map(task => taskToMcpDto(task, this.fields(), nextIds.has(task.blockId))) };
                },
            },
            get_tasks: {
                title: "NextAction · Get tasks",
                description: description("Get 1-100 tasks by ID in input order. Parent and direct-child relations are optional."),
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
                        tasks = tasks.filter(task => task.context.split("|").map(normalizeMcpContext).some(value => contexts.includes(value)));
                    }
                    if (Array.isArray(input.priorities) && input.priorities.length) {
                        tasks = tasks.filter(task => input.priorities.includes(task.priority));
                    }
                    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit || 20)));
                    const ids = new Set(tasks.map(task => task.blockId));
                    return { items: tasks.slice(0, limit).map(task => taskToMcpDto(task, this.fields(), ids.has(task.blockId))) };
                },
            },
            list_projects: {
                title: "NextAction · Projects",
                description: description("List projects with open descendant and next-action counts."),
                inputSchema: { type: "object", properties: { includeCompleted: { type: "boolean" }, limit: { type: "number" } } },
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
                description: description("Get GTD review groups: overdue, inbox, waiting, someday, active projects, and review-due tasks."),
                inputSchema: { type: "object", properties: {} },
                handler: () => {
                    const data = this.taskService.getReviewData();
                    const ids = this.nextActionIds();
                    const map = (items: TaskCacheEntry[]) => items.map(item => taskToMcpDto(item, this.fields(), ids.has(item.blockId)));
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
                description: description("Create 1-100 tasks or projects sequentially. Each item reports success or an error independently."),
                inputSchema: {
                    type: "object",
                    properties: { items: { type: "array", minItems: 1, maxItems: MAX_MCP_BATCH_SIZE, items: this.createTaskSchema() } },
                    required: ["items"],
                },
                handler: (input) => this.runBatch(input.items, item => this.createTask(item)),
            },
            update_tasks: {
                title: "NextAction · Update tasks",
                description: description("Update public fields on 1-100 tasks sequentially, including title, kind, status, repeat, and custom fields."),
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
                handler: (input) => this.runBatch(input.items, item => this.updateTask(item)),
            },
            delete_tasks: {
                title: "NextAction · Delete tasks",
                description: description("Remove the NextAction task identity from 1-100 blocks while preserving the original SiYuan block content."),
                inputSchema: { type: "object", properties: { ids: this.taskIdsSchema() }, required: ["ids"] },
                handler: (input) => this.runBatch(input.ids, async (value) => {
                    const task = this.requireTask(value);
                    await this.taskService.removeTask(task.blockId);
                    return { id: task.blockId, removed: true, blockPreserved: true };
                }, false),
            },
            convert_blocks_to_tasks: {
                title: "NextAction · Convert blocks to tasks",
                description: description("Convert 1-100 existing paragraph, heading, or document blocks to tasks or projects."),
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
                handler: (input) => this.runBatch(input.items, item => this.convertBlock(item)),
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
                    const batch = await this.runBatch(input.items, item => this.setMyDay(item));
                    return { ...batch, myDay: await this.enrichMyDay(await this.taskService.getMyDay()) };
                },
            },
            mark_tasks_reviewed: {
                title: "NextAction · Mark reviewed",
                description: description("Mark one or more tasks as reviewed and calculate their next review date."),
                inputSchema: { type: "object", properties: { ids: this.taskIdsSchema() }, required: ["ids"] },
                handler: (input) => this.runBatch(input.ids, async (value) => {
                    const task = this.requireTask(value);
                    const [updated] = await this.taskService.markTaskReviewed([task.blockId]);
                    return { task: this.dto(updated) };
                }, false),
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
                startFrom: { type: "string" }, startTo: { type: "string" },
                dueFrom: { type: "string" }, dueTo: { type: "string" },
                sortBy: { type: "string", enum: ["order", "due", "importance", "priority", "created"] },
                offset: { type: "number" }, limit: { type: "number" },
            },
        };
    }

    private createTaskSchema() {
        return {
            type: "object",
            properties: {
                title: { type: "string", description: "Single-line plain text, 1-512 characters" },
                kind: { type: "string", enum: ["task", "project"], description: "Projects are created as child documents under a document-class destination" },
                destination: {
                    type: "object",
                    properties: {
                        type: { type: "string", enum: [...CREATE_TASK_DESTINATION_TYPES] },
                        notebookId: { type: "string" },
                        documentId: ID_SCHEMA,
                        parentBlockId: ID_SCHEMA,
                        format: { type: "string", enum: [...CREATE_TASK_FORMATS], description: "Task block form: paragraph or child document. Child block targets always use paragraph. Projects always create a document" },
                    },
                    required: ["type"],
                },
                properties: { type: "object" },
                addToMyDay: { type: "boolean" },
                schedule: { type: "object", properties: { start: { type: "number" }, end: { type: "number" } }, required: ["start", "end"] },
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

    private async runBatch(
        values: unknown,
        operation: (item: any, index: number) => any | Promise<any>,
        requireObject = true,
    ) {
        if (!Array.isArray(values) || values.length === 0 || values.length > MAX_MCP_BATCH_SIZE) {
            throw new McpToolError("INVALID_INPUT", `items must contain 1-${MAX_MCP_BATCH_SIZE} operations`);
        }
        const results: Array<Record<string, any>> = [];
        for (let index = 0; index < values.length; index++) {
            const item = values[index];
            if (requireObject && (!item || typeof item !== "object" || Array.isArray(item))) {
                results.push({ index, success: false, error: { code: "INVALID_INPUT", message: "Batch item must be an object" } });
                continue;
            }
            try {
                results.push({ index, success: true, result: await operation(item, index) });
            } catch (error: any) {
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
        const succeeded = results.filter(item => item.success).length;
        return {
            total: results.length,
            succeeded,
            failed: results.length - succeeded,
            results,
        };
    }

    private async getTasks(input: Record<string, any>) {
        const relations = input.includeRelations === undefined ? [] : input.includeRelations;
        if (!Array.isArray(relations) || relations.some(value => value !== "parent" && value !== "children")) {
            throw new McpToolError("INVALID_INPUT", "includeRelations may only contain parent and children");
        }
        const includeParent = relations.includes("parent");
        const includeChildren = relations.includes("children");
        const nextIds = this.nextActionIds();
        return this.runBatch(input.ids, (value) => {
            const task = this.requireTask(value);
            const result: Record<string, any> = {
                task: taskToMcpDto(task, this.fields(), nextIds.has(task.blockId)),
            };
            if (includeParent) {
                const parent = task.parentId ? this.taskService.getTask(task.parentId) : null;
                result.parent = parent ? taskToMcpDto(parent, this.fields(), nextIds.has(parent.blockId)) : null;
            }
            if (includeChildren) {
                result.children = this.taskService.getTasksByParent(task.blockId)
                    .map(child => taskToMcpDto(child, this.fields(), nextIds.has(child.blockId)));
            }
            return result;
        }, false);
    }

    private listProjects(input: Record<string, any>) {
        const all = this.allTasks();
        const nextIds = this.nextActionIds();
        const map = new Map(all.map(task => [task.blockId, task]));
        const belongs = (task: TaskCacheEntry, projectId: string) => {
            let current: TaskCacheEntry | undefined = task;
            const visited = new Set<string>();
            while (current && !visited.has(current.blockId)) {
                if (current.blockId === projectId) return true;
                visited.add(current.blockId);
                current = current.parentId ? map.get(current.parentId) : undefined;
            }
            return false;
        };
        const limit = Math.min(100, Math.max(1, Math.trunc(input.limit || 50)));
        const projects = all.filter(task => task.taskType === "2" && (input.includeCompleted || task.status !== "done")).slice(0, limit);
        return {
            items: projects.map(project => {
                const descendants = all.filter(task => task.blockId !== project.blockId && belongs(task, project.blockId));
                return {
                    project: taskToMcpDto(project, this.fields(), false),
                    openDescendantCount: descendants.filter(task => task.status !== "done").length,
                    nextActionCount: descendants.filter(task => nextIds.has(task.blockId)).length,
                };
            }),
        };
    }

    private async enrichMyDay(state: MyDayState) {
        const nextIds = this.nextActionIds();
        return {
            schema: state.schema,
            dayKey: state.dayKey,
            updatedAt: state.updatedAt,
            items: state.tasks.map(entry => {
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

    async createTaskForPlugin(input: Record<string, any>) {
        return this.createTask(input);
    }

    async convertTaskForPlugin(input: Record<string, any>) {
        return this.convertBlock(input);
    }

    /** Resolve a logical task block to a physical container for a nested list. */
    private async resolveChildContainer(value: unknown, reuseNestedList = true): Promise<{ taskBlockId: string; containerId: string; containerType: string }> {
        const taskBlockId = extractBlockId(value);
        if (!taskBlockId) throw new McpToolError("INVALID_INPUT", "parentBlockId is invalid");
        const rows = await siyuanFetch<Array<{ id: string; parent_id: string; type: string }>>("/api/query/sql", {
            stmt: "WITH RECURSIVE ancestors(id, parent_id, type) AS ("
                + "SELECT id, parent_id, type FROM blocks WHERE id = '" + taskBlockId + "' "
                + "UNION ALL SELECT b.id, b.parent_id, b.type FROM blocks b INNER JOIN ancestors a ON b.id = a.parent_id"
                + ") SELECT id, parent_id, type FROM ancestors",
        });
        if (!rows?.length) throw new McpToolError("TARGET_NOT_FOUND", `Parent block unavailable: ${taskBlockId}`);
        const byId = new Map(rows.map(row => [row.id, row]));
        const containerTypes = new Set(["b", "i", "l", "s", "callout"]);
        let current = byId.get(taskBlockId);
        while (current) {
            if (containerTypes.has(current.type)) {
                // 列表项的第一个子任务会创建 NodeList；后续子任务必须复用这
                // 个列表，否则每次 appendBlock 都会在同一列表项下再创建一个
                // 并列的 NodeList，最终表现为子任务之间出现空行。
                if (current.type === "i" && reuseNestedList) {
                    try {
                        const children = await siyuanFetch<Array<{ id?: string; type?: string }>>("/api/block/getChildBlocks", {
                            id: current.id,
                        });
                        const nestedList = Array.isArray(children)
                            ? [...children].reverse().find(item => item?.id && item.type === "l")
                            : undefined;
                        if (nestedList?.id) {
                            return { taskBlockId, containerId: nestedList.id, containerType: "l" };
                        }
                    } catch {
                        // 子块查询失败时仍使用列表项作为容器，让思源创建首个子列表。
                    }
                }
                return { taskBlockId, containerId: current.id, containerType: current.type };
            }
            if (!current.parent_id) break;
            current = byId.get(current.parent_id);
        }
        throw new McpToolError("TARGET_UNSUPPORTED", "This block has no container that can receive child tasks");
    }

    /** Resolve an inserted list/list-item root to its paragraph text block. */
    private async resolveInsertedTaskBlock(meta: InsertedBlockMeta): Promise<InsertedBlockMeta> {
        if (meta.nodeType === "NodeParagraph") return meta;
        if (meta.nodeType !== "NodeList" && meta.nodeType !== "NodeListItem") {
            throw new McpToolError("SIYUAN_API_ERROR", `Expected NodeParagraph, got ${meta.nodeType || "unknown"}`);
        }

        const rootId = meta.rootId || meta.id;
        const queue = [rootId];
        const visited = new Set<string>();
        while (queue.length) {
            const currentId = queue.shift()!;
            if (!currentId || visited.has(currentId)) continue;
            visited.add(currentId);
            let children: Array<{ id?: string; type?: string }> = [];
            try {
                const result = await siyuanFetch<Array<{ id?: string; type?: string }>>("/api/block/getChildBlocks", { id: currentId });
                children = Array.isArray(result) ? result : [];
            } catch {
                children = [];
            }
            const paragraph = children.find(child => child?.id && child.type === "p");
            if (paragraph?.id) {
                return {
                    id: paragraph.id,
                    parentId: currentId,
                    nodeType: "NodeParagraph",
                    rootId,
                };
            }
            for (const child of children) {
                if (child?.id && (child.type === "i" || child.type === "l")) queue.push(child.id);
            }
        }

        throw new McpToolError("SIYUAN_API_ERROR", "Inserted list does not contain a text block");
    }

    async resolveChildTarget(value: unknown): Promise<{ available: boolean; parentBlockId: string; containerId?: string; containerType?: string; reason?: string }> {
        try {
            const target = await this.resolveChildContainer(value);
            return { available: true, parentBlockId: target.taskBlockId, containerId: target.containerId, containerType: target.containerType };
        } catch (error: any) {
            return { available: false, parentBlockId: extractBlockId(value), reason: String(error?.message || error) };
        }
    }

    private async createTask(input: Record<string, any>) {
        if (typeof input.title !== "string") throw new McpToolError("INVALID_INPUT", "title is required");
        const title = input.title.replace(/[\r\n]+/g, " ").trim();
        if (!title || title.length > 512) throw new McpToolError("INVALID_INPUT", "title must contain 1-512 characters");
        if (input.kind !== undefined && input.kind !== "task" && input.kind !== "project") {
            throw new McpToolError("INVALID_INPUT", "kind must be task or project");
        }
        const kind = input.kind === "project" ? "2" : "1";
        const destination = input.destination || { type: this.settings.taskCreationSettings.defaultCreateTarget };
        if (!destination || typeof destination !== "object" || Array.isArray(destination)) {
            throw new McpToolError("INVALID_INPUT", "destination must be an object");
        }
        if (!(CREATE_TASK_DESTINATION_TYPES as readonly string[]).includes(destination.type)) {
            throw new McpToolError("INVALID_INPUT", "destination.type must be inbox, daily_note, document, or block");
        }
        const format: CreateTaskFormat = destination.type === "block"
            ? "paragraph"
            : destination.format === undefined
                ? "paragraph"
                : destination.format;
        if (!(CREATE_TASK_FORMATS as readonly string[]).includes(format)) {
            throw new McpToolError("INVALID_INPUT", "destination.format must be paragraph or document");
        }
        if (destination.type === "block" && destination.format !== undefined && destination.format !== "paragraph") {
            throw new McpToolError("INVALID_INPUT", "block destinations always use paragraph format");
        }
        if (kind === "2" && destination.type !== "document") {
            throw new McpToolError("INVALID_INPUT", "projects require a document destination");
        }
        if (input.properties !== undefined && (!input.properties || typeof input.properties !== "object" || Array.isArray(input.properties))) {
            throw new McpToolError("INVALID_INPUT", "properties must be an object");
        }
        if (input.addToMyDay !== undefined && typeof input.addToMyDay !== "boolean") {
            throw new McpToolError("INVALID_INPUT", "addToMyDay must be boolean");
        }
        const schedule = input.schedule === undefined ? null : this.validateSchedule(input.schedule);
        let blockId = "";
        let rollbackBlockId = "";
        let destinationResult: Record<string, any> = {};
        let insertedMeta: InsertedBlockMeta = { id: "", parentId: "", nodeType: "" };
        let createdDocument = false;
        try {
            if (kind === "2" || format === "document") {
                const created = await this.createChildDocument(title, destination);
                blockId = created.document.id;
                rollbackBlockId = blockId;
                createdDocument = true;
                insertedMeta = { id: blockId, parentId: created.parent.id, nodeType: "NodeDocument" };
                destinationResult = {
                    type: destination.type,
                    format,
                    notebookId: created.document.notebookId,
                    document: created.document,
                    parentDocument: created.parent,
                    createdDocument: true,
                };
            } else if (destination.type === "block") {
                const childTarget = await this.resolveChildContainer(destination.parentBlockId, false);
                const inserted = await siyuanFetch<any[]>("/api/block/appendBlock", {
                    parentID: childTarget.containerId,
                    dataType: "markdown",
                    data: escapeMarkdownText(title),
                });
                insertedMeta = extractInsertedBlockMeta(inserted);
                blockId = insertedMeta.id;
                rollbackBlockId = insertedMeta.rootId || blockId;
                insertedMeta = await this.resolveInsertedTaskBlock(insertedMeta);
                blockId = insertedMeta.id;
                rollbackBlockId = insertedMeta.rootId || blockId;
                destinationResult = {
                    type: "block",
                    format: "paragraph",
                    parentBlockId: childTarget.taskBlockId,
                    containerId: childTarget.containerId,
                    containerType: childTarget.containerType,
                };
            } else if (destination.type === "daily_note") {
                const notebookId = destination.notebookId || this.settings.taskCreationSettings.dailyNoteNotebookId;
                if (!notebookId) throw new McpToolError("TARGET_NOT_CONFIGURED", "Daily note notebook is not configured");
                const notebooks = await this.listTargetNotebooks();
                if (!notebooks.some(item => item.id === notebookId)) throw new McpToolError("TARGET_NOT_FOUND", `Notebook unavailable: ${notebookId}`);
                const markdown = escapeMarkdownText(title);
                const inserted = await siyuanFetch<any[]>("/api/block/appendDailyNoteBlock", { notebook: notebookId, dataType: "markdown", data: markdown });
                insertedMeta = extractInsertedBlockMeta(inserted);
                blockId = insertedMeta.id;
                rollbackBlockId = insertedMeta.rootId || blockId;
                insertedMeta = await this.resolveInsertedTaskBlock(insertedMeta);
                blockId = insertedMeta.id;
                rollbackBlockId = insertedMeta.rootId || blockId;
                destinationResult = { type: "daily_note", format, notebookId };
            } else {
                const rawDocumentId = destination.type === "document" ? destination.documentId : this.settings.taskCreationSettings.inboxDocumentId;
                if (!rawDocumentId) throw new McpToolError("TARGET_NOT_CONFIGURED", "Inbox document is not configured");
                const document = await this.resolveDocumentTarget(rawDocumentId);
                const markdown = escapeMarkdownText(title);
                const inserted = await siyuanFetch<any[]>("/api/block/appendBlock", { parentID: document.id, dataType: "markdown", data: markdown });
                insertedMeta = extractInsertedBlockMeta(inserted);
                blockId = insertedMeta.id;
                rollbackBlockId = insertedMeta.rootId || blockId;
                insertedMeta = await this.resolveInsertedTaskBlock(insertedMeta);
                blockId = insertedMeta.id;
                rollbackBlockId = insertedMeta.rootId || blockId;
                destinationResult = { type: destination.type === "document" ? "document" : "inbox", format, document };
            }
            if (!blockId) throw new McpToolError("SIYUAN_API_ERROR", "SiYuan did not return the inserted block ID");
            const expectedNodeType = kind === "2" || format === "document" ? "NodeDocument" : "NodeParagraph";
            if (insertedMeta.nodeType !== expectedNodeType) {
                throw new McpToolError("SIYUAN_API_ERROR", `Expected ${expectedNodeType}, got ${insertedMeta.nodeType || "unknown"}`);
            }

            let task = await this.taskService.convertToTask(blockId, kind === "2" ? undefined : title, kind, {
                knownTextBlock: true,
                knownTextBlockType: kind === "2" || format === "document" ? "d" : "p",
                parentIdHint: insertedMeta.parentId,
            });
            const taskBlockId = task.blockId;
            const patch = (input.properties || {}) as McpTaskPatch;
            if (Object.keys(patch).length) {
                if (patch.title !== undefined || patch.kind !== undefined) {
                    throw new McpToolError("INVALID_INPUT", "Create properties must not contain title or kind; use the top-level fields");
                }
                task = await this.applyTaskPatch(task, patch);
            }

            const warnings: string[] = [];
            if (input.addToMyDay || schedule) {
                try {
                    await this.taskService.addTaskToMyDay(taskBlockId);
                    if (schedule) await this.taskService.setMyDaySchedule(taskBlockId, schedule.start, schedule.end);
                } catch (error: any) {
                    warnings.push(`My Day update failed: ${String(error?.message || error)}`);
                }
            }
            return { task: this.dto(task), destination: destinationResult, warnings };
        } catch (error: any) {
            if (blockId) {
                try {
                    if (this.taskService.getTask(blockId)) {
                        try {
                            await this.taskService.removeTask(blockId);
                        } catch {
                            // Deleting the newly inserted block remains the authoritative rollback.
                        }
                    }
                    if (createdDocument) {
                        await siyuanFetch("/api/filetree/removeDocByID", { id: blockId });
                    } else {
                        await siyuanFetch("/api/block/deleteBlock", { id: rollbackBlockId || blockId });
                    }
                } catch (rollbackError: any) {
                    throw new McpToolError("PARTIAL_SUCCESS", `Task creation failed and rollback failed; orphan block: ${blockId}; ${String(rollbackError?.message || rollbackError)}`);
                }
            }
            throw error;
        }
    }

    private async convertBlock(input: Record<string, any>) {
        const blockId = extractBlockId(input.blockId);
        if (!blockId) throw new McpToolError("INVALID_INPUT", "blockId is invalid");
        if (input.kind !== undefined && input.kind !== "task" && input.kind !== "project") {
            throw new McpToolError("INVALID_INPUT", "kind must be task or project");
        }
        if (input.properties !== undefined && (!input.properties || typeof input.properties !== "object" || Array.isArray(input.properties))) {
            throw new McpToolError("INVALID_INPUT", "properties must be an object");
        }
        const kind = input.kind === "project" ? "2" : "1";
        let task = await this.taskService.convertToTask(blockId, undefined, kind);
        try {
            const patch = (input.properties || {}) as McpTaskPatch;
            if (Object.keys(patch).length) {
                if (patch.kind !== undefined) {
                    throw new McpToolError("INVALID_INPUT", "Convert properties must not contain kind; use the top-level field");
                }
                task = await this.applyTaskPatch(task, patch);
            }
            return { task: this.dto(task), warnings: [] };
        } catch (error: any) {
            throw new McpToolError("PARTIAL_SUCCESS", `Block ${blockId} was converted, but initial fields failed: ${String(error?.message || error)}`);
        }
    }

    private async updateTask(input: Record<string, any>) {
        const task = this.requireTask(input.id);
        return { task: this.dto(await this.applyTaskPatch(task, input.patch)) };
    }

    private async applyTaskPatch(task: TaskCacheEntry, rawPatch: unknown): Promise<TaskCacheEntry> {
        try {
            validateMcpTaskPatch(rawPatch);
        } catch (error: any) {
            throw new McpToolError("INVALID_INPUT", String(error?.message || error));
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
                updated = await this.taskService.updateTask(updated.blockId, this.attrsFromPatch({ repeat: null }, updated));
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

    private async setMyDay(input: Record<string, any>) {
        const task = this.requireTask(input.id);
        let state: MyDayState;
        if (input.action === "add") state = await this.taskService.addTaskToMyDay(task.blockId);
        else if (input.action === "remove") state = await this.taskService.removeTaskFromMyDay(task.blockId);
        else if (input.action === "unschedule") state = await this.taskService.removeMyDaySchedule(task.blockId);
        else if (input.action === "schedule") {
            const schedule = this.validateSchedule({ start: input.start, end: input.end });
            const current = await this.taskService.getMyDay();
            if (!current.tasks.some(item => item.blockId === task.blockId)) await this.taskService.addTaskToMyDay(task.blockId);
            state = await this.taskService.setMyDaySchedule(task.blockId, schedule.start, schedule.end);
        } else throw new McpToolError("INVALID_INPUT", "action is invalid");
        const entry = state.tasks.find(item => item.blockId === task.blockId) || null;
        return { id: task.blockId, action: input.action, entry };
    }
}
