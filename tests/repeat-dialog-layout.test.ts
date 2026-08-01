import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dialogSource = readFileSync(
    new URL("../src/frontend/components/RepeatRuleDialog.svelte", import.meta.url),
    "utf8",
);
const datePickerSource = readFileSync(
    new URL("../src/frontend/ui/NaDatePicker.svelte", import.meta.url),
    "utf8",
);
const taskDetailSource = readFileSync(
    new URL("../src/frontend/components/TaskDetail.svelte", import.meta.url),
    "utf8",
);

test("月度附加条件使用独立响应式网格，不挤压主模式选择器", () => {
    assert.match(dialogSource, /class="na-repeat-editor__monthly"[\s\S]*bind:value=\{monthlyType\}[\s\S]*class="na-repeat-editor__conditional-grid"/);
    assert.match(dialogSource, /\.na-repeat-editor__monthly, \.na-repeat-editor__end \{[\s\S]*flex-direction: column/);
    assert.match(dialogSource, /\.na-repeat-editor__conditional-grid \{[\s\S]*grid-template-columns: minmax/);
});

test("结束条件主选择器保持整行，次数或日期编辑器另起一行", () => {
    assert.match(dialogSource, /NaSegmentControl options=\{endOptions\}[\s\S]*na-repeat-editor__conditional-row/);
    assert.match(dialogSource, /NaDatePicker value=\{endDate\} fixedDropdown=\{true\}/);
});

test("对话框日期浮层会根据上下空间自动选择展开方向", () => {
    assert.match(datePickerSource, /const spaceBelow = window\.innerHeight - rect\.bottom/);
    assert.match(datePickerSource, /const spaceAbove = rect\.top/);
    assert.match(datePickerSource, /const openAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow/);
    assert.match(taskDetailSource, /NaDatePicker bind:value=\{start\}[\s\S]*fixedDropdown=\{dialogMode\}/);
    assert.match(taskDetailSource, /NaDatePicker bind:value=\{due\}[\s\S]*fixedDropdown=\{dialogMode\}/);
});

test("滚轮位于表单控件上时仍转交给重复设置滚动容器", () => {
    assert.match(dialogSource, /function handleEditorWheel\(event: WheelEvent\)/);
    assert.match(dialogSource, /closest\("input, select, textarea, button, \[role='radio'\], \[role='switch'\], \.na-date-picker__input"\)/);
    assert.match(dialogSource, /closest\("\.na-date-picker__dropdown, \.na-date-picker__time-scroll"\)/);
    assert.match(dialogSource, /on:wheel\|capture\|nonpassive=\{handleEditorWheel\}/);
});
