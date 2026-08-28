import test from "node:test";
import assert from "node:assert/strict";
import { CacheManager } from "../src/kernel/cache-manager.ts";
import { Mutex } from "../src/kernel/mutex.ts";
import { registerRpcMethods } from "../src/kernel/rpc-server.ts";
import { TaskService } from "../src/kernel/task-service.ts";
import { TaskRepository } from "../src/kernel/task-repository.ts";
import { errorToRpcError, setSiyuan } from "../src/kernel/utils.ts";
import { FakeMyDayTaskPort, FakeSiyuanApi, FakeTaskChangePublisher } from "./helpers/fakes.ts";
import { KernelBridge, RpcCallError, RpcTransportError } from "../src/frontend/kernel-bridge.ts";
import type * as kernel from "siyuan/kernel";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import { RPC_CONTRACT, RPC_METHOD_NAMES } from "../src/shared/rpc-methods.ts";
import {
    RPC_ERROR_ACTION_MOVE_NOT_MOVED,
    RPC_ERROR_ACTION_MOVE_RECOVERED,
    RPC_ERROR_ACTION_MOVE_RECOVERY_FAILED,
    RPC_ERROR_ACTION_MOVE_TARGET_CHANGED,
    RPC_ERROR_ACTION_MOVE_UNDO_INVALID,
    RPC_ERROR_ACTION_MOVE_UNDO_UNSAFE,
    RPC_ERROR_INTERNAL,
    RPC_ERROR_NOT_READY,
} from "../src/shared/constants.ts";

const ID = "20260816123456-abcdefg";
const PROJECT_ID = "20260816123457-project";

test("内部 RPC 拒绝块链接且 echo 保持数组参数语义", async () => {
    const handlers = new Map<string, (...params: unknown[]) => unknown>();
    setSiyuan({
        rpc: {
            async bind(name: string, handler: (...params: unknown[]) => unknown) {
                handlers.set(name, handler);
            },
        },
        logger: {
            error: async () => {},
        },
    } as unknown as kernel.ISiyuan);

    const api = new FakeSiyuanApi();
    api.addBlock(ID);
    const cache = new CacheManager(api);
    const publisher = new FakeTaskChangePublisher();
    const repository = new TaskRepository(api, cache, new Mutex(), publisher, DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    registerRpcMethods(service);
    assert.deepEqual([...handlers.keys()].sort(), [...RPC_METHOD_NAMES].sort());
    assert.equal(
        RPC_METHOD_NAMES.every((method) => typeof RPC_CONTRACT[method].parseParams === "function"),
        true,
    );

    const result = (await handlers.get("getTask")?.({ blockId: `siyuan://blocks/${ID}` })) as {
        _rpcError?: { code: number; message: string };
    };
    assert.equal(result._rpcError?.code, -32001);
    assert.equal(api.requests.length, 0);

    const echoed = await handlers.get("echo")?.({ params: [ID, 42] });
    assert.deepEqual(echoed, [ID, 42]);

    service.getNextActions = () => {
        throw new Error("sensitive task contents");
    };
    const internal = (await handlers.get("getNextActions")?.({})) as { _rpcError?: { code: number; message: string } };
    assert.deepEqual(internal._rpcError, { code: RPC_ERROR_INTERNAL, message: "Internal error" });
});

test("KernelBridge 在发起 RPC 前拒绝块链接", async () => {
    const calls: string[] = [];
    const bridge = new KernelBridge({
        kernel: {
            state: { code: 2 },
            rpc: {
                call: new Proxy(
                    {},
                    {
                        get: (_target, method: string) => async () => {
                            calls.push(method);
                            return null;
                        },
                    },
                ),
                bind: () => {},
                unbind: () => {},
            },
        },
    });

    await assert.rejects(bridge.getTask(`siyuan://blocks/${ID}`), (error: unknown) => {
        return error instanceof Error && (error as Error & { code?: number }).code === -32001;
    });
    assert.deepEqual(calls, []);
});

test("Stage 重命名通过共享 RPC 契约进入内核标题写入", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const bridge = new KernelBridge({
        kernel: {
            state: { code: 2 },
            rpc: {
                call: new Proxy(
                    {},
                    {
                        get: (_target, method: string) => async (params: unknown) => {
                            calls.push({ method, params });
                            return { blockId: ID, title: "Renamed Stage" };
                        },
                    },
                ),
                bind: () => {},
                unbind: () => {},
            },
        },
    });

    const updated = await bridge.updateTaskTitle(ID, "Renamed Stage");

    assert.equal(updated.title, "Renamed Stage");
    assert.deepEqual(calls, [
        {
            method: "updateTaskTitle",
            params: { blockId: ID, title: "Renamed Stage" },
        },
    ]);
    assert.deepEqual(RPC_CONTRACT.updateTaskTitle.parseParams({ blockId: ID, title: "Renamed Stage" }), {
        blockId: ID,
        title: "Renamed Stage",
    });
});

