import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const detailSource = readFileSync(
    new URL("../src/frontend/components/TaskDetail.svelte", import.meta.url),
    "utf8",
);

test("任务属性中的重复设置只保留开关和操作按钮", () => {
    assert.match(detailSource, /na-detail__value na-detail__repeat-controls[\s\S]*NaToggle/);
    assert.match(detailSource, /\{#if repeatEnabled\}[\s\S]*na-detail__repeat-actions/);
    assert.doesNotMatch(detailSource, /repeatSummary/);
    assert.doesNotMatch(detailSource, /na-detail__repeat-rule/);
    assert.doesNotMatch(detailSource, /na-detail__repeat-state/);
});

