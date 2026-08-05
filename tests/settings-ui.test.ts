import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const panel = read("src/frontend/components/SettingsPanel.svelte");
const general = read("src/frontend/components/settings/GeneralSettingsPage.svelte");
const customFields = read("src/frontend/components/settings/CustomFieldsSettingsPage.svelte");
const ai = read("src/frontend/components/settings/AiSettingsPage.svelte");
const mcp = read("src/frontend/components/settings/McpSettingsPage.svelte");
const advanced = read("src/frontend/components/settings/AdvancedSettingsPage.svelte");
const indexSource = read("src/index.ts");

test("设置页使用五个现代页面并保留外部组件契约", () => {
    assert.match(panel, /type ModernTabId = "general" \| "customFields" \| "ai" \| "mcp" \| "advanced"/);
    assert.match(panel, /export let bridge: any/);
    assert.match(panel, /export let onSave: \(settings: PluginSettings\) => void/);
    assert.match(panel, /export let onClose: \(\) => void/);
    for (const id of ["general", "customFields", "ai", "mcp", "advanced"]) {
        assert.match(panel, new RegExp(`id: "${id}"`));
    }
});

test("设置页支持脏状态、显式保存和 Esc 防误关", () => {
    assert.match(panel, /savedSignature/);
    assert.match(panel, /draftSignature/);
    assert.match(panel, /settingsUnsavedDesc/);
    assert.match(panel, /on:keydown\|capture=\{handleWindowKeydown\}/);
    assert.match(panel, /disabled=\{saving \|\| !settingsLoaded \|\| !isDirty\}/);
    assert.match(panel, /export function requestClose\(\)/);
    assert.match(indexSource, /\.b3-dialog__scrim/);
    assert.match(indexSource, /comp\.requestClose\(\)/);
    assert.match(panel, /na-settings-modern__header \{ position: sticky/);
    assert.match(panel, /na-settings-modern__footer \{ position: sticky/);
    assert.match(panel, /na-settings-modern__nav \{[\s\S]*position: sticky/);
});

test("设置页提供带确认的全部重置并统一原生表单字体", () => {
    assert.match(panel, /function handleResetAll\(\)/);
    assert.match(panel, /settingResetAllConfirm/);
    assert.match(panel, /handleResetCustomFields\(\)/);
    assert.match(panel, /na-settings-modern__reset-all/);
    assert.match(panel, /input\.b3-text-field/);
    assert.match(panel, /select\.b3-select/);
});

test("常规页包含任务默认值、我的一天和提醒三个可独立恢复分区", () => {
    assert.match(general, /onAction=\{onResetDefaults\}/);
    assert.match(general, /onAction=\{onResetMyDay\}/);
    assert.match(general, /onAction=\{onResetReminder\}/);
    assert.match(general, /setting-myday-enabled/);
    assert.match(general, /setting-reminder-enabled/);
});

test("复杂设置页保留关键行为并使用按需展开交互", () => {
    assert.match(customFields, /builderOpen/);
    assert.match(customFields, /purgeCustomField/);
    assert.match(customFields, /customFieldTypeLocked/);
    assert.match(customFields, /na-settings-custom-field__show-card/);
    assert.match(customFields, /title=\{field\.key\}/);
    assert.match(ai, /maxlength="12000"/);
    assert.match(ai, /SettingsAccordion/);
    assert.match(mcp, /settingMcpWriteWarning/);
    assert.match(mcp, /settingMcpToolInventory/);
    assert.match(advanced, /rebuildCache/);
    assert.match(advanced, /rebuildParents/);
});

test("现代设置样式优先使用思源主题变量", () => {
    assert.match(panel, /\.na-settings-modern/);
    for (const source of [general, customFields, ai, mcp, advanced]) {
        assert.match(source, /var\(--b3-/);
        assert.doesNotMatch(source, /#ffffff|#fff\b|#000000|rgba\(0,\s*0,\s*0,\s*0\.1\)/i);
    }
});
