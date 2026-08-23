import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { CacheManager } from "../src/kernel/cache-manager.ts";
import { Mutex } from "../src/kernel/mutex.ts";
import { TaskRepository } from "../src/kernel/task-repository.ts";
import { TaskService } from "../src/kernel/task-service.ts";
import { TaskCreationService } from "../src/kernel/task-creation-service.ts";
import { TaskTargetResolver } from "../src/kernel/task-target-resolver.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import { ATTR_PARENT, ATTR_STATUS, ATTR_TASK, RPC_ERROR_PROJECT_REQUIRES_DOCUMENT } from "../src/shared/constants.ts";
import { FakeMyDayTaskPort, FakeSiyuanApi, FakeTaskChangePublisher, taskFactory } from "./helpers/fakes.ts";

const TASK_ID = "20260818120000-taskitm";
const TEXT_ID = "20260818120001-tasktxt";

function setupNativeTask(markdown = "- [ ] Native task") {
    const api = new FakeSiyuanApi();
    api.addBlock(TASK_ID, "i", "Native task", "notebook", "/Native", { subtype: "t", markdown });
    api.addBlock(TEXT_ID, "p", "Native task", "notebook", "/Native", { parentId: TASK_ID });
    const cache = new CacheManager(api);
    cache.set(
        taskFactory(TASK_ID, {
            identificationSource: "native",
            attrHostId: TASK_ID,
            contentBlockId: TEXT_ID,
            status: markdown.includes("[ ]") ? "inbox" : "done",
        }),
    );
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    return { api, cache, service };
}

test("缓存双路发现文档任务与无属性原生任务", async () => {
    // Regression: native task list items must not depend on custom-na-task to enter the cache.
    const statements: string[] = [];
    let page = 0;
    const api = {
        query: async (statement: string) => {
            statements.push(statement);
            if (page++ > 0) return [];
            return [
                {
                    id: "20260818110000-project",
                    parent_id: "",
                    content_block_id: "",
                    title_content: "Project",
                    markdown: "",
                    structural_parent_id: "",
                    source: "document",
                    sort: 0,
                    updated: "20260818110000",
                },
                {
                    id: "20260818110001-nativea",
                    parent_id: "20260818110010-listaaa",
                    content_block_id: "20260818110002-textaaa",
                    title_content: "Unchecked",
                    markdown: "* [ ] Unchecked",
                    structural_parent_id: "",
                    source: "native",
                    sort: 20,
                    updated: "20260818110001",
                },
                {
                    id: "20260818110003-nativeb",
                    parent_id: "20260818110011-listbbb",
                    content_block_id: "20260818110004-textbbb",
                    title_content: "Checked",
                    markdown: "* [X] Checked",
                    structural_parent_id: "20260818110001-nativea",
                    source: "native",
                    sort: 30,
                    updated: "20260818110003",
                },
            ];
        },
        log: () => {},
    } as unknown as FakeSiyuanApi;
    const cache = new CacheManager(api);
    await cache.loadAll(async () => ({
        "20260818110000-project": { [ATTR_TASK]: "2", [ATTR_STATUS]: "todo" },
        "20260818110001-nativea": {},
        "20260818110003-nativeb": {},
    }));

    assert.equal(cache.get("20260818110000-project")?.identificationSource, "document");
    assert.equal(cache.get("20260818110001-nativea")?.status, "inbox");
    assert.equal(cache.get("20260818110003-nativeb")?.status, "done");
    assert.equal(cache.get("20260818110003-nativeb")?.parentId, "20260818110001-nativea");
    assert.equal(cache.get("20260818110001-nativea")?.contentBlockId, "20260818110002-textaaa");
    assert.match(statements[0], /b\.type = 'd'/);
    assert.match(statements[0], /task\.type = 'i'/);
    assert.match(statements[0], /task\.subtype = 't'/);
    assert.match(statements[0], /task_list\.subtype = 't'/);
});

