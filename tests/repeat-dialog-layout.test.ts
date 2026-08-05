import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editorSource = readFileSync(new URL("../src/frontend/ui/NaRepeatRuleEditor.svelte", import.meta.url), "utf8");
const controllerSource = readFileSync(new URL("../src/frontend/dialogs/task-property-dialogs.ts", import.meta.url), "utf8");
const datePickerSource = readFileSync(new URL("../src/frontend/ui/NaDatePicker.svelte", import.meta.url), "utf8");
const taskDetailSource = readFileSync(new URL("../src/frontend/components/TaskDetail.svelte", import.meta.url), "utf8");

test("重复规则编辑器保留频率、月度条件、结束条件和预览", () => {
    assert.match(editorSource, /NaSegmentControl options=\{frequencyOptions\}/);
    assert.match(editorSource, /monthlyType === "dayOfMonth"/);
    assert.match(editorSource, /monthlyType === "nthWeekday"/);
    assert.match(editorSource, /NaSegmentControl options=\{endOptions\}/);
    assert.match(editorSource, /previewRepeatOccurrences/);
});

test("重复弹窗使用公共壳层并在关闭时检查本地草稿", () => {
    assert.match(editorSource, /<NaDialogShell/);
    assert.match(editorSource, /export function hasUnsavedChanges/);
    assert.match(controllerSource, /component\?\.hasUnsavedChanges\(\)/);
    assert.match(controllerSource, /unsavedChangesTitle/);
});

test("重复规则草稿显式声明全部响应式依赖", () => {
    assert.doesNotMatch(editorSource, /\$:\s*draftRule\s*=\s*buildRule\(\)/);
    assert.match(editorSource, /\$:\s*draftRule\s*=\s*buildRule\(\{[\s\S]*frequency,[\s\S]*monthDay,[\s\S]*\}\);/);
});

test("对话框日期浮层会根据上下空间自动选择展开方向", () => {
    assert.match(datePickerSource, /const spaceBelow = window\.innerHeight - rect\.bottom/);
    assert.match(datePickerSource, /const spaceAbove = rect\.top/);
    assert.match(datePickerSource, /const openAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow/);
    assert.match(taskDetailSource, /NaDatePicker bind:value=\{start\}[\s\S]*fixedDropdown=\{true\}/);
    assert.match(taskDetailSource, /NaDatePicker bind:value=\{due\}[\s\S]*fixedDropdown=\{true\}/);
});
