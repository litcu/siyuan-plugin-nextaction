import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CacheManager } from "../src/kernel/cache-manager.ts";
import { Mutex } from "../src/kernel/mutex.ts";
import { TaskRepository } from "../src/kernel/task-repository.ts";
import { TaskService } from "../src/kernel/task-service.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import {
    ATTR_PARENT,
    ATTR_STATUS,
    ATTR_TASK,
    RPC_ERROR_INVALID_PARAMS,
    RPC_ERROR_PROJECT_REQUIRES_DOCUMENT,
} from "../src/shared/constants.ts";
import { FakeMyDayTaskPort, FakeSiyuanApi, FakeTaskChangePublisher } from "./helpers/fakes.ts";

const frontendSource = readFileSync(
    new URL("../src/frontend/controllers/task-command-controller.ts", import.meta.url),
    "utf8",
);
const constantsSource = readFileSync(new URL("../src/shared/constants.ts", import.meta.url), "utf8");

function serviceFor(api: FakeSiyuanApi): TaskService {
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    return service;
}

function hasCode(code: number): (error: unknown) => boolean {
    return (error) => error instanceof Error && (error as Error & { code?: number }).code === code;
}

test("单块转换校验项目必须是文档", async () => {
    const api = new FakeSiyuanApi();
    const paragraphId = "20260823160000-paragra";
    api.addBlock(paragraphId, "p", "Paragraph");
    await assert.rejects(
        serviceFor(api).convertToTask(paragraphId, undefined, "2"),
        hasCode(RPC_ERROR_PROJECT_REQUIRES_DOCUMENT),
    );
});

test("属性更新和带子树入口都不能绕过项目类型校验", async () => {
    const api = new FakeSiyuanApi();
    const itemId = "20260823160001-taskitm";
    const textId = "20260823160002-tasktxt";
    api.addBlock(itemId, "i", "Task", "notebook", "/Task", { subtype: "t", markdown: "- [ ] Task" });
    api.addBlock(textId, "p", "Task", "notebook", "/Task", { parentId: itemId });
    const service = serviceFor(api);
    await service.convertToTask(itemId);

    await assert.rejects(
        service.updateTask(itemId, { [ATTR_TASK]: "2" }),
        hasCode(RPC_ERROR_PROJECT_REQUIRES_DOCUMENT),
    );
    await assert.rejects(
        service.convertToTaskWithChildren(itemId, undefined, "2"),
        hasCode(RPC_ERROR_PROJECT_REQUIRES_DOCUMENT),
    );
});

test("带既有父关系的文档不能直接转换为 Project", async () => {
    // Regression: project conversion used to preserve an existing custom-na-parent and create Project children.
    const api = new FakeSiyuanApi();
    const parentId = "20260823160009-parentx";
    const projectId = "20260823160010-project";
    api.addBlock(parentId, "d", "Parent task");
    const project = api.addBlock(projectId, "d", "Project candidate");
    const service = serviceFor(api);
    await service.convertToTask(parentId, undefined, "1");
    project.attrs[ATTR_PARENT] = parentId;

    await assert.rejects(service.convertToTask(projectId, undefined, "2"), hasCode(RPC_ERROR_INVALID_PARAMS));
});

test("任务目标允许文档和两种原生结构，普通段落通过转换进入原生模型", async () => {
    const api = new FakeSiyuanApi();
    const documentId = "20260823160003-doctask";
    const listId = "20260823160004-tasklst";
    const itemId = "20260823160005-taskitm";
    const textId = "20260823160006-tasktxt";
    const paragraphId = "20260823160007-paragra";
    api.addBlock(documentId, "d", "Document");
    api.addBlock(listId, "l", "", "notebook", "/Document", { parentId: documentId, subtype: "t" });
    api.addBlock(itemId, "i", "Native", "notebook", "/Document", {
        parentId: listId,
        subtype: "u",
        markdown: "- [ ] Native",
    });
    api.addBlock(textId, "p", "Native", "notebook", "/Document", { parentId: itemId });
    api.addBlock(paragraphId, "p", "Paragraph", "notebook", "/Document", { parentId: documentId });
    const service = serviceFor(api);

    assert.equal((await service.convertToTask(documentId)).identificationSource, "document");
    assert.equal((await service.convertToTask(itemId)).blockId, itemId);
    const converted = await service.convertToTask(paragraphId);
    assert.equal(converted.identificationSource, "native");
    assert.notEqual(converted.blockId, paragraphId);
});

test("缓存尚未同步时，已有文档任务属性仍可更新", async () => {
    const api = new FakeSiyuanApi();
    const documentId = "20260823160008-uncachd";
    const document = api.addBlock(documentId, "d", "Document task");
    document.attrs[ATTR_TASK] = "1";
    document.attrs[ATTR_STATUS] = "todo";
    const updated = await serviceFor(api).updateTask(documentId, { [ATTR_STATUS]: "doing" });
    assert.equal(updated.blockId, documentId);
    assert.equal(updated.identificationSource, "document");
    assert.equal(updated.status, "doing");
});

test("内核错误码覆盖项目校验且前端不再保留直连回退", () => {
    assert.match(constantsSource, /RPC_ERROR_PROJECT_REQUIRES_DOCUMENT = -32009/);
    assert.doesNotMatch(frontendSource, /\/api\/attr\//);
    assert.doesNotMatch(frontendSource, /\/api\/query\/sql/);
    assert.match(frontendSource, /return this\.getBridge\(\)\.convertToTask\(blockId, cleanTitle, taskType\)/);
});
