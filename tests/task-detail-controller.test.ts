import test from "node:test";
import assert from "node:assert/strict";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import {
    TaskDetailController,
    rebaseTaskDetailDraft,
    taskDetailDraftToAttrs,
    taskToTaskDetailDraft,
} from "../src/frontend/controllers/task-detail-controller.ts";

function task(blockId = "task", overrides: Partial<TaskCacheEntry> = {}): TaskCacheEntry {
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

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((ok, fail) => {
        resolve = ok;
        reject = fail;
    });
    return { promise, resolve, reject };
}

test("保存期间的新编辑排队且同一时刻只执行一个保存", async () => {
    const saves: Array<{
        draft: ReturnType<typeof taskToTaskDetailDraft>;
        result: ReturnType<typeof deferred<TaskCacheEntry>>;
    }> = [];
    let active = 0;
    let maxActive = 0;
    const controller = new TaskDetailController(task(), {
        debounceMs: 60_000,
        save: async (_blockId, draft) => {
            active++;
            maxActive = Math.max(maxActive, active);
            const result = deferred<TaskCacheEntry>();
            saves.push({ draft, result });
            try {
                return await result.promise;
            } finally {
                active--;
            }
        },
        formatError: String,
    });

    controller.edit({ note: "first" });
    const flushing = controller.flush();
    await Promise.resolve();
    controller.edit({ note: "second" });
    assert.equal(saves.length, 1);
    saves[0].result.resolve(task("task", { note: "first" }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(saves.length, 2);
    saves[1].result.resolve(task("task", { note: "second" }));

    assert.equal(await flushing, true);
    assert.equal(maxActive, 1);
    assert.deepEqual(
        saves.map((save) => save.draft.note),
        ["first", "second"],
    );
    assert.equal(controller.snapshot.dirty, false);
    controller.dispose();
});

test("保存失败保留草稿且下一次显式保存可以重试", async () => {
    let attempts = 0;
    const controller = new TaskDetailController(task(), {
        debounceMs: 60_000,
        save: async (_blockId, draft) => {
            attempts++;
            if (attempts === 1) throw new Error("offline");
            return task("task", { note: draft.note });
        },
        formatError: (error) => (error as Error).message,
    });
    controller.edit({ note: "keep me" });

    assert.equal(await controller.flush(), false);
    assert.equal(controller.snapshot.saveState, "error");
    assert.equal(controller.snapshot.saveError, "offline");
    assert.equal(controller.snapshot.draft.note, "keep me");
    assert.equal(controller.snapshot.dirty, true);
    assert.equal(await controller.flush(), true);
    assert.equal(controller.snapshot.dirty, false);
    controller.dispose();
});

test("同任务外部更新按字段 rebase，本地字段不被覆盖", () => {
    const initial = task("task", { note: "old", due: "2026-08-20", context: "home" });
    const controller = new TaskDetailController(initial, {
        debounceMs: 60_000,
        save: async () => initial,
        formatError: String,
    });
    controller.edit({ note: "local" });
    controller.receiveExternalTask(task("task", { note: "remote", due: "2026-08-22", context: "office" }));

    assert.equal(controller.snapshot.draft.note, "local");
    assert.equal(controller.snapshot.draft.due, "2026-08-22");
    assert.deepEqual(controller.snapshot.draft.contexts, ["office"]);
    assert.deepEqual([...controller.snapshot.dirtyFields], ["note"]);
    controller.dispose();
});

test("纯 rebase 保留所有本地脏字段并接收干净字段", () => {
    const baseline = taskToTaskDetailDraft(task("task", { note: "old", tags: "one", due: "2026-08-20" }));
    const current = { ...baseline, note: "local", taskTags: ["local-tag"] };
    const incoming = taskToTaskDetailDraft(task("task", { note: "remote", tags: "remote-tag", due: "2026-08-22" }));
    const rebased = rebaseTaskDetailDraft(current, baseline, incoming);
    assert.equal(rebased.note, "local");
    assert.deepEqual(rebased.taskTags, ["local-tag"]);
    assert.equal(rebased.due, "2026-08-22");
});

test("关闭决策区分干净、脏草稿、取消和显式丢弃", async () => {
    const controller = new TaskDetailController(task(), {
        debounceMs: 60_000,
        save: async (_blockId, draft) => task("task", { note: draft.note }),
        formatError: String,
    });
    assert.equal(await controller.requestClose(), "close");
    controller.edit({ note: "draft" });
    assert.equal(await controller.requestClose(), "confirm-discard");
    controller.cancelClose();
    assert.equal(controller.snapshot.draft.note, "draft");
    assert.equal(controller.confirmDiscard(), "close");
    controller.dispose();
});

test("保存期间关闭会等待排队草稿完成后再作关闭决策", async () => {
    const first = deferred<TaskCacheEntry>();
    const second = deferred<TaskCacheEntry>();
    let saves = 0;
    const controller = new TaskDetailController(task(), {
        debounceMs: 60_000,
        save: async () => (++saves === 1 ? first.promise : second.promise),
        formatError: String,
    });
    controller.edit({ note: "first" });
    const flushing = controller.flush();
    await Promise.resolve();
    controller.edit({ note: "second" });
    const closing = controller.requestClose();
    first.resolve(task("task", { note: "first" }));
    await new Promise((resolve) => setImmediate(resolve));
    second.resolve(task("task", { note: "second" }));
    assert.equal(await flushing, true);
    assert.equal(await closing, "close");
    controller.dispose();
});

test("销毁只对非显式丢弃的脏草稿执行尽力保存", async () => {
    const saved: string[] = [];
    const options = {
        debounceMs: 60_000,
        save: async (_blockId: string, draft: ReturnType<typeof taskToTaskDetailDraft>) => {
            saved.push(draft.note);
            return task("task", { note: draft.note });
        },
        formatError: String,
    };
    const keep = new TaskDetailController(task(), options);
    keep.edit({ note: "best effort" });
    keep.dispose({ bestEffort: true });
    const discard = new TaskDetailController(task(), options);
    discard.edit({ note: "discard" });
    discard.confirmDiscard();
    discard.dispose({ bestEffort: true });
    await Promise.resolve();
    assert.deepEqual(saved, ["best effort"]);
});

test("任务详情载荷保持全部既有属性和自定义字段", () => {
    const draft = taskToTaskDetailDraft(
        task("task", {
            status: "doing",
            priority: "high",
            importance: 6,
            effort: 2,
            due: "2026-08-20",
            start: "2026-08-17",
            context: "home|deep",
            tags: "phase|five",
            parentId: "project",
            taskType: "1",
            depends: "a|b",
            depMode: "any",
            sequential: true,
            note: "note",
            reviewInterval: 14,
            reviewDate: "2026-08-30",
        }),
    );
    const attrs = taskDetailDraftToAttrs(draft, { "na-ext-owner": "me" });
    assert.deepEqual(Object.keys(attrs), [
        "na-status",
        "na-priority",
        "na-importance",
        "na-effort",
        "na-due",
        "na-start",
        "na-context",
        "na-tags",
        "na-parent",
        "na-task",
        "na-depends",
        "na-dep-mode",
        "na-sequential",
        "na-note",
        "na-review-interval",
        "na-review-date",
        "na-ext-owner",
    ]);
    assert.equal(attrs["na-context"], "home|deep");
    assert.equal(attrs["na-depends"], "a|b");
});
