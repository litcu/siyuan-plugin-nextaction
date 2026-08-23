import { DEFAULT_SETTINGS, type PluginSettings } from "../../src/shared/settings";
import type { MyDayState, TaskChangeSetV2, TaskCacheEntry } from "../../src/shared/types";
import type { SiyuanApiPort, SiyuanLogLevel } from "../../src/kernel/siyuan-api";
import type { TaskChangePublisher } from "../../src/kernel/sync-engine";
import type { MyDayTaskPort } from "../../src/kernel/task-service";
import { setMyDayTaskCompletedAt } from "../../src/shared/my-day";

export interface FakeBlock {
    id: string;
    type: string;
    subtype: string;
    parentId: string;
    markdown: string;
    content: string;
    box: string;
    hpath: string;
    attrs: Record<string, string>;
}

export class FakeSiyuanApi implements SiyuanApiPort {
    readonly blocks = new Map<string, FakeBlock>();
    readonly notebooks: Array<{ id: string; name: string; icon?: string; closed?: boolean }> = [];
    readonly requests: Array<{ path: string; body: object }> = [];
    readonly broadcasts: Array<{ name: "tasksChangedV2"; payload: TaskChangeSetV2 }> = [];
    readonly logs: Array<{ level: SiyuanLogLevel; message: string }> = [];
    readonly failPaths = new Set<string>();
    readonly failAtRequest = new Map<string, number>();
    readonly requestCounts = new Map<string, number>();
    failBroadcast = false;
    private generatedIdCounter = 0;

    private nextBlockId(): string {
        this.generatedIdCounter++;
        return `20260818000000-${this.generatedIdCounter.toString(36).padStart(7, "0")}`;
    }

    addBlock(
        id: string,
        type = "p",
        content = "Task",
        box = "notebook",
        hpath = "/Task",
        options: { subtype?: string; parentId?: string; markdown?: string } = {},
    ): FakeBlock {
        const block = {
            id,
            type,
            subtype: options.subtype || "",
            parentId: options.parentId || "",
            markdown: options.markdown || content,
            content,
            box,
            hpath,
            attrs: {},
        };
        this.blocks.set(id, block);
        return block;
    }

