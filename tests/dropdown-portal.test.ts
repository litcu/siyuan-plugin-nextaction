import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const datePicker = readFileSync(new URL("../src/frontend/ui/NaDatePicker.svelte", import.meta.url), "utf8");
const searchSelect = readFileSync(new URL("../src/frontend/ui/NaSearchSelect.svelte", import.meta.url), "utf8");
const taskDetail = readFileSync(new URL("../src/frontend/components/TaskDetail.svelte", import.meta.url), "utf8");
const portal = readFileSync(new URL("../src/frontend/utils/portal.ts", import.meta.url), "utf8");

test("日期与搜索选择器的浮层通过 Portal 脱离弹窗裁剪容器", () => {
    assert.match(datePicker, /use:portal=\{fixedDropdown\}/);
    assert.match(searchSelect, /use:portal=\{fixedDropdown\}/);
    assert.match(searchSelect, /export let fixedDropdown: boolean = false/);
});

test("Portal 浮层保留 NextAction 主题变量作用域", () => {
    assert.match(portal, /node\.classList\.add\("nextaction"\)/);
    assert.match(portal, /if \(!hadThemeScope\) node\.classList\.remove\("nextaction"\)/);
});

test("搜索选择器根据视口上下空间决定展开方向并限制高度", () => {
    assert.match(searchSelect, /const spaceBelow = Math\.max/);
    assert.match(searchSelect, /const spaceAbove = Math\.max/);
    assert.match(searchSelect, /const openAbove = spaceBelow < 200 && spaceAbove > spaceBelow/);
    assert.match(searchSelect, /max-height:\$\{maxHeight\}px/);
});

test("任务详情弹窗中的上下文、标签、任务关系和自定义选项均启用固定浮层", () => {
    const fixedDropdownUsages = taskDetail.match(/fixedDropdown=\{dialogMode\}/g) || [];
    assert.ok(fixedDropdownUsages.length >= 8, `expected at least 8 fixed dropdown usages, got ${fixedDropdownUsages.length}`);
    assert.match(taskDetail, /def\.type === "multiSelect"[\s\S]*?fixedDropdown=\{dialogMode\}/);
    assert.match(taskDetail, /def\.type === "singleSelect"[\s\S]*?fixedDropdown=\{dialogMode\}/);
});

test("浮层会在弹窗内部滚动和窗口缩放时重新定位", () => {
    assert.match(datePicker, /document\.addEventListener\("scroll", handleViewportChange, true\)/);
    assert.match(searchSelect, /document\.addEventListener\("scroll", handleViewportChange, true\)/);
    assert.match(datePicker, /on:resize=\{handleViewportChange\}/);
    assert.match(searchSelect, /on:resize=\{handleViewportChange\}/);
});
