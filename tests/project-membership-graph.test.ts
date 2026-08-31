import test from "node:test";
import assert from "node:assert/strict";
import {
    createProjectMembershipGraph,
    ProjectMembershipGraphBuildError,
} from "../src/shared/project-membership-graph.ts";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import { CacheManager } from "../src/kernel/cache-manager.ts";

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

test("有效父任务优先于过期 childIds，并稳定推导 Project 归属", () => {
    // Regression: different callers previously chose parentId or childIds independently.
    const first = task("first", { taskType: "2" });
    const stale = task("stale", { taskType: "2", childIds: ["action"] });
    const action = task("action", { parentId: first.blockId });
    const graph = createProjectMembershipGraph([first, stale, action]);

    assert.equal(graph.node(action.blockId)?.effectiveParentId, first.blockId);
    assert.equal(graph.node(action.blockId)?.edgeSource, "parentId");
    assert.equal(graph.node(action.blockId)?.projectId, first.blockId);
    assert.deepEqual(
        graph.node(first.blockId)?.actions.map((entry) => entry.blockId),
        [action.blockId],
    );
    assert.deepEqual(graph.node(stale.blockId)?.actions, []);
    assert.equal(
        graph.node(action.blockId)?.diagnostics.some((entry) => entry.code === "stale-childids-parent"),
        true,
    );
});

test("广播窗口只接受唯一 childIds 回退，多父声明时保持断开并给出诊断", () => {
    // Regression: input order previously decided which Project won an ambiguous fallback.
    const project = task("project", { taskType: "2", childIds: ["fallback"] });
    const fallback = task("fallback", { parentId: "missing" });
    const single = createProjectMembershipGraph([project, fallback]);
    assert.equal(single.node(fallback.blockId)?.effectiveParentId, project.blockId);
    assert.equal(single.node(fallback.blockId)?.edgeSource, "childIds");
    assert.equal(single.node(fallback.blockId)?.projectId, project.blockId);

    const other = task("other", { taskType: "2", childIds: ["fallback"] });
    const ambiguous = createProjectMembershipGraph([other, fallback, project]);
    assert.equal(ambiguous.node(fallback.blockId)?.effectiveParentId, "");
    assert.equal(ambiguous.node(fallback.blockId)?.projectId, "");
    assert.equal(
        ambiguous.node(fallback.blockId)?.diagnostics.some((entry) => entry.code === "conflicting-childids-parents"),
        true,
    );
});

test("最近 Project 是成员边界，异常嵌套不会泄漏内层 Action", () => {
    // Regression: MCP parent walks crossed nested Projects while Project summaries stopped at them.
    const outer = task("outer", { taskType: "2", childIds: ["inner"] });
    const inner = task("inner", { taskType: "2", parentId: outer.blockId, childIds: ["action"] });
    const action = task("action", { parentId: inner.blockId, actionKind: "stage" });
    const graph = createProjectMembershipGraph([outer, inner, action]);

    assert.equal(graph.node(inner.blockId)?.effectiveParentId, "");
    assert.equal(graph.node(inner.blockId)?.projectId, inner.blockId);
    assert.equal(graph.node(action.blockId)?.projectId, inner.blockId);
    assert.equal(graph.node(action.blockId)?.role, "stage");
    assert.deepEqual(graph.node(outer.blockId)?.actions, []);
    assert.deepEqual(
        graph.node(inner.blockId)?.actions.map((entry) => entry.blockId),
        [action.blockId],
    );
});

test("环和孤儿安全终止，不会产生虚假的 Project 成员", () => {
    const a = task("a", { parentId: "b" });
    const b = task("b", { parentId: "a" });
    const orphan = task("orphan", { parentId: "missing" });
    const graph = createProjectMembershipGraph([a, b, orphan]);

    assert.equal(graph.node(a.blockId)?.projectId, "");
    assert.equal(graph.node(b.blockId)?.projectId, "");
    assert.equal(graph.node(orphan.blockId)?.projectId, "");
    assert.equal(graph.node(a.blockId)?.ancestors.length, 0);
    assert.equal(
        graph.node(a.blockId)?.diagnostics.some((entry) => entry.code === "effective-parent-cycle"),
        true,
    );
    assert.equal(
        graph.node(orphan.blockId)?.diagnostics.some((entry) => entry.code === "orphan-effective-parent"),
        true,
    );
});

test("Project Actions 按父级优先和同级手动顺序返回", () => {
    const project = task("project", { taskType: "2" });
    const later = task("later", { parentId: project.blockId, sort: 20 });
    const earlier = task("earlier", { parentId: project.blockId, sort: 10 });
    const nested = task("nested", { parentId: earlier.blockId, sort: 0 });
    const graph = createProjectMembershipGraph([later, nested, project, earlier]);

    assert.deepEqual(
        graph.node(project.blockId)?.actions.map((entry) => entry.blockId),
        [earlier.blockId, nested.blockId, later.blockId],
    );
    assert.equal(graph.node(nested.blockId)?.nearestStage, undefined);
});

test("父任务变更区分领域拒绝与快照证据不足", () => {
    const project = task("project", { taskType: "2" });
    const parent = task("parent", { parentId: project.blockId });
    const child = task("child", { parentId: parent.blockId });
    const graph = createProjectMembershipGraph([project, parent, child]);

    assert.deepEqual(graph.assessParentChange({ task: parent, parentId: child.blockId }), {
        kind: "rejected",
        reason: "circular-effective-parent",
        path: [parent.blockId, child.blockId, parent.blockId],
    });
    assert.deepEqual(graph.assessParentChange({ task: project, parentId: parent.blockId }), {
        kind: "rejected",
        reason: "project-cannot-have-parent",
        path: [project.blockId, parent.blockId],
    });
    assert.deepEqual(graph.assessParentChange({ task: child, parentId: "missing" }), {
        kind: "incomplete",
        missingTaskIds: ["missing"],
    });
    assert.deepEqual(graph.assessParentChange({ task: child, parentId: project.blockId }), {
        kind: "allowed",
        resultingProjectId: project.blockId,
    });
});

test("重复 Task 身份在构图时立即失败", () => {
    assert.throws(
        () => createProjectMembershipGraph([task("same"), task("same")]),
        (error: unknown) => error instanceof ProjectMembershipGraphBuildError && error.code === "duplicate-task-id",
    );
});

test("内核缓存变更会使复用的 Project 成员快照失效", () => {
    const cache = new CacheManager({} as never);
    const project = task("project", { taskType: "2" });
    const action = task("action");
    cache.set(project);
    cache.set(action);

    const before = cache.getProjectMembershipGraph();
    assert.equal(before.node(action.blockId)?.projectId, "");

    cache.set({ ...action, parentId: project.blockId });
    const after = cache.getProjectMembershipGraph();
    assert.notEqual(after, before);
    assert.equal(after.node(action.blockId)?.projectId, project.blockId);

    cache.remove(project.blockId);
    assert.equal(cache.getProjectMembershipGraph().node(action.blockId)?.projectId, "");
});
