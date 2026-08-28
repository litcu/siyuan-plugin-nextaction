import test from "node:test";
import assert from "node:assert/strict";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import { DEFAULT_FILTER_STATE } from "../src/frontend/utils/filter.ts";
import { ATTR_STATUS } from "../src/shared/constants.ts";
import { buildProjectBoardColumns, isProjectBoardTask } from "../src/shared/project-board.ts";
import {
    buildProjectViewControl,
    buildProjectViewModel as buildProjectViewModelFromControl,
    confirmProjectCompletion,
    executeProjectBoardMove,
    shouldOfferProjectRiskAction,
    shouldShowProjectCompletionPanel,
    type ProjectViewState,
} from "../src/frontend/utils/project-view-state.ts";

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

function state(overrides: Partial<ProjectViewState> = {}): ProjectViewState {
    return {
        mode: "overview",
        activeProjectId: "",
        filterBypassProjectId: "",
        selectedTaskId: "",
        selectedTaskOverride: null,
        preferActiveProject: false,
        showCompleted: false,
        riskFilter: "all",
        dateFilter: "all",
        actionFilter: "all",
        filterState: { ...DEFAULT_FILTER_STATE },
        collapsedIds: new Set(),
        ganttSortMode: "timeline",
        startPreviewDays: 0,
        ...overrides,
    };
}

