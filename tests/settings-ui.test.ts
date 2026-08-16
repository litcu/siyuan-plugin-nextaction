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
const naSection = read("src/frontend/ui/NaSection.svelte");
const naSettingRow = read("src/frontend/ui/NaSettingRow.svelte");
const naAccordion = read("src/frontend/ui/NaAccordion.svelte");
const primitives = read("src/frontend/ui/primitives.scss");

test("设置页使用五个现代页面并保留外部组件契约", () => {
    assert.match(panel, /type ModernTabId = "general" \| "customFields" \| "ai" \| "mcp" \| "advanced"/);
    assert.match(panel, /export let bridge: any/);
    assert.match(panel, /export let onSave: \(settings: PluginSettings\) => void \| Promise<void>/);
    assert.match(panel, /export let onClose: \(\) => void/);
    for (const id of ["general", "customFields", "ai", "mcp", "advanced"]) {
        assert.match(panel, new RegExp(`id: "${id}"`));
    }
});

test("设置页支持脏状态、显式保存和 Esc 防误关", () => {
    assert.match(panel, /savedSignature/);
    assert.match(panel, /draftSignature/);
    assert.match(panel, /afterUpdate\(\(\) => \{[\s\S]*JSON\.stringify\(buildSettings\(\)\)[\s\S]*draftSignature = nextSignature/);
    assert.doesNotMatch(panel, /\$:\s*draftSignature\s*=\s*settingsLoaded\s*\?\s*JSON\.stringify\(buildSettings\(\)\)/);
    assert.match(panel, /settingsUnsavedDesc/);
    assert.match(panel, /on:keydown\|capture=\{handleWindowKeydown\}/);
    assert.match(panel, /disabled=\{saving \|\| !settingsLoaded \|\| !isDirty\}/);
    assert.match(panel, /await onSave\(result\);[\s\S]*savedSignature = JSON\.stringify\(buildSettings\(\)\);[\s\S]*draftSignature = savedSignature/);
    assert.match(panel, /i18n\?\.save \|\| "Save"/);
    assert.match(indexSource, /notifyInfo\(i18n\.settingsSaved \|\| "Settings saved"\);\s*\n\s*\} catch/);
    assert.doesNotMatch(indexSource, /settingsSaved \|\| "Settings saved"\}`\);\s*\n\s*dialog\.destroy\(\);/);
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
    assert.match(primitives, /input\.b3-text-field/);
    assert.match(primitives, /select\.b3-select/);
});

test("各分区重置和维护操作要求确认且全部重置不会嵌套确认", () => {
    for (const name of ["Priority", "Defaults", "MyDay", "Reminder", "Mcp", "TaskCreation"]) {
        assert.match(panel, new RegExp(`function doReset${name}\\(\\)`));
        assert.match(panel, new RegExp(`function handleReset${name}\\(\\) \\{[\\s\\S]*?settingResetSectionConfirm[\\s\\S]*?doReset${name}\\(\\)`));
    }
    const resetAll = panel.match(/function handleResetAll\(\) \{([\s\S]*?)\n    \}/)?.[1] || "";
    for (const name of ["Defaults", "TaskCreation", "MyDay", "Reminder", "Mcp", "Priority"]) {
        assert.match(resetAll, new RegExp(`doReset${name}\\(\\)`));
        assert.doesNotMatch(resetAll, new RegExp(`handleReset${name}\\(\\)`));
    }
    assert.match(panel, /function handleRebuildCache\(\) \{[\s\S]*?rebuildCacheConfirm[\s\S]*?bridge\.rebuildCache\(\)/);
    assert.match(panel, /function handleRebuildParents\(\) \{[\s\S]*?rebuildParentsConfirm[\s\S]*?bridge\.rebuildParents\(\)/);
});

test("常规页包含任务创建、任务默认值、我的一天和提醒四个可独立恢复分区", () => {
    assert.match(general, /onAction=\{onResetTaskCreation\}/);
    assert.match(general, /onAction=\{onResetDefaults\}/);
    assert.match(general, /onAction=\{onResetMyDay\}/);
    assert.match(general, /onAction=\{onResetReminder\}/);
    assert.match(general, /setting-myday-reset-hour/);
    assert.doesNotMatch(general, /setting-myday-enabled|myDayEnabled/);
    assert.match(general, /setting-reminder-enabled/);
    assert.match(general, /setting-task-creation-target/);
});

test("指定的收件箱文档通过搜索选择且不提供当前文档快捷方式", () => {
    assert.match(general, /NaDocumentPicker/);
    assert.match(general, /bind:value=\{taskCreationInboxDocument\}/);
    assert.match(general, /fixedDropdown/);
    assert.doesNotMatch(general, /taskCreationInboxDocumentId|onUseCurrentDocument|settingTaskCreationUseCurrentDocument|settingTaskCreationVerify/);
    assert.match(panel, /inboxDocumentId: taskCreationInboxDocumentId\.trim\(\)/);
    assert.match(panel, /taskCreationInboxDocumentId = document\?\.id \|\| ""/);
    assert.doesNotMatch(panel, /getCurrentDocumentId|useCurrentDocumentForTaskCreation|onUseCurrentDocument/);
    assert.doesNotMatch(indexSource, /new SettingsPanel\(\{[\s\S]*?getCurrentDocumentId/);
});

test("复杂设置页保留关键行为并使用按需展开交互", () => {
    assert.match(customFields, /builderOpen/);
    assert.match(customFields, /purgeCustomField/);
    assert.match(customFields, /customFieldTypeLocked/);
    assert.match(customFields, /na-settings-custom-field__show-card/);
    assert.match(customFields, /<code>\{field\.key\}<\/code>/);
    assert.match(ai, /maxlength="12000"/);
    assert.match(ai, /NaAccordion/);
    assert.match(mcp, /settingMcpWriteWarning/);
    assert.match(mcp, /settingMcpToolInventory/);
    assert.match(advanced, /rebuildCache/);
    assert.match(advanced, /rebuildParents/);
});

test("MCP 地址使用思源固定服务端口而不是当前随机端口", () => {
    assert.match(panel, /const mcpEndpoint = "http:\/\/127\.0\.0\.1:6806\/mcp"/);
    assert.doesNotMatch(panel, /window\.location\.origin \+ "\/mcp"/);
});

test("设置界面基础结构统一使用 Na 公共组件", () => {
    for (const source of [general, mcp, advanced]) {
        assert.match(source, /\.\.\/\.\.\/ui\/Na/);
    }
    assert.match(ai, /ui\/NaAccordion\.svelte/);
    for (const source of [naSection, naSettingRow, naAccordion]) {
        assert.match(source, /var\(--b3-/);
    }
});
