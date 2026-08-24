import test from "node:test";
import assert from "node:assert/strict";
import { completeAiReviewGroups, parseAiJson, validateAiProposal } from "../src/shared/ai.ts";
import { AiProposalService } from "../src/kernel/ai-proposal-service.ts";
import { buildAiTaskContext } from "../src/shared/ai-context.ts";
import { taskFactory } from "./helpers/fakes.ts";

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

test("AI 提案可读写 Outcome、DoD 和 Stage 并遵守字段适用范围", async () => {
    // Regression: AI proposals previously dropped the Project control fields.
    const valid = validateAiProposal({
        feature: "decomposeTask",
        summary: "补全项目定义",
        tasks: [
            {
                title: "发布项目",
                kind: "project",
                status: "doing",
                outcome: "用户可完成闭环",
                dod: "检查通过\n已发布",
            },
            { title: "实施阶段", kind: "task", actionKind: "stage" },
        ],
    });
    assert.deepEqual(valid.errors, []);
    assert.equal(valid.proposal.tasks?.[0].outcome, "用户可完成闭环");
    assert.equal(valid.proposal.tasks?.[0].dod, "检查通过\n已发布");
    assert.equal(valid.proposal.tasks?.[1].actionKind, "stage");

    const invalid = validateAiProposal({
        feature: "decomposeTask",
        summary: "非法字段",
        tasks: [
            { title: "项目", kind: "project", actionKind: "stage" },
            { title: "项目二", kind: "project", outcome: "第一行\n第二行" },
            { title: "项目三", kind: "project", outcome: 42, dod: ["not", "text"] },
        ],
    });
    assert.ok(invalid.errors.some((error) => error.includes("ordinary Action")));
    assert.ok(invalid.errors.some((error) => error.includes("single-line")));
    assert.ok(invalid.errors.some((error) => error.includes("outcome must be a string")));
    assert.ok(invalid.errors.some((error) => error.includes("dod must be a string")));

    const createCalls: Array<Record<string, unknown>> = [];
    const convertCalls: Array<Record<string, unknown>> = [];
    const service = new AiProposalService(
        {} as any,
        async (input) => {
            createCalls.push(input.properties || {});
            return { task: { blockId: `created-${createCalls.length}` } };
        },
        async (input) => {
            convertCalls.push((input.properties as Record<string, unknown>) || {});
            return { task: { blockId: "converted-1" } };
        },
    );
    await service.apply(valid.proposal);
    assert.deepEqual(createCalls, [
        { status: "doing", outcome: "用户可完成闭环", dod: "检查通过\n已发布" },
        { actionKind: "stage" },
    ]);

    await service.apply({
        feature: "extractTasks",
        summary: "补全已有项目",
        target: { type: "original" },
        tasks: [
            {
                title: "已有项目",
                kind: "project",
                sourceBlockId: "20260802120003-existng",
                outcome: "已转换",
            },
        ],
    });
    assert.deepEqual(convertCalls, [{ outcome: "已转换" }]);
});

test("AI 任务上下文显式提供 Project 定义和 Stage 类型", () => {
    // Regression: prompt context previously omitted the fields that define outcome-oriented projects.
    const project = buildAiTaskContext(
        taskFactory("20260802120000-project", {
            taskType: "2",
            actionKind: "",
            outcome: "用户完成工作流",
            dod: "验收通过\n发布完成",
        }),
    );
    const stage = buildAiTaskContext(
        taskFactory("20260802120001-stagexx", { actionKind: "stage", outcome: "stale but non-identifying" }),
    );

    assert.equal(project.kind, "project");
    assert.equal(project.actionKind, null);
    assert.equal(project.outcome, "用户完成工作流");
    assert.equal(project.dod, "验收通过\n发布完成");
    assert.equal(stage.kind, "task");
    assert.equal(stage.actionKind, "stage");

    const bounded = buildAiTaskContext(
        taskFactory("20260802120002-bounded", { tags: "t".repeat(200), depends: "d".repeat(200) }),
        { tagsLimit: 0, dependsLimit: 0 },
    );
    assert.equal(bounded.tags, "");
    assert.equal(bounded.depends, "");
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
