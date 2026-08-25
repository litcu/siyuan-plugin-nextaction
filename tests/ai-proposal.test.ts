import test from "node:test";
import assert from "node:assert/strict";
import { completeAiReviewGroups, parseAiJson, validateAiProposal } from "../src/shared/ai.ts";
import { AiProposalService } from "../src/kernel/ai-proposal-service.ts";
import { buildAiTaskContext } from "../src/shared/ai-context.ts";
import { RPC_CONTRACT } from "../src/shared/rpc-methods.ts";
import { KernelBridge } from "../src/frontend/kernel-bridge.ts";
import { McpToolError } from "../src/kernel/mcp-tool-error.ts";
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

test("AI Action 提取将来源子项与原位转换保持为不同写入目标", async () => {
    const sourceBlockId = "20260825185959-source0";
    const createCalls: Array<{ destination: unknown; sourceReferenceBlockId?: string }> = [];
    const convertCalls: unknown[] = [];
    const service = new AiProposalService(
        {} as any,
        async (input, options) => {
            createCalls.push({
                destination: input.destination,
                sourceReferenceBlockId: options?.sourceReferenceBlockId,
            });
            return { task: { blockId: "20260825185958-created" } };
        },
        async (input) => {
            convertCalls.push(input);
            return { task: { blockId: sourceBlockId } };
        },
        { exists: async () => true },
    );
    const context = { sourceBlockIds: [sourceBlockId] };

    const sourceChild = await service.apply(
        {
            feature: "extractTasks",
            summary: "保存为来源子项",
            target: { type: "source_child" },
            tasks: [{ title: "Child Action", sourceBlockId }],
        },
        context,
    );
    const original = await service.apply(
        {
            feature: "extractTasks",
            summary: "原位转换",
            target: { type: "original" },
            tasks: [{ title: "Converted Action", sourceBlockId }],
        },
        context,
    );

    assert.deepEqual(createCalls, [
        {
            destination: { type: "block", parentBlockId: sourceBlockId },
            sourceReferenceBlockId: sourceBlockId,
        },
    ]);
    assert.equal(convertCalls.length, 1);
    assert.deepEqual(
        sourceChild.items.map((item) => [item.target, item.status]),
        [["source_child", "created"]],
    );
    assert.deepEqual(
        original.items.map((item) => [item.target, item.status]),
        [["original", "converted"]],
    );
});

test("AI Action 提取在写入前拒绝缺失或伪造的来源上下文", async () => {
    const sourceBlockId = "20260825190000-source1";
    const forgedSourceBlockId = "20260825190001-forged1";
    const writes: unknown[] = [];
    const service = new AiProposalService(
        {} as any,
        async (input) => {
            writes.push(input);
            return { task: { blockId: "20260825190002-created" } };
        },
        async (input) => {
            writes.push(input);
            return { task: { blockId: input.blockId } };
        },
        { exists: async () => true },
    );

    await assert.rejects(
        () =>
            service.apply(
                {
                    feature: "extractTasks",
                    summary: "缺失来源",
                    tasks: [{ title: "Prepare launch checklist" }],
                },
                { sourceBlockIds: [sourceBlockId] },
            ),
        /sourceBlockId.*required/,
    );
    await assert.rejects(
        () =>
            service.apply(
                {
                    feature: "extractTasks",
                    summary: "伪造来源",
                    tasks: [{ title: "Publish release notes", sourceBlockId: forgedSourceBlockId }],
                },
                { sourceBlockIds: [sourceBlockId] },
            ),
        /sourceBlockId.*input context/,
    );
    assert.deepEqual(writes, []);
});

test("AI Action 提取强制使用可信上下文中的当前 Project", () => {
    const sourceBlockId = "20260825190015-source8";
    const projectId = "20260825190016-project";
    const otherProjectId = "20260825190017-project";
    const proposal = {
        feature: "extractTasks" as const,
        summary: "Project Action",
        tasks: [{ title: "Prepare release", sourceBlockId, parentId: otherProjectId }],
    };

    // Regression: Project 详情入口的默认归属可被模型返回的其他 parentId 覆盖。
    const result = validateAiProposal(proposal, { sourceBlockIds: [sourceBlockId], defaultProjectId: projectId });
    assert.deepEqual(result.errors, []);
    assert.equal(result.proposal.tasks?.[0].parentId, projectId);
});

