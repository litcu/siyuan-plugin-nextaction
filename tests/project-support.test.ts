import test from "node:test";
import assert from "node:assert/strict";
import {
    ProjectSupportService,
    type ProjectSupportQueryCandidate,
    type ProjectSupportQueryPort,
} from "../src/kernel/project-support-service.ts";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import { CacheManager } from "../src/kernel/cache-manager.ts";
import { Mutex } from "../src/kernel/mutex.ts";
import { registerRpcMethods } from "../src/kernel/rpc-server.ts";
import { TaskRepository } from "../src/kernel/task-repository.ts";
import { TaskService } from "../src/kernel/task-service.ts";
import { setSiyuan } from "../src/kernel/utils.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import { FakeMyDayTaskPort, FakeSiyuanApi, FakeTaskChangePublisher } from "./helpers/fakes.ts";
import type * as kernel from "siyuan/kernel";
import { KernelBridge } from "../src/frontend/kernel-bridge.ts";

const PROJECT_ID = "20260825120000-project";
const FORWARD_BLOCK_ID = "20260825120001-forward";
const FORWARD_DOCUMENT_ID = "20260825120002-forward";
const BACKLINK_BLOCK_ID = "20260825120003-backlin";
const BACKLINK_DOCUMENT_ID = "20260825120004-backlin";

function task(overrides: Partial<TaskCacheEntry> = {}): TaskCacheEntry {
    return {
        blockId: PROJECT_ID,
        identificationSource: "document",
        attrHostId: PROJECT_ID,
        parentId: "",
        status: "doing",
        priority: "none",
        importance: 4,
        effort: 4,
        due: "",
        start: "",
        context: "",
        taskType: "2",
        order: 0,
        childIds: [],
        title: "Project",
        depends: "",
        depMode: "all",
        sequential: false,
        repeat: "",
        repeatState: "",
        sort: 0,
        completed: "",
        note: "",
        outcome: "",
        dod: "",
        actionKind: "",
        created: "",
        tags: "",
        blocked: false,
        blockedReason: "",
        reviewInterval: 0,
        reviewDate: "",
        reminder: "",
        customFields: {},
        ...overrides,
    };
}

function candidate(overrides: Partial<ProjectSupportQueryCandidate> = {}): ProjectSupportQueryCandidate {
    return {
        blockId: FORWARD_BLOCK_ID,
        documentId: FORWARD_DOCUMENT_ID,
        title: "Forward block",
        blockType: "p",
        ...overrides,
    };
}

function queryPort(
    forward: ProjectSupportQueryCandidate[],
    backlinks: ProjectSupportQueryCandidate[],
    projectDocumentExists = true,
): ProjectSupportQueryPort {
    return {
        projectDocumentExists: async () => projectDocumentExists,
        listForwardReferences: async () => forward,
        listDirectBacklinks: async () => backlinks,
    };
}

test("Project Support 合并一层正向引用与直接反向链接并保留来源方向", async () => {
    const service = new ProjectSupportService(
        queryPort(
            [
                candidate(),
                candidate({
                    blockId: FORWARD_DOCUMENT_ID,
                    documentId: FORWARD_DOCUMENT_ID,
                    title: "Forward document",
                    blockType: "d",
                }),
                candidate({ blockId: PROJECT_ID, documentId: PROJECT_ID, title: "Self", blockType: "d" }),
            ],
            [
                candidate({ title: "Forward block seen from backlink" }),
                candidate({
                    blockId: BACKLINK_BLOCK_ID,
                    documentId: BACKLINK_DOCUMENT_ID,
                    title: "Backlink block",
                    blockType: "p",
                }),
                candidate({
                    blockId: "20260825120005-interna",
                    documentId: PROJECT_ID,
                    title: "Internal self backlink",
                }),
            ],
        ),
    );

    const result = await service.load(task());

    assert.equal(result.projectId, PROJECT_ID);
    assert.deepEqual(result.items, [
        {
            blockId: FORWARD_BLOCK_ID,
            documentId: FORWARD_DOCUMENT_ID,
            title: "Forward block",
            kind: "block",
            blockType: "p",
            directions: ["forward", "backlink"],
        },
        {
            blockId: FORWARD_DOCUMENT_ID,
            documentId: FORWARD_DOCUMENT_ID,
            title: "Forward document",
            kind: "document",
            blockType: "d",
            directions: ["forward", "backlink"],
        },
        {
            blockId: BACKLINK_BLOCK_ID,
            documentId: BACKLINK_DOCUMENT_ID,
            title: "Backlink block",
            kind: "block",
            blockType: "p",
            directions: ["backlink"],
        },
    ]);
});

