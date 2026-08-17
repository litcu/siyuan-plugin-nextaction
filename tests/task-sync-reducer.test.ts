import test from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import type { KernelBridge } from "../src/frontend/kernel-bridge.ts";
import { createTaskStore } from "../src/frontend/stores/task-store.ts";
import {
    buildTaskCollection,
    isTaskChangeSetV2,
    isTaskSnapshotV2,
    reduceTaskChanges,
} from "../src/frontend/stores/task-sync-reducer.ts";
import type { TaskSnapshotV2 } from "../src/shared/types.ts";
import { taskFactory } from "./helpers/fakes.ts";

const PROJECT = "20260816120000-project";
const TASK_A = "20260816120001-taskaaa";
const TASK_B = "20260816120002-taskbbb";

function snapshot(streamId: string, revision: number, tasks = [taskFactory(TASK_A)]): TaskSnapshotV2 {
    return { schema: 2, streamId, revision, tasks };
}

function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

test("纯 reducer 每批统一更新任务及全部聚合值", () => {
    const current = buildTaskCollection([
        taskFactory(PROJECT, { taskType: "2", childIds: [TASK_A, TASK_B] }),
        taskFactory(TASK_A),
        taskFactory(TASK_B, { status: "done" }),
    ]);
    const reduction = reduceTaskChanges(current, {
        upserts: [taskFactory(TASK_A, { status: "done", context: "work|home", tags: "phase-four" })],
        deletedBlockIds: [TASK_B],
    });

    assert.deepEqual(reduction.collection.allTasks.find((task) => task.blockId === PROJECT)?.childIds, [TASK_A]);
    assert.deepEqual(reduction.collection.contexts, ["work", "home"]);
    assert.deepEqual(reduction.collection.tags, ["phase-four"]);
    assert.equal(reduction.collection.doneCount, 1);
    assert.deepEqual(
        reduction.collection.projectReminders.map((task) => task.blockId),
        [PROJECT],
    );
    assert.equal(reduction.completedChanged, true);
});

test("V2 snapshot 与 delta 校验拒绝缺字段、重复和交叉 ID", () => {
    assert.equal(isTaskSnapshotV2(snapshot("stream-a", 0)), true);
    assert.equal(isTaskSnapshotV2({ ...snapshot("stream-a", 0), tasks: [{ blockId: TASK_A }] }), false);
    assert.equal(
        isTaskChangeSetV2({
            schema: 2,
            type: "delta",
            streamId: "stream-a",
            fromRevision: 0,
            revision: 1,
            upserts: [taskFactory(TASK_A)],
            deletedBlockIds: [TASK_A],
        }),
        false,
    );
});

test("snapshot 握手期间缓存并按 revision 重放 V2 通知", async () => {
    let resolveSnapshot!: (value: TaskSnapshotV2) => void;
    const pendingSnapshot = new Promise<TaskSnapshotV2>((resolve) => {
        resolveSnapshot = resolve;
    });
    let getAllCalls = 0;
    const bridge = {
        getTaskSnapshotV2: () => pendingSnapshot,
        getAllTasks: async () => {
            getAllCalls++;
            return [];
        },
    } as unknown as KernelBridge;
    const store = createTaskStore();
    store.setBridge(bridge);

    const loading = store.loadTasks();
    store.applyChangeSetV2({
        schema: 2,
        type: "delta",
        streamId: "stream-a",
        fromRevision: 0,
        revision: 1,
        upserts: [taskFactory(TASK_A, { priority: "critical" })],
        deletedBlockIds: [],
    });
    resolveSnapshot(snapshot("stream-a", 0));
    await loading;

    assert.equal(get(store).allTasks[0].priority, "critical");
    assert.equal(getAllCalls, 0);
    store.disposeSync();
});

test("revision 缺口触发 snapshot 恢复且过期通知被忽略", async () => {
    const snapshots = [
        snapshot("stream-a", 0, [taskFactory(TASK_A)]),
        snapshot("stream-a", 4, [taskFactory(TASK_B, { title: "Recovered" })]),
    ];
    let snapshotCalls = 0;
    const bridge = {
        getTaskSnapshotV2: async () => snapshots[Math.min(snapshotCalls++, snapshots.length - 1)],
        getAllTasks: async () => {
            throw new Error("V2 must not call getAllTasks");
        },
    } as unknown as KernelBridge;
    const store = createTaskStore();
    store.setBridge(bridge);
    await store.loadTasks();

    store.applyChangeSetV2({
        schema: 2,
        type: "delta",
        streamId: "stream-a",
        fromRevision: 2,
        revision: 3,
        upserts: [taskFactory(TASK_A, { title: "Gap" })],
        deletedBlockIds: [],
    });
    await tick();
    await tick();
    assert.deepEqual(
        get(store).allTasks.map((task) => task.blockId),
        [TASK_B],
    );
    assert.equal(snapshotCalls, 2);

    store.applyChangeSetV2({
        schema: 2,
        type: "delta",
        streamId: "stream-a",
        fromRevision: 3,
        revision: 4,
        upserts: [taskFactory(TASK_A)],
        deletedBlockIds: [],
    });
    await tick();
    assert.equal(snapshotCalls, 2);
    store.disposeSync();
});

test("reset、stream 变化和非法载荷都通过 V2 snapshot 恢复", async () => {
    const snapshots = [
        snapshot("stream-a", 0, [taskFactory(TASK_A)]),
        snapshot("stream-b", 2, [taskFactory(TASK_B, { title: "After reset" })]),
        snapshot("stream-c", 5, [taskFactory(TASK_A, { title: "After corruption" })]),
    ];
    let snapshotCalls = 0;
    const bridge = {
        getTaskSnapshotV2: async () => snapshots[Math.min(snapshotCalls++, snapshots.length - 1)],
        getAllTasks: async () => {
            throw new Error("V2 recovery must not call getAllTasks");
        },
    } as unknown as KernelBridge;
    const store = createTaskStore();
    store.setBridge(bridge);
    await store.loadTasks();

    store.applyChangeSetV2({ schema: 2, type: "reset", streamId: "stream-a", revision: 1 });
    await tick();
    await tick();
    assert.equal(get(store).allTasks[0].title, "After reset");

    store.applyChangeSetV2({
        schema: 2,
        type: "delta",
        streamId: "stream-b",
        fromRevision: 2,
        revision: 3,
        upserts: [{ blockId: TASK_A }],
        deletedBlockIds: [],
    });
    await tick();
    await tick();
    assert.equal(get(store).allTasks[0].title, "After corruption");
    assert.equal(snapshotCalls, 3);
    store.disposeSync();
});

test("旧内核自动退回 V1，并将一批逐 ID 回读交给同一 reducer", async () => {
    let getAllCalls = 0;
    const bridge = {
        getTaskSnapshotV2: async () => {
            throw new Error("unknown RPC method");
        },
        getAllTasks: async () => {
            getAllCalls++;
            return [taskFactory(TASK_A)];
        },
        getTask: async (blockId: string) => taskFactory(blockId, { status: "done", context: "legacy" }),
    } as unknown as KernelBridge;
    const store = createTaskStore();
    store.setBridge(bridge);
    await store.loadTasks();
    store.applyChangeNotification({ changedBlockIds: [TASK_A], changeTypes: { [TASK_A]: "update" } });
    await tick();
    await tick();

    assert.equal(get(store).allTasks[0].status, "done");
    assert.deepEqual(get(store).contexts, ["legacy"]);
    assert.equal(getAllCalls, 1);
    store.disposeSync();
});
