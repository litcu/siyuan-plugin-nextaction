import test from "node:test";
import assert from "node:assert/strict";
import type { ISiyuan } from "siyuan/kernel";

import { DEFAULT_SETTINGS, mergeSettings } from "../src/shared/settings.ts";
import { McpCapabilityManager } from "../src/kernel/mcp-capability-manager.ts";
import { McpToolCatalog } from "../src/kernel/mcp-tool-catalog.ts";
import type { McpToolExecutor, ToolDefinition } from "../src/kernel/mcp-tool-executor.ts";
import { READ_MCP_TOOL_NAMES, WRITE_MCP_TOOL_NAMES, type McpToolName } from "../src/kernel/mcp-utils.ts";

const ALL_NAMES = [...READ_MCP_TOOL_NAMES, ...WRITE_MCP_TOOL_NAMES];

function definitions(): Record<McpToolName, ToolDefinition> {
    return Object.fromEntries(
        ALL_NAMES.map((name) => [
            name,
            {
                title: name,
                description: `tool ${name}`,
                inputSchema: { properties: {} },
                handler: async () => ({ name }),
            },
        ]),
    ) as unknown as Record<McpToolName, ToolDefinition>;
}

function fakeExecutor(catalog: McpToolCatalog) {
    const settingsSeen: unknown[] = [];
    const executor = {
        updateSettings(settings: unknown) {
            settingsSeen.push(settings);
        },
        getCatalog() {
            return catalog;
        },
        createHandler(name: McpToolName) {
            return catalog.get(name).handler;
        },
    } as unknown as McpToolExecutor;
    return { executor, settingsSeen };
}

function fakeSiyuan(agent?: {
    registerCapability: (name: string, definition: unknown, handler: unknown) => Promise<{ name: string }>;
    unregisterCapability: (name: string) => Promise<void>;
}) {
    const messages: string[] = [];
    return {
        agent,
        logger: {
            info: async (message: string) => {
                messages.push(message);
            },
            warn: async (message: string) => {
                messages.push(message);
            },
            error: async (message: string) => {
                messages.push(message);
            },
        },
    } as unknown as ISiyuan;
}

function mcpSettings(enabled: boolean, allowWrite: boolean) {
    return mergeSettings(DEFAULT_SETTINGS, {
        mcpSettings: { ...DEFAULT_SETTINGS.mcpSettings, enabled, allowWrite },
    });
}

test("MCP catalog 唯一覆盖 8 个只读和 6 个写入工具", () => {
    const catalog = new McpToolCatalog(definitions());
    const entries = catalog.list();
    assert.equal(entries.length, 14);
    assert.deepEqual(
        entries.map((entry) => entry.name),
        ALL_NAMES,
    );
    assert.equal(entries.filter((entry) => !entry.write).length, 8);
    assert.equal(entries.filter((entry) => entry.write).length, 6);
    assert.deepEqual(catalog.get("search_tasks").effects, { localRead: true });
    assert.deepEqual(catalog.get("create_tasks").effects, { localRead: true, localWrite: true });
});

test("缺少 Agent API 时仅报告 unsupported，不影响执行器设置更新", async () => {
    const catalog = new McpToolCatalog(definitions());
    const { executor, settingsSeen } = fakeExecutor(catalog);
    const settings = mcpSettings(true, true);
    const manager = new McpCapabilityManager(fakeSiyuan(), executor, settings);

    await manager.reconcile(settings);

    assert.equal(manager.getStatus().supported, false);
    assert.match(manager.getStatus().lastError, /agent is unavailable/i);
    assert.equal(settingsSeen.length, 1);
});

test("reconcile 幂等切换只读、读写和关闭，并在 unload 注销", async () => {
    const registered = new Set<string>();
    const registerCalls: string[] = [];
    const unregisterCalls: string[] = [];
    const agent = {
        registerCapability: async (name: string) => {
            registerCalls.push(name);
            registered.add(name);
            return { name: `plugin:${name}` };
        },
        unregisterCapability: async (name: string) => {
            unregisterCalls.push(name);
            registered.delete(name);
        },
    };
    const catalog = new McpToolCatalog(definitions());
    const { executor } = fakeExecutor(catalog);
    const readonly = mcpSettings(true, false);
    const readwrite = mcpSettings(true, true);
    const disabled = mcpSettings(false, false);
    const manager = new McpCapabilityManager(fakeSiyuan(agent), executor, readonly);

    await manager.reconcile(readonly);
    assert.equal(registered.size, 8);
    await manager.reconcile(readonly);
    assert.equal(registerCalls.length, 8);
    await manager.reconcile(readwrite);
    assert.equal(registered.size, 14);
    await manager.reconcile(disabled);
    assert.equal(registered.size, 0);
    assert.equal(unregisterCalls.length, 14);
    await manager.reconcile(readwrite);
    await manager.unload();
    assert.equal(registered.size, 0);
    assert.equal(manager.getStatus().tools.length, 0);
});

test("部分注册失败保留成功工具并记录 lastError", async () => {
    const agent = {
        registerCapability: async (name: string) => {
            if (name === "get_tasks") throw new Error("registration denied");
            return { name: `plugin:${name}` };
        },
        unregisterCapability: async () => {},
    };
    const catalog = new McpToolCatalog(definitions());
    const { executor } = fakeExecutor(catalog);
    const settings = mcpSettings(true, false);
    const manager = new McpCapabilityManager(fakeSiyuan(agent), executor, settings);

    await manager.reconcile(settings);

    assert.equal(manager.getStatus().tools.length, 7);
    assert.match(manager.getStatus().lastError, /registration denied/);
});
