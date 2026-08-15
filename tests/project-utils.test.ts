import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectSummaries, getProjectDateBucket } from "../src/frontend/utils/project.ts";
import type { TaskCacheEntry } from "../src/shared/types.ts";

function task(blockId: string, overrides: Partial<TaskCacheEntry> = {}): TaskCacheEntry {
    return {
        blockId, parentId: "", status: "todo", priority: "medium", importance: 4, effort: 4,
        due: "", start: "", context: "", taskType: "1", order: 0, childIds: [], title: blockId,
        depends: "", depMode: "all", sequential: false, repeat: "", repeatState: "", sort: 0,
        completed: "", note: "", created: "", tags: "", blocked: false, blockedReason: "",
        reviewInterval: 0, reviewDate: "", reminder: "", customFields: {}, ...overrides,
    };
}

test("项目摘要递归统计后代任务并保留已完成任务", () => {
    const project = task("p", { taskType: "2", childIds: ["a"] });
    const a = task("a", { parentId: "p", childIds: ["b"] });
    const b = task("b", { parentId: "a", status: "done" });
    const summary = buildProjectSummaries([project, a, b], "2026-08-06")[0];
    assert.equal(summary.descendants.length, 2);
    assert.equal(summary.doneCount, 1);
    assert.equal(summary.progress, 50);
});

test("项目风险优先级为完成、阻塞、关注、正常", () => {
    const complete = task("done-project", { taskType: "2", status: "done" });
    const blocked = task("blocked-project", { taskType: "2", childIds: ["blocked-task"] });
    const blockedTask = task("blocked-task", { parentId: "blocked-project", blocked: true });
    const attention = task("attention-project", { taskType: "2", childIds: ["waiting-task"] });
    const waiting = task("waiting-task", { parentId: "attention-project", status: "waiting" });
    const normal = task("normal-project", { taskType: "2", childIds: ["next"] });
    const next = task("next", { parentId: "normal-project" });
    const summaries = buildProjectSummaries([complete, blocked, blockedTask, attention, waiting, normal, next], "2026-08-06");
    assert.equal(summaries.find(item => item.project.blockId === "done-project")?.health, "complete");
    assert.equal(summaries.find(item => item.project.blockId === "blocked-project")?.health, "blocked");
    assert.equal(summaries.find(item => item.project.blockId === "attention-project")?.health, "attention");
    assert.equal(summaries.find(item => item.project.blockId === "normal-project")?.health, "onTrack");
});

test("项目不会因为存在未完成子任务而显示阻塞", () => {
    const project = task("project", {
        taskType: "2",
        status: "doing",
        childIds: ["child"],
        blocked: true,
        blockedReason: "children",
    });
    const child = task("child", { parentId: "project", status: "todo" });
    const summary = buildProjectSummaries([project, child], "2026-08-15")[0];
    assert.equal(summary.health, "onTrack");
    assert.equal(summary.nextActions.length, 1);
});

test("收件箱子任务属于待澄清而不是项目阻塞", () => {
    const project = task("project", { taskType: "2", status: "doing", childIds: ["inbox", "next"] });
    const inbox = task("inbox", {
        parentId: "project",
        status: "inbox",
        blocked: true,
        blockedReason: "inbox",
    });
    const next = task("next", { parentId: "project", status: "todo" });
    const summary = buildProjectSummaries([project, inbox, next], "2026-08-15")[0];
    assert.equal(summary.health, "onTrack");
    assert.equal(summary.blockedTasks.length, 0);
    assert.equal(summary.nextActions.length, 1);
});

test("部分子任务阻塞时项目需关注，只有没有可执行任务时才阻塞", () => {
    const project = task("project", { taskType: "2", status: "doing", childIds: ["blocked", "next"] });
    const blocked = task("blocked", {
        parentId: "project",
        blocked: true,
        blockedReason: "dependency",
    });
    const next = task("next", { parentId: "project" });
    const attention = buildProjectSummaries([project, blocked, next], "2026-08-15")[0];
    const fullyBlocked = buildProjectSummaries([
        { ...project, childIds: ["blocked"] },
        blocked,
    ], "2026-08-15")[0];
    assert.equal(attention.health, "attention");
    assert.equal(fullyBlocked.health, "blocked");
});

test("空项目和缺少下一步行动项目会进入关注队列", () => {
    const empty = task("empty", { taskType: "2" });
    const parent = task("parent", { taskType: "2", childIds: ["child"] });
    const child = task("child", { parentId: "parent", status: "someday" });
    const summaries = buildProjectSummaries([empty, parent, child], "2026-08-06");
    assert.equal(summaries.find(item => item.project.blockId === "empty")?.risks[0]?.kind, "empty");
    assert.equal(summaries.find(item => item.project.blockId === "parent")?.risks[0]?.kind, "noNextAction");
});

test("循环父子关系不会导致递归失控", () => {
    const a = task("a", { taskType: "2", childIds: ["b"] });
    const b = task("b", { parentId: "a", childIds: ["a"] });
    assert.equal(buildProjectSummaries([a, b], "2026-08-06")[0].descendants.length, 1);
});

test("计划日期分组覆盖边界", () => {
    assert.equal(getProjectDateBucket(task("overdue", { due: "2026-08-05" }), "2026-08-06"), "overdue");
    assert.equal(getProjectDateBucket(task("today", { due: "2026-08-06" }), "2026-08-06"), "today");
    assert.equal(getProjectDateBucket(task("week", { due: "2026-08-10" }), "2026-08-06"), "thisWeek");
    assert.equal(getProjectDateBucket(task("later", { due: "2026-08-20" }), "2026-08-06"), "later");
    assert.equal(getProjectDateBucket(task("none"), "2026-08-06"), "unscheduled");
});
