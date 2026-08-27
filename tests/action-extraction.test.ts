import test from "node:test";
import assert from "node:assert/strict";
import type * as kernel from "siyuan/kernel";
import { ActionExtractionService, SiyuanActionSourcePort } from "../src/kernel/action-extraction-service.ts";
import { CacheManager } from "../src/kernel/cache-manager.ts";
import { registerRpcMethods } from "../src/kernel/rpc-server.ts";
import { Mutex } from "../src/kernel/mutex.ts";
import { TaskCreationService } from "../src/kernel/task-creation-service.ts";
import { TaskRepository } from "../src/kernel/task-repository.ts";
import { TaskService } from "../src/kernel/task-service.ts";
import { TaskTargetResolver } from "../src/kernel/task-target-resolver.ts";
import { setSiyuan } from "../src/kernel/utils.ts";
import { KernelBridge } from "../src/frontend/kernel-bridge.ts";
import { ATTR_DUE, ATTR_KIND, ATTR_PARENT, ATTR_START, ATTR_STATUS } from "../src/shared/constants.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import { FakeMyDayTaskPort, FakeSiyuanApi, FakeTaskChangePublisher, taskFactory } from "./helpers/fakes.ts";

const SOURCE_ID = "20260825180000-source1";
const SOURCE_DOC_ID = "20260825180006-srcdoc1";
const INBOX_ID = "20260825180001-inbox01";
const PROJECT_ID = "20260825180002-project";
const ORDINARY_TASK_ID = "20260825180003-regular";

function createHarness(options: { defaultCreateTarget?: "inbox" | "daily_note"; dailyNoteDocumentId?: string } = {}) {
    const api = new FakeSiyuanApi();
    api.dailyNoteDocumentId = options.dailyNoteDocumentId || "";
    api.addBlock(SOURCE_DOC_ID, "d", "Source notes", "notebook", "/Source notes");
    api.addBlock(SOURCE_ID, "p", "Discuss launch plan", "notebook", "/Notes", {
        markdown: "Discuss launch plan",
        parentId: SOURCE_DOC_ID,
    });
    api.addBlock(INBOX_ID, "d", "Inbox", "notebook", "/Inbox");
    api.addBlock(PROJECT_ID, "d", "Launch Project", "notebook", "/Launch Project");
    api.addBlock(ORDINARY_TASK_ID, "d", "Ordinary task", "notebook", "/Ordinary task");
    api.notebooks.push({ id: "notebook", name: "Notebook" });
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const taskService = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    taskService.setIsReady(true);
    const settings = {
        ...DEFAULT_SETTINGS,
        taskCreationSettings: {
            ...DEFAULT_SETTINGS.taskCreationSettings,
            inboxDocumentId: INBOX_ID,
            dailyNoteNotebookId: "notebook",
            defaultCreateTarget: options.defaultCreateTarget || ("inbox" as const),
        },
    };
    const targets = new TaskTargetResolver(api, () => settings);
    const creation = new TaskCreationService(taskService, api, targets, () => settings);
    const extraction = new ActionExtractionService(taskService, creation, new SiyuanActionSourcePort(api));
    return { api, taskService, extraction, creation };
}

test("从真实笔记块提取归属 Project 的 Stage Action，并保留来源原文与原生引用", async () => {
    const { api, taskService, extraction } = createHarness();
    await taskService.convertToTask(PROJECT_ID, undefined, "2");
    const sourceBefore = structuredClone(api.blocks.get(SOURCE_ID));

    const result = await extraction.extract({
        sourceBlockId: SOURCE_ID,
        title: "Prepare launch checklist",
        status: "todo",
        actionKind: "stage",
        start: "2026-08-26",
        due: "2026-08-30",
        projectId: PROJECT_ID,
    });

    assert.deepEqual(api.blocks.get(SOURCE_ID), sourceBefore);
    assert.equal(result.sourceBlockId, SOURCE_ID);
    assert.equal(result.projectId, PROJECT_ID);
    assert.equal(result.task.title, "Prepare launch checklist");
    assert.equal(result.task.status, "todo");
    assert.equal(result.task.actionKind, "stage");
    assert.equal(result.task.parentId, PROJECT_ID);
    assert.equal(api.blocks.get(result.task.contentBlockId || "")?.content, "Prepare launch checklist");
    const createdBlock = api.blocks.get(result.task.blockId);
    assert.equal(createdBlock?.attrs[ATTR_STATUS], "todo");
    assert.equal(createdBlock?.attrs[ATTR_KIND], "stage");
    assert.equal(createdBlock?.attrs[ATTR_PARENT], PROJECT_ID);
    assert.equal(createdBlock?.attrs[ATTR_START], "2026-08-26");
    assert.equal(createdBlock?.attrs[ATTR_DUE], "2026-08-30");
    const insertion = api.requests.find((request) => request.path === "/api/block/appendBlock");
    assert.match((insertion?.body as { data?: string })?.data || "", new RegExp(`\\(\\(${SOURCE_ID}\\)\\)`));
});

