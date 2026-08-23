import test from "node:test";
import assert from "node:assert/strict";
import { CacheManager } from "../src/kernel/cache-manager.ts";
import { TaskDerivedStateService } from "../src/kernel/task-derived-state-service.ts";
import { TaskRepository } from "../src/kernel/task-repository.ts";
import { Mutex } from "../src/kernel/mutex.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import { FakeSiyuanApi, FakeTaskChangePublisher, taskFactory } from "./helpers/fakes.ts";

const PROJECT_A = "20260816100000-projecta";
const PROJECT_B = "20260816100001-projectb";
const CHILD_A = "20260816100002-childaaa";
const CHILD_B = "20260816100003-childbbb";
const DEPENDENCY = "20260816100004-dependxx";
const DEPENDENT = "20260816100005-dependyy";

function reconcile(cache: CacheManager): string[] {
    return new TaskDerivedStateService(cache).reconcile(cache.consumeAffectedIds());
}

test("顺序项目开关由统一派生服务更新全部子任务", () => {
    const cache = new CacheManager(new FakeSiyuanApi());
    cache.set(taskFactory(PROJECT_A, { taskType: "2", sequential: false }));
    cache.set(taskFactory(CHILD_A, { parentId: PROJECT_A, sort: 0 }));
    cache.set(taskFactory(CHILD_B, { parentId: PROJECT_A, sort: 10000 }));
    reconcile(cache);

    cache.set(taskFactory(PROJECT_A, { taskType: "2", sequential: true }));
    const changed = reconcile(cache);

    assert.equal(cache.get(CHILD_A)?.blocked, false);
    assert.equal(cache.get(CHILD_B)?.blockedReason, "sequential");
    assert.ok(changed.includes(CHILD_B));
});

test("顺序父任务中的状态变化只提交实际变化的兄弟", () => {
    const cache = new CacheManager(new FakeSiyuanApi());
    cache.set(taskFactory(PROJECT_A, { taskType: "2", sequential: true }));
    cache.set(taskFactory(CHILD_A, { parentId: PROJECT_A, sort: 0 }));
    cache.set(taskFactory(CHILD_B, { parentId: PROJECT_A, sort: 10000 }));
    reconcile(cache);
    assert.equal(cache.get(CHILD_B)?.blockedReason, "sequential");

    cache.set(taskFactory(CHILD_A, { parentId: PROJECT_A, sort: 0, status: "done" }));
    const changed = reconcile(cache);

    assert.equal(cache.get(CHILD_B)?.blocked, false);
    assert.ok(changed.includes(CHILD_B));
});

test("父任务移动同时更新旧父和新父的顺序派生状态", () => {
    const cache = new CacheManager(new FakeSiyuanApi());
    cache.set(taskFactory(PROJECT_A, { taskType: "2", sequential: true }));
    cache.set(taskFactory(PROJECT_B, { taskType: "2", sequential: true }));
    cache.set(taskFactory(CHILD_A, { parentId: PROJECT_A, sort: 0 }));
    cache.set(taskFactory(CHILD_B, { parentId: PROJECT_A, sort: 10000 }));
    reconcile(cache);

    cache.set(taskFactory(CHILD_A, { parentId: PROJECT_B, sort: 0 }));
    const changed = reconcile(cache);

    assert.equal(cache.get(CHILD_B)?.blocked, false);
    assert.deepEqual(cache.get(PROJECT_A)?.childIds, [CHILD_B]);
    assert.deepEqual(cache.get(PROJECT_B)?.childIds, [CHILD_A]);
    assert.ok(changed.includes(CHILD_B));
});

test("依赖目标状态变化和删除通过反向索引解除阻塞", () => {
    const cache = new CacheManager(new FakeSiyuanApi());
    cache.set(taskFactory(DEPENDENCY));
    cache.set(taskFactory(DEPENDENT, { depends: DEPENDENCY }));
    reconcile(cache);
    assert.equal(cache.get(DEPENDENT)?.blockedReason, "dependency");

    cache.set(taskFactory(DEPENDENCY, { status: "done" }));
    assert.ok(reconcile(cache).includes(DEPENDENT));
    assert.equal(cache.get(DEPENDENT)?.blocked, false);

    cache.set(taskFactory(DEPENDENCY));
    reconcile(cache);
    cache.remove(DEPENDENCY);
    assert.ok(reconcile(cache).includes(DEPENDENT));
    assert.equal(cache.get(DEPENDENT)?.blocked, false);
});

