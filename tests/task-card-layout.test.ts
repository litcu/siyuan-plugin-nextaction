import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const taskCardSource = readFileSync(
    new URL("../src/frontend/components/TaskCard.svelte", import.meta.url),
    "utf8",
);
const stylesheetSource = readFileSync(
    new URL("../src/index.scss", import.meta.url),
    "utf8",
);

test("父任务作为任务名称的同一行语义后缀展示", () => {
    const titleRowStart = taskCardSource.indexOf('<div class="na-task-card__title-row">');
    const compositeTitle = taskCardSource.indexOf('class="na-task-card__title-composite"');
    const metaClusterStart = taskCardSource.indexOf('<div class="na-task-card__meta-cluster">');
    const parentContext = taskCardSource.indexOf('class="na-task-card__parent-context"');
    const title = taskCardSource.indexOf('class="na-task-card__title"');

    assert.ok(titleRowStart >= 0, "缺少任务标题行");
    assert.ok(compositeTitle > titleRowStart, "缺少复合标题容器");
    assert.ok(title > compositeTitle, "任务名称应位于复合标题内");
    assert.ok(parentContext > title, "父任务应跟在任务名称之后");
    assert.ok(metaClusterStart > parentContext, "父任务不应出现在辅助信息行");
    assert.doesNotMatch(taskCardSource, /na-task-card__parent-path/);
    assert.doesNotMatch(taskCardSource, /na-task-card__content--has-parent/);
});

test("任务卡片使用统一且有呼吸感的紧凑高度", () => {
    const cardRule = stylesheetSource.match(/\.na-task-card\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    assert.match(cardRule, /box-sizing:\s*border-box/);
    assert.match(cardRule, /height:\s*52px/);
    assert.match(cardRule, /min-height:\s*52px/);
    assert.match(cardRule, /max-height:\s*52px/);
    assert.match(cardRule, /flex:\s*0\s+0\s+52px/);
});

test("优先级使用卡片专属的轻量标记", () => {
    assert.doesNotMatch(taskCardSource, /import NaBadge/);
    assert.doesNotMatch(taskCardSource, /<NaBadge/);
    assert.match(taskCardSource, /class="na-task-card__priority"/);
});

test("任务元数据保持单行，内容过多时不撑高卡片", () => {
    const clusterRule = stylesheetSource.match(/\.na-task-card__meta-cluster\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    assert.match(clusterRule, /flex-wrap:\s*nowrap/);
    assert.match(clusterRule, /overflow:\s*hidden/);
});

test("复合标题分别约束任务名和父任务的溢出", () => {
    const compositeRule = stylesheetSource.match(/\.na-task-card__title-composite\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const childTitleRule = stylesheetSource.match(/\.na-task-card__title-composite--has-parent \.na-task-card__title\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const parentRule = stylesheetSource.match(/\.na-task-card__parent-context\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    assert.match(compositeRule, /overflow:\s*hidden/);
    assert.match(childTitleRule, /flex-shrink:\s*0/);
    assert.match(parentRule, /min-width:\s*0/);
    assert.match(parentRule, /overflow:\s*hidden/);
});
