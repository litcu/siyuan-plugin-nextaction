import test from "node:test";
import assert from "node:assert/strict";
import { CacheManager } from "../src/kernel/cache-manager.ts";
import { ProjectBoardMoveService } from "../src/kernel/project-board-move-service.ts";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import { ATTR_IMPORTANCE, ATTR_PRIORITY, ATTR_STATUS } from "../src/shared/constants.ts";
import { createProjectMembershipGraph } from "../src/shared/project-membership-graph.ts";

const id = (n: number) => `2026082800000${n}-abcdefg`;
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

function fixture() {
    const api = {} as never;
    const cache = new CacheManager(api);
    const project = task(id(1), { taskType: "2", parentId: "", title: "Project" });
    const first = task(id(2), { parentId: project.blockId, sort: 0 });
    const moving = task(id(3), { parentId: project.blockId, sort: 10000 });
    const target = task(id(4), { parentId: project.blockId, sort: 20000 });
    for (const entry of [project, first, moving, target]) cache.set(entry);
    const updates: Array<{ id: string; attrs: Record<string, string> }> = [];
    const service = new ProjectBoardMoveService(cache, {
        updateTask: async (blockId: string, attrs: Record<string, string>) => {
            updates.push({ id: blockId, attrs });
            const current = cache.get(blockId)!;
            const next = task(blockId, {
                ...current,
                status: attrs[ATTR_STATUS] || current.status,
                priority: attrs[ATTR_PRIORITY] || current.priority,
                importance: attrs[ATTR_IMPORTANCE] ? Number(attrs[ATTR_IMPORTANCE]) : current.importance,
            });
            cache.set(next);
            return next;
        },
        reorderTask: async (blockId: string, parentId: string, afterId?: string) => {
            const current = cache.get(blockId)!;
            const siblings = cache
                .getByParent(parentId)
                .filter((item) => item.blockId !== blockId)
                .sort((a, b) => a.sort - b.sort);
            const index = afterId ? siblings.findIndex((item) => item.blockId === afterId) + 1 : 0;
            const nextSort = index === 0 ? (siblings[0]?.sort || 0) - 1000 : (siblings[index - 1]?.sort || 0) + 1000;
            cache.set(task(blockId, { ...current, sort: nextSort }));
            void updates;
            return cache.get(blockId)!;
        },
    } as never);
    return { service, cache, project, moving, first, target, updates };
}

test("看板移动只接受当前可见同父级目标，并插入目标卡片前方", async () => {
    const { service, project, moving, first, target } = fixture();
    const result = await service.move({
        taskId: moving.blockId,
        projectId: project.blockId,
        groupBy: "status",
        value: "doing",
        afterId: target.blockId,
        afterParentId: project.blockId,
        visibleTaskIds: [first.blockId, moving.blockId, target.blockId],
    });
    assert.equal(result.status, "success");
    assert.equal(result.task.status, "doing");
    assert.ok(result.undo);
    assert.ok((result.task.sort || 0) < (target.sort || 0));
});

// Regression: 服务层不得在缺少可见快照时接受 afterId
test("缺少可见快照时拒绝 afterId", async () => {
    const { service, project, moving, target } = fixture();
    await assert.rejects(
        service.move({
            taskId: moving.blockId,
            projectId: project.blockId,
            groupBy: "status",
            value: "doing",
            afterId: target.blockId,
            afterParentId: project.blockId,
        }),
        (error: unknown) => (error as { code?: number }).code === -32016,
    );
});

// Regression: 筛选隐藏任务不得成为隐式落点
test("筛选隐藏任务不得成为隐式落点", async () => {
    const { service, project, moving, first } = fixture();
    await assert.rejects(
        service.move({
            taskId: moving.blockId,
            projectId: project.blockId,
            groupBy: "status",
            value: "doing",
            afterId: id(9),
            afterParentId: project.blockId,
            visibleTaskIds: [first.blockId, moving.blockId],
        }),
        (error: unknown) => (error as { code?: number }).code === -32016,
    );
});