test("all 与 any 依赖模式使用相同的派生提交入口", () => {
    const cache = new CacheManager(new FakeSiyuanApi());
    cache.set(taskFactory(DEPENDENCY, { status: "done" }));
    cache.set(taskFactory(CHILD_A));
    cache.set(taskFactory(DEPENDENT, { depends: `${DEPENDENCY}|${CHILD_A}`, depMode: "all" }));
    reconcile(cache);
    assert.equal(cache.get(DEPENDENT)?.blockedReason, "dependency");

    cache.set(taskFactory(DEPENDENT, { depends: `${DEPENDENCY}|${CHILD_A}`, depMode: "any" }));
    reconcile(cache);
    assert.equal(cache.get(DEPENDENT)?.blocked, false);
});

test("普通父任务在子任务删除后解除 children 阻塞", () => {
    const cache = new CacheManager(new FakeSiyuanApi());
    cache.set(taskFactory(PROJECT_A, { taskType: "1" }));
    cache.set(taskFactory(CHILD_A, { parentId: PROJECT_A }));
    reconcile(cache);
    assert.equal(cache.get(PROJECT_A)?.blockedReason, "children");

    cache.remove(CHILD_A);
    assert.ok(reconcile(cache).includes(PROJECT_A));
    assert.equal(cache.get(PROJECT_A)?.blocked, false);
});

test("嵌套项目从最深层向祖先传播子任务排序", () => {
    const cache = new CacheManager(new FakeSiyuanApi());
    cache.set(taskFactory(PROJECT_A, { taskType: "2", importance: 1, effort: 8 }));
    cache.set(taskFactory(PROJECT_B, { taskType: "2", parentId: PROJECT_A, importance: 1, effort: 8 }));
    cache.set(taskFactory(CHILD_A, { parentId: PROJECT_B, importance: 8, effort: 1, priority: "critical" }));
    reconcile(cache);

    assert.equal(cache.get(PROJECT_B)?.order, cache.get(CHILD_A)?.order);
    assert.equal(cache.get(PROJECT_A)?.order, cache.get(CHILD_A)?.order);
});

test("不影响派生值的任务更新不会产生额外派生通知", () => {
    const cache = new CacheManager(new FakeSiyuanApi());
    cache.set(taskFactory(CHILD_A));
    reconcile(cache);
    cache.set({ ...cache.get(CHILD_A)!, title: "Renamed" });

    assert.deepEqual(reconcile(cache), []);
});

test("Repository 提交点自动登记间接受影响的顺序兄弟", async () => {
    const api = new FakeSiyuanApi();
    const cache = new CacheManager(api);
    const publisher = new FakeTaskChangePublisher();
    const repository = new TaskRepository(api, cache, new Mutex(), publisher, DEFAULT_SETTINGS);
    cache.set(taskFactory(PROJECT_A, { taskType: "2", sequential: true }));
    cache.set(taskFactory(CHILD_A, { parentId: PROJECT_A, sort: 0 }));
    cache.set(taskFactory(CHILD_B, { parentId: PROJECT_A, sort: 10000 }));
    repository.reconcileAllDerivedState();
    cache.consumeAffectedIds();

    await repository.withConfirmedChanges(async (changes) => {
        changes.upsertEntry({ ...cache.get(CHILD_A)!, status: "done" });
    });

    assert.ok(publisher.changes.includes(CHILD_B));
    assert.equal(cache.get(CHILD_B)?.blocked, false);
});

test("Repository 提交点广播仅 childIds 变化的项目父任务", async () => {
    const api = new FakeSiyuanApi();
    const cache = new CacheManager(api);
    const publisher = new FakeTaskChangePublisher();
    const repository = new TaskRepository(api, cache, new Mutex(), publisher, DEFAULT_SETTINGS);
    await repository.withConfirmedChanges(async (changes) => {
        changes.upsertEntry(taskFactory(PROJECT_A, { taskType: "2", importance: 8, priority: "critical" }));
    });
    publisher.changes.length = 0;

    await repository.withConfirmedChanges(async (changes) => {
        changes.upsertEntry(taskFactory(CHILD_A, { parentId: PROJECT_A, importance: 1, effort: 8 }));
    });

    assert.deepEqual(cache.get(PROJECT_A)?.childIds, [CHILD_A]);
    assert.ok(publisher.changes.includes(PROJECT_A));
});