test("AI Action 原位转换拒绝同一来源产生多个候选", () => {
    const sourceBlockId = "20260825190018-source9";
    const proposal = {
        feature: "extractTasks" as const,
        summary: "Duplicate originals",
        target: { type: "original" as const },
        tasks: [
            { title: "First Action", sourceBlockId },
            { title: "Second Action", sourceBlockId },
        ],
    };

    // Regression: 原位模式会重复转换同一块并把同一个 Action 报告为多个成功项。
    const result = validateAiProposal(proposal, { sourceBlockIds: [sourceBlockId] });
    assert.ok(result.errors.some((error) => error.includes("unique sourceBlockId")));
});

test("AI Action 提取在批量写入前确认所有来源块仍然存在", async () => {
    const existingSourceId = "20260825190003-source2";
    const deletedSourceId = "20260825190004-deleted";
    const writes: unknown[] = [];
    const service = new AiProposalService(
        {} as any,
        async (input) => {
            writes.push(input);
            return { task: { blockId: "20260825190005-created" } };
        },
        async () => {
            throw new Error("not expected");
        },
        { exists: async (sourceBlockId) => sourceBlockId === existingSourceId },
    );

    await assert.rejects(
        () =>
            service.apply(
                {
                    feature: "extractTasks",
                    summary: "两个来源的提取建议",
                    tasks: [
                        { title: "Prepare launch checklist", sourceBlockId: existingSourceId },
                        { title: "Publish release notes", sourceBlockId: deletedSourceId },
                    ],
                },
                { sourceBlockIds: [existingSourceId, deletedSourceId] },
            ),
        new RegExp(`Source block not found: ${deletedSourceId}`),
    );
    assert.deepEqual(writes, []);
});

test("AI Action 批量提取保留每项来源引用并隔离单项失败", async () => {
    const firstSourceId = "20260825190006-source3";
    const secondSourceId = "20260825190007-source4";
    const createCalls: Array<{ input: unknown; sourceReferenceBlockId?: string }> = [];
    const service = new AiProposalService(
        {} as any,
        async (input, options) => {
            createCalls.push({ input, sourceReferenceBlockId: options?.sourceReferenceBlockId });
            if (input.title === "Rejected candidate") throw new Error("temporary write failure");
            return { task: { blockId: `2026082519000${createCalls.length}-created` } };
        },
        async () => {
            throw new Error("not expected");
        },
        { exists: async () => true },
    );

    const result = await service.apply(
        {
            feature: "extractTasks",
            summary: "批量提取",
            tasks: [
                { title: "First Action", sourceBlockId: firstSourceId },
                { title: "Rejected candidate", sourceBlockId: firstSourceId },
                { title: "Second Action", sourceBlockId: secondSourceId },
            ],
        },
        { sourceBlockIds: [firstSourceId, secondSourceId] },
    );

    assert.deepEqual(
        createCalls.map((call) => call.sourceReferenceBlockId),
        [firstSourceId, firstSourceId, secondSourceId],
    );
    assert.deepEqual(
        result.items.map((item) => ({ index: item.index, status: item.status, retryable: item.retryable })),
        [
            { index: 0, status: "created", retryable: false },
            { index: 1, status: "failed", retryable: true },
            { index: 2, status: "created", retryable: false },
        ],
    );
    assert.match(result.items[1].error || "", /temporary write failure/);
    assert.equal(result.created.length, 2);
});

test("AI Action 批量提取将已创建但依赖写入失败报告为不可直接重试", async () => {
    const sourceBlockId = "20260825190011-source6";
    let createCount = 0;
    const service = new AiProposalService(
        {
            updateTask: async () => {
                throw new Error("dependency update failed");
            },
        } as any,
        async () => {
            createCount++;
            return { task: { blockId: `2026082519001${createCount}-created` } };
        },
        async () => {
            throw new Error("not expected");
        },
        { exists: async () => true },
    );

    const result = await service.apply(
        {
            feature: "extractTasks",
            summary: "有依赖的批量提取",
            tasks: [
                { title: "First Action", sourceBlockId },
                { title: "Dependent Action", sourceBlockId, dependsOnIndexes: [0] },
            ],
        },
        { sourceBlockIds: [sourceBlockId] },
    );

    assert.equal(result.created.length, 2);
    assert.deepEqual(
        result.items.map((item) => ({ status: item.status, retryable: item.retryable })),
        [
            { status: "created", retryable: false },
            { status: "partial", retryable: false },
        ],
    );
    assert.match(result.items[1].error || "", /dependency update failed/);
});

