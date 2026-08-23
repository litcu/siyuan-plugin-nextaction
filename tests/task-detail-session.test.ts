import test from "node:test";
import assert from "node:assert/strict";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import type { KernelBridge } from "../src/frontend/kernel-bridge.ts";
import type { TaskDetailDraft } from "../src/frontend/utils/task-detail-draft.ts";
import { createTaskDetailTaskSource, taskStore } from "../src/frontend/stores/task-store.ts";
import {
    TaskDetailSession,
    TaskDetailTransitionQueue,
    rebaseTaskDetailDraft,
    taskDetailDraftToAttrs,
    taskToTaskDetailDraft,
    type TaskDetailSessionOptions,
    type TaskDetailTaskSource,
    type TaskDetailTransition,
} from "../src/frontend/controllers/task-detail-controller.ts";

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function task(blockId = "task", overrides: Partial<TaskCacheEntry> = {}): TaskCacheEntry {
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
        title: blockId,
        depends: "",
        depMode: "all",
        sequential: false,
        repeat: "",
        repeatState: "",
        sort: 0,
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

class MemoryTaskSource implements TaskDetailTaskSource {
    readonly tasks = new Map<string, TaskCacheEntry>();
    readonly commits: TaskCacheEntry[] = [];
    readonly removals: string[] = [];
    private readonly observers = new Map<string, Set<(task: TaskCacheEntry | null) => void>>();

    constructor(tasks: TaskCacheEntry[]) {
        for (const entry of tasks) this.tasks.set(entry.blockId, entry);
    }

    async resolve(blockId: string): Promise<TaskCacheEntry | null> {
        return this.tasks.get(blockId) || null;
    }

    observe(blockId: string, listener: (task: TaskCacheEntry | null) => void): () => void {
        const listeners = this.observers.get(blockId) || new Set();
        listeners.add(listener);
        this.observers.set(blockId, listeners);
        const current = this.tasks.get(blockId);
        if (current) listener(current);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) this.observers.delete(blockId);
        };
    }

    commit(entry: TaskCacheEntry): void {
        this.commits.push(entry);
        this.tasks.set(entry.blockId, entry);
        this.emit(entry.blockId, entry);
    }

    remove(blockId: string): void {
        this.removals.push(blockId);
        this.tasks.delete(blockId);
        this.emit(blockId, null);
    }

    push(entry: TaskCacheEntry): void {
        this.tasks.set(entry.blockId, entry);
        this.emit(entry.blockId, entry);
    }

    delete(blockId: string): void {
        this.tasks.delete(blockId);
        this.emit(blockId, null);
    }

    listenerCount(blockId: string): number {
        return this.observers.get(blockId)?.size || 0;
    }

    private emit(blockId: string, entry: TaskCacheEntry | null): void {
        for (const listener of this.observers.get(blockId) || []) listener(entry);
    }
}

function entryFromDraft(blockId: string, draft: TaskDetailDraft): TaskCacheEntry {
    return task(blockId, {
        status: draft.status,
        priority: draft.priority,
        importance: draft.importance,
        effort: draft.effort,
        due: draft.due,
        start: draft.start,
        note: draft.note,
        context: draft.contexts.join("|"),
        tags: draft.taskTags.join("|"),
        parentId: draft.parentId,
        depends: draft.depends.join("|"),
        depMode: draft.depMode,
        sequential: draft.sequentialEnabled,
        taskType: draft.taskType,
        reviewInterval: draft.reviewInterval,
        reviewDate: draft.reviewDate,
        customFields: { ...draft.customFieldValues },
    });
}

function createSession(
    initial: TaskCacheEntry,
    source: MemoryTaskSource,
    overrides: Partial<TaskDetailSessionOptions> = {},
): TaskDetailSession {
    return new TaskDetailSession(initial, {
        source,
        debounceMs: 60_000,
        save: async (blockId, draft) => entryFromDraft(blockId, draft),
        remove: async () => undefined,
        formatError: (error) => (error instanceof Error ? error.message : String(error)),
        missingTaskMessage: "missing task",
        ...overrides,
    });
}

// Regression: V2/本地集合更新过去不会进入已经打开的任务详情。
test("实时任务更新进入 session，并按字段 rebase 保留本地脏草稿", () => {
    const initial = task("a", { note: "old", due: "2026-08-20", context: "home" });
    const source = new MemoryTaskSource([initial]);
    const session = createSession(initial, source);
    session.edit({ note: "local" });

    source.push(task("a", { note: "remote", due: "2026-08-22", context: "office" }));

    assert.equal(session.snapshot.draft.note, "local");
    assert.equal(session.snapshot.draft.due, "2026-08-22");
    assert.deepEqual(session.snapshot.draft.contexts, ["office"]);
    assert.deepEqual([...session.snapshot.dirtyFields], ["note"]);
    session.dispose();
});

