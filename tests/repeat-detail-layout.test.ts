import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const detailSource = readFileSync(new URL("../src/frontend/components/TaskDetail.svelte", import.meta.url), "utf8");

test("任务属性中的重复设置只保留开关和操作按钮", () => {
    assert.match(detailSource, /class="na-task-detail__repeat-control"[\s\S]*NaToggle/);
    assert.match(detailSource, /\{#if repeatEnabled\}[\s\S]*openRepeatSettings/);
    assert.doesNotMatch(detailSource, /repeatSummary/);
    assert.doesNotMatch(detailSource, /na-detail__repeat-rule/);
    assert.doesNotMatch(detailSource, /na-detail__repeat-state/);
});

test("缺少重复日期显示前置警告而不是保存失败", () => {
    const openRepeat = detailSource.match(/async function openRepeatSettings\(\) \{([\s\S]*?)\n    \}/)?.[1] || "";
    assert.match(openRepeat, /repeatDateError = i18n\?\.repeatNeedsDate/);
    assert.doesNotMatch(openRepeat, /saveState = "error"/);
    assert.match(detailSource, /repeatDateError[\s\S]*\? "warning"/);
    assert.match(detailSource, /function handleDateChange\(\) \{[\s\S]*?repeatDateError = ""/);
});