test("从真实笔记块提取未归属 Project 的 Action", async () => {
    const { api, extraction } = createHarness();
    const sourceBefore = structuredClone(api.blocks.get(SOURCE_ID));

    const result = await extraction.extract({
        sourceBlockId: SOURCE_ID,
        title: "Unassigned follow-up",
        status: "inbox",
        actionKind: "action",
    });

    assert.equal(result.projectId, "");
    assert.equal(result.task.parentId, "");
    assert.equal(api.blocks.get(result.task.blockId)?.attrs[ATTR_PARENT], undefined);
    assert.deepEqual(api.blocks.get(SOURCE_ID), sourceBefore);
});

test("提取在来源或 Project 无效时拒绝写入", async () => {
    const { api, taskService, extraction } = createHarness();
    await taskService.convertToTask(ORDINARY_TASK_ID, undefined, "1");

    await assert.rejects(
        () =>
            extraction.extract({
                sourceBlockId: "20260825180004-missing",
                title: "Should not exist",
                status: "todo",
                actionKind: "action",
            }),
        /Source block not found/,
    );
    await assert.rejects(
        () =>
            extraction.extract({
                sourceBlockId: SOURCE_ID,
                title: "Should not exist",
                status: "todo",
                actionKind: "action",
                projectId: ORDINARY_TASK_ID,
            }),
        /Project not found/,
    );

    assert.equal(
        api.requests.some((request) => request.path === "/api/block/appendBlock"),
        false,
    );
});

test("来源文档就是实际写入目标时在写入前拒绝提取", async () => {
    const { api, extraction } = createHarness();
    const sourceBefore = structuredClone(api.blocks.get(INBOX_ID));

    await assert.rejects(
        () =>
            extraction.extract({
                sourceBlockId: INBOX_ID,
                title: "Must not change source document",
                status: "todo",
                actionKind: "action",
            }),
        /source/i,
    );

    assert.deepEqual(api.blocks.get(INBOX_ID), sourceBefore);
    assert.equal(
        api.requests.some((request) => request.path === "/api/block/appendBlock"),
        false,
    );
});

test("来源是写入目标文档内的普通块时允许提取并保持该块不变", async () => {
    const { api, extraction } = createHarness();
    const sourceInInboxId = "20260825180007-inblock";
    api.addBlock(sourceInInboxId, "p", "Source paragraph in Inbox", "notebook", "/Inbox", {
        parentId: INBOX_ID,
    });
    const sourceBefore = structuredClone(api.blocks.get(sourceInInboxId));

    const result = await extraction.extract({
        sourceBlockId: sourceInInboxId,
        title: "Sibling Action",
        status: "todo",
        actionKind: "action",
    });

    assert.ok(result.task.blockId);
    assert.deepEqual(api.blocks.get(sourceInInboxId), sourceBefore);
});

test("来源文档就是当日日记目标时在追加前拒绝提取", async () => {
    const { api, extraction } = createHarness({
        defaultCreateTarget: "daily_note",
        dailyNoteDocumentId: SOURCE_DOC_ID,
    });

    await assert.rejects(
        () =>
            extraction.extract({
                sourceBlockId: SOURCE_DOC_ID,
                title: "Must not append to the source daily note",
                status: "todo",
                actionKind: "action",
            }),
        /source/i,
    );

    assert.equal(
        api.requests.some((request) => request.path === "/api/block/appendDailyNoteBlock"),
        false,
    );
});

test("选择未归属但实际目标会产生结构父级时拒绝并回滚", async () => {
    const { api, taskService, extraction } = createHarness();
    await taskService.convertToTask(INBOX_ID, undefined, "2");
    await taskService.updateTask(INBOX_ID, { [ATTR_STATUS]: "done" });
    const appendCountBefore = api.requestCounts.get("/api/block/appendBlock") || 0;

    await assert.rejects(
        () =>
            extraction.extract({
                sourceBlockId: SOURCE_ID,
                title: "Must stay unassigned",
                status: "todo",
                actionKind: "action",
            }),
        /structural parent/i,
    );

    assert.equal(
        [...api.blocks.values()].some((block) => block.content === "Must stay unassigned"),
        false,
    );
    assert.equal(api.requestCounts.get("/api/block/appendBlock") || 0, appendCountBefore);
    assert.equal(taskService.getTask(INBOX_ID)?.status, "done");
});

test("显式选择 Project 时不会通过不同的物理 Project 目标创建或重开它", async () => {
    const { api, taskService, extraction } = createHarness();
    await taskService.convertToTask(INBOX_ID, undefined, "2");
    await taskService.convertToTask(PROJECT_ID, undefined, "2");
    await taskService.updateTask(INBOX_ID, { [ATTR_STATUS]: "done" });
    const appendCountBefore = api.requestCounts.get("/api/block/appendBlock") || 0;

    await assert.rejects(
        () =>
            extraction.extract({
                sourceBlockId: SOURCE_ID,
                title: "Must use the selected Project",
                status: "todo",
                actionKind: "action",
                projectId: PROJECT_ID,
            }),
        /target/i,
    );

    assert.equal(api.requestCounts.get("/api/block/appendBlock") || 0, appendCountBefore);
    assert.equal(taskService.getTask(INBOX_ID)?.status, "done");
});

