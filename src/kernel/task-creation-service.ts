import type { PluginSettings } from "../shared/settings";
import {
    CREATE_TASK_DESTINATION_TYPES,
    CREATE_TASK_FORMATS,
    type CreateTaskFormat,
    type CreateTaskInput,
} from "../shared/task-creation";
import { TASK_WARNING_PROJECT_REOPENED } from "../shared/constants";
import type { TaskCacheEntry } from "../shared/types";
import { getErrorMessage, McpToolError } from "./mcp-tool-error";
import { escapeMarkdownText, extractBlockId, extractInsertedBlockMeta, type InsertedBlockMeta } from "./mcp-utils";
import type { SiyuanApiPort } from "./siyuan-api";
import type { TaskService } from "./task-service";
import type { TaskTargetResolver } from "./task-target-resolver";

export interface TaskCreationOutcome {
    task: TaskCacheEntry;
    destination: Record<string, unknown>;
    warnings: string[];
}

export type TaskPropertyApplier = (
    task: TaskCacheEntry,
    properties: Record<string, unknown>,
) => Promise<TaskCacheEntry>;

export class TaskCreationService {
    constructor(
        private readonly taskService: TaskService,
        private readonly api: SiyuanApiPort,
        private readonly targets: TaskTargetResolver,
        private readonly getSettings: () => PluginSettings,
    ) {}

    async create(input: CreateTaskInput, applyProperties?: TaskPropertyApplier): Promise<TaskCreationOutcome> {
        if (typeof input.title !== "string") throw new McpToolError("INVALID_INPUT", "title is required");
        const title = input.title.replace(/[\r\n]+/g, " ").trim();
        if (!title || title.length > 512)
            throw new McpToolError("INVALID_INPUT", "title must contain 1-512 characters");
        if (input.kind !== undefined && input.kind !== "task" && input.kind !== "project") {
            throw new McpToolError("INVALID_INPUT", "kind must be task or project");
        }
        const kind = input.kind === "project" ? "2" : "1";
        const settings = this.getSettings();
        const destination = input.destination || { type: settings.taskCreationSettings.defaultCreateTarget };
        if (!destination || typeof destination !== "object" || Array.isArray(destination)) {
            throw new McpToolError("INVALID_INPUT", "destination must be an object");
        }
        if (!(CREATE_TASK_DESTINATION_TYPES as readonly string[]).includes(destination.type)) {
            throw new McpToolError("INVALID_INPUT", "destination.type must be inbox, daily_note, document, or block");
        }
        const format: CreateTaskFormat =
            destination.type === "block"
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
        if (
            input.properties !== undefined &&
            (!input.properties || typeof input.properties !== "object" || Array.isArray(input.properties))
        ) {
            throw new McpToolError("INVALID_INPUT", "properties must be an object");
        }
        if (input.addToMyDay !== undefined && typeof input.addToMyDay !== "boolean") {
            throw new McpToolError("INVALID_INPUT", "addToMyDay must be boolean");
        }
        const schedule = input.schedule === undefined ? null : this.validateSchedule(input.schedule);
        let blockId = "";
        let rollbackBlockId = "";
        let destinationResult: Record<string, unknown> = {};
        let insertedMeta: InsertedBlockMeta = { id: "", parentId: "", nodeType: "" };
        let parentTaskHint = "";
        let createdDocument = false;
        try {
            if (kind === "2" || format === "document") {
                const created = await this.targets.createChildDocument(title, destination);
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
                const childTarget = await this.targets.resolveChildContainer(destination.parentBlockId, false);
                const inserted = await this.api.request<unknown[]>("/api/block/appendBlock", {
                    parentID: childTarget.containerId,
                    dataType: "markdown",
                    data: `- [ ] ${escapeMarkdownText(title)}`,
                });
                parentTaskHint = childTarget.taskBlockId;
                insertedMeta = extractInsertedBlockMeta(inserted);
                blockId = insertedMeta.id;
                rollbackBlockId = insertedMeta.rootId || blockId;
                insertedMeta = await this.targets.resolveInsertedTaskBlock(insertedMeta);
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
                const notebookId = destination.notebookId || settings.taskCreationSettings.dailyNoteNotebookId;
                if (!notebookId)
                    throw new McpToolError("TARGET_NOT_CONFIGURED", "Daily note notebook is not configured");
                const notebooks = await this.targets.listNotebooks();
                if (!notebooks.some((item) => item.id === notebookId)) {
                    throw new McpToolError("TARGET_NOT_FOUND", `Notebook unavailable: ${notebookId}`);
                }
                const inserted = await this.api.request<unknown[]>("/api/block/appendDailyNoteBlock", {
                    notebook: notebookId,
                    dataType: "markdown",
                    data: `- [ ] ${escapeMarkdownText(title)}`,
                });
                insertedMeta = extractInsertedBlockMeta(inserted);
                blockId = insertedMeta.id;
                rollbackBlockId = insertedMeta.rootId || blockId;
                insertedMeta = await this.targets.resolveInsertedTaskBlock(insertedMeta);
                blockId = insertedMeta.id;
                rollbackBlockId = insertedMeta.rootId || blockId;
                destinationResult = { type: "daily_note", format, notebookId };
            } else {
                const rawDocumentId =
                    destination.type === "document"
                        ? destination.documentId
                        : settings.taskCreationSettings.inboxDocumentId;
                if (!rawDocumentId) throw new McpToolError("TARGET_NOT_CONFIGURED", "Inbox document is not configured");
                const document = await this.targets.resolveDocument(rawDocumentId);
                const inserted = await this.api.request<unknown[]>("/api/block/appendBlock", {
                    parentID: document.id,
                    dataType: "markdown",
                    data: `- [ ] ${escapeMarkdownText(title)}`,
                });
                insertedMeta = extractInsertedBlockMeta(inserted);
                blockId = insertedMeta.id;
                rollbackBlockId = insertedMeta.rootId || blockId;
                insertedMeta = await this.targets.resolveInsertedTaskBlock(insertedMeta);
                blockId = insertedMeta.id;
                rollbackBlockId = insertedMeta.rootId || blockId;
                destinationResult = { type: destination.type === "document" ? "document" : "inbox", format, document };
            }
            if (!blockId) throw new McpToolError("SIYUAN_API_ERROR", "SiYuan did not return the inserted block ID");
            const expectedNodeType = kind === "2" || format === "document" ? "NodeDocument" : "NodeListItem";
            if (insertedMeta.nodeType !== expectedNodeType) {
                throw new McpToolError(
                    "SIYUAN_API_ERROR",
                    `Expected ${expectedNodeType}, got ${insertedMeta.nodeType || "unknown"}`,
                );
            }

            let task = await this.taskService.convertToTask(blockId, kind === "2" ? undefined : title, kind, {
                parentIdHint: parentTaskHint || insertedMeta.parentId,
                evidence:
                    kind === "2" || format === "document"
                        ? { kind: "verified-document", blockId, title }
                        : {
                              kind: "inserted-native",
                              blockId,
                              contentBlockId: insertedMeta.contentBlockId,
                              parentId: insertedMeta.parentId,
                              title,
                          },
            });
            let projectReopened = task._warning === TASK_WARNING_PROJECT_REOPENED;
            const taskBlockId = task.blockId;
            const properties = (input.properties || {}) as Record<string, unknown>;
            if (Object.keys(properties).length) {
                if (!applyProperties)
                    throw new McpToolError("INVALID_INPUT", "Initial properties are not supported by this caller");
                task = await applyProperties(task, properties);
                projectReopened ||= task._warning === TASK_WARNING_PROJECT_REOPENED;
            }

            const warnings: string[] = [];
            if (projectReopened) warnings.push(TASK_WARNING_PROJECT_REOPENED);
            if (input.addToMyDay || schedule) {
                try {
                    await this.taskService.addTaskToMyDay(taskBlockId);
                    if (schedule) await this.taskService.setMyDaySchedule(taskBlockId, schedule.start, schedule.end);
                } catch (error: unknown) {
                    warnings.push(`My Day update failed: ${getErrorMessage(error)}`);
                }
            }
            return { task, destination: destinationResult, warnings };
        } catch (error: unknown) {
            if (blockId) {
                try {
                    if (this.taskService.getTask(blockId)) {
                        try {
                            await this.taskService.removeTask(blockId);
                        } catch {
                            // Deleting the inserted block remains the authoritative rollback.
                        }
                    }
                    if (createdDocument) {
                        await this.api.request("/api/filetree/removeDocByID", { id: blockId });
                    } else {
                        await this.api.request("/api/block/deleteBlock", { id: rollbackBlockId || blockId });
                    }
                } catch (rollbackError: unknown) {
                    throw new McpToolError(
                        "PARTIAL_SUCCESS",
                        `Task creation failed and rollback failed; orphan block: ${blockId}; ${getErrorMessage(rollbackError)}`,
                    );
                }
            }
            throw error;
        }
    }

