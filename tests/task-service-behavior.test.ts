import test from "node:test";
import assert from "node:assert/strict";
import { CacheManager } from "../src/kernel/cache-manager.ts";
import { Mutex } from "../src/kernel/mutex.ts";
import { TaskService } from "../src/kernel/task-service.ts";
import { TaskRepository } from "../src/kernel/task-repository.ts";
import { SyncEngine } from "../src/kernel/sync-engine.ts";
import {
    ATTR_DUE,
    ATTR_PARENT,
    ATTR_PRIORITY,
    ATTR_REPEAT,
    ATTR_REPEAT_STATE,
    ATTR_STATUS,
    ATTR_SORT,
    ATTR_TASK,
    RPC_ERROR_TIMEOUT,
} from "../src/shared/constants.ts";
import { FakeMyDayTaskPort, FakeSiyuanApi, FakeTaskChangePublisher, taskFactory } from "./helpers/fakes.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";

const ID = "20260816123456-abcdefg";

function setup() {
    const api = new FakeSiyuanApi();
    api.addBlock(ID, "p", "Write tests");
    const cache = new CacheManager(api);
    const publisher = new FakeTaskChangePublisher();
    const repository = new TaskRepository(api, cache, new Mutex(), publisher, DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    return { api, cache, publisher, service };
}

test("转换、更新和移除均以权威属性回读驱动缓存与变更发布", async () => {
    const { api, cache, publisher, service } = setup();
    const created = await service.convertToTask(ID, "Write tests");
    assert.equal(api.blocks.get(ID)?.attrs[ATTR_TASK], "1");
    assert.equal(created.status, "inbox");
    assert.equal(cache.get(ID)?.title, "Write tests");
    assert.deepEqual(publisher.changes[publisher.changes.length - 1], { blockId: ID, type: "create" });

    const updated = await service.updateTask(ID, { [ATTR_STATUS]: "todo", [ATTR_PRIORITY]: "high" });
    assert.equal(updated.status, "todo");
    assert.equal(updated.priority, "high");
    assert.deepEqual(service.getTask(ID), updated);
    assert.equal(
        service.getNextActions().some((task) => task.blockId === ID),
        true,
    );

    await service.removeTask(ID);
    assert.equal(api.blocks.get(ID)?.attrs[ATTR_TASK], "");
    assert.equal(cache.get(ID), undefined);
    assert.deepEqual(publisher.changes[publisher.changes.length - 1], { blockId: ID, type: "delete" });
});

test("非法内部 URI 在 SQL、属性写入和缓存变化前失败", async () => {
    const { api, cache, service } = setup();
    await assert.rejects(service.convertToTask(`siyuan://blocks/${ID}`), (error: unknown) => {
        return error instanceof Error && (error as Error & { code?: number }).code === -32001;
    });
    assert.equal(api.requests.length, 0);
    assert.equal(cache.size(), 0);
});

test("内部 parent、after 与查询关系字段同样只接受 raw ID", async () => {
    const { api, service } = setup();
    const uri = `siyuan://blocks/${ID}`;
    await assert.rejects(service.convertToTask(ID, "Write tests", "1", { parentIdHint: uri }));
    await assert.rejects(service.reorderTask(ID, uri));
    assert.throws(() => service.getTasksByParent(uri));
    assert.equal(api.requests.length, 0);
});

test("权威回读失败时不产生虚假的缓存成功状态", async () => {
    const { api, cache, service } = setup();
    api.failAtRequest.set("/api/attr/getBlockAttrs", 2);
    await assert.rejects(service.convertToTask(ID, "Write tests"));
    assert.equal(api.blocks.get(ID)?.attrs[ATTR_TASK], "1");
    assert.equal(cache.get(ID), undefined);
});

test("属性写入失败时保留既有权威缓存", async () => {
    const { api, cache, service } = setup();
    await service.convertToTask(ID, "Write tests");
    const before = cache.get(ID);
    api.failPaths.add("/api/attr/setBlockAttrs");
    await assert.rejects(service.updateTask(ID, { [ATTR_PRIORITY]: "critical" }));
    assert.equal(cache.get(ID), before);
    assert.equal(cache.get(ID)?.priority, "medium");
});

test("重复规则写入规则与状态，并以回读结果更新缓存和广播", async () => {
    const { api, cache, publisher, service } = setup();
    await service.convertToTask(ID, "Write tests");
    await service.updateTask(ID, { [ATTR_DUE]: "2026-08-20" });
    const result = await service.setRepeatRule(ID, { version: 2, frequency: "day", interval: 1 });
    assert.ok(api.blocks.get(ID)?.attrs[ATTR_REPEAT]);
    assert.ok(api.blocks.get(ID)?.attrs[ATTR_REPEAT_STATE]);
    assert.equal(cache.get(ID)?.repeat, result.repeat);
    assert.deepEqual(publisher.changes[publisher.changes.length - 1], { blockId: ID, type: "update" });
});

test("下一步行动排除已完成和阻塞任务，并按统一优先级排序", () => {
    const { cache, service } = setup();
    const highId = "20260816123457-abcdefg";
    const lowId = "20260816123458-abcdefg";
    const doneId = "20260816123459-abcdefg";
    const blockedId = "20260816123500-abcdefg";
    const blockerId = "20260816123501-abcdefg";
    cache.set(taskFactory(lowId, { priority: "low", order: 10 }));
    cache.set(taskFactory(highId, { priority: "critical", order: 100 }));
    cache.set(taskFactory(doneId, { status: "done", order: 1000 }));
    cache.set(taskFactory(blockerId, { status: "waiting", order: 1000 }));
    cache.set(taskFactory(blockedId, { depends: blockerId, order: 1000 }));

    assert.deepEqual(
        service.getNextActions().map((task) => task.blockId),
        [highId, lowId],
    );
    assert.equal(service.getTask(highId)?.priority, "critical");
});

test("当期完成统计不计入缺少完成时间的任务", () => {
    // Regression: done tasks without completion history must not count toward the current period.
    const { cache, service } = setup();
    const now = new Date();
    const completed = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T12:00:00`;
    cache.set(taskFactory("20260816123457-statnow", { status: "done", completed }));
    cache.set(taskFactory("20260816123458-statold", { status: "done", completed: "" }));

    assert.equal(service.getStatistics("month").summary.completedInPeriod, 1);
});

test("新建子任务显式写入父级和排序属性", async () => {
    const { api, cache, service } = setup();
    const parentId = "20260816123457-parentx";
    const childId = "20260816123458-childxx";
    api.addBlock(parentId, "d", "Parent").attrs[ATTR_TASK] = "2";
    api.addBlock(childId, "p", "Child");
    cache.set(taskFactory(parentId, { taskType: "2" }));

    await service.convertToTask(childId, "Child", "1", { parentIdHint: parentId });

    assert.equal(api.blocks.get(childId)?.attrs[ATTR_PARENT], parentId);
    assert.equal(api.blocks.get(childId)?.attrs[ATTR_SORT], "0");
});

test("广播失败由 SyncEngine 隔离，已确认的权威缓存保持成功状态", async () => {
    const api = new FakeSiyuanApi();
    api.addBlock(ID, "p", "Write tests");
    api.failBroadcast = true;
    const cache = new CacheManager(api);
    const publisher = new SyncEngine(api, cache);
    const repository = new TaskRepository(api, cache, new Mutex(), publisher, DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);

    const result = await service.convertToTask(ID, "Write tests");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(cache.get(ID)?.blockId, result.blockId);
    assert.equal(
        api.logs.some((log) => log.level === "error" && log.message.includes("tasksChangedV2")),
        true,
    );
    publisher.stop();
});

test("Repository 严格按写入、权威回读顺序确认状态", async () => {
    const api = new FakeSiyuanApi();
    api.addBlock(ID);
    const repository = new TaskRepository(
        api,
        new CacheManager(api),
        new Mutex(),
        new FakeTaskChangePublisher(),
        DEFAULT_SETTINGS,
    );
    const attrs = await repository.writeAttrs(ID, { [ATTR_PRIORITY]: "high" });
    assert.equal(attrs[ATTR_PRIORITY], "high");
    assert.deepEqual(
        api.requests.slice(-2).map((request) => request.path),
        ["/api/attr/setBlockAttrs", "/api/attr/getBlockAttrs"],
    );
});

test("Repository 批量写失败时只返回逐块确认成功项", async () => {
    const api = new FakeSiyuanApi();
    api.addBlock(ID);
    const missingId = "20260816123457-abcdefg";
    const repository = new TaskRepository(
        api,
        new CacheManager(api),
        new Mutex(),
        new FakeTaskChangePublisher(),
        DEFAULT_SETTINGS,
    );
    const result = await repository.batchWriteAttrs([
        { id: ID, attrs: { [ATTR_PRIORITY]: "high" } },
        { id: missingId, attrs: { [ATTR_PRIORITY]: "low" } },
    ]);
    assert.equal(result.attrsByBlockId[ID][ATTR_PRIORITY], "high");
    assert.deepEqual(result.failedBlockIds, [missingId]);
});

test("Repository 并发锁超时返回编码错误且不会窃取锁", async () => {
    const api = new FakeSiyuanApi();
    const mutex = new Mutex();
    const held = await mutex.acquire().promise;
    const repository = new TaskRepository(
        api,
        new CacheManager(api),
        mutex,
        new FakeTaskChangePublisher(),
        DEFAULT_SETTINGS,
        5,
    );
    await assert.rejects(repository.acquireWithTimeout(), (error: unknown) => {
        return error instanceof Error && (error as Error & { code?: number }).code === RPC_ERROR_TIMEOUT;
    });
    held.release();
    const next = await repository.acquireWithTimeout();
    next.release();
});

test("Repository 广播失败只记录日志，不回滚已确认缓存", () => {
    const api = new FakeSiyuanApi();
    const cache = new CacheManager(api);
    const repository = new TaskRepository(
        api,
        cache,
        new Mutex(),
        {
            addPendingChange: () => {},
            broadcastChanges: () => {
                throw new Error("broadcast unavailable");
            },
        },
        DEFAULT_SETTINGS,
    );
    const entry = taskFactory(ID);
    repository.cache(entry);
    repository.recordChange(ID, "update");
    repository.publishChanges();
    assert.equal(cache.get(ID), entry);
    assert.equal(
        api.logs.some((log) => log.level === "error" && log.message.includes("broadcast unavailable")),
        true,
    );
});
