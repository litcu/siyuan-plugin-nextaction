import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const managerSource = readFileSync(new URL("../src/kernel/mcp-tool-manager.ts", import.meta.url), "utf8");
const taskServiceSource = readFileSync(new URL("../src/kernel/task-service.ts", import.meta.url), "utf8");
const rpcSource = readFileSync(new URL("../src/kernel/rpc-server.ts", import.meta.url), "utf8");
const kernelSource = readFileSync(new URL("../src/kernel.ts", import.meta.url), "utf8");
const mcpSettingsPageSource = readFileSync(
    new URL("../src/frontend/components/settings/McpSettingsPage.svelte", import.meta.url),
    "utf8",
);
const aiSettingsPageSource = readFileSync(
    new URL("../src/frontend/components/settings/AiSettingsPage.svelte", import.meta.url),
    "utf8",
);

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
    assert.match(mcpSettingsPageSource, />plugin<\/code>/);
    assert.match(mcpSettingsPageSource, /tool\.fullName/);
    assert.match(mcpSettingsPageSource, /mcpAllowWrite/);
    assert.match(mcpSettingsPageSource, /settingMcpWriteWarning/);
    assert.match(mcpSettingsPageSource, /settingMcpBatchOperations/);
});

test("MCP 提供统一的批量 CRUD，并移除重复的单项和状态工具", () => {
    assert.match(managerSource, /create_tasks/);
    assert.match(managerSource, /get_tasks/);
    assert.match(managerSource, /update_tasks/);
    assert.match(managerSource, /delete_tasks/);
    assert.doesNotMatch(managerSource, /batch_set_task_status/);
    assert.doesNotMatch(managerSource, /set_task_status:/);
    assert.match(managerSource, /MAX_MCP_BATCH_SIZE = 100/);
    assert.match(managerSource, /private async runBatch/);
    assert.match(managerSource, /success: true, result: await operation/);
    assert.match(managerSource, /success: false,[\s\S]*error:/);
    assert.match(managerSource, /succeeded,[\s\S]*failed:[\s\S]*results/);
    assert.match(managerSource, /taskService\.removeTask/);
    assert.match(managerSource, /blockPreserved: true/);
});

test("通用任务更新支持状态、重复规则、类型和标题", () => {
    assert.match(managerSource, /validateMcpTaskPatch/);
    assert.match(managerSource, /taskService\.setRepeatRule/);
    assert.match(managerSource, /taskService\.updateTaskTitle/);
    assert.match(taskServiceSource, /\/api\/filetree\/renameDocByID/);
    assert.match(taskServiceSource, /\/api\/block\/updateBlock/);
});

test("MCP 创建任务使用思源插入事务元数据，不等待 SQL 索引", () => {
    assert.match(managerSource, /extractInsertedBlockMeta/);
    assert.match(managerSource, /knownTextBlock:\s*kind !== "2"/);
    assert.match(managerSource, /parentIdHint:\s*insertedMeta\.parentId/);
    assert.match(managerSource, /expectedNodeType = kind === "2" \? "NodeDocument" : "NodeParagraph"/);
    assert.match(managerSource, /extractInsertedBlockMeta\([\s\S]*parentID/);
    assert.match(taskServiceSource, /cleanTitle \|\| await this\.fetchBlockTitle/);
});

test("列表容器创建任务通过兄弟插入保持 NodeListItem 结构", () => {
    assert.match(managerSource, /containerType === "l"/);
    assert.match(managerSource, /buildListItemBlockDom/);
    assert.match(managerSource, /\/api\/block\/getChildBlocks/);
    assert.match(managerSource, /\/api\/block\/insertBlock/);
    assert.match(managerSource, /previousID: lastChild\.id/);
});

test("列表项父块会复用已有的子列表", () => {
    assert.match(managerSource, /current\.type === "i"/);
    assert.match(managerSource, /\/api\/block\/getChildBlocks/);
    assert.match(managerSource, /nestedList\?\.id/);
    assert.match(managerSource, /containerId: nestedList\.id, containerType: "l"/);
});

test("设置页提供四个内置 AI 功能的提示词编辑器", () => {
    assert.match(aiSettingsPageSource, /extractTasks/);
    assert.match(aiSettingsPageSource, /decomposeTask/);
    assert.match(aiSettingsPageSource, /planMyDay/);
    assert.match(aiSettingsPageSource, /review/);
    assert.match(aiSettingsPageSource, /aiPrompts\[feature\.id\]/);
    assert.match(aiSettingsPageSource, /maxlength="12000"/);
    assert.match(aiSettingsPageSource, /resetPrompt/);
});
