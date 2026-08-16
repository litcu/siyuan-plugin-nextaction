import type { PluginSettings } from "../shared/settings";
import { sql } from "../shared/sql";
import type { CreateTaskDestination } from "../shared/task-creation";
import type { SiyuanApiPort } from "./siyuan-api";
import { getErrorMessage, McpToolError } from "./mcp-tool-error";
import {
    extractBlockId,
    extractDocumentIdFromPath,
    type InsertedBlockMeta,
} from "./mcp-utils";

export interface TaskNotebookTarget {
    id: string;
    name: string;
    icon: string;
}

export interface TaskDocumentTarget {
    id: string;
    title: string;
    notebookId: string;
    notebookName?: string;
    path?: string;
    icon?: string;
}

export interface TaskDocumentListItem extends TaskDocumentTarget {
    path: string;
    icon: string;
    hasChildren: boolean;
}

export class TaskTargetResolver {
    constructor(
        private readonly api: SiyuanApiPort,
        private readonly getSettings: () => PluginSettings,
    ) {}

    async listNotebooks(): Promise<TaskNotebookTarget[]> {
        const data = await this.api.request<{ notebooks?: Array<{ id: string; name: string; icon?: string; closed?: boolean }> }>(
            "/api/notebook/lsNotebooks",
            {},
        );
        return (data?.notebooks || [])
            .filter(notebook => !notebook.closed)
            .map(notebook => ({ id: notebook.id, name: notebook.name, icon: notebook.icon || "" }));
    }

