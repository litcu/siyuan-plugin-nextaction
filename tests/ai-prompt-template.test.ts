import test from "node:test";
import assert from "node:assert/strict";
import { renderAiPromptTemplate } from "../src/frontend/ai/ai-prompt-template.ts";

test("AI 提示词模板会替换通用和功能上下文变量", () => {
    const result = renderAiPromptTemplate(
        "功能={{feature}} 日期={{today}} 任务={{currentTaskBlock}} 候选={{nextaction}}",
        {
            feature: "decomposeTask",
            context: { task: { blockId: "task-1", title: "准备发布" }, candidates: [{ blockId: "next-1" }] },
        },
    );
    assert.match(result.text, /decomposeTask/);
    assert.match(result.text, /task-1/);
    assert.match(result.text, /next-1/);
    assert.deepEqual(result.unknown, []);
    assert.deepEqual(result.blockIds, []);
});

test("AI 提示词模板不会遗留未知占位符", () => {
    const result = renderAiPromptTemplate("{{notARealVariable}} {{currentTaskDoc}}", {
        feature: "review",
        context: {},
    });
    assert.match(result.text, /未知变量/);
    assert.match(result.text, /未提供/);
    assert.deepEqual(result.unknown, ["notARealVariable"]);
});

test("AI 提示词可以通过 block 变量引用指定思源块", () => {
    const blockId = "20260804123000-abcdefg";
    const result = renderAiPromptTemplate(`请参考 {{block:${blockId}}} 和 {{ block: ${blockId} }}`, {
        feature: "extractTasks",
        context: {},
    });
    assert.deepEqual(result.blockIds, [blockId]);
    assert.doesNotMatch(result.text, /\{\{block:/);
    assert.match(result.text, new RegExp(blockId));
});

test("AI 提示词拒绝无效的指定块 ID", () => {
    const result = renderAiPromptTemplate("{{block:not-a-block}}", { feature: "review", context: {} });
    assert.deepEqual(result.blockIds, []);
    assert.match(result.text, /无效的思源块 ID/);
});
