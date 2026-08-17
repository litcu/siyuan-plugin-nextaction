import { DEFAULT_SETTINGS, type PluginSettings } from "../../src/shared/settings";
import type { MyDayState, TaskChangeSetV2, TaskCacheEntry } from "../../src/shared/types";
import type { SiyuanApiPort, SiyuanLogLevel } from "../../src/kernel/siyuan-api";
import type { TaskChangePublisher } from "../../src/kernel/sync-engine";
import type { MyDayTaskPort } from "../../src/kernel/task-service";
import { setMyDayTaskCompletedAt } from "../../src/shared/my-day";

export interface FakeBlock {
    id: string;
    type: string;
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

    addBlock(id: string, type = "p", content = "Task", box = "notebook", hpath = "/Task"): FakeBlock {
        const block = { id, type, content, box, hpath, attrs: {} };
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
        if (path === "/api/block/getChildBlocks") return [] as T;
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
        const rows = ids.map((id) => this.blocks.get(id)).filter((block): block is FakeBlock => !!block);
        if (/SELECT\s+type\s+FROM/i.test(statement)) return rows.map((block) => ({ type: block.type }));
        if (/SELECT\s+content\s+FROM/i.test(statement)) return rows.map((block) => ({ content: block.content }));
        return rows.map((block) => ({
            id: block.id,
            type: block.type,
            content: block.content,
            parent_id: "",
            box: block.box,
            hpath: block.hpath,
        }));
    }
}

export class FakeTaskChangePublisher implements TaskChangePublisher {
    readonly changes: Array<{ blockId: string; type: "create" | "update" | "delete" }> = [];
    broadcasts = 0;

    addPendingChange(blockId: string, type: "create" | "update" | "delete"): void {
        this.changes.push({ blockId, type });
    }

    broadcastChanges(): void {
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