    async listDocuments(notebookId: string, path = "/"): Promise<{ notebookId: string; path: string; items: TaskDocumentListItem[] }> {
        if (typeof notebookId !== "string" || !notebookId.trim()) throw new McpToolError("INVALID_INPUT", "notebookId is required");
        if (typeof path !== "string" || !path.startsWith("/")) throw new McpToolError("INVALID_INPUT", "path must start with /");
        const data = await this.api.request<{ box?: string; path?: string; files?: Array<{ id?: string; name?: string; icon?: string; path?: string; subFileCount?: number }> }>(
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

    async searchDocuments(query: string): Promise<TaskDocumentListItem[]> {
        const keyword = typeof query === "string" ? query.trim() : "";
        if (!keyword) return [];
        const results = await this.api.request<Array<{ path?: string; hPath?: string; box?: string; boxIcon?: string }>>(
            "/api/filetree/searchDocs",
            { k: keyword, flashcard: false },
        );
        const notebooks = new Map((await this.listNotebooks()).map(notebook => [notebook.id, notebook]));
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

    async resolveDocument(value: unknown): Promise<TaskDocumentTarget> {
        const id = extractBlockId(value);
        if (!id) throw new McpToolError("INVALID_INPUT", "Invalid SiYuan document ID or block link");
        const rows = await this.api.query<{ id: string; type: string; content: string; box: string; hpath: string }>(
            sql`SELECT id, type, content, box, hpath FROM blocks WHERE id = ${id} LIMIT 1`,
        );
        if (!rows?.length) throw new McpToolError("TARGET_NOT_FOUND", `Document not found: ${id}`);
        if (rows[0].type !== "d") throw new McpToolError("TARGET_NOT_DOCUMENT", `Block is not a document: ${id}`);
        const notebooks = await this.listNotebooks();
        if (!notebooks.some(notebook => notebook.id === rows[0].box)) {
            throw new McpToolError("TARGET_NOT_FOUND", `Document notebook is closed or unavailable: ${id}`);
        }
        return { id, title: rows[0].content || "", notebookId: rows[0].box || "", path: rows[0].hpath || "" };
    }

    async createChildDocument(title: string, destination: CreateTaskDestination): Promise<{
        document: TaskDocumentTarget;
        parent: TaskDocumentTarget;
    }> {
        let parent: TaskDocumentTarget;
        const settings = this.getSettings();
        if (destination.type === "daily_note") {
            const notebookId = destination.notebookId || settings.taskCreationSettings.dailyNoteNotebookId;
            if (!notebookId) throw new McpToolError("TARGET_NOT_CONFIGURED", "Daily note notebook is not configured");
            const notebooks = await this.listNotebooks();
            if (!notebooks.some(item => item.id === notebookId)) {
                throw new McpToolError("TARGET_NOT_FOUND", `Notebook unavailable: ${notebookId}`);
            }
            const dailyNote = await this.api.request<{ id?: string }>("/api/filetree/createDailyNote", { notebook: notebookId });
            if (!dailyNote?.id) throw new McpToolError("SIYUAN_API_ERROR", "SiYuan did not return the daily note document ID");
            parent = await this.resolveDocument(dailyNote.id);
        } else {
            const rawDocumentId = destination.type === "document"
                ? destination.documentId
                : settings.taskCreationSettings.inboxDocumentId;
            if (!rawDocumentId) throw new McpToolError("TARGET_NOT_CONFIGURED", "Inbox document is not configured");
            parent = await this.resolveDocument(rawDocumentId);
        }

        if (!parent.path) throw new McpToolError("TARGET_NOT_FOUND", `Document path is unavailable: ${parent.id}`);
        const baseTitle = title.replace(/\//g, "／");
        let documentTitle = baseTitle;
        let documentPath = "";
        for (let suffix = 1; suffix <= 100; suffix++) {
            documentTitle = suffix === 1 ? baseTitle : `${baseTitle} (${suffix})`;
            documentPath = `${parent.path.replace(/\/$/, "")}/${documentTitle}`;
            const existing = await this.api.request<string[]>("/api/filetree/getIDsByHPath", {
                notebook: parent.notebookId,
                path: documentPath,
            });
            if (!existing?.length) break;
            documentPath = "";
        }
        if (!documentPath) throw new McpToolError("SIYUAN_API_ERROR", "Could not allocate a unique task document path");

        const id = await this.api.request<string>("/api/filetree/createDocWithMd", {
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

    async resolveChildContainer(value: unknown, reuseNestedList = true): Promise<{ taskBlockId: string; containerId: string; containerType: string }> {
        const taskBlockId = extractBlockId(value);
        if (!taskBlockId) throw new McpToolError("INVALID_INPUT", "parentBlockId is invalid");
        const rows = await this.api.query<{ id: string; parent_id: string; type: string }>(
            sql`WITH RECURSIVE ancestors(id, parent_id, type) AS (
                SELECT id, parent_id, type FROM blocks WHERE id = ${taskBlockId}
                UNION ALL SELECT b.id, b.parent_id, b.type FROM blocks b INNER JOIN ancestors a ON b.id = a.parent_id
            ) SELECT id, parent_id, type FROM ancestors`,
        );
        if (!rows?.length) throw new McpToolError("TARGET_NOT_FOUND", `Parent block unavailable: ${taskBlockId}`);
        const byId = new Map(rows.map(row => [row.id, row]));
        const containerTypes = new Set(["b", "d", "i", "l", "s", "callout"]);
        let current = byId.get(taskBlockId);
        while (current) {
            if (containerTypes.has(current.type)) {
                if (current.type === "i" && reuseNestedList) {
                    try {
                        const children = await this.api.request<Array<{ id?: string; type?: string }>>("/api/block/getChildBlocks", {
                            id: current.id,
                        });
                        const nestedList = Array.isArray(children)
                            ? [...children].reverse().find(item => item?.id && item.type === "l")
                            : undefined;
                        if (nestedList?.id) return { taskBlockId, containerId: nestedList.id, containerType: "l" };
                    } catch {
                        // Fall back to the list item so SiYuan can create the first nested list.
                    }
                }
                return { taskBlockId, containerId: current.id, containerType: current.type };
            }
            if (!current.parent_id) break;
            current = byId.get(current.parent_id);
        }
        throw new McpToolError("TARGET_UNSUPPORTED", "This block has no container that can receive child tasks");
    }

    async resolveInsertedTaskBlock(meta: InsertedBlockMeta): Promise<InsertedBlockMeta> {
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
                const result = await this.api.request<Array<{ id?: string; type?: string }>>("/api/block/getChildBlocks", { id: currentId });
                children = Array.isArray(result) ? result : [];
            } catch {
                children = [];
            }
            const paragraph = children.find(child => child?.id && child.type === "p");
            if (paragraph?.id) return { id: paragraph.id, parentId: currentId, nodeType: "NodeParagraph", rootId };
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
        } catch (error: unknown) {
            return { available: false, parentBlockId: extractBlockId(value), reason: getErrorMessage(error) };
        }
    }

    async validateSettings(settings: PluginSettings): Promise<void> {
        const mcp = settings.mcpSettings;
        if (!mcp.enabled || !mcp.allowWrite) return;
        const creation = settings.taskCreationSettings;
        if (creation.defaultCreateTarget === "inbox") {
            if (!creation.inboxDocumentId) throw new McpToolError("TARGET_NOT_CONFIGURED", "MCP inbox document is required");
            await this.resolveDocument(creation.inboxDocumentId);
        } else {
            if (!creation.dailyNoteNotebookId) throw new McpToolError("TARGET_NOT_CONFIGURED", "Daily note notebook is required");
            const notebooks = await this.listNotebooks();
            if (!notebooks.some(item => item.id === creation.dailyNoteNotebookId)) {
                throw new McpToolError("TARGET_NOT_FOUND", `Notebook is closed or unavailable: ${creation.dailyNoteNotebookId}`);
            }
        }
    }
}