    async convertExisting(
        input: Record<string, unknown>,
        applyProperties?: TaskPropertyApplier,
    ): Promise<{ task: TaskCacheEntry; warnings: string[] }> {
        const blockId = extractBlockId(input.blockId);
        if (!blockId) throw new McpToolError("INVALID_INPUT", "blockId is invalid");
        if (input.kind !== undefined && input.kind !== "task" && input.kind !== "project") {
            throw new McpToolError("INVALID_INPUT", "kind must be task or project");
        }
        if (
            input.properties !== undefined &&
            (!input.properties || typeof input.properties !== "object" || Array.isArray(input.properties))
        ) {
            throw new McpToolError("INVALID_INPUT", "properties must be an object");
        }
        const kind = input.kind === "project" ? "2" : "1";
        let task = await this.taskService.convertToTask(blockId, undefined, kind);
        try {
            const properties = (input.properties || {}) as Record<string, unknown>;
            if (Object.keys(properties).length) {
                if (!applyProperties)
                    throw new McpToolError("INVALID_INPUT", "Initial properties are not supported by this caller");
                task = await applyProperties(task, properties);
            }
            return { task, warnings: [] };
        } catch (error: unknown) {
            throw new McpToolError(
                "PARTIAL_SUCCESS",
                `Block ${blockId} was converted, but initial fields failed: ${getErrorMessage(error)}`,
            );
        }
    }

    validateSchedule(value: unknown): { start: number; end: number } {
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
}
