import type * as kernel from "siyuan/kernel";
import {
    ALL_STATUSES,
    ATTR_STATUS,
    RPC_ERROR_INVALID_PARAMS,
    RPC_ERROR_NOT_READY,
    RPC_ERROR_TASK_NOT_FOUND,
} from "../shared/constants";
import type { PluginSettings } from "../shared/settings";
import type { MyDayState, TaskCacheEntry } from "../shared/types";
import { TaskService } from "./task-service";
import { siyuanFetch } from "./utils";
import {
    WRITE_MCP_TOOL_NAMES,
    buildTaskAttrsFromMcpPatch,
    escapeMarkdownText,
    extractBlockId,
    extractInsertedBlockMeta,
    type InsertedBlockMeta,
    filterTasksForMcp,
    getDesiredMcpToolNames,
    normalizeMcpContext,
    taskToMcpDto,
    validateMcpStatus,
    type McpListTasksInput,
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

    async resolveDocumentTarget(value: unknown): Promise<McpDocumentTarget> {
        const id = extractBlockId(value);
        if (!id) throw new McpToolError("INVALID_INPUT", "Invalid SiYuan document ID or block link");
        const rows = await siyuanFetch<Array<{ id: string; type: string; content: string; box: string }>>(
            "/api/query/sql",
            { stmt: `SELECT id, type, content, box FROM blocks WHERE id = '${id}' LIMIT 1` },
        );
        if (!rows?.length) throw new McpToolError("TARGET_NOT_FOUND", `Document not found: ${id}`);
        if (rows[0].type !== "d") throw new McpToolError("TARGET_NOT_DOCUMENT", `Block is not a document: ${id}`);
        return { id, title: rows[0].content || "", notebookId: rows[0].box || "" };
    }

    async validateSettings(settings: PluginSettings): Promise<void> {
        const mcp = settings.mcpSettings;
        if (!mcp.enabled || !mcp.allowWrite) return;
        if (mcp.defaultCreateTarget === "inbox") {
            if (!mcp.inboxDocumentId) throw new McpToolError("TARGET_NOT_CONFIGURED", "MCP inbox document is required");
            await this.resolveDocumentTarget(mcp.inboxDocumentId);
        } else {
            if (!mcp.dailyNoteNotebookId) throw new McpToolError("TARGET_NOT_CONFIGURED", "Daily note notebook is required");
            const notebooks = await this.listTargetNotebooks();
            if (!notebooks.some(item => item.id === mcp.dailyNoteNotebookId)) {
                throw new McpToolError("TARGET_NOT_FOUND", `Notebook is closed or unavailable: ${mcp.dailyNoteNotebookId}`);
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
                for (const key of ["id", "blockId", "task", "items"]) collect(value[key], depth + 1);
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

    private parseStatus(value: unknown): string {
        try {
            return validateMcpStatus(value);
        } catch (error: any) {
            throw new McpToolError("INVALID_INPUT", String(error?.message || error));
        }
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
            list_tasks: {
                title: "NextAction · List tasks",
                description: description("Search and filter tasks or projects. Results are paginated and limited to 100 items."),
                inputSchema: this.listTasksSchema(),
                handler: (input) => {
                    const nextIds = this.nextActionIds();
                    const page = filterTasksForMcp(this.allTasks(), input as McpListTasksInput, nextIds);
                    return { ...page, items: page.items.map(task => taskToMcpDto(task, this.fields(), nextIds.has(task.blockId))) };
                },
            },
            get_task: {
                title: "NextAction · Get task",
                description: description("Get one task with its parent and direct children."),
                inputSchema: { type: "object", properties: { blockId: ID_SCHEMA }, required: ["blockId"] },
                handler: (input) => {
                    const task = this.requireTask(input.blockId);
                    const nextIds = this.nextActionIds();
                    const parent = task.parentId ? this.taskService.getTask(task.parentId) : null;
                    const children = this.taskService.getTasksByParent(task.blockId);
                    return {
                        task: taskToMcpDto(task, this.fields(), nextIds.has(task.blockId)),
                        parent: parent ? taskToMcpDto(parent, this.fields(), nextIds.has(parent.blockId)) : null,
                        children: children.map(child => taskToMcpDto(child, this.fields(), nextIds.has(child.blockId))),
                    };
                },
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
            create_task: {
                title: "NextAction · Create task",
                description: description("Create a task or project in the configured inbox, today's daily note, or an explicit document."),
                inputSchema: this.createTaskSchema(),
                handler: (input) => this.createTask(input),
            },
            convert_block_to_task: {
                title: "NextAction · Convert block",
                description: description("Convert an existing paragraph, heading, or document block to a task or project."),
                inputSchema: {
                    type: "object",
                    properties: { blockId: ID_SCHEMA, kind: { type: "string", enum: ["task", "project"] }, status: STATUS_SCHEMA, fields: { type: "object" } },
                    required: ["blockId"],
                },
                handler: (input) => this.convertBlock(input),
            },
            update_task: {
                title: "NextAction · Update task",
                description: description("Update allow-listed task fields. Raw custom-na attributes, status, title, and task kind are not accepted."),
                inputSchema: { type: "object", properties: { blockId: ID_SCHEMA, patch: { type: "object" } }, required: ["blockId", "patch"] },
                handler: (input) => this.updateTask(input),
            },
            set_task_status: {
                title: "NextAction · Set status",
                description: description("Set task status while preserving completion history, repeat advancement, and My Day behavior."),
                inputSchema: { type: "object", properties: { blockId: ID_SCHEMA, status: STATUS_SCHEMA }, required: ["blockId", "status"] },
                handler: async (input) => {
                    const task = this.requireTask(input.blockId);
                    const requestedStatus = this.parseStatus(input.status);
                    const updated = await this.taskService.updateTask(task.blockId, { [ATTR_STATUS]: requestedStatus });
                    return { requestedStatus, effectiveStatus: updated.status, repeatAdvanced: requestedStatus === "done" && updated.status !== "done", task: this.dto(updated) };
                },
            },
            set_my_day: {
                title: "NextAction · Set My Day",
                description: description("Add, remove, schedule, or unschedule a task in My Day."),
                inputSchema: {
                    type: "object",
                    properties: {
                        blockId: ID_SCHEMA,
                        action: { type: "string", enum: ["add", "remove", "schedule", "unschedule"] },
                        start: { type: "number", description: "Minutes from midnight" },
                        end: { type: "number", description: "Minutes from midnight" },
                    },
                    required: ["blockId", "action"],
                },
                handler: (input) => this.setMyDay(input),
            },
            mark_tasks_reviewed: {
                title: "NextAction · Mark reviewed",
                description: description("Mark one or more tasks as reviewed and calculate their next review date."),
                inputSchema: { type: "object", properties: { blockIds: { type: "array", items: ID_SCHEMA } }, required: ["blockIds"] },
                handler: async (input) => {
                    if (!Array.isArray(input.blockIds) || input.blockIds.length === 0 || input.blockIds.length > 100) {
                        throw new McpToolError("INVALID_INPUT", "blockIds must contain 1-100 task IDs");
                    }
                    const ids = input.blockIds.map((value: unknown) => this.requireTask(value).blockId);
                    const updated = await this.taskService.markTaskReviewed(ids);
                    return { items: updated.map(task => this.dto(task)) };
                },
            },
        };
    }

    private listTasksSchema() {
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
                nextActionOnly: { type: "boolean" }, includeCompleted: { type: "boolean" },
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
                kind: { type: "string", enum: ["task", "project"] },
                status: STATUS_SCHEMA,
                destination: {
                    type: "object",
                    properties: {
                        type: { type: "string", enum: ["inbox", "daily_note", "document", "block"] },
                        notebookId: { type: "string" },
                        documentId: ID_SCHEMA,
                        parentBlockId: ID_SCHEMA,
                    },
                    required: ["type"],
                },
                fields: { type: "object" },
                addToMyDay: { type: "boolean" },
                schedule: { type: "object", properties: { start: { type: "number" }, end: { type: "number" } }, required: ["start", "end"] },
            },
            required: ["title"],
        };
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
    private async resolveChildContainer(value: unknown): Promise<{ taskBlockId: string; containerId: string }> {
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
            if (containerTypes.has(current.type)) return { taskBlockId, containerId: current.id };
            if (!current.parent_id) break;
            current = byId.get(current.parent_id);
        }
        throw new McpToolError("TARGET_UNSUPPORTED", "This block has no container that can receive child tasks");
    }

    async resolveChildTarget(value: unknown): Promise<{ available: boolean; parentBlockId: string; containerId?: string; reason?: string }> {
        try {
            const target = await this.resolveChildContainer(value);
            return { available: true, parentBlockId: target.taskBlockId, containerId: target.containerId };
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
        const status = input.status === undefined ? "inbox" : this.parseStatus(input.status);
        const destination = input.destination || { type: this.settings.mcpSettings.defaultCreateTarget };
        if (!destination || typeof destination !== "object" || Array.isArray(destination)) {
            throw new McpToolError("INVALID_INPUT", "destination must be an object");
        }
        if (!(["inbox", "daily_note", "document", "block"] as const).includes(destination.type)) {
            throw new McpToolError("INVALID_INPUT", "destination.type must be inbox, daily_note, document, or block");
        }
        if (input.fields !== undefined && (!input.fields || typeof input.fields !== "object" || Array.isArray(input.fields))) {
            throw new McpToolError("INVALID_INPUT", "fields must be an object");
        }
        if (input.addToMyDay !== undefined && typeof input.addToMyDay !== "boolean") {
            throw new McpToolError("INVALID_INPUT", "addToMyDay must be boolean");
        }
        const schedule = input.schedule === undefined ? null : this.validateSchedule(input.schedule);
        let blockId = "";
        let rollbackBlockId = "";
        let destinationResult: Record<string, any> = {};
        let insertedMeta: InsertedBlockMeta = { id: "", parentId: "", nodeType: "" };
        try {
            if (destination.type === "block") {
                const childTarget = await this.resolveChildContainer(destination.parentBlockId);
                const inserted = await siyuanFetch<any[]>("/api/block/appendBlock", {
                    parentID: childTarget.containerId,
                    dataType: "markdown",
                    data: "- " + escapeMarkdownText(title),
                });
                insertedMeta = extractInsertedBlockMeta(inserted);
                blockId = insertedMeta.id;
                rollbackBlockId = insertedMeta.rootId || blockId;
                destinationResult = { type: "block", parentBlockId: childTarget.taskBlockId, containerId: childTarget.containerId };
            } else if (destination.type === "daily_note") {
                const notebookId = destination.notebookId || this.settings.mcpSettings.dailyNoteNotebookId;
                if (!notebookId) throw new McpToolError("TARGET_NOT_CONFIGURED", "Daily note notebook is not configured");
                const notebooks = await this.listTargetNotebooks();
                if (!notebooks.some(item => item.id === notebookId)) throw new McpToolError("TARGET_NOT_FOUND", `Notebook unavailable: ${notebookId}`);
                const inserted = await siyuanFetch<any[]>("/api/block/appendDailyNoteBlock", { notebook: notebookId, dataType: "markdown", data: escapeMarkdownText(title) });
                insertedMeta = extractInsertedBlockMeta(inserted);
                blockId = insertedMeta.id;
                rollbackBlockId = blockId;
                destinationResult = { type: "daily_note", notebookId };
            } else {
                const rawDocumentId = destination.type === "document" ? destination.documentId : this.settings.mcpSettings.inboxDocumentId;
                if (!rawDocumentId) throw new McpToolError("TARGET_NOT_CONFIGURED", "Inbox document is not configured");
                const document = await this.resolveDocumentTarget(rawDocumentId);
                const inserted = await siyuanFetch<any[]>("/api/block/appendBlock", { parentID: document.id, dataType: "markdown", data: escapeMarkdownText(title) });
                insertedMeta = extractInsertedBlockMeta(inserted);
                blockId = insertedMeta.id;
                rollbackBlockId = blockId;
                destinationResult = { type: destination.type === "document" ? "document" : "inbox", document };
            }
            if (!blockId) throw new McpToolError("SIYUAN_API_ERROR", "SiYuan did not return the inserted block ID");
            if (insertedMeta.nodeType !== "NodeParagraph") {
                throw new McpToolError("SIYUAN_API_ERROR", `Expected a paragraph block, got ${insertedMeta.nodeType || "unknown"}`);
            }

            let task = await this.taskService.convertToTask(blockId, title, kind, {
                knownTextBlock: true,
                parentIdHint: insertedMeta.parentId,
            });
            const patch = (input.fields || {}) as McpTaskPatch;
            if (Object.keys(patch).length) {
                task = await this.taskService.updateTask(blockId, this.attrsFromPatch(patch, task));
            }
            if (status !== task.status) task = await this.taskService.updateTask(blockId, { [ATTR_STATUS]: status });

            const warnings: string[] = [];
            if (input.addToMyDay || schedule) {
                try {
                    await this.taskService.addTaskToMyDay(blockId);
                    if (schedule) await this.taskService.setMyDaySchedule(blockId, schedule.start, schedule.end);
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
                    await siyuanFetch("/api/block/deleteBlock", { id: rollbackBlockId || blockId });
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
        if (input.fields !== undefined && (!input.fields || typeof input.fields !== "object" || Array.isArray(input.fields))) {
            throw new McpToolError("INVALID_INPUT", "fields must be an object");
        }
        const kind = input.kind === "project" ? "2" : "1";
        let task = await this.taskService.convertToTask(blockId, undefined, kind);
        try {
            const patch = (input.fields || {}) as McpTaskPatch;
            if (Object.keys(patch).length) {
                task = await this.taskService.updateTask(blockId, this.attrsFromPatch(patch, task));
            }
            if (input.status !== undefined) task = await this.taskService.updateTask(blockId, { [ATTR_STATUS]: this.parseStatus(input.status) });
            return { task: this.dto(task), warnings: [] };
        } catch (error: any) {
            throw new McpToolError("PARTIAL_SUCCESS", `Block ${blockId} was converted, but initial fields failed: ${String(error?.message || error)}`);
        }
    }

    private async updateTask(input: Record<string, any>) {
        const task = this.requireTask(input.blockId);
        if (!input.patch || typeof input.patch !== "object" || Array.isArray(input.patch)) {
            throw new McpToolError("INVALID_INPUT", "patch must be an object");
        }
        const attrs = this.attrsFromPatch(input.patch as McpTaskPatch, task);
        return { task: this.dto(await this.taskService.updateTask(task.blockId, attrs)) };
    }

    private async setMyDay(input: Record<string, any>) {
        const task = this.requireTask(input.blockId);
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
        return this.enrichMyDay(state);
    }
}