    async request<T = unknown>(path: string, body: object = {}): Promise<T> {
        this.requests.push({ path, body });
        const requestCount = (this.requestCounts.get(path) || 0) + 1;
        this.requestCounts.set(path, requestCount);
        if (this.failPaths.has(path)) throw new Error(`Fake failure: ${path}`);
        if (this.failAtRequest.get(path) === requestCount) throw new Error(`Fake failure #${requestCount}: ${path}`);
        const input = body as {
            id?: string;
            ids?: string[];
            attrs?: Record<string, string>;
            blockAttrs?: Array<{ id: string; attrs: Record<string, string> }>;
            stmt?: string;
            parentID?: string;
            dataType?: string;
            data?: string;
        };
        if (path === "/api/attr/getBlockAttrs") {
            return { ...(this.blocks.get(input.id || "")?.attrs || {}) } as T;
        }
        if (path === "/api/attr/setBlockAttrs") {
            const block = this.blocks.get(input.id || "");
            if (!block) throw new Error(`Unknown fake block: ${input.id}`);
            Object.assign(block.attrs, input.attrs || {});
            return null as T;
        }
        if (path === "/api/attr/batchGetBlockAttrs") {
            const result: Record<string, Record<string, string>> = {};
            for (const id of input.ids || []) result[id] = { ...(this.blocks.get(id)?.attrs || {}) };
            return result as T;
        }
        if (path === "/api/attr/batchSetBlockAttrs") {
            for (const item of input.blockAttrs || []) {
                const block = this.blocks.get(item.id);
                if (!block) throw new Error(`Unknown fake block: ${item.id}`);
                Object.assign(block.attrs, item.attrs);
            }
            return null as T;
        }
        if (path === "/api/notebook/lsNotebooks") return { notebooks: this.notebooks } as T;
        if (path === "/api/query/sql") return this.queryFromStatement(input.stmt || "") as T;
        if (path === "/api/block/getChildBlocks") {
            return [...this.blocks.values()]
                .filter((block) => block.parentId === input.id)
                .map((block) => ({ id: block.id, type: block.type, subtype: block.subtype })) as T;
        }
        if (path === "/api/block/getBlockDOM") {
            const block = this.blocks.get(input.id || "");
            if (!block) return { id: input.id, dom: "" } as T;
            if (block.type === "l") {
                return {
                    id: block.id,
                    dom: `<div data-node-id="${block.id}" data-type="NodeList" data-subtype="${block.subtype}" class="list"></div>`,
                } as T;
            }
            const textChild = [...this.blocks.values()].find(
                (child) => child.parentId === block.id && (child.type === "p" || child.type === "h"),
            );
            const checked = /\[[^ ]\]/.test(block.markdown);
            return {
                id: block.id,
                dom: `<div data-task="${checked ? "X" : " "}" data-marker="*" data-subtype="${block.subtype}" data-node-id="${block.id}" data-type="NodeListItem" class="li${checked ? " protyle-task--done" : ""}"><div class="protyle-action protyle-action--task"><svg><use xlink:href="#icon${checked ? "Check" : "Uncheck"}"></use></svg></div>${textChild ? `<div data-node-id="${textChild.id}" data-type="NodeParagraph" class="p"><div contenteditable="true">${textChild.content}</div></div>` : ""}</div>`,
            } as T;
        }
        if (path === "/api/block/appendBlock" && /^- \[ \] /.test(input.data || "")) {
            const rootId = this.nextBlockId();
            const listItemId = this.nextBlockId();
            const paragraphId = this.nextBlockId();
            const title = (input.data || "").replace(/^- \[ \] /, "").replace(/\\([\\`*_[\]{}()#+\-.!>|])/g, "$1");
            this.addBlock(rootId, "l", title, "notebook", "/Task", {
                subtype: "t",
                parentId: input.parentID || "",
                markdown: input.data || "",
            });
            this.addBlock(listItemId, "i", title, "notebook", "/Task", {
                subtype: "t",
                parentId: rootId,
                markdown: `- [ ] ${title}`,
            });
            this.addBlock(paragraphId, "p", title, "notebook", "/Task", { parentId: listItemId });
            return [
                {
                    doOperations: [
                        {
                            action: "insert",
                            id: rootId,
                            parentID: input.parentID || "",
                            data: `<div data-node-id="${rootId}" data-type="NodeList" data-subtype="t"><div data-node-id="${listItemId}" data-type="NodeListItem" data-subtype="t" data-task=" "><div data-node-id="${paragraphId}" data-type="NodeParagraph"></div></div></div>`,
                        },
                    ],
                },
            ] as T;
        }
        if (path === "/api/block/updateBlock") {
            const block = this.blocks.get(input.id || "");
            if (!block) throw new Error(`Unknown fake block: ${input.id}`);
            if (input.dataType === "markdown" && /^- \[ \] /.test(input.data || "")) {
                const title = (input.data || "").replace(/^- \[ \] /, "").replace(/\\([\\`*_[\]{}()#+\-.!>|])/g, "$1");
                const listItemId = this.nextBlockId();
                const paragraphId = this.nextBlockId();
                block.type = "l";
                block.subtype = "t";
                block.content = title;
                block.markdown = input.data || "";
                this.addBlock(listItemId, "i", title, block.box, block.hpath, {
                    subtype: "t",
                    parentId: block.id,
                    markdown: `- [ ] ${title}`,
                });
                this.addBlock(paragraphId, "p", title, block.box, block.hpath, { parentId: listItemId });
                return [
                    {
                        doOperations: [
                            {
                                action: "update",
                                id: block.id,
                                parentID: block.parentId,
                                data: `<div data-node-id="${block.id}" data-type="NodeList" data-subtype="t"><div data-node-id="${listItemId}" data-type="NodeListItem" data-subtype="t" data-task=" "><div data-node-id="${paragraphId}" data-type="NodeParagraph"></div></div></div>`,
                            },
                        ],
                    },
                ] as T;
            }
            if (input.dataType === "dom") {
                const openingTag = (input.data || "").match(/^\s*<[^>]+>/)?.[0] || "";
                const subtype = openingTag.match(/data-subtype=["']([^"']*)["']/i)?.[1];
                if (subtype) block.subtype = subtype;
                if (block.type === "i" && !/\sdata-task=["']/i.test(openingTag)) {
                    block.markdown = block.markdown.replace(/\[[^\]]\]\s*/, "");
                }
            } else {
                block.content = input.data || "";
                block.markdown = input.data || "";
            }
            return [{ doOperations: [{ action: "update", id: block.id, data: input.data || "" }] }] as T;
        }
        return null as T;
    }

    getBlockAttrs(blockId: string): Promise<Record<string, string>> {
        return this.request("/api/attr/getBlockAttrs", { id: blockId });
    }

    async setBlockAttrs(blockId: string, attrs: Record<string, string>): Promise<void> {
        await this.request("/api/attr/setBlockAttrs", { id: blockId, attrs });
    }

    batchGetBlockAttrs(blockIds: string[]): Promise<Record<string, Record<string, string>>> {
        return this.request("/api/attr/batchGetBlockAttrs", { ids: blockIds });
    }

    async batchSetBlockAttrs(blockAttrs: Array<{ id: string; attrs: Record<string, string> }>): Promise<void> {
        await this.request("/api/attr/batchSetBlockAttrs", { blockAttrs });
    }

    async updateTaskListItemMarker(id: string, marker: string): Promise<void> {
        await this.request("/api/block/updateTaskListItemMarker", { id, marker });
        const block = this.blocks.get(id);
        if (!block) throw new Error(`Unknown fake block: ${id}`);
        block.markdown = block.markdown.replace(/\[[^\]]\]/, `[${marker}]`);
    }

    async batchUpdateTaskListItemMarker(items: Array<{ id: string; marker: string }>): Promise<void> {
        for (const item of items) await this.updateTaskListItemMarker(item.id, item.marker);
    }

    async query<T = Record<string, unknown>>(statement: string): Promise<T[]> {
        return this.request<T[]>("/api/query/sql", { stmt: statement });
    }

    broadcast(name: "tasksChangedV2", payload: TaskChangeSetV2): void {
        if (this.failBroadcast) throw new Error("Fake broadcast failure");
        this.broadcasts.push({ name, payload });
    }

    log(level: SiyuanLogLevel, message: string): void {
        this.logs.push({ level, message });
    }

    private queryFromStatement(statement: string): Array<Record<string, string>> {
        const ids = [...statement.matchAll(/'(\d{14}-[0-9a-z]{7})'/g)].map((match) => match[1]);
        if (/parent\.type\s+AS\s+parent_type/i.test(statement) && ids[0]) {
            const block = this.blocks.get(ids[0]);
            const parent = block?.parentId ? this.blocks.get(block.parentId) : undefined;
            return block
                ? [
                      {
                          subtype: block.subtype,
                          parent_id: block.parentId,
                          parent_type: parent?.type || "",
                          parent_subtype: parent?.subtype || "",
                      },
                  ]
                : [];
        }
        if (/WITH\s+RECURSIVE\s+selected/i.test(statement) && ids[0]) {
            const selected: FakeBlock[] = [];
            const queue = [ids[0]];
            const visited = new Set<string>();
            while (queue.length) {
                const id = queue.shift()!;
                if (visited.has(id)) continue;
                visited.add(id);
                const block = this.blocks.get(id);
                if (!block) continue;
                selected.push(block);
                for (const child of this.blocks.values()) if (child.parentId === id) queue.push(child.id);
            }
            return selected.map((block, index) => ({
                id: block.id,
                parent_id: block.parentId,
                type: block.type,
                subtype: block.subtype,
                sort: String(index),
            }));
        }
        if (/WITH\s+RECURSIVE\s+ancestors/i.test(statement) && ids[0]) {
            const ancestors: FakeBlock[] = [];
            let current = this.blocks.get(ids[0]);
            const visited = new Set<string>();
            while (current && !visited.has(current.id)) {
                ancestors.push(current);
                visited.add(current.id);
                current = current.parentId ? this.blocks.get(current.parentId) : undefined;
            }
            return ancestors.map((block) => ({
                id: block.id,
                parent_id: block.parentId,
                type: block.type,
                subtype: block.subtype,
            }));
        }
        if (/WITH\s+RECURSIVE\s+ancestry/i.test(statement) && ids[0]) {
            const ancestors: FakeBlock[] = [];
            let current = this.blocks.get(ids[0]);
            const visited = new Set<string>();
            while (current && !visited.has(current.id)) {
                ancestors.push(current);
                visited.add(current.id);
                if (current.type === "d") break;
                current = current.parentId ? this.blocks.get(current.parentId) : undefined;
            }
            return ancestors.map((block, depth) => {
                const parent = this.blocks.get(block.parentId);
                const textChild = [...this.blocks.values()].find(
                    (child) => child.parentId === block.id && (child.type === "p" || child.type === "h"),
                );
                return {
                    id: block.id,
                    parent_id: block.parentId,
                    type: block.type,
                    subtype: block.subtype,
                    content: block.content,
                    markdown: block.markdown,
                    sort: String(depth),
                    updated: "",
                    depth: String(depth),
                    parent_type: parent?.type || "",
                    parent_subtype: parent?.subtype || "",
                    content_block_id: textChild?.id || "",
                    content_title: textChild?.content || "",
                };
            });
        }
        const rows = ids.map((id) => this.blocks.get(id)).filter((block): block is FakeBlock => !!block);
        if (/SELECT\s+type\s+FROM/i.test(statement)) return rows.map((block) => ({ type: block.type }));
        if (/SELECT\s+content\s+FROM/i.test(statement)) return rows.map((block) => ({ content: block.content }));
        return rows.map((block) => ({
            id: block.id,
            type: block.type,
            subtype: block.subtype,
            content: block.content,
            markdown: block.markdown,
            parent_id: block.parentId,
            box: block.box,
            hpath: block.hpath,
        }));
    }
}

export class FakeTaskChangePublisher implements TaskChangePublisher {
    readonly changes: string[] = [];
    broadcasts = 0;