test("缓存识别跨普通列表容器嵌套的原生子任务", async () => {
    // Regression: 普通段落和无序列表夹在两个任务之间时，孙任务曾被错误识别为根任务。
    const db = new DatabaseSync(":memory:");
    db.exec(`
        CREATE TABLE blocks (
            id TEXT PRIMARY KEY,
            parent_id TEXT NOT NULL,
            type TEXT NOT NULL,
            subtype TEXT NOT NULL,
            content TEXT NOT NULL,
            markdown TEXT NOT NULL,
            sort INTEGER NOT NULL,
            updated TEXT NOT NULL
        );
        CREATE TABLE attributes (
            block_id TEXT NOT NULL,
            name TEXT NOT NULL,
            value TEXT
        );
    `);
    const insert = db.prepare(
        "INSERT INTO blocks (id, parent_id, type, subtype, content, markdown, sort, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const outsideTaskId = "20260823130000-hiddenx";
    const documentId = "20260823130001-docroot";
    const parentTaskId = "20260823130653-ph774ex";
    const childTaskId = "20260823130705-swrypcg";
    const rows = [
        [outsideTaskId, "", "i", "t", "Outside", "- [ ] Outside", 0, "0"],
        [documentId, outsideTaskId, "d", "", "Document", "Document", 1, "1"],
        ["20260823130650-ify71an", documentId, "l", "t", "", "", 2, "2"],
        [parentTaskId, "20260823130650-ify71an", "i", "t", "Parent", "- [ ] Parent", 3, "3"],
        ["20260823130653-parentp", parentTaskId, "p", "", "Parent", "Parent", 4, "4"],
        ["20260823130659-l9lds9z", parentTaskId, "l", "u", "", "", 5, "5"],
        ["20260823130704-mkdueow", "20260823130659-l9lds9z", "i", "u", "Container", "- Container", 6, "6"],
        ["20260823130704-contain", "20260823130704-mkdueow", "p", "", "Container", "Container", 7, "7"],
        ["20260823130706-wufqpsz", "20260823130704-mkdueow", "l", "t", "", "", 8, "8"],
        [childTaskId, "20260823130706-wufqpsz", "i", "t", "Child", "- [ ] Child", 9, "9"],
        ["20260823130705-childpp", childTaskId, "p", "", "Child", "Child", 10, "10"],
    ] as const;
    for (const row of rows) insert.run(...row);

    const api = {
        query: async <T>(statement: string) => db.prepare(statement).all() as T[],
        log: () => {},
    } as unknown as FakeSiyuanApi;
    const cache = new CacheManager(api);

    try {
        await cache.loadAll(async () => ({}));
        assert.equal(cache.get(parentTaskId)?.parentId, "");
        assert.equal(cache.get(childTaskId)?.parentId, parentTaskId);
    } finally {
        db.close();
    }
});

test("普通任务创建返回 NodeListItem ID 并把默认属性写在列表项", async () => {
    // Regression: all creation callers must share the native task-list insertion path.
    const api = new FakeSiyuanApi();
    const documentId = "20260818115000-targetd";
    api.addBlock(documentId, "d", "Inbox", "notebook", "/Inbox");
    api.notebooks.push({ id: "notebook", name: "Notebook" });
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    const settings = {
        ...DEFAULT_SETTINGS,
        taskCreationSettings: {
            ...DEFAULT_SETTINGS.taskCreationSettings,
            inboxDocumentId: documentId,
        },
    };
    const targets = new TaskTargetResolver(api, () => settings);
    const creation = new TaskCreationService(service, api, targets, () => settings);

    const outcome = await creation.create({
        title: "Created natively",
        destination: { type: "document", format: "paragraph", documentId },
    });

    assert.equal(outcome.task.identificationSource, "native");
    assert.equal(api.blocks.get(outcome.task.blockId)?.type, "i");
    assert.equal(api.blocks.get(outcome.task.blockId)?.subtype, "t");
    assert.ok(outcome.task.contentBlockId);
    assert.equal(api.blocks.get(outcome.task.blockId)?.attrs[ATTR_STATUS], "inbox");
    assert.equal(api.blocks.get(outcome.task.blockId)?.attrs[ATTR_TASK], undefined);
    assert.match(
        String(
            api.requests.find((request) => request.path === "/api/block/appendBlock")?.body &&
                (api.requests.find((request) => request.path === "/api/block/appendBlock")!.body as { data: string })
                    .data,
        ),
        /^- \[ \] Created natively$/,
    );
});

test("文档任务和文档项目继续使用 custom-na-task 且保持原块 ID", async () => {
    // Regression: native-task convergence must not change document task/project identity.
    const api = new FakeSiyuanApi();
    const documentId = "20260818115500-doctask";
    api.addBlock(documentId, "d", "Document task");
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);

    const task = await service.convertToTask(documentId, undefined, "1");
    assert.equal(task.blockId, documentId);
    assert.equal(task.identificationSource, "document");
    assert.equal(api.blocks.get(documentId)?.attrs[ATTR_TASK], "1");

    const project = await service.convertToTask(documentId, undefined, "2");
    assert.equal(project.blockId, documentId);
    assert.equal(project.taskType, "2");
    assert.equal(api.blocks.get(documentId)?.attrs[ATTR_TASK], "2");
});

