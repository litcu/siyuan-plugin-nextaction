import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const capabilitySource = readFileSync(new URL("../src/kernel/mcp-capability-manager.ts", import.meta.url), "utf8");
const executorSource = readFileSync(new URL("../src/kernel/mcp-tool-executor.ts", import.meta.url), "utf8");
const catalogSource = readFileSync(new URL("../src/kernel/mcp-tool-catalog.ts", import.meta.url), "utf8");
const creationSource = readFileSync(new URL("../src/kernel/task-creation-service.ts", import.meta.url), "utf8");
const targetSource = readFileSync(new URL("../src/kernel/task-target-resolver.ts", import.meta.url), "utf8");
const taskServiceSource = readFileSync(new URL("../src/kernel/task-lifecycle-service.ts", import.meta.url), "utf8");
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
const settingsPanelSource = readFileSync(
    new URL("../src/frontend/components/SettingsPanel.svelte", import.meta.url),
    "utf8",
);

test("MCP 工具通过思源 Agent capability 注册并保留插件来源和完整名称", () => {
    assert.match(capabilitySource, /agentApi\.registerCapability/);
    assert.match(capabilitySource, /agentApi\.unregisterCapability/);
    assert.match(capabilitySource, /effects:\s*definition\.effects/);
    assert.match(capabilitySource, /source:\s*"plugin"/);
    assert.match(capabilitySource, /fullName:\s*result\.name/);
    assert.doesNotMatch(capabilitySource, /\.mcp\?\.registerTool|\.registerTool\(|\.unregisterTool\(/);
    assert.match(executorSource, /\[NextAction Plugin\]/);
    assert.match(catalogSource, /ALL_MCP_TOOL_NAMES/);
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

test("设置保存后立即刷新 MCP 工具清单", () => {
    const handleSaveStart = settingsPanelSource.indexOf("async function handleSave()");
    const handleSaveEnd = settingsPanelSource.indexOf("function requestDraftAction", handleSaveStart);
    const handleSaveSource = settingsPanelSource.slice(handleSaveStart, handleSaveEnd);

    // Regression: 启用 MCP 并保存后，工具清单曾保留打开面板时的空状态直到重新打开设置。
    assert.match(handleSaveSource, /if \(!result\) return;[\s\S]*?mcpStatus = await bridge\.getMcpStatus\(\)/);
});

test("MCP 提供统一的批量 CRUD，并移除重复的单项和状态工具", () => {
    assert.match(executorSource, /create_tasks/);
    assert.match(executorSource, /get_tasks/);
    assert.match(executorSource, /update_tasks/);
    assert.match(executorSource, /delete_tasks/);
    assert.doesNotMatch(executorSource, /batch_set_task_status/);
    assert.doesNotMatch(executorSource, /set_task_status:/);
    assert.match(executorSource, /MAX_MCP_BATCH_SIZE = 100/);
    assert.match(executorSource, /private async runBatch/);
    assert.match(executorSource, /success: true, result: await operation/);
    assert.match(executorSource, /success: false,[\s\S]*error:/);
    assert.match(executorSource, /succeeded,[\s\S]*failed:[\s\S]*results/);
    assert.match(executorSource, /taskService\.removeTask/);
    assert.match(executorSource, /blockPreserved: true/);
});

test("通用任务更新支持状态、重复规则、类型和标题", () => {
    assert.match(executorSource, /validateMcpTaskPatch/);
    assert.match(executorSource, /taskService\.setRepeatRule/);
    assert.match(executorSource, /taskService\.updateTaskTitle/);
    assert.match(taskServiceSource, /\/api\/filetree\/renameDocByID/);
    assert.match(taskServiceSource, /\/api\/block\/updateBlock/);
    assert.match(taskServiceSource, /getBlockType\(blockId, true\)/);
});

test("MCP 创建任务使用思源插入事务元数据，不等待 SQL 索引", () => {
    assert.match(creationSource, /extractInsertedBlockMeta/);
    assert.match(creationSource, /resolveInsertedTaskBlock/);
    assert.match(creationSource, /knownTextBlock:\s*true/);
    assert.match(creationSource, /knownTextBlockType:\s*kind === "2" \|\| format === "document" \? "d" : "p"/);
    assert.match(creationSource, /parentIdHint:\s*insertedMeta\.parentId/);
    assert.match(
        creationSource,
        /expectedNodeType = kind === "2" \|\| format === "document" \? "NodeDocument" : "NodeParagraph"/,
    );
    assert.match(creationSource, /extractInsertedBlockMeta\([\s\S]*parentID/);
    assert.match(taskServiceSource, /cleanTitle \|\| \(await this\.fetchBlockTitle/);
});

test("子任务创建直接写入文本块并停止生成列表项", () => {
    assert.match(creationSource, /resolveChildContainer\(destination\.parentBlockId, false\)/);
    assert.match(targetSource, /containerTypes = new Set\(\[[^\]]*"d"/);
    assert.match(creationSource, /dataType: "markdown"/);
    assert.match(creationSource, /data: escapeMarkdownText\(title\)/);
    assert.doesNotMatch(creationSource, /buildListItemBlockDom/);
    assert.match(creationSource, /format: "paragraph"/);
    assert.match(targetSource, /Inserted list does not contain a text block/);
    assert.match(creationSource, /await this\.taskService\.addTaskToMyDay\(taskBlockId\)/);
});

test("列表项父块会复用已有的子列表", () => {
    assert.match(targetSource, /current\.type === "i"/);
    assert.match(targetSource, /\/api\/block\/getChildBlocks/);
    assert.match(targetSource, /nestedList\?\.id/);
    assert.match(targetSource, /containerId: nestedList\.id, containerType: "l"/);
});

test("设置页提供四个内置 AI 功能的提示词编辑器", () => {
    assert.match(aiSettingsPageSource, /extractTasks/);
    assert.match(aiSettingsPageSource, /decomposeTask/);
    assert.match(aiSettingsPageSource, /planMyDay/);
    assert.match(aiSettingsPageSource, /review/);
    assert.match(aiSettingsPageSource, /aiPrompts\[feature\.id\]/);
    assert.match(aiSettingsPageSource, /maxlength="12000"/);
    assert.match(aiSettingsPageSource, /onResetPrompt\(feature\.id\)/);
    assert.match(settingsPanelSource, /handleResetAiPrompt/);
    assert.match(settingsPanelSource, /requestDraftAction/);
});
