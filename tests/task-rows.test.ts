import test from "node:test";
import assert from "node:assert/strict";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import { buildTaskListRows } from "../src/frontend/utils/task-rows.ts";

function task(blockId: string, overrides: Partial<TaskCacheEntry> = {}): TaskCacheEntry {
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
        outcome: "",
        dod: "",
        actionKind: "action",
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

test("task rows build hierarchy and hide collapsed descendants in one result", () => {
    const rows = buildTaskListRows(
        [
            task("root", { order: 2 }),
            task("child", { parentId: "root", sort: 1 }),
            task("grandchild", { parentId: "child", sort: 2 }),
            task("sibling", { parentId: "root", sort: 3 }),
        ],
        { child: true },
        true,
    );

    assert.deepEqual(
        rows.map((row) => [row.task.blockId, row.indent]),
        [
            ["root", 0],
            ["child", 1],
            ["sibling", 1],
        ],
    );
    assert.equal(rows[0].childCount, 2);
    assert.equal(rows[1].hasChildren, true);
});

test("task rows keep orphaned and cyclic entries visible once", () => {
    const rows = buildTaskListRows(
        [task("a", { parentId: "b" }), task("b", { parentId: "a" }), task("orphan", { parentId: "missing" })],
        {},
        true,
    );
    assert.deepEqual(rows.map((row) => row.task.blockId).sort(), ["a", "b", "orphan"]);
    assert.equal(new Set(rows.map((row) => row.task.blockId)).size, 3);
});
