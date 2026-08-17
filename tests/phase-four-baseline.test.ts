import test from "node:test";
import assert from "node:assert/strict";
import { CacheManager } from "../src/kernel/cache-manager.ts";
import { calculateOrder, getBlockedReason } from "../src/kernel/priority-engine.ts";
import { FakeSiyuanApi, taskFactory } from "./helpers/fakes.ts";

const PROJECT_ID = "20260816090000-project";
const CHILD_A_ID = "20260816090001-childaa";
const CHILD_B_ID = "20260816090002-childbb";
const OTHER_ID = "20260816090003-otherxx";

test("缓存父子关系在新增、移动和删除后保持一致", () => {
    const cache = new CacheManager(new FakeSiyuanApi());
    cache.set(taskFactory(PROJECT_ID, { taskType: "2" }));
    cache.set(taskFactory(OTHER_ID, { taskType: "2" }));
    cache.set(taskFactory(CHILD_A_ID, { parentId: PROJECT_ID }));
    cache.set(taskFactory(CHILD_B_ID, { parentId: PROJECT_ID }));

    assert.deepEqual(
        cache
            .getByParent(PROJECT_ID)
            .map((task) => task.blockId)
            .sort(),
        [CHILD_A_ID, CHILD_B_ID],
    );
    assert.deepEqual(cache.get(PROJECT_ID)?.childIds.slice().sort(), [CHILD_A_ID, CHILD_B_ID]);

    cache.set(taskFactory(CHILD_A_ID, { parentId: OTHER_ID }));
    assert.deepEqual(cache.get(PROJECT_ID)?.childIds, [CHILD_B_ID]);
    assert.deepEqual(cache.get(OTHER_ID)?.childIds, [CHILD_A_ID]);

    cache.remove(CHILD_A_ID);
    assert.deepEqual(cache.get(OTHER_ID)?.childIds, []);
});

test("子任务早于父任务写入时仍能在父任务出现后回填索引", () => {
    const cache = new CacheManager(new FakeSiyuanApi());
    cache.set(taskFactory(CHILD_A_ID, { parentId: PROJECT_ID }));
    assert.deepEqual(
        cache.getByParent(PROJECT_ID).map((task) => task.blockId),
        [CHILD_A_ID],
    );

    cache.set(taskFactory(PROJECT_ID, { taskType: "2" }));
    assert.deepEqual(cache.get(PROJECT_ID)?.childIds, [CHILD_A_ID]);
});

test("依赖反向索引随依赖更新和任务删除同步变化", () => {
    const cache = new CacheManager(new FakeSiyuanApi());
    cache.set(taskFactory(CHILD_A_ID, { depends: PROJECT_ID }));
    assert.deepEqual(
        cache.getDependents(PROJECT_ID).map((task) => task.blockId),
        [CHILD_A_ID],
    );

    cache.set(taskFactory(CHILD_A_ID, { depends: OTHER_ID }));
    assert.deepEqual(cache.getDependents(PROJECT_ID), []);
    assert.deepEqual(
        cache.getDependents(OTHER_ID).map((task) => task.blockId),
        [CHILD_A_ID],
    );

    cache.remove(CHILD_A_ID);
    assert.deepEqual(cache.getDependents(OTHER_ID), []);
});

test("依赖和顺序约束能从同一缓存状态计算阻塞原因", () => {
    const cache = new CacheManager(new FakeSiyuanApi());
    cache.set(taskFactory(PROJECT_ID, { taskType: "2", sequential: true }));
    cache.set(taskFactory(CHILD_A_ID, { parentId: PROJECT_ID, sort: 0 }));
    cache.set(taskFactory(CHILD_B_ID, { parentId: PROJECT_ID, sort: 10000, depends: OTHER_ID }));
    cache.set(taskFactory(OTHER_ID, { status: "todo" }));

    const state = cache.getCache();
    assert.equal(getBlockedReason(cache.get(CHILD_B_ID)!, state), "dependency");

    cache.set(taskFactory(OTHER_ID, { status: "done" }));
    assert.equal(getBlockedReason(cache.get(CHILD_B_ID)!, cache.getCache()), "sequential");

    cache.set(taskFactory(CHILD_A_ID, { parentId: PROJECT_ID, sort: 0, status: "done" }));
    assert.equal(getBlockedReason(cache.get(CHILD_B_ID)!, cache.getCache()), "");
});

test("项目排序继续取未完成子任务与项目自身的较高值", () => {
    const cache = new CacheManager(new FakeSiyuanApi());
    const project = taskFactory(PROJECT_ID, { taskType: "2", importance: 1, effort: 8 });
    const child = taskFactory(CHILD_A_ID, { parentId: PROJECT_ID, importance: 8, effort: 1, priority: "critical" });
    child.order = calculateOrder(child);
    cache.set(project);
    cache.set(child);

    const projectOrder = calculateOrder(cache.get(PROJECT_ID)!, cache.getCache());
    assert.equal(projectOrder, child.order);
});
