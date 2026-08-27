import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectSummary, TaskCacheEntry } from "../src/shared/types.ts";
import { buildProjectTreeModel, shouldShowSubtreeProgress } from "../src/frontend/utils/project-tree.ts";

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

function summary(project: TaskCacheEntry, descendants: TaskCacheEntry[]): ProjectSummary {
    return {
        project,
        descendants,
        leafActions: descendants,
        subtreeProgress: {},
        empty: descendants.length === 0,
        clarificationNeeded: descendants.length === 0,
        completionCandidate: false,
        incompleteNonLeafActions: [],
        openCount: descendants.length,
        doneCount: 0,
        progress: 0,
        nextActions: [],
        overdueTasks: [],
        blockedTasks: [],
        waitingTasks: [],
        risks: [],
        health: "onTrack",
    };
}

test("项目树保留真实层级并让折叠只影响可见行", () => {
    const project = task("p", { taskType: "2", childIds: ["a"] });
    const a = task("a", { parentId: "p", childIds: ["b"], sort: 1 });
    const b = task("b", { parentId: "a", start: "2026-08-01", sort: 2 });
    const model = buildProjectTreeModel(summary(project, [a, b]), new Set(["a"]), { showCompleted: true });
    assert.deepEqual(
        model.rows.map((row) => row.task.blockId),
        ["p", "a"],
    );
    assert.deepEqual(
        model.includedTasks.map((entry) => entry.blockId),
        ["p", "a", "b"],
    );
    assert.equal(model.rows[1].hasChildren, true);
    assert.equal(model.rows[1].childCount, 1);
});

test("项目树向有子节点的 Stage 和父 Action 提供叶子子树进度", () => {
    // Regression: subtree progress was rendered for Stage rows but omitted for ordinary parent Actions.
    const project = task("p", { taskType: "2", childIds: ["stage"] });
    const stage = task("stage", { parentId: "p", actionKind: "stage", childIds: ["parent"] });
    const parent = task("parent", { parentId: "stage", childIds: ["done", "open"] });
    const done = task("done", { parentId: "parent", status: "done" });
    const open = task("open", { parentId: "parent" });
    const projectSummary = summary(project, [stage, parent, done, open]);
    projectSummary.subtreeProgress.stage = { done: 1, total: 2, percent: 50 };
    projectSummary.subtreeProgress.parent = { done: 1, total: 2, percent: 50 };

    const model = buildProjectTreeModel(projectSummary, new Set(), { showCompleted: true });

    assert.deepEqual(model.rows.find((row) => row.task.blockId === "stage")?.subtreeProgress, {
        done: 1,
        total: 2,
        percent: 50,
    });
    const stageRow = model.rows.find((row) => row.task.blockId === "stage")!;
    const parentRow = model.rows.find((row) => row.task.blockId === "parent")!;
    assert.equal(shouldShowSubtreeProgress(stageRow), true);
    assert.equal(shouldShowSubtreeProgress(parentRow), true);
    assert.equal(shouldShowSubtreeProgress(model.rows[0]), false);
});

test("子任务筛选保留必要祖先并排除无关兄弟", () => {
    const project = task("p", { taskType: "2", childIds: ["a", "x"] });
    const a = task("a", { parentId: "p", childIds: ["b"] });
    const b = task("b", { parentId: "a" });
    const x = task("x", { parentId: "p" });
    const model = buildProjectTreeModel(summary(project, [a, b, x]), new Set(), {
        showCompleted: true,
        matchedTaskIds: new Set(["b"]),
    });
    assert.deepEqual(
        model.rows.map((row) => row.task.blockId),
        ["p", "a", "b"],
    );
    assert.equal(model.includedIds.has("x"), false);
});