test("无关任务更新不改变当前 session", () => {
    const initial = task("a", { due: "2026-08-20" });
    const other = task("b");
    const source = new MemoryTaskSource([initial, other]);
    const session = createSession(initial, source);
    source.push(task("b", { due: "2026-08-30" }));
    assert.equal(session.snapshot.task, initial);
    assert.equal(session.snapshot.draft.due, "2026-08-20");
    session.dispose();
});

test("任务切换先保存草稿并把实时订阅移动到新任务", async () => {
    const initial = task("a");
    const next = task("b");
    const source = new MemoryTaskSource([initial, next]);
    const saved: string[] = [];
    const session = createSession(initial, source, {
        save: async (blockId, draft) => {
            saved.push(`${blockId}:${draft.note}`);
            return entryFromDraft(blockId, draft);
        },
    });
    session.edit({ note: "save before switch" });

    assert.equal(await session.transition({ type: "task", blockId: "b" }), "applied");
    assert.deepEqual(saved, ["a:save before switch"]);
    assert.equal(session.snapshot.task.blockId, "b");
    assert.equal(source.listenerCount("a"), 0);
    assert.equal(source.listenerCount("b"), 1);
    session.dispose();
});

// Regression: 保存期间连续选择两个任务时，后一个目标不能复用前一个转换结果而被静默丢弃。
test("转换协调器按顺序执行保存期间到达的不同目标", async () => {
    const queue = new TaskDetailTransitionQueue();
    const firstFinished = deferred<boolean>();
    const visited: string[] = [];
    const run = async (target: TaskDetailTransition): Promise<boolean> => {
        assert.equal(target.type, "task");
        if (target.type !== "task") return false;
        visited.push(target.blockId);
        if (target.blockId === "b") return firstFinished.promise;
        return true;
    };

    const first = queue.run({ type: "task", blockId: "b" }, run);
    const second = queue.run({ type: "task", blockId: "c" }, run);
    assert.deepEqual(visited, ["b"]);
    firstFinished.resolve(true);

    assert.equal(await first, true);
    assert.equal(await second, true);
    assert.deepEqual(visited, ["b", "c"]);
});

// Regression: 目标解析期间发生外部删除后，已终止的 session 不得重新保存当前脏草稿。
test("目标解析期间外部删除不会在 controller 销毁后重新启动保存", async () => {
    const initial = task("a");
    const next = task("b");
    const source = new MemoryTaskSource([initial, next]);
    const target = deferred<TaskCacheEntry | null>();
    source.resolve = async () => target.promise;
    let saves = 0;
    const session = createSession(initial, source, {
        save: async () => {
            saves++;
            if (saves > 1) throw new Error("stop recursive save");
            return initial;
        },
    });
    session.edit({ note: "must not be saved" });

    const switching = session.transition({ type: "task", blockId: "b" });
    await Promise.resolve();
    source.delete("a");
    target.resolve(next);

    assert.equal(await switching, "blocked");
    assert.equal(saves, 0);
    session.dispose();
});

// Regression: 内核 fallback 找到的任务必须先进入实时集合，不能在开始观察时被误报为删除。
test("远端 resolve fallback 保持目标 session 可用", async () => {
    const initial = task("source-a");
    const remote = task("source-b");
    taskStore.setBridge({
        getTaskSnapshotV2: async () => ({
            schema: 2,
            streamId: "task-detail-source",
            revision: 0,
            tasks: [initial],
        }),
    } as unknown as KernelBridge);
    await taskStore.loadTasks();
    const source = createTaskDetailTaskSource(async (blockId) => (blockId === remote.blockId ? remote : null));
    const session = new TaskDetailSession(initial, {
        source,
        debounceMs: 60_000,
        save: async () => initial,
        remove: async () => undefined,
        formatError: String,
        missingTaskMessage: "missing task",
    });

    try {
        assert.equal(await session.transition({ type: "task", blockId: remote.blockId }), "applied");
        assert.equal(session.snapshot.task.blockId, remote.blockId);
        assert.equal(session.snapshot.availability, "available");
    } finally {
        session.dispose();
        taskStore.applyRemove(initial.blockId);
        taskStore.applyRemove(remote.blockId);
        taskStore.disposeSync();
    }
});

test("保存失败时转换等待丢弃确认，取消与确认分别保持和切换任务", async () => {
    const initial = task("a");
    const next = task("b");
    const source = new MemoryTaskSource([initial, next]);
    const session = createSession(initial, source, {
        save: async () => {
            throw new Error("offline");
        },
    });
    session.edit({ note: "draft" });

    assert.equal(await session.transition({ type: "task", blockId: "b" }), "confirm-discard");
    session.cancelTransition();
    assert.equal(session.snapshot.task.blockId, "a");
    assert.equal(session.snapshot.draft.note, "draft");

    assert.equal(await session.transition({ type: "task", blockId: "b" }), "confirm-discard");
    assert.equal(await session.confirmTransition(), "applied");
    assert.equal(session.snapshot.task.blockId, "b");
    assert.equal(session.snapshot.dirty, false);
    session.dispose();
});

