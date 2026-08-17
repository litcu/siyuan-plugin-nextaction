import test from "node:test";
import assert from "node:assert/strict";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import { DEFAULT_FILTER_STATE } from "../src/frontend/utils/filter.ts";
import {
    buildProjectViewModel,
    executeProjectBoardMove,
    type ProjectViewState,
} from "../src/frontend/utils/project-view-state.ts";

function task(blockId: string, overrides: Partial<TaskCacheEntry> = {}): TaskCacheEntry {
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

function state(overrides: Partial<ProjectViewState> = {}): ProjectViewState {
    return {
        mode: "overview",
        activeProjectId: "",
        selectedTaskId: "",
        selectedTaskOverride: null,
        showCompleted: false,
        riskFilter: "all",
        dateFilter: "all",
        actionFilter: "all",
        filterState: { ...DEFAULT_FILTER_STATE },
        collapsedIds: new Set(),
        ganttSortMode: "timeline",
        ...overrides,
    };
}

const projects = [
    task("p1", { taskType: "2", childIds: ["a", "done"] }),
    task("a", { parentId: "p1", due: "2099-01-02", title: "alpha", sort: 2 }),
    task("done", { parentId: "p1", status: "done", title: "finished", sort: 1 }),
    task("p2", { taskType: "2", childIds: ["waiting"] }),
    task("waiting", { parentId: "p2", status: "waiting", title: "waiting" }),
];

test("五种项目模式共享同一筛选和选中模型", () => {
    for (const mode of ["overview", "hierarchy", "board", "plan", "gantt"] as const) {
        const model = buildProjectViewModel(projects, [], state({ mode }));
        assert.equal(model.visibleSummaries.length, 2);
        assert.equal(model.activeProjectId, "p1");
        assert.equal(model.selectedSummary?.project.blockId, "p1");
        assert.equal(model.projectTreeModel?.rows[0].task.blockId, "p1");
    }
});

test("完成项开关、任务筛选和三类项目筛选可以组合", () => {
    const hiddenDone = buildProjectViewModel(projects, [], state({ activeProjectId: "p1" }));
    assert.deepEqual(
        hiddenDone.detailTasks.map((item) => item.blockId),
        ["a"],
    );
    const shownDone = buildProjectViewModel(projects, [], state({ activeProjectId: "p1", showCompleted: true }));
    assert.deepEqual(
        shownDone.detailTasks.map((item) => item.blockId),
        ["a", "done"],
    );
    const searched = buildProjectViewModel(
        projects,
        [],
        state({
            showCompleted: true,
            filterState: { ...DEFAULT_FILTER_STATE, searchText: "finished" },
        }),
    );
    assert.deepEqual(
        searched.visibleSummaries.map((item) => item.project.blockId),
        ["p1"],
    );
    const available = buildProjectViewModel(projects, [], state({ actionFilter: "available" }));
    assert.deepEqual(
        available.visibleSummaries.map((item) => item.project.blockId),
        ["p1"],
    );
    const missing = buildProjectViewModel(projects, [], state({ actionFilter: "missing" }));
    assert.deepEqual(
        missing.visibleSummaries.map((item) => item.project.blockId),
        [],
    );
});

test("选中任务自动定位项目且 override 立即进入视图模型", () => {
    const override = { ...projects[1], title: "edited before broadcast", status: "doing" };
    const model = buildProjectViewModel(
        projects,
        [],
        state({
            activeProjectId: "p2",
            selectedTaskId: "a",
            selectedTaskOverride: override,
        }),
    );
    assert.equal(model.activeProjectId, "p1");
    assert.equal(model.detailTasks[0].title, "edited before broadcast");
    assert.equal(model.boardTasks[0].status, "doing");
});

test("折叠状态和甘特排序进入树模型但不丢失完整任务集合", () => {
    const nested = [
        task("p", { taskType: "2", childIds: ["parent"] }),
        task("parent", { parentId: "p", childIds: ["child"] }),
        task("child", { parentId: "parent", start: "2099-01-01" }),
    ];
    const model = buildProjectViewModel(
        nested,
        [],
        state({
            mode: "gantt",
            collapsedIds: new Set(["parent"]),
        }),
    );
    assert.deepEqual(
        model.projectTreeModel?.rows.map((row) => row.task.blockId),
        ["p", "parent"],
    );
    assert.deepEqual(
        model.projectTreeModel?.includedTasks.map((item) => item.blockId),
        ["p", "parent", "child"],
    );
});

test("看板移动先更新状态再重排并向上抛出失败", async () => {
    const calls: string[] = [];
    await executeProjectBoardMove({ task: projects[1], status: "doing", afterId: "after" }, "p1", {
        updateTask: async (_task, attrs) => {
            calls.push(`update:${attrs["na-status"]}`);
        },
        reorderTask: async (blockId, parentId, afterId) => {
            calls.push(`reorder:${blockId}:${parentId}:${afterId}`);
        },
    });
    assert.deepEqual(calls, ["update:doing", "reorder:a:p1:after"]);

    await assert.rejects(
        () =>
            executeProjectBoardMove({ task: projects[1], status: "doing" }, "p1", {
                updateTask: async () => {
                    throw new Error("write failed");
                },
                reorderTask: async () => {
                    calls.push("unexpected reorder");
                },
            }),
        /write failed/,
    );
    assert.equal(calls.includes("unexpected reorder"), false);
});