test("提取写入失败时来源块保持不变", async () => {
    const { api, extraction } = createHarness();
    const sourceBefore = structuredClone(api.blocks.get(SOURCE_ID));

    await assert.rejects(
        () =>
            extraction.extract({
                sourceBlockId: SOURCE_ID,
                title: "Invalid dates",
                status: "todo",
                actionKind: "action",
                start: "2026-08-30",
                due: "2026-08-26",
            }),
        /Due date must not be earlier than start date/,
    );

    assert.deepEqual(api.blocks.get(SOURCE_ID), sourceBefore);
    assert.equal(
        [...api.blocks.values()].some((block) => block.content === "Invalid dates"),
        false,
    );
    assert.equal(
        api.requests.some((request) => request.path === "/api/block/deleteBlock"),
        true,
    );
});

test("Project 在预检后失效时由统一父关系校验拒绝并完整回滚", async () => {
    const harness = createHarness();
    await harness.taskService.convertToTask(PROJECT_ID, undefined, "2");
    const sourceBefore = structuredClone(harness.api.blocks.get(SOURCE_ID));
    const creationWithProjectRace = {
        create: async (...args: Parameters<TaskCreationService["create"]>) => {
            await harness.taskService.removeTask(PROJECT_ID);
            return harness.creation.create(...args);
        },
    } as TaskCreationService;
    const extraction = new ActionExtractionService(
        harness.taskService,
        creationWithProjectRace,
        new SiyuanActionSourcePort(harness.api),
    );

    await assert.rejects(
        () =>
            extraction.extract({
                sourceBlockId: SOURCE_ID,
                title: "Rejected parent relationship",
                status: "todo",
                actionKind: "action",
                projectId: PROJECT_ID,
            }),
        /Parent task not found/,
    );

    assert.deepEqual(harness.api.blocks.get(SOURCE_ID), sourceBefore);
    assert.equal(
        [...harness.api.blocks.values()].some((block) => block.content === "Rejected parent relationship"),
        false,
    );
    assert.equal(
        harness.api.requests.some((request) => request.path === "/api/block/deleteBlock"),
        true,
    );
});

test("extractAction RPC 校验真实块 ID 并调用专用应用入口", async () => {
    const handlers = new Map<string, (...params: unknown[]) => unknown>();
    setSiyuan({
        rpc: {
            async bind(name: string, handler: (...params: unknown[]) => unknown) {
                handlers.set(name, handler);
            },
        },
        logger: { error: async () => {} },
    } as unknown as kernel.ISiyuan);
    const { taskService } = createHarness();
    const calls: unknown[] = [];
    registerRpcMethods(taskService, {
        extractAction: async (input) => {
            calls.push(input);
            return {
                task: taskFactory("20260825180005-created", { parentId: PROJECT_ID }),
                sourceBlockId: input.sourceBlockId,
                projectId: input.projectId || "",
            };
        },
    });

    const invalid = (await handlers.get("extractAction")?.({
        sourceBlockId: `siyuan://blocks/${SOURCE_ID}`,
        title: "Prepare launch checklist",
        status: "todo",
        actionKind: "action",
    })) as { _rpcError?: { code: number } };
    assert.equal(invalid._rpcError?.code, -32001);
    assert.deepEqual(calls, []);

    const input = {
        sourceBlockId: SOURCE_ID,
        title: "Prepare launch checklist",
        status: "todo",
        actionKind: "action" as const,
        projectId: PROJECT_ID,
    };
    const result = (await handlers.get("extractAction")?.(input)) as { sourceBlockId?: string; projectId?: string };
    assert.equal(result.sourceBlockId, SOURCE_ID);
    assert.equal(result.projectId, PROJECT_ID);
    assert.deepEqual(calls, [input]);
});

test("KernelBridge 通过 extractAction 专用写入方法调用内核", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const expected = {
        task: taskFactory("20260825180005-created"),
        sourceBlockId: SOURCE_ID,
        projectId: "",
    };
    const bridge = new KernelBridge({
        kernel: {
            state: { code: 2 },
            rpc: {
                call: new Proxy(
                    {},
                    {
                        get: (_target, method: string) => async (params: unknown) => {
                            calls.push({ method, params });
                            return expected;
                        },
                    },
                ),
                bind: () => {},
                unbind: () => {},
            },
        },
    });
    const input = {
        sourceBlockId: SOURCE_ID,
        title: "Prepare launch checklist",
        status: "todo",
        actionKind: "action" as const,
    };

    assert.deepEqual(await bridge.extractAction(input), expected);
    assert.deepEqual(calls, [{ method: "extractAction", params: input }]);
    await assert.rejects(
        () => bridge.extractAction({ ...input, sourceBlockId: `siyuan://blocks/${SOURCE_ID}` }),
        /raw SiYuan block ID/,
    );
    assert.equal(calls.length, 1);
});
