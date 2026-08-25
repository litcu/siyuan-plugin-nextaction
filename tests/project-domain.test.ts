import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectSummaries, isNextActionCandidate, isProjectTask } from "../src/shared/project-domain.ts";
import type { TaskCacheEntry } from "../src/shared/types.ts";

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

test("只有带项目标记的文档任务才具有 Project 身份", () => {
    // Regression: taskType alone must not make a native task a Project.
    const documentProject = task("document-project", { taskType: "2", identificationSource: "document" });
    const nativeTaskWithStaleMarker = task("native-task", { taskType: "2", identificationSource: "native" });

    assert.equal(isProjectTask(documentProject), true);
    assert.equal(isProjectTask(nativeTaskWithStaleMarker), false);
    assert.deepEqual(
        buildProjectSummaries([documentProject, nativeTaskWithStaleMarker]).map((summary) => summary.project.blockId),
        ["document-project"],
    );
    assert.equal(isNextActionCandidate(nativeTaskWithStaleMarker), true);
});

test("项目进度只统计叶子 Action，并提供每个父 Action 的子树进度", () => {
    // Regression: parent actions used to be counted again alongside their leaf actions.
    const project = task("project", { taskType: "2", childIds: ["stage", "standalone"] });
    const stage = task("stage", { parentId: "project", status: "done", childIds: ["done", "open"] });
    const done = task("done", { parentId: "stage", status: "done" });
    const open = task("open", { parentId: "stage" });
    const standalone = task("standalone", { parentId: "project", status: "done" });

    const summary = buildProjectSummaries([project, stage, done, open, standalone], {
        today: "2026-08-24",
    })[0];

    assert.deepEqual(
        summary.leafActions.map((entry) => entry.blockId),
        ["done", "open", "standalone"],
    );
    assert.equal(summary.progress, 67);
    assert.deepEqual(summary.subtreeProgress.stage, { done: 1, total: 2, percent: 50 });
    assert.equal(summary.doneCount, 2);
    assert.equal(summary.openCount, 1);
});

test("空项目保留 0/0 待澄清语义，仅 Planned/Active 项目产生尚未拆解风险", () => {
    const draft = task("draft", { taskType: "2", status: "inbox" });
    const planned = task("planned", { taskType: "2", status: "todo" });
    const active = task("active", { taskType: "2", status: "doing" });
    const summaries = buildProjectSummaries([draft, planned, active], { today: "2026-08-24" });

    const draftSummary = summaries.find((entry) => entry.project.blockId === "draft")!;
    assert.equal(draftSummary.empty, true);
    assert.equal(draftSummary.clarificationNeeded, true);
    assert.equal(draftSummary.progress, 0);
    assert.equal(draftSummary.doneCount + draftSummary.openCount, 0);
    assert.equal(
        draftSummary.risks.some((risk) => risk.kind === "empty"),
        false,
    );
    assert.equal(draftSummary.health, "onTrack");

    for (const projectId of ["planned", "active"]) {
        const summary = summaries.find((entry) => entry.project.blockId === projectId)!;
        assert.equal(
            summary.risks.some((risk) => risk.kind === "empty"),
            true,
        );
        assert.equal(summary.health, "attention");
    }
});

test("叶子全部完成只产生 completionCandidate，项目确认 done 后健康度才是 complete", () => {
    const action = task("action", { parentId: "stage", status: "done" });
    const stage = task("stage", { parentId: "project", status: "doing", childIds: ["action"] });
    const active = task("project", { taskType: "2", status: "doing", childIds: ["stage"] });
    const confirmed = { ...active, status: "done" };

    const candidate = buildProjectSummaries([active, stage, action], { today: "2026-08-24" })[0];
    assert.equal(candidate.completionCandidate, true);
    assert.notEqual(candidate.health, "complete");
    assert.deepEqual(
        candidate.incompleteNonLeafActions.map((entry) => entry.blockId),
        ["stage"],
    );

    const completed = buildProjectSummaries([confirmed, stage, action], { today: "2026-08-24" })[0];
    assert.equal(completed.completionCandidate, false);
    assert.equal(completed.health, "complete");
});

test("共享 Next Action 判断统一排除不可执行状态、未来窗口和阻塞任务", () => {
    // Regression: someday actions used to appear in the kernel Next Action query but not in ProjectView.
    const sequentialParent = task("sequential-parent", {
        childIds: ["first", "sequential"],
        sequential: true,
    });
    const first = task("first", { parentId: "sequential-parent", sort: 1 });
    const dependencyBlocker = task("dependency-blocker");
    const candidates = [
        task("available"),
        task("preview", { start: "2026-08-26" }),
        task("future", { start: "2026-08-27" }),
        task("project", { taskType: "2" }),
        task("done", { status: "done" }),
        task("waiting", { status: "waiting" }),
        task("someday", { status: "someday" }),
        task("inbox", { status: "inbox" }),
        task("dependency", { depends: "dependency-blocker" }),
        task("sequential", { parentId: "sequential-parent", sort: 2 }),
    ];
    const lookup = new Map(
        [...candidates, sequentialParent, first, dependencyBlocker].map((entry) => [entry.blockId, entry]),
    );

    assert.deepEqual(
        candidates
            .filter((entry) =>
                isNextActionCandidate(entry, {
                    today: "2026-08-24",
                    startPreviewDays: 2,
                    taskLookup: lookup,
                }),
            )
            .map((entry) => entry.blockId),
        ["available", "preview"],
    );
});

test("项目风险与 Next Action 使用相同的依赖阻塞证据", () => {
    const project = task("project", { taskType: "2", childIds: ["blocked"] });
    const blocked = task("blocked", { parentId: "project", depends: "blocker" });
    const blocker = task("blocker", { status: "todo" });

    const summary = buildProjectSummaries([project, blocked, blocker], { today: "2026-08-24" })[0];

    assert.deepEqual(summary.nextActions, []);
    assert.deepEqual(
        summary.blockedTasks.map((entry) => entry.blockId),
        ["blocked"],
    );
    assert.equal(summary.health, "blocked");
});