test("段落和标题转换为原生任务，递归转换跳过已有原生任务", async () => {
    // Regression: legacy paragraph/heading identities must be replaced by native task items.
    const api = new FakeSiyuanApi();
    const rootId = "20260818116000-rootdoc";
    const paragraphId = "20260818116001-paragra";
    const headingId = "20260818116002-heading";
    const nativeId = "20260818116003-nativei";
    const nativeTextId = "20260818116004-nativet";
    api.addBlock(rootId, "d", "Document");
    api.addBlock(paragraphId, "p", "Paragraph", "notebook", "/Document", { parentId: rootId });
    api.addBlock(headingId, "h", "Heading", "notebook", "/Document", { parentId: rootId });
    api.addBlock(nativeId, "i", "Existing", "notebook", "/Document", {
        subtype: "t",
        parentId: rootId,
        markdown: "- [ ] Existing",
    });
    api.addBlock(nativeTextId, "p", "Existing", "notebook", "/Document", { parentId: nativeId });
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);

    const result = await service.convertToTaskWithChildren(rootId);
    assert.deepEqual(result, { converted: 2, skipped: 1 });
    assert.equal(api.blocks.get(paragraphId)?.type, "l");
    assert.equal(api.blocks.get(headingId)?.type, "l");
    assert.equal(api.blocks.get(nativeId)?.subtype, "t");
    assert.equal(cache.get(nativeId), undefined);
    assert.equal(cache.getAll().filter((task) => task.identificationSource === "native").length, 2);

    await assert.rejects(service.convertToTask(paragraphId, undefined, "2"), /errProjectRequiresDocument/);
});

test("已有原生任务再次转换保持 ID 并补齐缺失属性", async () => {
    // Regression: convert-to-task on a native task is a no-op, not a nested task conversion.
    const { api, service } = setupNativeTask("- [X] Existing task");
    const result = await service.convertToTask(TASK_ID);
    assert.equal(result.blockId, TASK_ID);
    assert.equal(result.status, "done");
    assert.equal(api.blocks.get(TASK_ID)?.attrs[ATTR_STATUS], "done");
    assert.equal(api.blocks.get(TASK_ID)?.attrs[ATTR_TASK], undefined);
});

test("原生任务不能更新为项目", async () => {
    // Regression: projects remain document-only even when the native task is already cached.
    const { service } = setupNativeTask();
    await assert.rejects(service.updateTask(TASK_ID, { [ATTR_TASK]: "2" }), (error: unknown) => {
        return (
            error instanceof Error && (error as Error & { code?: number }).code === RPC_ERROR_PROJECT_REQUIRES_DOCUMENT
        );
    });
});

test("六态业务状态投影为原生任务二态 marker", async () => {
    // Regression: editor status changes must keep custom-na-status and the native marker consistent.
    const { api, service } = setupNativeTask();
    for (const status of ["inbox", "todo", "doing", "waiting", "someday", "done"]) {
        const updated = await service.updateTask(TASK_ID, { [ATTR_STATUS]: status });
        assert.equal(updated.status, status);
        assert.equal(/\[X\]/.test(api.blocks.get(TASK_ID)!.markdown), status === "done");
        assert.equal(api.blocks.get(TASK_ID)?.attrs[ATTR_TASK], undefined);
    }
});