test("Action 物理移动通过共享 RPC 契约分别预览和执行", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const bridge = new KernelBridge({
        kernel: {
            state: { code: 2 },
            rpc: {
                call: new Proxy(
                    {},
                    {
                        get: (_target, method: string) => async (params: unknown) => {
                            calls.push({ method, params });
                            if (method === "previewActionMove") {
                                return {
                                    actionId: ID,
                                    actionTitle: "Move safely",
                                    source: { documentId: "20260816123458-sourced", title: "Source" },
                                    target: { projectId: PROJECT_ID, title: "Project" },
                                    currentEffectiveParentId: "",
                                    nextEffectiveParentId: PROJECT_ID,
                                    effectiveParentWillChange: true,
                                    explicitParentPreserved: false,
                                };
                            }
                            if (method === "undoActionMove") {
                                return { task: { blockId: ID }, summary: "Restored Source" };
                            }
                            return {
                                task: { blockId: ID },
                                preview: { actionId: ID },
                                undo: { credential: "undo-token", actionId: ID, summary: "Moved" },
                            };
                        },
                    },
                ),
                bind: () => {},
                unbind: () => {},
            },
        },
    });

    const preview = await bridge.previewActionMove(ID, PROJECT_ID);
    const moved = await bridge.moveActionToProject(ID, PROJECT_ID);
    const undone = await bridge.undoActionMove(moved.undo.credential);

    assert.equal(preview.nextEffectiveParentId, PROJECT_ID);
    assert.equal(moved.task.blockId, ID);
    assert.equal(undone.summary, "Restored Source");
    assert.deepEqual(calls, [
        { method: "previewActionMove", params: { actionId: ID, projectId: PROJECT_ID } },
        { method: "moveActionToProject", params: { actionId: ID, projectId: PROJECT_ID } },
        { method: "undoActionMove", params: { credential: "undo-token" } },
    ]);
    assert.deepEqual(RPC_CONTRACT.previewActionMove.parseParams({ actionId: ID, projectId: PROJECT_ID }), {
        actionId: ID,
        projectId: PROJECT_ID,
    });
    assert.throws(() => RPC_CONTRACT.moveActionToProject.parseParams({ actionId: ID, projectId: "Project" }));
    assert.deepEqual(
        RPC_CONTRACT.undoActionMove.parseParams({
            credential: "undo-token",
            actionId: ID,
            projectId: PROJECT_ID,
        }),
        { credential: "undo-token" },
    );
});

test("KernelBridge 区分未就绪、传输失败和可重试恢复", async () => {
    let calls = 0;
    let shouldReject = true;
    const host = {
        kernel: {
            state: { code: 1 },
            rpc: {
                call: new Proxy(
                    {},
                    {
                        get: () => async () => {
                            calls++;
                            if (shouldReject) throw new Error("socket closed");
                            return null;
                        },
                    },
                ),
                bind: () => {},
                unbind: () => {},
            },
        },
    };
    const bridge = new KernelBridge(host);

    await assert.rejects(
        bridge.getTask(ID),
        (error: unknown) => error instanceof RpcCallError && error.code === RPC_ERROR_NOT_READY,
    );
    assert.equal(calls, 0);

    host.kernel.state.code = 2;
    await assert.rejects(bridge.getTask(ID), (error: unknown) => error instanceof RpcTransportError);
    assert.equal(calls, 1);

    shouldReject = false;
    assert.equal(await bridge.getTask(ID), null);
    assert.equal(calls, 2);
});

test("Action 移动失败状态通过 RPC 保留可区分错误码", () => {
    for (const code of [
        RPC_ERROR_ACTION_MOVE_NOT_MOVED,
        RPC_ERROR_ACTION_MOVE_RECOVERED,
        RPC_ERROR_ACTION_MOVE_RECOVERY_FAILED,
        RPC_ERROR_ACTION_MOVE_TARGET_CHANGED,
        RPC_ERROR_ACTION_MOVE_UNDO_INVALID,
        RPC_ERROR_ACTION_MOVE_UNDO_UNSAFE,
    ]) {
        const error = new Error(`move outcome ${code}`) as Error & { code: number };
        error.code = code;
        assert.deepEqual(errorToRpcError(error), {
            _rpcError: { code, message: `move outcome ${code}` },
        });
    }
});

test("Project 看板移动 RPC 校验枚举和当前可见快照", () => {
    assert.deepEqual(
        RPC_CONTRACT.moveProjectBoardTask.parseParams({
            taskId: ID,
            projectId: PROJECT_ID,
            groupBy: "status",
            value: "doing",
            sortBy: "order",
            visibleTaskIds: [ID],
        }),
        {
            taskId: ID,
            projectId: PROJECT_ID,
            groupBy: "status",
            value: "doing",
            sortBy: "order",
            afterId: undefined,
            afterParentId: undefined,
            visibleTaskIds: [ID],
        },
    );
    assert.throws(() =>
        RPC_CONTRACT.moveProjectBoardTask.parseParams({
            taskId: ID,
            projectId: PROJECT_ID,
            groupBy: "priority",
            value: "critical",
            sortBy: "unknown",
            visibleTaskIds: [ID],
        }),
    );
    assert.throws(
        () =>
            RPC_CONTRACT.moveProjectBoardTask.parseParams({
                taskId: ID,
                projectId: PROJECT_ID,
                groupBy: "status",
                value: "bogus",
                visibleTaskIds: [ID],
            }),
        /valid status/,
    );
    assert.throws(
        () =>
            RPC_CONTRACT.moveProjectBoardTask.parseParams({
                taskId: ID,
                projectId: PROJECT_ID,
                groupBy: "status",
                value: "doing",
            }),
        /non-empty array/,
    );
});
