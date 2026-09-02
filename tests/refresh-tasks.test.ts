import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { KernelBridge } from "../src/frontend/kernel-bridge.ts";
import { refreshTasks } from "../src/frontend/utils/refresh-tasks.ts";

test("刷新任务先重建缓存再加载快照", async () => {
    const calls: string[] = [];
    const bridge = {
        rebuildCache: async () => calls.push("rebuild"),
        recalcAllOrders: async () => calls.push("recalc"),
    } as unknown as KernelBridge;

    // Regression: 直接删除项目文档后，手动刷新曾只读取旧内核缓存，项目持续显示。
    await refreshTasks(bridge, async () => {
        calls.push("load");
    });

    assert.deepEqual(calls, ["rebuild", "recalc", "load"]);
});

test("侧边栏和命令刷新入口共享完整刷新流程", () => {
    const app = readFileSync("src/frontend/components/NextActionApp.svelte", "utf8");
    const controller = readFileSync("src/frontend/controllers/task-command-controller.ts", "utf8");
    assert.match(app, /await refreshTasks\(bridge, \(\) => taskStore\.loadTasks\(\)\)/);
    assert.match(controller, /await refreshTasks\(this\.getBridge\(\), \(\) => taskStore\.loadTasks\(\)\)/);
});
