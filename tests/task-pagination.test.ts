import test from "node:test";
import assert from "node:assert/strict";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import { paginateCompletedTasks, sortCompletedTasks } from "../src/shared/task-pagination.ts";

function task(blockId: string, overrides: Partial<TaskCacheEntry> = {}): TaskCacheEntry {
    return {
        blockId,
        parentId: "",
        status: "done",
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
        created: "2026-01-01T00:00:00",
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

test("completed tasks default to newest completion first with stable ids", () => {
    const result = sortCompletedTasks([
        task("b", { completed: "2026-02-01T10:00:00" }),
        task("a", { completed: "2026-02-01T10:00:00" }),
        task("c", { completed: "2026-01-01T10:00:00" }),
    ]);
    assert.deepEqual(result.map((entry) => entry.blockId), ["a", "b", "c"]);
});

test("completed sorting falls back to updated and keeps missing due dates last", () => {
    const fallback = sortCompletedTasks([
        task("old", { created: "2026-01-01T00:00:00" }),
        task("new", { updated: "2026-03-01T00:00:00", created: "2025-01-01T00:00:00" }),
    ]);
    assert.deepEqual(fallback.map((entry) => entry.blockId), ["new", "old"]);

    const due = sortCompletedTasks([
        task("missing", { due: "" }),
        task("dated", { due: "2026-04-01" }),
    ], "due", false);
    assert.deepEqual(due.map((entry) => entry.blockId), ["dated", "missing"]);
});

test("pagination clamps page and limits page size", () => {
    const tasks = Array.from({ length: 121 }, (_, index) => task(String(index).padStart(3, "0"), {
        completed: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00`,
    }));
    const result = paginateCompletedTasks(tasks, { page: 999, pageSize: 500 });
    assert.equal(result.pageSize, 200);
    assert.equal(result.page, 1);
    assert.equal(result.total, 121);
    assert.equal(result.hasMore, false);
    assert.equal(result.items.length, 121);
});

test("pagination ignores non-completed entries and reports hasMore", () => {
    const result = paginateCompletedTasks([
        task("done-1"),
        task("todo", { status: "todo" }),
        task("done-2"),
    ], { page: 1, pageSize: 1 });
    assert.equal(result.total, 2);
    assert.equal(result.items.length, 1);
    assert.equal(result.hasMore, true);
});