function buildProjectViewModel(
    tasks: TaskCacheEntry[],
    customFields: Parameters<typeof buildProjectViewModelFromControl>[1],
    currentState: ProjectViewState,
) {
    return buildProjectViewModelFromControl(buildProjectViewControl(tasks, currentState), customFields, currentState);
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

test("看板只展示普通 Action 和叶子 Stage，并始终保留六个状态列", () => {
    const project = task("project", { taskType: "2", childIds: ["action", "parent-stage", "leaf-stage"] });
    const action = task("action", { parentId: project.blockId, status: "todo", childIds: ["nested-action"] });
    const parentStage = task("parent-stage", {
        parentId: project.blockId,
        status: "doing",
        actionKind: "stage",
        childIds: ["nested-action"],
    });
    const leafStage = task("leaf-stage", { parentId: project.blockId, status: "waiting", actionKind: "stage" });
    const nestedAction = task("nested-action", { parentId: parentStage.blockId, status: "done" });
    const descendants = [action, parentStage, leafStage, nestedAction];

    assert.equal(isProjectBoardTask(project, descendants), false);
    assert.equal(isProjectBoardTask(parentStage, descendants), false);
    assert.equal(isProjectBoardTask(action, descendants), true);
    assert.equal(isProjectBoardTask(leafStage, descendants), true);

    const columns = buildProjectBoardColumns(descendants.filter((item) => isProjectBoardTask(item, descendants)));
    assert.deepEqual(
        columns.map((column) => column.status),
        ["inbox", "todo", "doing", "waiting", "someday", "done"],
    );
    assert.deepEqual(
        columns.find((column) => column.status === "todo")?.tasks.map((item) => item.blockId),
        ["action"],
    );
    assert.deepEqual(
        columns.find((column) => column.status === "waiting")?.tasks.map((item) => item.blockId),
        ["leaf-stage"],
    );
    assert.deepEqual(columns.find((column) => column.status === "inbox")?.tasks, []);
});

test("看板复用任务筛选但不受完成项开关隐藏 done 列", () => {
    // Regression: showCompleted=false made the board's done column empty even when a completed Action existed.
    const boardProject = [
        task("board-project", { taskType: "2", childIds: ["open-action", "finished-action"] }),
        task("open-action", { parentId: "board-project", title: "Open work", status: "todo" }),
        task("finished-action", { parentId: "board-project", title: "Release notes", status: "done" }),
    ];

    const unfiltered = buildProjectViewModel(boardProject, [], state({ mode: "board", showCompleted: false }));
    assert.deepEqual(
        unfiltered.boardTasks.map((item) => item.blockId),
        ["finished-action", "open-action"],
    );

    const filtered = buildProjectViewModel(
        boardProject,
        [],
        state({
            mode: "board",
            showCompleted: false,
            filterState: { ...DEFAULT_FILTER_STATE, searchText: "release" },
        }),
    );
    assert.deepEqual(
        filtered.boardTasks.map((item) => item.blockId),
        ["finished-action"],
    );
});

test("显式切换 Project 不会把旧任务选择带入新项目", () => {
    // Regression: selecting a Project briefly reused the previous Action selection or opened the Project detail drawer.
    const explicitProjectState = state({
        activeProjectId: "p2",
        selectedTaskId: "a",
        preferActiveProject: true,
    });

    const control = buildProjectViewControl(projects, explicitProjectState);
    const model = buildProjectViewModelFromControl(control, [], explicitProjectState);

    assert.deepEqual(control.selection, { projectId: "p2", taskId: "" });
    assert.equal(model.activeProjectId, "p2");
    assert.equal(model.selectedSummary?.project.blockId, "p2");
});

test("从 Review 打开的项目不受项目视图既有任务筛选影响", () => {
    // Regression: Review 指定的项目会被 ProjectView 保留的搜索和标签筛选挡住。
    const navigationState = state({
        activeProjectId: "p2",
        filterBypassProjectId: "p2",
        filterState: { ...DEFAULT_FILTER_STATE, searchText: "alpha" },
    });

    const model = buildProjectViewModel(projects, [], navigationState);

    assert.deepEqual(
        model.visibleSummaries.map((summary) => summary.project.blockId),
        ["p1", "p2"],
    );
    assert.equal(model.activeProjectId, "p2");
    assert.equal(model.selectedSummary?.project.blockId, "p2");
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

test("项目视图从共享摘要取得叶子进度", () => {
    // Regression: ProjectView used to count a parent Action and its leaf Action twice.
    const nested = [
        task("p", { taskType: "2", childIds: ["parent"] }),
        task("parent", { parentId: "p", status: "done", childIds: ["child"] }),
        task("child", { parentId: "parent", status: "done" }),
    ];

    const model = buildProjectViewModel(nested, [], state());

    assert.equal(model.summaries[0].doneCount, 1);
    assert.equal(model.summaries[0].openCount, 0);
    assert.equal(model.summaries[0].completionCandidate, true);
});

test("项目完成面板只确认完成候选或空项目", async () => {
    const completedCandidate = buildProjectViewModel(
        [
            task("candidate", { taskType: "2", status: "doing", childIds: ["done-action"] }),
            task("done-action", { parentId: "candidate", status: "done" }),
        ],
        [],
        state(),
    ).summaries[0];
    const emptyProject = buildProjectViewModel([task("empty", { taskType: "2" })], [], state()).summaries[0];
    const openProject = buildProjectViewModel(
        [
            task("open-project", { taskType: "2", childIds: ["open-action"] }),
            task("open-action", { parentId: "open-project" }),
        ],
        [],
        state(),
    ).summaries[0];
    const confirmed: string[] = [];
    const updateTask = async (project: TaskCacheEntry, attrs: Record<string, string>) => {
        if (attrs[ATTR_STATUS] === "done") confirmed.push(project.blockId);
    };

    await confirmProjectCompletion(completedCandidate, updateTask);
    await confirmProjectCompletion(emptyProject, updateTask);
    await assert.rejects(confirmProjectCompletion(openProject, updateTask), /not ready/i);

    assert.deepEqual(confirmed, ["candidate", "empty"]);
});

test("空 Draft 不直接显示异常完成面板，Planned 和 Active 空项目需要澄清", () => {
    // Regression: every empty Project was styled as an abnormal state, including an unplanned Draft.
    const draft = buildProjectViewModel([task("draft", { taskType: "2", status: "inbox" })], [], state()).summaries[0];
    const planned = buildProjectViewModel([task("planned", { taskType: "2", status: "todo" })], [], state())
        .summaries[0];
    const active = buildProjectViewModel([task("active", { taskType: "2", status: "doing" })], [], state())
        .summaries[0];

    assert.equal(shouldShowProjectCompletionPanel(draft), false);
    assert.equal(shouldShowProjectCompletionPanel(planned), true);
    assert.equal(shouldShowProjectCompletionPanel(active), true);
});

test("项目风险只为没有 Next Action 提供创建入口", () => {
    // Regression: project risks previously exposed observation only, leaving no direct recovery action.
    assert.equal(shouldOfferProjectRiskAction({ kind: "noNextAction" }), true);
    assert.equal(shouldOfferProjectRiskAction({ kind: "waiting" }), false);
    assert.equal(shouldOfferProjectRiskAction({ kind: "blocked" }), false);
    assert.equal(shouldOfferProjectRiskAction({ kind: "overdue" }), false);
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