test("AI Action 批量提取在依赖候选创建失败时不创建后继", async () => {
    const sourceBlockId = "20260825190019-sourcea";
    const createTitles: string[] = [];
    const service = new AiProposalService(
        {} as any,
        async (input) => {
            createTitles.push(input.title);
            if (input.title === "First Action") throw new Error("temporary failure");
            return { task: { blockId: "20260825190020-created" } };
        },
        async () => {
            throw new Error("not expected");
        },
        { exists: async () => true },
    );

    // Regression: 前项失败后仍创建后继，重试前项时无法再补上后继的依赖关系。
    const result = await service.apply(
        {
            feature: "extractTasks",
            summary: "Dependency failure",
            tasks: [
                { title: "First Action", sourceBlockId },
                { title: "Dependent Action", sourceBlockId, dependsOnIndexes: [0] },
            ],
        },
        { sourceBlockIds: [sourceBlockId] },
    );

    assert.deepEqual(createTitles, ["First Action"]);
    assert.deepEqual(
        result.items.map((item) => ({ status: item.status, retryable: item.retryable })),
        [
            { status: "failed", retryable: true },
            { status: "failed", retryable: true },
        ],
    );
});

test("AI Action 批量提取不允许脱离已成功前置项直接重试后继", async () => {
    const sourceBlockId = "20260825190021-sourceb";
    const service = new AiProposalService(
        {} as any,
        async (input) => {
            if (input.title === "Dependent Action") throw new Error("temporary failure");
            return { task: { blockId: "20260825190022-created" } };
        },
        async () => {
            throw new Error("not expected");
        },
        { exists: async () => true },
    );

    // Regression: 只重试后继会把已成功前置项从 dependsOnIndexes 中丢掉。
    const result = await service.apply(
        {
            feature: "extractTasks",
            summary: "Dependent retry",
            tasks: [
                { title: "First Action", sourceBlockId },
                { title: "Dependent Action", sourceBlockId, dependsOnIndexes: [0] },
            ],
        },
        { sourceBlockIds: [sourceBlockId] },
    );

    assert.deepEqual(
        result.items.map((item) => ({ status: item.status, retryable: item.retryable })),
        [
            { status: "created", retryable: false },
            { status: "failed", retryable: false },
        ],
    );
});

test("AI Action 批量提取让部分应用前置项的后继继承不可重试语义", async () => {
    const sourceBlockId = "20260825190023-sourcec";
    const service = new AiProposalService(
        {} as any,
        async () => {
            throw new Error("not expected");
        },
        async () => {
            throw new McpToolError("PARTIAL_SUCCESS", "source changed");
        },
        { exists: async () => true },
    );

    // Regression: 前置项已经改写来源时，后继不能脱离它单独重试。
    const result = await service.apply(
        {
            feature: "extractTasks",
            summary: "Partial dependency",
            target: { type: "original" },
            tasks: [
                { title: "First Action", sourceBlockId },
                { title: "Dependent Action", sourceBlockId: "20260825190024-sourced", dependsOnIndexes: [0] },
            ],
        },
        { sourceBlockIds: [sourceBlockId, "20260825190024-sourced"] },
    );

    assert.deepEqual(
        result.items.map((item) => ({ status: item.status, retryable: item.retryable })),
        [
            { status: "partial", retryable: false },
            { status: "failed", retryable: false },
        ],
    );
});

test("AI Action 批量提取不允许多前置后继丢弃已成功依赖后单独重试", async () => {
    const sourceBlockId = "20260825190026-sourcef";
    const service = new AiProposalService(
        {} as any,
        async (input) => {
            if (input.title === "Failed prerequisite") throw new Error("temporary failure");
            return { task: { blockId: "20260825190027-created" } };
        },
        async () => {
            throw new Error("not expected");
        },
        { exists: async () => true },
    );

    // Regression: 后继的一个前置成功、另一个失败时，单独重试会静默丢掉成功前置。
    const result = await service.apply(
        {
            feature: "extractTasks",
            summary: "Multiple dependencies",
            tasks: [
                { title: "Successful prerequisite", sourceBlockId },
                { title: "Failed prerequisite", sourceBlockId },
                { title: "Dependent Action", sourceBlockId, dependsOnIndexes: [0, 1] },
            ],
        },
        { sourceBlockIds: [sourceBlockId] },
    );

    assert.deepEqual(
        result.items.map((item) => ({ status: item.status, retryable: item.retryable })),
        [
            { status: "created", retryable: false },
            { status: "failed", retryable: true },
            { status: "failed", retryable: false },
        ],
    );
});