// Regression: 跨父级 afterId 必须拒绝且不写入属性
test("跨父级 afterId 必须拒绝且不写入属性", async () => {
    const { service, cache, project, moving } = fixture();
    const otherParent = task(id(5), { parentId: project.blockId, title: "Other parent" });
    const crossTarget = task(id(6), { parentId: otherParent.blockId, sort: 0 });
    cache.set(otherParent);
    cache.set(crossTarget);
    await assert.rejects(
        service.move({
            taskId: moving.blockId,
            projectId: project.blockId,
            groupBy: "status",
            value: "doing",
            afterId: crossTarget.blockId,
            afterParentId: otherParent.blockId,
            visibleTaskIds: [moving.blockId, crossTarget.blockId],
        }),
        (error: unknown) => (error as { code?: number }).code === -32016,
    );
});

test("属性已成功但重排失败时返回部分成功", async () => {
    const { service, project, moving } = fixture();
    const failing = new ProjectBoardMoveService(
        {
            get: (blockId: string) => (blockId === project.blockId ? project : moving),
            getByParent: () => [],
            getProjectMembershipGraph: () => createProjectMembershipGraph([project, moving]),
        } as never,
        {
            updateTask: async () => ({ ...moving, status: "doing" }),
            reorderTask: async () => {
                throw new Error("order unavailable");
            },
        } as never,
    );
    const result = await failing.move({
        taskId: moving.blockId,
        projectId: project.blockId,
        groupBy: "status",
        value: "doing",
    });
    assert.equal(result.status, "partial");
    assert.equal(result.reordered, false);
});

// Regression: none 是独立优先级分组，不能归一化为 veryLow
test("优先级移动保留 none 语义并保持逻辑父级", async () => {
    const { service, project, moving, updates } = fixture();
    const result = await service.move({
        taskId: moving.blockId,
        projectId: project.blockId,
        groupBy: "priority",
        value: "none",
        sortBy: "order",
        visibleTaskIds: [moving.blockId],
    });
    assert.equal(result.task.priority, "none");
    assert.equal(result.task.parentId, project.blockId);
    assert.deepEqual(updates[0]?.attrs, { [ATTR_PRIORITY]: "none" });
});

// Regression: 非手动排序只写分组字段，不调用重排
test("重要性看板在非手动排序时只更新重要性", async () => {
    const { service, project, moving, updates } = fixture();
    const result = await service.move({
        taskId: moving.blockId,
        projectId: project.blockId,
        groupBy: "importance",
        value: 7,
        sortBy: "due",
        visibleTaskIds: [moving.blockId],
    });
    assert.equal(result.status, "success");
    assert.equal(result.reordered, false);
    assert.equal(result.task.importance, 7);
    assert.equal(result.task.parentId, project.blockId);
    assert.deepEqual(updates[0]?.attrs, { [ATTR_IMPORTANCE]: "7" });
});

// Regression: 字段写入成功后的重排失败必须回读缓存中的权威字段值
test("优先级写入成功但重排失败时返回权威部分成功状态", async () => {
    const { cache, project, moving } = fixture();
    const failing = new ProjectBoardMoveService(cache, {
        updateTask: async () => {
            const updated = task(moving.blockId, { ...moving, priority: "critical" });
            cache.set(updated);
            return updated;
        },
        reorderTask: async () => {
            throw new Error("order unavailable");
        },
    } as never);
    const result = await failing.move({
        taskId: moving.blockId,
        projectId: project.blockId,
        groupBy: "priority",
        value: "critical",
        sortBy: "order",
        visibleTaskIds: [moving.blockId],
    });
    assert.equal(result.status, "partial");
    assert.equal(result.task.priority, "critical");
    assert.equal(result.task.parentId, project.blockId);
});

test("移动撤销在任务被外部修改后安全拒绝", async () => {
    const { service, cache, project, moving } = fixture();
    const result = await service.move({
        taskId: moving.blockId,
        projectId: project.blockId,
        groupBy: "status",
        value: "doing",
    });
    assert.ok(result.undo);
    cache.set(task(moving.blockId, { ...moving, status: "waiting", sort: result.task.sort }));
    await assert.rejects(
        service.undo(result.undo!.credential),
        (error: unknown) => (error as { code?: number }).code === -32018,
    );
});
