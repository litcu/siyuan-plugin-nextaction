import test from "node:test";
import assert from "node:assert/strict";
import type * as kernel from "siyuan/kernel";
import { CacheManager } from "../src/kernel/cache-manager.ts";
import { McpToolExecutor } from "../src/kernel/mcp-tool-executor.ts";
import { Mutex } from "../src/kernel/mutex.ts";
import { TaskRepository } from "../src/kernel/task-repository.ts";
import { TaskService } from "../src/kernel/task-service.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import { FakeMyDayTaskPort, FakeSiyuanApi, FakeTaskChangePublisher, taskFactory } from "./helpers/fakes.ts";

test("MCP 项目列表复用领域摘要的叶子进度", async () => {
    // Regression: MCP used to count a parent Action and its leaf Action as two open descendants.
    const api = new FakeSiyuanApi();
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    cache.set(taskFactory("project", { taskType: "2", childIds: ["parent"] }));
    cache.set(taskFactory("parent", { parentId: "project", childIds: ["leaf"] }));
    cache.set(taskFactory("leaf", { parentId: "parent" }));

    const settings = {
        ...DEFAULT_SETTINGS,
        mcpSettings: { ...DEFAULT_SETTINGS.mcpSettings, enabled: true },
    };
    const siyuan = {
        plugin: { name: "siyuan-plugin-nextaction", version: "test" },
        logger: { info: async () => undefined, warn: async () => undefined },
    } as unknown as kernel.ISiyuan;
    const executor = new McpToolExecutor(siyuan, service, settings, api);

    const result = (await executor.createHandler("list_projects")({})) as {
        items: Array<{ openDescendantCount: number; nextActionCount: number }>;
    };

    assert.equal(result.items[0].openDescendantCount, 1);
    assert.equal(result.items[0].nextActionCount, 1);
});
