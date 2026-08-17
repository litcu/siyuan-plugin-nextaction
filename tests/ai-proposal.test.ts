import test from "node:test";
import assert from "node:assert/strict";
import { completeAiReviewGroups, parseAiJson, validateAiProposal } from "../src/shared/ai.ts";
import { AiProposalService } from "../src/kernel/ai-proposal-service.ts";

test("AI 提案解析支持 JSON 和 markdown fenced JSON", () => {
    assert.deepEqual(
        parseAiJson('{"feature":"review","summary":"ok","review":{"summary":"ok","groups":[],"actions":[]}}'),
        {
            feature: "review",
            summary: "ok",
            review: { summary: "ok", groups: [], actions: [] },
        },
    );
    assert.deepEqual(parseAiJson('```json\n{"feature":"planMyDay","summary":"ok","myDay":[]}\n```'), {
        feature: "planMyDay",
        summary: "ok",
        myDay: [],
    });
    assert.deepEqual(
        parseAiJson(
            '好的，结果如下：\n{"feature":"review","summary":"ok","review":{"summary":"ok","groups":[],"actions":[],},}',
        ),
        {
            feature: "review",
            summary: "ok",
            review: { summary: "ok", groups: [], actions: [] },
        },
    );
});

test("AI 空任务提案可以表示没有识别到可执行任务", () => {
    const result = validateAiProposal({
        feature: "extractTasks",
        summary: "没有可执行任务",
        tasks: [],
        warnings: ["无任务"],
    });
    assert.equal(result.errors.length, 0);
});

test("AI 任务提案拒绝非法字段、日期和依赖循环", () => {
    const result = validateAiProposal({
        feature: "decomposeTask",
        summary: "拆解",
        tasks: [
            { title: "A", dependsOnIndexes: [1], due: "2024-02-30" },
            { title: "B", dependsOnIndexes: [0], priority: "urgent" },
        ],
    });
    assert.ok(result.errors.some((error) => error.includes("due")));
    assert.ok(result.errors.some((error) => error.includes("priority")));
    assert.ok(result.errors.some((error) => error.includes("cycle")));
});

test("AI My Day 提案只接受合法任务 block ID", () => {
    const result = validateAiProposal({
        feature: "planMyDay",
        summary: "选择",
        myDay: [{ blockId: "bad", reason: "x" }],
    });
    assert.ok(result.errors.some((error) => error.includes("myDay")));
});

test("AI 提案支持保存到已有任务的子块", () => {
    const valid = validateAiProposal({
        feature: "decomposeTask",
        summary: "拆解",
        target: { type: "child", parentBlockId: "20260802120000-abcdefg" },
        tasks: [{ title: "子任务" }],
    });
    assert.equal(valid.errors.length, 0);
    const invalid = validateAiProposal({
        feature: "decomposeTask",
        summary: "拆解",
        target: { type: "child" },
        tasks: [{ title: "子任务" }],
    });
    assert.ok(invalid.errors.some((error) => error.includes("parentBlockId")));
    const sourceChild = validateAiProposal({
        feature: "extractTasks",
        summary: "提取",
        target: { type: "source_child" },
        tasks: [{ title: "子任务", sourceBlockId: "20260802120000-abcdefg" }],
    });
    assert.equal(sourceChild.errors.length, 0);
    const missingSource = validateAiProposal({
        feature: "extractTasks",
        summary: "提取",
        target: { type: "source_child" },
        tasks: [{ title: "子任务" }],
    });
    assert.ok(missingSource.errors.some((error) => error.includes("sourceBlockId")));
});

test("AI 任务提案允许可选的重要性和工作量使用 null", () => {
    const result = validateAiProposal({
        feature: "extractTasks",
        summary: "提取任务",
        tasks: [
            {
                title: "下午去拿快递",
                sourceBlockId: "20260803220441-9fbfdvw",
                importance: null,
                effort: null,
                start: null,
                due: null,
                contexts: null,
                tags: null,
                note: null,
            },
        ],
    });
    assert.equal(result.errors.length, 0);
    assert.equal(result.proposal.tasks?.[0].importance, undefined);
    assert.equal(result.proposal.tasks?.[0].effort, undefined);
    assert.equal(result.proposal.tasks?.[0].contexts, undefined);
    assert.equal(result.proposal.tasks?.[0].tags, undefined);
});

test("AI 任务提案仍拒绝非法的重要性和工作量", () => {
    const result = validateAiProposal({
        feature: "extractTasks",
        summary: "提取任务",
        tasks: [
            { title: "任务", importance: 0, effort: 8 },
            { title: "任务2", importance: "4", effort: "large" },
        ],
    });
    assert.ok(result.errors.some((error) => error.includes("tasks[0].importance")));
    assert.ok(result.errors.some((error) => error.includes("tasks[0].effort")));
    assert.ok(result.errors.some((error) => error.includes("tasks[1].importance")));
    assert.ok(result.errors.some((error) => error.includes("tasks[1].effort")));
});

test("AI 回顾提案只读且必须包含报告", () => {
    const invalid = validateAiProposal({ feature: "review", summary: "x" });
    assert.ok(invalid.errors.includes("review is required for review proposals"));
    const valid = validateAiProposal({
        feature: "review",
        summary: "x",
        review: { summary: "x", groups: [{ key: "overdue", title: "逾期", summary: "需要处理" }], actions: [] },
    });
    assert.equal(valid.errors.length, 0);
});

test("AI 回顾会补齐模型遗漏的源分组任务", () => {
    const result = completeAiReviewGroups(
        {
            feature: "review",
            summary: "回顾",
            review: {
                summary: "回顾",
                groups: [
                    { key: "reviewDue", title: "待回顾", summary: "模型摘要", blockIds: ["20260802120000-zzzzzzz"] },
                ],
                actions: [],
            },
        },
        { reviewDue: ["20260802120000-abcdefg"] },
        { reviewDue: "待回顾" },
    );
    assert.deepEqual(result.review?.groups[0].blockIds, ["20260802120000-abcdefg"]);
    assert.equal(result.review?.groups[0].summary, "模型摘要");
});

test("AI My Day 应用只添加候选任务，不生成排程", async () => {
    const calls: string[] = [];
    const task = { blockId: "20260802120000-abcdefg" };
    const service = new AiProposalService(
        {
            getMyDay: async () => ({ schema: 1, dayKey: "2026-08-02", updatedAt: 1, tasks: [] }),
            getTask: (id: string) => (id === task.blockId ? task : null),
            addTaskToMyDay: async (id: string) => {
                calls.push(id);
                return {
                    schema: 1,
                    dayKey: "2026-08-02",
                    updatedAt: 2,
                    tasks: [{ blockId: id, addedAt: 1, scheduleStart: null, scheduleEnd: null, order: 0 }],
                };
            },
        } as any,
        async () => {
            throw new Error("not expected");
        },
        async () => {
            throw new Error("not expected");
        },
    );
    const result = await service.apply({
        feature: "planMyDay",
        summary: "选择",
        myDay: [{ blockId: task.blockId, reason: "due" }],
    });
    assert.deepEqual(calls, [task.blockId]);
    assert.equal(result.myDay?.tasks[0].scheduleStart, null);
});

test("AI 提案服务拒绝回顾写入", async () => {
    const service = new AiProposalService(
        {} as any,
        async () => {
            throw new Error();
        },
        async () => {
            throw new Error();
        },
    );
    await assert.rejects(
        () => service.apply({ feature: "review", summary: "x", review: { summary: "x", groups: [], actions: [] } }),
        /read-only/,
    );
});
