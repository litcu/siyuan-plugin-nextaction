import test from "node:test";
import assert from "node:assert/strict";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import {
    buildProjectTreeDropIntent,
    buildProjectTreeParentOptions,
    buildProjectTreeReorderIntent,
} from "../src/frontend/utils/project-tree-operations.ts";

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

const project = task("project", { taskType: "2", actionKind: "" });
const stage = task("stage", { parentId: project.blockId, actionKind: "stage", sort: 0 });
const child = task("child", { parentId: stage.blockId, sort: 0 });
const sibling = task("sibling", { parentId: project.blockId, sort: 10_000 });

test("项目树父级选项排除自身、后代和不可见 Action", () => {
    const options = buildProjectTreeParentOptions(
        stage,
        project,
        [stage, child, sibling],
        new Set(["stage", "sibling"]),
    );

    assert.deepEqual(
        options.map((entry) => entry.blockId),
        [project.blockId, sibling.blockId],
    );
});

test("项目树快捷排序生成稳定的同级重排意图", () => {
    const first = task("first", { parentId: project.blockId, sort: 0 });
    const middle = task("middle", { parentId: project.blockId, sort: 10_000 });
    const last = task("last", { parentId: project.blockId, sort: 20_000 });

    assert.deepEqual(buildProjectTreeReorderIntent(middle, [last, first, middle], "up"), {
        blockId: middle.blockId,
        parentId: project.blockId,
        afterId: undefined,
    });
    assert.deepEqual(buildProjectTreeReorderIntent(middle, [last, first, middle], "down"), {
        blockId: middle.blockId,
        parentId: project.blockId,
        afterId: last.blockId,
    });
});

test("项目树拖拽把前后位置和成为子项转换为明确重排意图", () => {
    const tasks = [stage, child, sibling];

    assert.deepEqual(buildProjectTreeDropIntent(sibling, stage, "before", project, tasks), {
        blockId: sibling.blockId,
        parentId: project.blockId,
        afterId: undefined,
    });
    assert.deepEqual(buildProjectTreeDropIntent(stage, sibling, "after", project, tasks), {
        blockId: stage.blockId,
        parentId: project.blockId,
        afterId: sibling.blockId,
    });
    assert.deepEqual(buildProjectTreeDropIntent(sibling, stage, "inside", project, tasks), {
        blockId: sibling.blockId,
        parentId: stage.blockId,
        afterId: child.blockId,
    });
});

test("项目树拖拽拒绝自身、后代和 Project 作为移动源", () => {
    const tasks = [stage, child, sibling];

    assert.equal(buildProjectTreeDropIntent(stage, stage, "inside", project, tasks), null);
    assert.equal(buildProjectTreeDropIntent(stage, child, "inside", project, tasks), null);
    assert.equal(buildProjectTreeDropIntent(project, sibling, "after", project, tasks), null);
});

test("项目树操作在 parentId 广播前使用 childIds 回退关系阻止循环", () => {
    const fallbackParent = task("parent", { parentId: "project", sort: 100, childIds: ["child"] });
    const fallbackChild = task("child", { sort: 100 });
    const tasks = [project, fallbackParent, fallbackChild];

    // Regression: childIds-only 关系曾不会进入后代检测，允许父节点移入自己的子节点。
    assert.equal(buildProjectTreeDropIntent(fallbackParent, fallbackChild, "inside", project, tasks), null);
    assert.deepEqual(
        buildProjectTreeParentOptions(fallbackParent, project, tasks).map((entry) => entry.blockId),
        ["project"],
    );
});