test("AI Action 原位转换如果底层已部分写入则不允许盲目重试", async () => {
    const sourceBlockId = "20260825190014-source7";
    const service = new AiProposalService(
        {} as any,
        async () => {
            throw new Error("not expected");
        },
        async () => {
            throw new McpToolError("PARTIAL_SUCCESS", "source converted but fields failed");
        },
        { exists: async () => true },
    );

    const result = await service.apply(
        {
            feature: "extractTasks",
            summary: "原位转换",
            target: { type: "original" },
            tasks: [{ title: "Existing Action", sourceBlockId }],
        },
        { sourceBlockIds: [sourceBlockId] },
    );

    assert.deepEqual(
        result.items.map((item) => ({ target: item.target, status: item.status, retryable: item.retryable })),
        [{ target: "original", status: "partial", retryable: false }],
    );
    assert.match(result.items[0].error || "", /source converted but fields failed/);
});

test("AI Action 原位转换使用用户编辑后的标题", async () => {
    const sourceBlockId = "20260825190025-sourcee";
    const convertedInputs: Record<string, unknown>[] = [];
    const service = new AiProposalService(
        {} as any,
        async () => {
            throw new Error("not expected");
        },
        async (input) => {
            convertedInputs.push(input);
            return { task: { blockId: sourceBlockId } };
        },
        { exists: async () => true },
    );

    // Regression: 原位模式忽略确认页编辑后的候选标题。
    await service.apply(
        {
            feature: "extractTasks",
            summary: "Edited original",
            target: { type: "original" },
            tasks: [{ title: "Edited Action", sourceBlockId }],
        },
        { sourceBlockIds: [sourceBlockId] },
    );

    assert.equal(convertedInputs[0]?.cleanTitle, "Edited Action");
});

test("AI Action 提取上下文通过 KernelBridge 与 RPC 契约传入内核", async () => {
    const sourceBlockId = "20260825190010-source5";
    const proposal = {
        feature: "extractTasks" as const,
        summary: "提取候选",
        tasks: [{ title: "Prepare release", sourceBlockId }],
    };
    const context = { sourceBlockIds: [sourceBlockId] };
    const parsed = RPC_CONTRACT.applyAiProposal.parseParams({ proposal, context });
    assert.deepEqual(parsed.context, context);
    assert.equal(parsed.proposal.tasks?.[0].sourceBlockId, sourceBlockId);

    const calls: Array<{ method: string; params: unknown }> = [];
    const bridge = new KernelBridge({
        kernel: {
            state: { code: 2 },
            rpc: {
                call: new Proxy(
                    {},
                    {
                        get: (_target, method: string) => async (params: unknown) => {
                            calls.push({ method, params });
                            return {
                                feature: "extractTasks",
                                created: [],
                                converted: [],
                                myDay: null,
                                warnings: [],
                                items: [],
                            };
                        },
                    },
                ),
                bind: () => {},
                unbind: () => {},
            },
        },
    });

    await bridge.applyAiProposal(proposal, context);
    assert.deepEqual(calls, [{ method: "applyAiProposal", params: { proposal, context } }]);
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
        { exists: async () => true },
    );
    await service.apply(valid.proposal);
    assert.deepEqual(createCalls, [
        { status: "doing", outcome: "用户可完成闭环", dod: "检查通过\n已发布" },
        { actionKind: "stage" },
    ]);

    await service.apply(
        {
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
        },
        { sourceBlockIds: ["20260802120003-existng"] },
    );
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
        { exists: async () => true },
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
        { exists: async () => true },
    );
    await assert.rejects(
        () => service.apply({ feature: "review", summary: "x", review: { summary: "x", groups: [], actions: [] } }),
        /read-only/,
    );
});
