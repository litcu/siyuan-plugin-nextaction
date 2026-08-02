import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const managerSource = readFileSync(new URL("../src/kernel/mcp-tool-manager.ts", import.meta.url), "utf8");
const taskServiceSource = readFileSync(new URL("../src/kernel/task-service.ts", import.meta.url), "utf8");
const rpcSource = readFileSync(new URL("../src/kernel/rpc-server.ts", import.meta.url), "utf8");
const kernelSource = readFileSync(new URL("../src/kernel.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/frontend/components/SettingsPanel.svelte", import.meta.url), "utf8");

test("MCP 工具通过思源注册并保留插件来源和完整名称", () => {
    assert.match(managerSource, /mcpApi\.registerTool/);
    assert.match(managerSource, /source:\s*"plugin"/);
    assert.match(managerSource, /plugin__\$\{plugin\}__\$\{tool\}/);
    assert.match(managerSource, /\[NextAction Plugin\]/);
});

test("设置由内核存储并触发 MCP 动态重配置", () => {
    assert.match(kernelSource, /storage\.get\("settings\.json"\)/);
    assert.match(kernelSource, /storage\.put\("settings\.json"/);
    assert.match(kernelSource, /mcpToolManager\.reconcile/);
    assert.match(rpcSource, /getMcpStatus/);
    assert.match(rpcSource, /listMcpTargetNotebooks/);
    assert.match(rpcSource, /resolveMcpDocumentTarget/);
});

test("设置页展示 MCP 来源、真实工具名和写权限警告", () => {
    assert.match(settingsSource, /source: plugin/);
    assert.match(settingsSource, /tool\.fullName/);
    assert.match(settingsSource, /mcpAllowWrite/);
    assert.match(settingsSource, /settingMcpWriteWarning/);
});

test("MCP 创建任务使用思源插入事务元数据，不等待 SQL 索引", () => {
    assert.match(managerSource, /extractInsertedBlockMeta/);
    assert.match(managerSource, /knownTextBlock:\s*true/);
    assert.match(managerSource, /parentIdHint:\s*insertedMeta\.parentId/);
    assert.match(managerSource, /nodeType !== "NodeParagraph"/);
    assert.match(managerSource, /extractInsertedBlockMeta\([\s\S]*parentID/);
    assert.match(taskServiceSource, /cleanTitle \|\| await this\.fetchBlockTitle/);
});