test("Project Support 将文档正文的反向链接汇总为文档级双向关联", async () => {
    const service = new ProjectSupportService(
        queryPort(
            [
                candidate({
                    blockId: FORWARD_DOCUMENT_ID,
                    documentId: FORWARD_DOCUMENT_ID,
                    title: "2026",
                    blockType: "d",
                }),
            ],
            [
                candidate({
                    blockId: BACKLINK_BLOCK_ID,
                    documentId: FORWARD_DOCUMENT_ID,
                    title: "关于测试项目P",
                    blockType: "p",
                }),
            ],
        ),
    );

    // Regression: Project 引用外部文档且该文档正文反向引用 Project 时，文档行曾只显示“项目引用”。
    const result = await service.load(task());

    assert.deepEqual(result.items, [
        {
            blockId: FORWARD_DOCUMENT_ID,
            documentId: FORWARD_DOCUMENT_ID,
            title: "2026",
            kind: "document",
            blockType: "d",
            directions: ["forward", "backlink"],
        },
        {
            blockId: BACKLINK_BLOCK_ID,
            documentId: FORWARD_DOCUMENT_ID,
            title: "关于测试项目P",
            kind: "block",
            blockType: "p",
            directions: ["backlink"],
        },
    ]);
});

test("Project Support 拒绝普通 Task、原生身份和缺失目标", async () => {
    const service = new ProjectSupportService(queryPort([], []));

    await assert.rejects(() => service.load(null), /valid Project document/);
    await assert.rejects(() => service.load(task({ taskType: "1" })), /valid Project document/);
    await assert.rejects(() => service.load(task({ identificationSource: "native" })), /valid Project document/);
    await assert.rejects(
        () => new ProjectSupportService(queryPort([], [], false)).load(task()),
        /valid Project document/,
    );
});

test("Project Support RPC 校验 Project ID 并返回独立按需读取结果", async () => {
    const handlers = new Map<string, (...params: unknown[]) => unknown>();
    setSiyuan({
        rpc: {
            async bind(name: string, handler: (...params: unknown[]) => unknown) {
                handlers.set(name, handler);
            },
        },
        logger: { error: async () => {} },
    } as unknown as kernel.ISiyuan);
    const api = new FakeSiyuanApi();
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const taskService = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    const calls: string[] = [];
    registerRpcMethods(taskService, {
        getProjectSupport: async (projectId) => {
            calls.push(projectId);
            return { projectId, items: [] };
        },
    });

    const invalid = (await handlers.get("getProjectSupport")?.({
        projectId: `siyuan://blocks/${PROJECT_ID}`,
    })) as { _rpcError?: { code: number } };
    assert.equal(invalid._rpcError?.code, -32001);
    assert.deepEqual(calls, []);

    const result = await handlers.get("getProjectSupport")?.({ projectId: PROJECT_ID });
    assert.deepEqual(result, { projectId: PROJECT_ID, items: [] });
    assert.deepEqual(calls, [PROJECT_ID]);
});

test("KernelBridge 通过 Project Support 专用读取方法调用内核", async () => {
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
                            return { projectId: PROJECT_ID, items: [] };
                        },
                    },
                ),
                bind: () => {},
                unbind: () => {},
            },
        },
    });

    assert.deepEqual(await bridge.getProjectSupport(PROJECT_ID), { projectId: PROJECT_ID, items: [] });
    assert.deepEqual(calls, [{ method: "getProjectSupport", params: { projectId: PROJECT_ID } }]);
    await assert.rejects(() => bridge.getProjectSupport(`siyuan://blocks/${PROJECT_ID}`), /raw SiYuan block ID/);
    assert.equal(calls.length, 1);
});
