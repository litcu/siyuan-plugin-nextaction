import test from "node:test";
import assert from "node:assert/strict";
import { CacheManager } from "../src/kernel/cache-manager.ts";
import { Mutex } from "../src/kernel/mutex.ts";
import { registerRpcMethods } from "../src/kernel/rpc-server.ts";
import { TaskService } from "../src/kernel/task-service.ts";
import { TaskRepository } from "../src/kernel/task-repository.ts";
import { setSiyuan } from "../src/kernel/utils.ts";
import { FakeMyDayTaskPort, FakeSiyuanApi, FakeTaskChangePublisher } from "./helpers/fakes.ts";
import { KernelBridge, RpcCallError, RpcTransportError } from "../src/frontend/kernel-bridge.ts";
import type * as kernel from "siyuan/kernel";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import { RPC_CONTRACT, RPC_METHOD_NAMES } from "../src/shared/rpc-methods.ts";
import { RPC_ERROR_INTERNAL, RPC_ERROR_NOT_READY } from "../src/shared/constants.ts";

const ID = "20260816123456-abcdefg";

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
