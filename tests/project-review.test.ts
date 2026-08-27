import test from "node:test";
import assert from "node:assert/strict";
import {
    buildProjectReviewQueue,
    excludeManualProjectReviewTasks,
    mergeManualProjectReviews,
    projectReviewPlanTasks,
} from "../src/shared/review.ts";
import { buildProjectSummaries } from "../src/shared/project-domain.ts";
import { buildProjectControlState } from "../src/shared/project-control.ts";
import type { ReviewData, TaskCacheEntry } from "../src/shared/types.ts";

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

test("项目周期到期与多个风险合并为唯一 Review 队列项", () => {
    // Regression: one project previously appeared separately as a due task, an active project, and multiple risks.
    const project = task("project", {
        taskType: "2",
        status: "doing",
        reviewInterval: 7,
        reviewDate: "2026-08-24",
    });
    const overdue = task("overdue", { parentId: project.blockId, due: "2026-08-20" });
    const blocked = task("blocked", { parentId: project.blockId, blocked: true, blockedReason: "dependency" });
    const control = buildProjectControlState([project, overdue, blocked], { today: "2026-08-25" });

    const result = buildProjectReviewQueue(control, "2026-08-25");

    assert.equal(result.queue.length, 1);
    assert.equal(result.queue[0].summary.project.blockId, project.blockId);
    assert.deepEqual(result.queue[0].triggers, ["schedule", "risk"]);
    assert.equal(result.queue[0].schedule, "overdue");
    assert.deepEqual(
        result.queue[0].summary.risks.map((risk) => risk.kind),
        ["overdue", "blocked"],
    );
});

test("风险消失后项目离开自动队列，但仍可手动立即回顾", () => {
    // Regression: risk-triggered projects either stayed stale in Review or became unreachable without a review cycle.
    const project = task("project", { taskType: "2", status: "doing" });
    const blockedAction = task("action", {
        parentId: project.blockId,
        blocked: true,
        blockedReason: "dependency",
    });
    const risky = buildProjectControlState([project, blockedAction], { today: "2026-08-25" });
    const healthy = buildProjectControlState([project, task("action", { parentId: project.blockId })], {
        today: "2026-08-25",
    });

    assert.deepEqual(
        buildProjectReviewQueue(risky, "2026-08-25").queue.map((item) => item.summary.project.blockId),
        [project.blockId],
    );
    const result = buildProjectReviewQueue(healthy, "2026-08-25");
    assert.deepEqual(result.queue, []);
    assert.deepEqual(
        result.reviewableProjects.map((summary) => summary.project.blockId),
        [project.blockId],
    );

    const manualQueue = mergeManualProjectReviews(result.queue, result.reviewableProjects, [project.blockId]);
    assert.equal(manualQueue.length, 1);
    assert.equal(manualQueue[0].summary.project.blockId, project.blockId);
    assert.deepEqual(manualQueue[0].triggers, ["manual"]);
    assert.equal(manualQueue[0].schedule, "none");
});

test("叶子行动完成后的 completionCandidate 进入项目回顾队列", () => {
    // Regression: removing the generic active-project checklist could hide completion candidates from Review.
    const project = task("project", { taskType: "2", status: "doing" });
    const completedAction = task("action", { parentId: project.blockId, status: "done" });
    const control = buildProjectControlState([project, completedAction], { today: "2026-08-25" });

    const result = buildProjectReviewQueue(control, "2026-08-25");

    assert.equal(result.queue.length, 1);
    assert.equal(result.queue[0].summary.completionCandidate, true);
    assert.deepEqual(result.queue[0].triggers, ["completionCandidate"]);
});

test("项目自身阻塞时即使存在可执行子项也进入风险回顾", () => {
    // Regression: project-level blocking produced blocked health but no risk, so Review omitted the project.
    const project = task("project", {
        taskType: "2",
        status: "doing",
        blocked: true,
        blockedReason: "dependency",
    });
    const action = task("action", { parentId: project.blockId });

    const result = buildProjectReviewQueue(
        buildProjectControlState([project, action], { today: "2026-08-25" }),
        "2026-08-25",
    );

    assert.equal(result.queue.length, 1);
    assert.deepEqual(result.queue[0].triggers, ["risk"]);
    assert.deepEqual(result.queue[0].summary.risks, [{ kind: "blocked", taskId: project.blockId, severity: "high" }]);
});

test("项目回顾计划保留非 Next Action 的未完成后代", () => {
    // Regression: Review only displayed Next Actions and hid the remaining project plan.
    const project = task("project", { taskType: "2", status: "doing" });
    const parent = task("parent", { parentId: project.blockId, childIds: ["later"] });
    const later = task("later", {
        parentId: parent.blockId,
        status: "someday",
        start: "2026-09-30",
    });
    const summary = buildProjectSummaries([project, parent, later], { today: "2026-08-25" })[0];

    assert.deepEqual(
        projectReviewPlanTasks(summary).map((entry) => entry.blockId),
        ["parent", "later"],
    );
});

test("手动回顾项目时从通用 Review 分组排除其后代", () => {
    // Regression: a manually selected healthy project and its Next Action appeared as two Review items.
    const project = task("project", { taskType: "2", status: "doing" });
    const action = task("action", { parentId: project.blockId });
    const summary = buildProjectSummaries([project, action], { today: "2026-08-25" })[0];
    const reviewData: ReviewData = {
        lastReviewAt: "",
        overdueTasks: [],
        nextActions: [action],
        inboxTasks: [],
        waitingTasks: [],
        somedayTasks: [],
        reviewDueTasks: [],
        projectReviews: [],
        reviewableProjects: [summary],
    };

    const filtered = excludeManualProjectReviewTasks(reviewData, [project.blockId]);

    assert.deepEqual(filtered.nextActions, []);
    assert.equal(filtered.reviewableProjects, reviewData.reviewableProjects);
});