test("目标任务不存在时阻止转换并保留当前详情", async () => {
    const initial = task("a");
    const source = new MemoryTaskSource([initial]);
    const session = createSession(initial, source);
    assert.equal(await session.transition({ type: "task", blockId: "missing" }), "blocked");
    assert.equal(session.snapshot.task.blockId, "a");
    assert.equal(session.snapshot.saveError, "missing task");
    session.dispose();
});

test("目标任务读取失败时转换被阻止并显示格式化错误", async () => {
    const initial = task("a");
    const source = new MemoryTaskSource([initial]);
    source.resolve = async () => {
        throw new Error("transport offline");
    };
    const session = createSession(initial, source);
    assert.equal(await session.transition({ type: "task", blockId: "b" }), "blocked");
    assert.equal(session.snapshot.task.blockId, "a");
    assert.equal(session.snapshot.saveError, "transport offline");
    session.dispose();
});

// Regression: 外部删除必须保留外部来源并阻止销毁时尽力保存。
test("外部删除把 session 置为终止状态且销毁时不执行尽力保存", async () => {
    const initial = task("a");
    const source = new MemoryTaskSource([initial]);
    let saves = 0;
    const session = createSession(initial, source, {
        save: async (blockId, draft) => {
            saves++;
            return entryFromDraft(blockId, draft);
        },
    });
    session.edit({ note: "local" });
    source.delete("a");
    assert.equal(session.snapshot.availability, "removed");
    assert.equal(session.snapshot.removalReason, "external");
    assert.equal(await session.transition({ type: "task", blockId: "b" }), "blocked");
    session.dispose({ bestEffort: true });
    await Promise.resolve();
    assert.equal(saves, 0);
});

test("权威保存结果只通过 task source 提交一次", async () => {
    const initial = task("a");
    const source = new MemoryTaskSource([initial]);
    const session = createSession(initial, source);
    session.edit({ note: "saved" });
    assert.equal(await session.flush(), true);
    assert.equal(source.commits.length, 1);
    assert.equal(source.commits[0].note, "saved");
    assert.equal(session.snapshot.dirty, false);
    session.dispose();
});

// Regression: 主动删除成功不能被误判为需要显示错误的外部删除。
test("显式删除调用远端一次并向实时集合登记删除", async () => {
    const initial = task("a");
    const source = new MemoryTaskSource([initial]);
    const removed: string[] = [];
    const session = createSession(initial, source, {
        remove: async (blockId) => {
            removed.push(blockId);
        },
    });
    assert.equal(await session.removeCurrent(), true);
    assert.deepEqual(removed, ["a"]);
    assert.deepEqual(source.removals, ["a"]);
    assert.equal(session.snapshot.availability, "removed");
    assert.equal(session.snapshot.removalReason, "local");
    session.dispose();
});

test("远端删除失败时保留任务和脏草稿供后续重试", async () => {
    const initial = task("a");
    const source = new MemoryTaskSource([initial]);
    const session = createSession(initial, source, {
        remove: async () => {
            throw new Error("remove failed");
        },
    });
    session.edit({ note: "keep" });
    assert.equal(await session.removeCurrent(), false);
    assert.equal(session.snapshot.availability, "available");
    assert.equal(session.snapshot.draft.note, "keep");
    assert.equal(session.snapshot.dirty, true);
    assert.equal(session.snapshot.saveError, "remove failed");
    assert.deepEqual(source.removals, []);
    session.dispose();
});

test("纯 rebase 保留所有本地脏字段并接收干净字段", () => {
    const baseline = taskToTaskDetailDraft(task("a", { note: "old", tags: "one", due: "2026-08-20" }));
    const current = { ...baseline, note: "local", taskTags: ["local-tag"] };
    const incoming = taskToTaskDetailDraft(task("a", { note: "remote", tags: "remote-tag", due: "2026-08-22" }));
    const rebased = rebaseTaskDetailDraft(current, baseline, incoming);
    assert.equal(rebased.note, "local");
    assert.deepEqual(rebased.taskTags, ["local-tag"]);
    assert.equal(rebased.due, "2026-08-22");
});

test("任务详情载荷保持全部既有属性和自定义字段", () => {
    const draft = taskToTaskDetailDraft(
        task("a", {
            status: "doing",
            priority: "high",
            importance: 6,
            effort: 2,
            due: "2026-08-20",
            start: "2026-08-17",
            context: "home|deep",
            tags: "phase|five",
            parentId: "project",
            depends: "b|c",
            depMode: "any",
            sequential: true,
            note: "note",
            reviewInterval: 14,
            reviewDate: "2026-08-30",
        }),
    );
    const attrs = taskDetailDraftToAttrs(draft, { "na-ext-owner": "me" });
    assert.equal(attrs["na-context"], "home|deep");
    assert.equal(attrs["na-depends"], "b|c");
    assert.equal(attrs["na-ext-owner"], "me");
});
