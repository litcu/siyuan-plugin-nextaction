import test from "node:test";
import assert from "node:assert/strict";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import { buildTaskMoveIntent, describeTaskMove } from "../src/frontend/utils/task-reorder.ts";

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

test("任务可以在同级中上移和下移", () => {
    const tasks = [task("first", { sort: 0 }), task("middle", { sort: 10_000 }), task("last", { sort: 20_000 })];

    assert.deepEqual(buildTaskMoveIntent("middle", tasks, "up"), {
        blockId: "middle",
        parentId: "",
        afterId: undefined,
    });
    assert.deepEqual(buildTaskMoveIntent("middle", tasks, "down"), {
        blockId: "middle",
        parentId: "",
        afterId: "last",
    });
    assert.equal(buildTaskMoveIntent("first", tasks, "up"), null);
    assert.equal(buildTaskMoveIntent("last", tasks, "down"), null);
});

test("任务可以移入前一个同级并移出到父任务之后", () => {
    const tasks = [
        task("parent", { sort: 0, title: "Parent" }),
        task("moving", { sort: 10_000, title: "Moving" }),
        task("existing-child", { parentId: "parent", sort: 20_000 }),
    ];

    assert.deepEqual(buildTaskMoveIntent("moving", tasks, "in"), {
        blockId: "moving",
        parentId: "parent",
        afterId: "existing-child",
    });

    const nested = tasks.map((entry) =>
        entry.blockId === "moving" ? { ...entry, parentId: "parent", sort: 30_000 } : entry,
    );
    assert.deepEqual(buildTaskMoveIntent("moving", nested, "out"), {
        blockId: "moving",
        parentId: "",
        afterId: "parent",
    });
});

test("移动意图保留 Project 非法父级保护", () => {
    const project = task("project", { taskType: "2", sort: 10_000 });
    const previousTask = task("previous", { sort: 0 });

    assert.equal(buildTaskMoveIntent(project.blockId, [previousTask, project], "in"), null);
    assert.equal(buildTaskMoveIntent(previousTask.blockId, [previousTask, project], "in"), null);
    assert.equal(buildTaskMoveIntent(previousTask.blockId, [previousTask, project], "out"), null);
});

test("移动说明包含新的同级位置和父级关系", () => {
    const tasks = [
        task("parent", { title: "Parent", sort: 0 }),
        task("first-child", { parentId: "parent", sort: 0 }),
        task("moving", { title: "Moving", sort: 10_000 }),
    ];
    const intent = buildTaskMoveIntent("moving", tasks, "in");

    assert.ok(intent);
    assert.deepEqual(describeTaskMove("moving", intent, tasks), {
        taskTitle: "Moving",
        parentTitle: "Parent",
        position: 2,
        setSize: 2,
    });
});