test("筛选命中和当前选择会揭示被折叠祖先下的 Action", () => {
    const project = task("p", { taskType: "2", childIds: ["stage"] });
    const stage = task("stage", { parentId: "p", childIds: ["parent"] });
    const parent = task("parent", { parentId: "stage", childIds: ["matched", "selected"] });
    const matched = task("matched", { parentId: "parent" });
    const selected = task("selected", { parentId: "parent" });

    const model = buildProjectTreeModel(
        summary(project, [stage, parent, matched, selected]),
        new Set(["stage", "parent"]),
        {
            showCompleted: true,
            matchedTaskIds: new Set([matched.blockId]),
            revealedTaskIds: new Set([selected.blockId]),
        },
    );

    assert.deepEqual(
        model.rows.map((row) => row.task.blockId),
        ["p", "stage", "parent", "matched", "selected"],
    );
    assert.equal(model.rows.find((row) => row.task.blockId === "stage")?.isCollapsed, false);
    assert.equal(model.rows.find((row) => row.task.blockId === "parent")?.isCollapsed, false);
});

test("隐藏已完成父任务时提升其未完成后代", () => {
    const project = task("p", { taskType: "2", childIds: ["done-parent"] });
    const doneParent = task("done-parent", { parentId: "p", status: "done", childIds: ["child"] });
    const child = task("child", { parentId: "done-parent" });
    const model = buildProjectTreeModel(summary(project, [doneParent, child]), new Set(), { showCompleted: false });
    assert.deepEqual(
        model.rows.map((row) => [row.task.blockId, row.depth]),
        [
            ["p", 0],
            ["child", 1],
        ],
    );
    assert.deepEqual(
        model.includedTasks.map((entry) => entry.blockId),
        ["p", "child"],
    );
    assert.equal(model.rows[0].childCount, 1);
    assert.equal(model.rows[1].visibleParentId, "p");
    assert.equal(model.rows[1].positionInSet, 1);
    assert.equal(model.rows[1].setSize, 1);
});

test("隐藏已完成父任务时直接子项计数使用提升后的可见层级", () => {
    // Regression: a hidden completed parent used to count as one child even when it promoted multiple visible Actions.
    const project = task("p", { taskType: "2", childIds: ["done-parent"] });
    const doneParent = task("done-parent", { parentId: "p", status: "done", childIds: ["a", "b"] });
    const a = task("a", { parentId: "done-parent" });
    const b = task("b", { parentId: "done-parent" });

    const model = buildProjectTreeModel(summary(project, [doneParent, a, b]), new Set(), { showCompleted: false });

    assert.deepEqual(
        model.rows.map((row) => [row.task.blockId, row.depth]),
        [
            ["p", 0],
            ["a", 1],
            ["b", 1],
        ],
    );
    assert.equal(model.rows[0].childCount, 2);
    assert.deepEqual(
        model.rows.slice(1).map((row) => [row.visibleParentId, row.positionInSet, row.setSize]),
        [
            ["p", 1, 2],
            ["p", 2, 2],
        ],
    );
});

test("项目树对循环和孤立节点保持单次可见", () => {
    const project = task("p", { taskType: "2" });
    const a = task("a", { parentId: "b", childIds: ["b"] });
    const b = task("b", { parentId: "a", childIds: ["a"] });
    const orphan = task("orphan", { parentId: "missing" });
    const model = buildProjectTreeModel(summary(project, [a, b, orphan]), new Set(), { showCompleted: true });
    assert.deepEqual(model.rows.map((row) => row.task.blockId).sort(), ["a", "b", "orphan", "p"]);
    assert.equal(new Set(model.rows.map((row) => row.task.blockId)).size, 4);
});

test("甘特时间排序按开始日期排列同级任务并将未排期任务放在末尾", () => {
    const project = task("p", { taskType: "2", childIds: ["late", "none", "early"] });
    const late = task("late", { parentId: "p", start: "2026-10-01", sort: 0 });
    const none = task("none", { parentId: "p", sort: 1 });
    const early = task("early", { parentId: "p", due: "2026-08-17", sort: 2 });
    const timeline = buildProjectTreeModel(summary(project, [late, none, early]), new Set(), {
        showCompleted: true,
        sortMode: "timeline",
    });
    const manual = buildProjectTreeModel(summary(project, [late, none, early]), new Set(), {
        showCompleted: true,
        sortMode: "manual",
    });
    assert.deepEqual(
        timeline.rows.map((row) => row.task.blockId),
        ["p", "early", "late", "none"],
    );
    assert.deepEqual(
        manual.rows.map((row) => row.task.blockId),
        ["p", "late", "none", "early"],
    );
});
