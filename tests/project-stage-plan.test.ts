import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectControlState } from "../src/shared/project-control.ts";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import { buildProjectTreeModel } from "../src/frontend/utils/project-tree.ts";
import { buildProjectPlanRows } from "../src/frontend/utils/project-stage-plan.ts";
import {
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

const project = task("project", { taskType: "2", actionKind: "", title: "Project" });
const stage = task("stage", { parentId: project.blockId, actionKind: "stage", title: "Stage", sort: 0 });
const child = task("child", { parentId: stage.blockId, title: "Child" });
const sibling = task("sibling", { parentId: project.blockId, title: "Sibling", sort: 10_000 });

test("项目计划的父级选项排除自身与后代并保留 Project 和其他 Action", () => {
    const options = buildProjectTreeParentOptions(stage, project, [stage, child, sibling]);

    assert.deepEqual(
        options.map((entry) => entry.blockId),
        [project.blockId, sibling.blockId],
    );
    assert.deepEqual(
        buildProjectTreeParentOptions(child, project, [stage, child, sibling]).map((entry) => entry.blockId),
        [project.blockId, stage.blockId, sibling.blockId],
    );
});

test("项目计划把上下移动换算成明确的 afterId，边界不产生写入", () => {
    const first = task("first", { parentId: project.blockId, sort: 0 });
    const middle = task("middle", { parentId: project.blockId, sort: 10_000 });
    const last = task("last", { parentId: project.blockId, sort: 20_000 });
    const siblings = [last, first, middle];

    assert.deepEqual(buildProjectTreeReorderIntent(middle, siblings, "up"), {
        blockId: middle.blockId,
        parentId: project.blockId,
        afterId: undefined,
    });
    assert.deepEqual(buildProjectTreeReorderIntent(middle, siblings, "down"), {
        blockId: middle.blockId,
        parentId: project.blockId,
        afterId: last.blockId,
    });
    assert.deepEqual(buildProjectTreeReorderIntent(last, siblings, "up"), {
        blockId: last.blockId,
        parentId: project.blockId,
        afterId: first.blockId,
    });
    assert.equal(buildProjectTreeReorderIntent(first, siblings, "up"), null);
    assert.equal(buildProjectTreeReorderIntent(last, siblings, "down"), null);
});

test("项目计划编辑列表不受其他项目视图的折叠状态影响", () => {
    // Regression: collapsing a Stage in hierarchy mode used to hide its children from the overview editor.
    const summary = buildProjectControlState([project, stage, child, sibling]).projects[0].summary;
    const collapsedModel = buildProjectTreeModel(summary, new Set([stage.blockId]), { showCompleted: true });

    assert.deepEqual(
        collapsedModel.rows.map((row) => row.task.blockId),
        [project.blockId, stage.blockId, sibling.blockId],
    );
    assert.deepEqual(
        buildProjectPlanRows(collapsedModel, project.blockId).map((row) => row.task.blockId),
        [stage.blockId, child.blockId, sibling.blockId],
    );
});

test("Stage 创建和结构变化后统一摘要、树、进度与 Next Action 一起重算", () => {
    const activeProject = task("active-project", { taskType: "2", actionKind: "", status: "doing" });
    const createdStage = task("created-stage", {
        parentId: activeProject.blockId,
        actionKind: "stage",
        title: "Delivery",
    });
    const createdControl = buildProjectControlState([activeProject, createdStage], {
        selection: { projectId: activeProject.blockId },
    });
    const createdSummary = createdControl.selectedProject!.summary;
    const createdTree = buildProjectTreeModel(createdSummary, new Set(), { showCompleted: true });

    assert.deepEqual(
        createdTree.rows.map((row) => row.task.blockId),
        [activeProject.blockId, createdStage.blockId],
    );
    assert.deepEqual(
        createdSummary.nextActions.map((entry) => entry.blockId),
        [createdStage.blockId],
    );
    assert.equal(createdSummary.openCount, 1);

    const completedChild = task("completed-child", {
        parentId: createdStage.blockId,
        status: "done",
    });
    const nestedSummary = buildProjectControlState([activeProject, createdStage, completedChild]).projects[0].summary;
    assert.equal(nestedSummary.doneCount, 1);
    assert.equal(nestedSummary.openCount, 0);
    assert.equal(nestedSummary.completionCandidate, true);

    const movedChild = { ...completedChild, parentId: activeProject.blockId };
    const movedSummary = buildProjectControlState([activeProject, createdStage, movedChild]).projects[0].summary;
    assert.equal(movedSummary.doneCount, 1);
    assert.equal(movedSummary.openCount, 1);
    assert.equal(movedSummary.completionCandidate, false);
    assert.deepEqual(
        movedSummary.nextActions.map((entry) => entry.blockId),
        [createdStage.blockId],
    );
});
