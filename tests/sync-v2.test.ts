import test from "node:test";
import assert from "node:assert/strict";
import { CacheManager } from "../src/kernel/cache-manager.ts";
import { SyncEngine } from "../src/kernel/sync-engine.ts";
import type { TaskChangeSetV2 } from "../src/shared/types.ts";
import { FakeSiyuanApi, taskFactory } from "./helpers/fakes.ts";

const TASK_A = "20260816110000-taskaaa";
const TASK_B = "20260816110001-taskbbb";

function waitForBroadcast(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 130));
}

function v2Broadcasts(api: FakeSiyuanApi): TaskChangeSetV2[] {
    return api.broadcasts
        .filter(item => item.name === "tasksChangedV2")
        .map(item => item.payload as TaskChangeSetV2);
}

test("V2 snapshot 返回当前 stream、revision 和隔离的完整任务", () => {
    const api = new FakeSiyuanApi();
    const cache = new CacheManager(api);
    cache.set(taskFactory(TASK_A, { childIds: [TASK_B], customFields: { owner: "alice" } }));
    const engine = new SyncEngine(api, cache);

    const snapshot = engine.getTaskSnapshotV2();
    assert.equal(snapshot.schema, 2);
    assert.equal(snapshot.revision, 0);
    assert.ok(snapshot.streamId.length > 0);
    assert.equal(snapshot.tasks[0].blockId, TASK_A);

    snapshot.tasks[0].title = "client mutation";
    snapshot.tasks[0].customFields.owner = "bob";
    assert.notEqual(cache.get(TASK_A)?.title, "client mutation");
    assert.equal(cache.get(TASK_A)?.customFields.owner, "alice");
    engine.stop();
});

test("100ms 窗口合并连续提交并保留 revision 区间", async () => {
    const api = new FakeSiyuanApi();
    const cache = new CacheManager(api);
    const engine = new SyncEngine(api, cache);

    cache.set(taskFactory(TASK_A));
    engine.addPendingChange(TASK_A, "create");
    engine.broadcastChanges();
    cache.set(taskFactory(TASK_A, { priority: "critical" }));
    engine.addPendingChange(TASK_A, "update");
    engine.broadcastChanges();
    await waitForBroadcast();

    const [delta] = v2Broadcasts(api);
    assert.equal(delta.type, "delta");
    if (delta.type !== "delta") return;
    assert.equal(delta.fromRevision, 0);
    assert.equal(delta.revision, 2);
    assert.equal(delta.upserts.length, 1);
    assert.equal(delta.upserts[0].priority, "critical");
    assert.deepEqual(delta.deletedBlockIds, []);
    assert.equal(api.broadcasts.filter(item => item.name === "tasksChanged").length, 1);
    engine.stop();
});

test("合并结果以最终缓存为准处理删除重建与创建删除", async () => {
    const api = new FakeSiyuanApi();
    const cache = new CacheManager(api);
    const engine = new SyncEngine(api, cache);
    cache.set(taskFactory(TASK_A));

    cache.remove(TASK_A);
    engine.addPendingChange(TASK_A, "delete");
    engine.broadcastChanges();
    cache.set(taskFactory(TASK_A, { title: "Recreated" }));
    engine.addPendingChange(TASK_A, "create");
    engine.broadcastChanges();

    cache.set(taskFactory(TASK_B));
    engine.addPendingChange(TASK_B, "create");
    engine.broadcastChanges();
    cache.remove(TASK_B);
    engine.addPendingChange(TASK_B, "delete");
    engine.broadcastChanges();
    await waitForBroadcast();

    const [delta] = v2Broadcasts(api);
    assert.equal(delta.type, "delta");
    if (delta.type !== "delta") return;
    assert.equal(delta.fromRevision, 0);
    assert.equal(delta.revision, 4);
    assert.deepEqual(delta.upserts.map(task => task.blockId), [TASK_A]);
    assert.equal(delta.upserts[0].title, "Recreated");
    assert.deepEqual(delta.deletedBlockIds, [TASK_B]);
    engine.stop();
});

test("完整重建取消待发增量并发送小型 reset", async () => {
    const api = new FakeSiyuanApi();
    const cache = new CacheManager(api);
    const engine = new SyncEngine(api, cache);
    cache.set(taskFactory(TASK_A));
    engine.addPendingChange(TASK_A, "create");
    engine.broadcastChanges();

    engine.broadcastReset();
    await waitForBroadcast();

    const [reset] = v2Broadcasts(api);
    assert.deepEqual(reset, {
        schema: 2,
        type: "reset",
        streamId: engine.getTaskSnapshotV2().streamId,
        revision: 2,
    });
    assert.equal(api.broadcasts.some(item => item.name === "tasksChanged"), false);
    engine.stop();
});

test("每次内核同步引擎启动都会生成新的 stream", () => {
    const api = new FakeSiyuanApi();
    const first = new SyncEngine(api, new CacheManager(api));
    const second = new SyncEngine(api, new CacheManager(api));

    assert.notEqual(first.getTaskSnapshotV2().streamId, second.getTaskSnapshotV2().streamId);
    first.stop();
    second.stop();
});
