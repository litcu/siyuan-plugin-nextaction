import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editorSource = readFileSync(new URL("../src/frontend/ui/NaRepeatRuleEditor.svelte", import.meta.url), "utf8");
const controllerSource = readFileSync(
    new URL("../src/frontend/dialogs/task-property-dialogs.ts", import.meta.url),
    "utf8",
);
const datePickerSource = readFileSync(new URL("../src/frontend/ui/NaDatePicker.svelte", import.meta.url), "utf8");
const taskDetailSource = readFileSync(new URL("../src/frontend/components/TaskDetail.svelte", import.meta.url), "utf8");
const segmentSource = readFileSync(new URL("../src/frontend/ui/NaSegmentControl.svelte", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../src/frontend/ui/NaDialogShell.svelte", import.meta.url), "utf8");

test("重复规则编辑器保留频率、月度条件、结束条件和预览", () => {
    assert.match(editorSource, /<NaSegmentControl\s+options=\{frequencyOptions\}/);
    assert.match(editorSource, /monthlyType === "dayOfMonth"/);
    assert.match(editorSource, /monthlyType === "nthWeekday"/);
    assert.match(editorSource, /<NaSegmentControl\s+options=\{endOptions\}/);
    assert.match(editorSource, /previewRepeatOccurrences/);
});

test("重复弹窗使用公共壳层并在关闭时检查本地草稿", () => {
    assert.match(editorSource, /<NaDialogShell/);
    assert.match(editorSource, /export function hasUnsavedChanges/);
    assert.match(controllerSource, /mounted\?\.instance\.hasUnsavedChanges\(\)/);
    assert.match(controllerSource, /unsavedChangesTitle/);
});

test("重复规则草稿显式声明全部响应式依赖", () => {
    assert.doesNotMatch(editorSource, /\$:\s*draftRule\s*=\s*buildRule\(\)/);
    assert.match(editorSource, /\$:\s*draftRule\s*=\s*buildRule\(\{[\s\S]*frequency,[\s\S]*monthDay,[\s\S]*\}\);/);
});

test("重复规则保存动作明确显示保存并让预设选中态匹配完整规则", () => {
    assert.match(editorSource, /i18n\?\.save \|\| "Save"/);
    assert.match(editorSource, /function applyDraft\(/);
    assert.match(editorSource, /slot="footerEnd"/);
    assert.match(editorSource, /function isPresetActive\(/);
    assert.match(editorSource, /monthlyType === "dayOfMonth" && monthDay === anchorDay/);
    assert.match(editorSource, /weekdays\[0\] === anchorWeekday/);
});

test("重复弹窗自身声明满高布局，底部保存区不依赖提醒编辑器样式", () => {
    assert.match(editorSource, /na-repeat-dialog-container > \.b3-dialog__body/);
    assert.match(editorSource, /flex: 1 1 0/);
    assert.doesNotMatch(editorSource, /na-repeat-dialog-container > \.b3-dialog__body\)[^{]*\{[^}]*height: 100%/);
    assert.match(editorSource, /na-repeat-rule-editor\)\s*\{\s*width:\s*100%;\s*height:\s*100%/);
    assert.doesNotMatch(
        readFileSync(new URL("../src/frontend/ui/NaReminderEditor.svelte", import.meta.url), "utf8"),
        /na-repeat-dialog-container/,
    );
});

test("重复规则的短控件从控制列起始对齐，避免全部贴在窗口右侧", () => {
    assert.match(
        editorSource,
        /na-repeat-rule-editor \.na-property-row__control\)\s*\{\s*justify-content:\s*flex-start;/,
    );
    assert.match(editorSource, /na-repeat-rule-editor \.na-property-row__control > \.b3-select/);
});

test("分段控件的选中背景跟随实际选项，不使用等宽滑块定位", () => {
    assert.match(segmentSource, /na-segment-control__option--active[\s\S]*background: var\(--na-accent-surface\)/);
    assert.match(segmentSource, /box-shadow: inset 0 -2px 0 var\(--b3-theme-primary\)/);
    assert.doesNotMatch(segmentSource, /na-segment-control__slider/);
});

test("重复设置的频率和结束条件均分整行，底部操作栏固定在 shell 底部", () => {
    assert.match(editorSource, /frequencyOptions\}[^>]*stretch=\{true\}/);
    assert.match(editorSource, /endOptions\}[^>]*stretch=\{true\}/);
    assert.match(shellSource, /padding-bottom: 72px/);
    assert.match(shellSource, /na-dialog-shell \.na-dialog-footer[\s\S]*position: absolute/);
    assert.match(editorSource, /b3-button b3-button--text[\s\S]*b3-button b3-button--primary/);
});

test("对话框日期浮层会根据上下空间自动选择展开方向", () => {
    assert.match(datePickerSource, /const spaceBelow = window\.innerHeight - rect\.bottom/);
    assert.match(datePickerSource, /const spaceAbove = rect\.top/);
    assert.match(datePickerSource, /const openAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow/);
    assert.match(taskDetailSource, /<NaDatePicker\s+bind:value=\{start\}[\s\S]*?fixedDropdown=\{true\}/);
    assert.match(taskDetailSource, /<NaDatePicker\s+bind:value=\{due\}[\s\S]*?fixedDropdown=\{true\}/);
});
