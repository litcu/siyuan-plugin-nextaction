import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectControlState } from "../src/shared/project-control.ts";
import { buildProjectReviewQueue } from "../src/shared/review.ts";
import { DEFAULT_FILTER_STATE } from "../src/frontend/utils/filter.ts";
import { buildProjectViewModel, type ProjectViewState } from "../src/frontend/utils/project-view-state.ts";
import type { ProjectControlRisk, TaskCacheEntry } from "../src/shared/types.ts";

function task(blockId: string, overrides: Partial<TaskCacheEntry> = {}): TaskCacheEntry {
    return {
        blockId,
        identificationSource: "document",
        attrHostId: blockId,
        parentId: "",
        status: "todo",
        priority: "none",
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

function viewState(overrides: Partial<ProjectViewState> = {}): ProjectViewState {
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

function riskIdentity(risk: ProjectControlRisk): [string, string, string, string, string] {
    return [risk.projectId, risk.kind, risk.severity, risk.targetKind, risk.target.blockId];
}

test("项目总览、详情与 Review 消费同一 Project Control 风险结果", () => {
    const project = task("project", { taskType: "2", status: "doing", title: "Project" });
    const blocked = task("blocked", {
        parentId: project.blockId,
        blocked: true,
        blockedReason: "dependency",
        title: "Blocked action",
    });
    const overdue = task("overdue", {
        parentId: project.blockId,
        due: "2026-08-20",
        title: "Overdue action",
    });
    const control = buildProjectControlState([project, blocked, overdue], {
        today: "2026-08-25",
        selection: { projectId: project.blockId, taskId: blocked.blockId },
    });

    const projectView = buildProjectViewModel(control, [], viewState({ activeProjectId: project.blockId }));
    const review = buildProjectReviewQueue(control, "2026-08-25");
    const overviewRisks = projectView.selectedProject?.risks || [];
    const detailRisks = projectView.riskItems
        .filter((item) => item.risk.projectId === project.blockId)
        .map((item) => item.risk);
    const reviewRisks = review.queue[0].risks;

    assert.strictEqual(overviewRisks, control.projects[0].risks);
    assert.strictEqual(reviewRisks, control.projects[0].risks);
    assert.deepEqual(overviewRisks.map(riskIdentity), [
        ["project", "overdue", "high", "action", "overdue"],
        ["project", "blocked", "high", "action", "blocked"],
    ]);
    assert.deepEqual(detailRisks.map(riskIdentity), overviewRisks.map(riskIdentity));
    assert.deepEqual(reviewRisks.map(riskIdentity), overviewRisks.map(riskIdentity));
});

test("任务快照变化和 Project 切换会重算状态并保留仍有效的选择", () => {
    const firstProject = task("first-project", { taskType: "2", status: "doing" });
    const firstAction = task("first-action", { parentId: firstProject.blockId });
    const secondProject = task("second-project", { taskType: "2", status: "doing" });
    const secondAction = task("second-action", {
        parentId: secondProject.blockId,
        blocked: true,
        blockedReason: "dependency",
    });
    const initial = buildProjectControlState([firstProject, firstAction, secondProject, secondAction], {
        today: "2026-08-25",
        selection: { projectId: secondProject.blockId, taskId: secondAction.blockId },
    });

    const refreshedAction = { ...secondAction, title: "Refreshed action", blocked: false, blockedReason: "" as const };
    const refreshed = buildProjectControlState([firstProject, firstAction, secondProject, refreshedAction], {
        today: "2026-08-25",
        selection: initial.selection,
    });

    assert.deepEqual(refreshed.selection, initial.selection);
    assert.equal(refreshed.selectedTask?.title, "Refreshed action");
    assert.deepEqual(refreshed.selectedProject?.risks, []);

    const switched = buildProjectControlState(refreshed.tasks, {
        today: "2026-08-25",
        selection: { projectId: firstProject.blockId, taskId: refreshed.selection.taskId },
    });

    assert.deepEqual(switched.selection, { projectId: firstProject.blockId, taskId: "" });

    const fallback = buildProjectControlState([secondProject, refreshedAction], {
        today: "2026-08-25",
        selection: switched.selection,
    });

    assert.deepEqual(fallback.selection, { projectId: secondProject.blockId, taskId: "" });
});