test("无属性原生任务首次加入 My Day 时持久化默认业务属性", async () => {
    // Regression: non-attribute actions must still cross the first-modification persistence boundary.
    const { api, service } = setupNativeTask();
    await service.addTaskToMyDay(TASK_ID);
    assert.equal(api.blocks.get(TASK_ID)?.attrs[ATTR_STATUS], "inbox");
    assert.ok(api.blocks.get(TASK_ID)?.attrs["custom-na-created"]);
    assert.equal(api.blocks.get(TASK_ID)?.attrs[ATTR_TASK], undefined);
});

test("marker 写入失败时不写任务属性", async () => {
    // Regression: a failed native marker write must stop before attribute persistence.
    const { api, service } = setupNativeTask();
    api.failPaths.add("/api/block/updateTaskListItemMarker");
    await assert.rejects(service.updateTask(TASK_ID, { [ATTR_STATUS]: "done" }));
    assert.equal(api.blocks.get(TASK_ID)?.attrs[ATTR_STATUS], undefined);
    assert.match(api.blocks.get(TASK_ID)!.markdown, /\[ \]/);
});

test("属性写入失败时回滚原生 marker", async () => {
    // Regression: a successful marker projection must be undone if custom-na attrs fail.
    const { api, cache, service } = setupNativeTask();
    api.failPaths.add("/api/attr/setBlockAttrs");
    await assert.rejects(service.updateTask(TASK_ID, { [ATTR_STATUS]: "done" }));
    assert.match(api.blocks.get(TASK_ID)!.markdown, /\[ \]/);
    assert.equal(cache.get(TASK_ID)?.status, "inbox");
});

test("属性已落盘但权威回读失败时同时回滚属性与 marker", async () => {
    // Regression: getBlockAttrs failure after setBlockAttrs must not leave a split native state.
    const { api, service } = setupNativeTask();
    api.failAtRequest.set("/api/attr/getBlockAttrs", 3);
    await assert.rejects(service.updateTask(TASK_ID, { [ATTR_STATUS]: "done" }));
    assert.equal(api.blocks.get(TASK_ID)?.attrs[ATTR_STATUS], "");
    assert.match(api.blocks.get(TASK_ID)!.markdown, /\[ \]/);
});

test("原生任务标题只更新直接文本子块，移除后保留内容并转普通列表项", async () => {
    // Regression: renaming or removing a native task must not replace the whole list-item subtree.
    const { api, cache, service } = setupNativeTask();
    const nestedListId = "20260818120002-nestedl";
    api.addBlock(nestedListId, "l", "", "notebook", "/Native", { parentId: TASK_ID, subtype: "u" });
    const renamed = await service.updateTaskTitle(TASK_ID, "Renamed task");
    assert.equal(renamed.title, "Renamed task");
    assert.equal(api.blocks.get(TEXT_ID)?.content, "Renamed task");
    assert.equal(api.blocks.get(nestedListId)?.parentId, TASK_ID);

    await service.removeTask(TASK_ID);
    assert.equal(api.blocks.get(TASK_ID)?.subtype, "u");
    assert.equal(api.blocks.get(TEXT_ID)?.content, "Renamed task");
    assert.equal(api.blocks.get(nestedListId)?.parentId, TASK_ID);
    assert.equal(cache.get(TASK_ID), undefined);
});

test("属性父关系覆盖原生嵌套结构提示", async () => {
    // Regression: structural nesting is only an initial hint and must not replace custom-na-parent.
    let page = 0;
    const explicitParent = "20260818130000-explicit";
    const api = {
        query: async () => {
            if (page++ > 0) return [];
            return [
                {
                    id: TASK_ID,
                    parent_id: "20260818130001-listaaa",
                    content_block_id: TEXT_ID,
                    title_content: "Native task",
                    markdown: "- [ ] Native task",
                    structural_parent_id: "20260818130002-structu",
                    source: "native",
                    sort: 10,
                    updated: "20260818130003",
                },
            ];
        },
        log: () => {},
    } as unknown as FakeSiyuanApi;
    const cache = new CacheManager(api);
    await cache.loadAll(async () => ({ [TASK_ID]: { [ATTR_PARENT]: explicitParent } }));
    assert.equal(cache.get(TASK_ID)?.parentId, explicitParent);
});
