import test from "node:test";
import assert from "node:assert/strict";
import { CacheManager } from "../src/kernel/cache-manager.ts";
import { Mutex } from "../src/kernel/mutex.ts";
import { registerRpcMethods } from "../src/kernel/rpc-server.ts";
import { TaskService } from "../src/kernel/task-service.ts";
import { setSiyuan } from "../src/kernel/utils.ts";
import { FakeMyDayTaskPort, FakeSiyuanApi, FakeTaskChangePublisher } from "./helpers/fakes.ts";
import { KernelBridge } from "../src/frontend/kernel-bridge.ts";

const ID = "20260816123456-abcdefg";

test("内部 RPC 拒绝块链接且 echo 保持数组参数语义", async () => {
    const handlers = new Map<string, (...params: unknown[]) => unknown>();
    setSiyuan({
        rpc: {
            bind(name: string, handler: (...params: unknown[]) => unknown) {
                handlers.set(name, handler);
            },
        },
    });

    const api = new FakeSiyuanApi();
    api.addBlock(ID);
    const service = new TaskService(
        new CacheManager(api),
        new Mutex(),
        new FakeTaskChangePublisher(),
        new FakeMyDayTaskPort(),
        api,
    );
    service.setIsReady(true);
    registerRpcMethods(service);

    const result = await handlers.get("getTask")?.({ blockId: `siyuan://blocks/${ID}` }) as {
        _rpcError?: { code: number; message: string };
    };
    assert.equal(result._rpcError?.code, -32001);
    assert.equal(api.requests.length, 0);

    const echoed = await handlers.get("echo")?.({ params: [ID, 42] });
    assert.deepEqual(echoed, [ID, 42]);
});

test("KernelBridge 在发起 RPC 前拒绝块链接", async () => {
    const calls: string[] = [];
    const bridge = new KernelBridge({
        kernel: {
            rpc: {
                call: new Proxy({}, {
                    get: (_target, method: string) => async () => {
                        calls.push(method);
                        return null;
                    },
                }),
            },
        },
    });

    await assert.rejects(bridge.getTask(`siyuan://blocks/${ID}`), (error: unknown) => {
        return error instanceof Error && (error as Error & { code?: number }).code === -32001;
    });
    assert.deepEqual(calls, []);
});
