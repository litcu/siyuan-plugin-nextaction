import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settingsSource = readFileSync(new URL("../src/shared/settings.ts", import.meta.url), "utf8");
const aiServiceSource = readFileSync(new URL("../src/frontend/ai/ai-feature-service.ts", import.meta.url), "utf8");
const aiSettingsPageSource = readFileSync(
    new URL("../src/frontend/components/settings/AiSettingsPage.svelte", import.meta.url),
    "utf8",
);
const settingsPanelSource = readFileSync(
    new URL("../src/frontend/components/SettingsPanel.svelte", import.meta.url),
    "utf8",
);

test("AI 设置为四个内置功能提供独立默认提示词", () => {
    assert.match(settingsSource, /export interface AiSettings/);
    assert.match(settingsSource, /extractTasks:/);
    assert.match(settingsSource, /decomposeTask:/);
    assert.match(settingsSource, /planMyDay:/);
    assert.match(settingsSource, /review:/);
    assert.match(settingsSource, /aiSettings: \{ prompts: \{ \.\.\.DEFAULT_AI_SETTINGS\.prompts \} \}/);
});

test("AI 设置支持单项提示词恢复默认", () => {
    assert.match(aiSettingsPageSource, /onResetPrompt: \(feature: AiFeatureId\) => void/);
    assert.match(aiSettingsPageSource, /onResetPrompt\(feature\.id\)/);
    assert.match(aiSettingsPageSource, /settingAiPromptReset/);
    assert.match(settingsPanelSource, /function handleResetAiPrompt\(feature: AiFeatureId\)/);
    assert.match(settingsPanelSource, /settingAiPromptResetConfirm/);
    assert.match(settingsPanelSource, /requestDraftAction\([\s\S]*?DEFAULT_AI_SETTINGS\.prompts\[feature\]/);
});

test("AI 提示词支持局部合并并限制长度", () => {
    assert.match(settingsSource, /prompts: \{[\s\S]*\.\.\.base\.aiSettings\.prompts/);
    assert.match(settingsSource, /aiSettings\.prompts\.\$\{feature\} must be <= 12000 characters/);
    assert.match(aiServiceSource, /get\(taskStore\)\.settings\?\.aiSettings\?\.prompts\?\./);
    assert.match(aiServiceSource, /DEFAULT_AI_SETTINGS\.prompts\[feature\]/);
});

test("自动规划默认提示词包含完整的 GTD 规划约束", () => {
    assert.match(settingsSource, /planMyDay: `你是一个遵循 GTD 方法的“我的一天”规划助手/);
    assert.match(settingsSource, /只从候选任务中选择/);
    assert.match(settingsSource, /已经逾期、今天到期/);
    assert.match(settingsSource, /不安排具体时间/);
    assert.match(settingsSource, /每条建议只包含候选任务的 blockId/);
});

test("智能回顾默认提示词覆盖固定分组、逾期和待回顾约束", () => {
    assert.match(settingsSource, /回顾分组/);
    assert.match(settingsSource, /回顾任务详情/);
    assert.match(settingsSource, /必须逐一覆盖输入中出现的每个固定分组/);
    assert.match(settingsSource, /尤其不能遗漏 overdue 和 reviewDue/);
    assert.match(settingsSource, /reviewDate 已到或临近/);
    assert.match(settingsSource, /该报告只用于展示和跳转，永远不会自动写入任务/);
});

test("AI 请求会显式插入功能输入数据并附带严格 JSON 示例", () => {
    assert.match(aiServiceSource, /【本次请求的输入数据】/);
    assert.match(aiServiceSource, /<extract_input>/);
    assert.match(aiServiceSource, /<decompose_input>/);
    assert.match(aiServiceSource, /<my_day_input>/);
    assert.match(aiServiceSource, /<review_input>/);
    assert.match(aiServiceSource, /【必须模仿的完整 JSON 示例】/);
    assert.match(aiServiceSource, /第一个字符必须是 \{/);
    assert.match(aiServiceSource, /禁止 Markdown、代码围栏/);
});