    publishChanges(blockIds: readonly string[]): void {
        this.changes.push(...blockIds);
        this.broadcasts++;
    }
}

export class FakeMyDayTaskPort implements MyDayTaskPort {
    settings: PluginSettings = { ...DEFAULT_SETTINGS };
    state: MyDayState = { schema: 1, dayKey: "2026-08-16", tasks: [], updatedAt: 0 };

    updateSettings(settings: PluginSettings): void {
        this.settings = settings;
    }
    async getState(): Promise<MyDayState> {
        return this.state;
    }
    async addTask(blockId: string): Promise<MyDayState> {
        this.state.tasks.push({
            blockId,
            addedAt: Date.now(),
            order: this.state.tasks.length,
            scheduleStart: null,
            scheduleEnd: null,
        });
        return this.state;
    }
    async removeTask(blockId: string): Promise<MyDayState> {
        this.state.tasks = this.state.tasks.filter((item) => item.blockId !== blockId);
        return this.state;
    }
    async reorderTask(): Promise<MyDayState> {
        return this.state;
    }
    async setSchedule(): Promise<MyDayState> {
        return this.state;
    }
    async removeSchedule(): Promise<MyDayState> {
        return this.state;
    }
    async markTaskCompleted(blockId: string, completedAt: number): Promise<MyDayState> {
        this.state = setMyDayTaskCompletedAt(this.state, blockId, completedAt);
        return this.state;
    }
    async clearTaskCompleted(blockId: string): Promise<MyDayState> {
        this.state = setMyDayTaskCompletedAt(this.state, blockId, undefined);
        return this.state;
    }
}

export function taskFactory(blockId: string, overrides: Partial<TaskCacheEntry> = {}): TaskCacheEntry {
    return {
        blockId,
        identificationSource: "document",
        attrHostId: blockId,
        parentId: "",
        status: "todo",
        priority: "medium",
        importance: 4,
        effort: 4,
        due: "",
        start: "",
        context: "",
        taskType: "1",
        order: 0,
        childIds: [],
        title: "Task",
        depends: "",
        depMode: "all",
        sequential: false,
        repeat: "",
        repeatState: "",
        sort: -1,
        completed: "",
        note: "",
        created: "",
        tags: "",
        blocked: false,
        blockedReason: "",
        reviewInterval: 0,
        reviewDate: "",
        reminder: "",
        customFields: {},
        ...overrides,
    };
}
