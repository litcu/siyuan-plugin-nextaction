import test from "node:test";
import assert from "node:assert/strict";
import { CacheManager } from "../src/kernel/cache-manager.ts";
import { Mutex } from "../src/kernel/mutex.ts";
import { TaskService } from "../src/kernel/task-service.ts";
import { TaskRepository } from "../src/kernel/task-repository.ts";
import { SyncEngine } from "../src/kernel/sync-engine.ts";
import {
    ATTR_DOD,
    ATTR_DUE,
    ATTR_KIND,
    ATTR_NOTE,
    ATTR_OUTCOME,
    ATTR_PARENT,
    ATTR_PRIORITY,
    ATTR_REPEAT,
    ATTR_REPEAT_STATE,
    ATTR_REVIEW_DATE,
    ATTR_REVIEW_INTERVAL,
    ATTR_STATUS,
    ATTR_SORT,
    ATTR_TASK,
    RPC_ERROR_CIRCULAR_REF,
    RPC_ERROR_INVALID_PARAMS,
    RPC_ERROR_TASK_NOT_FOUND,
    RPC_ERROR_TIMEOUT,
} from "../src/shared/constants.ts";
import { FakeMyDayTaskPort, FakeSiyuanApi, FakeTaskChangePublisher, taskFactory } from "./helpers/fakes.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import { isMyDayEntryDone } from "../src/shared/my-day.ts";
import { McpToolError } from "../src/kernel/mcp-tool-error.ts";

const ID = "20260816123456-abcdefg";
const OTHER_ID = "20260816123457-hijklmn";

function setup() {
    const api = new FakeSiyuanApi();
    api.addBlock(ID, "p", "Write tests");
    const cache = new CacheManager(api);
    const publisher = new FakeTaskChangePublisher();
    const repository = new TaskRepository(api, cache, new Mutex(), publisher, DEFAULT_SETTINGS);
    const myDay = new FakeMyDayTaskPort();
    const service = new TaskService(cache, repository, myDay, api);
    service.setIsReady(true);
    return { api, cache, myDay, publisher, service };
}

class DiscoveryFakeSiyuanApi extends FakeSiyuanApi {
    override async query<T = Record<string, unknown>>(statement: string): Promise<T[]> {
        if (/WITH RECURSIVE native_tasks/i.test(statement)) {
            const cursor = statement.match(/task\.id > '([^']*)'/)?.[1] || "";
            return [...this.blocks.values()]
                .filter((block) => block.type === "d" && Boolean(block.attrs[ATTR_TASK]) && block.id > cursor)
                .sort((left, right) => left.id.localeCompare(right.id))
                .map((block) => ({
                    id: block.id,
                    parent_id: block.parentId,
                    content_block_id: "",
                    title_content: block.content,
                    markdown: block.markdown,
                    structural_parent_id: "",
                    source: "document",
                    sort: 0,
                    updated: "",
                })) as T[];
        }
        return super.query<T>(statement);
    }
}

test("转换、更新和移除均以权威属性回读驱动缓存与变更发布", async () => {
    const { api, cache, publisher, service } = setup();
    const created = await service.convertToTask(ID, "Write tests");
    const taskId = created.blockId;
    assert.notEqual(taskId, ID);
    assert.equal(api.blocks.get(taskId)?.type, "i");
    assert.equal(api.blocks.get(taskId)?.subtype, "t");
    assert.equal(api.blocks.get(taskId)?.attrs[ATTR_TASK], undefined);
    assert.equal(created.status, "inbox");
    assert.equal(created.identificationSource, "native");
    assert.ok(created.contentBlockId);
    assert.equal(cache.get(taskId)?.title, "Write tests");
    assert.equal(publisher.changes[publisher.changes.length - 1], taskId);

    const updated = await service.updateTask(taskId, { [ATTR_STATUS]: "todo", [ATTR_PRIORITY]: "high" });
    assert.equal(updated.status, "todo");
    assert.equal(updated.priority, "high");
    assert.deepEqual(service.getTask(taskId), updated);
    assert.equal(
        service.getNextActions().some((task) => task.blockId === taskId),
        true,
    );

    await service.removeTask(taskId);
    assert.equal(api.blocks.get(taskId)?.subtype, "u");
    assert.equal(api.blocks.get(taskId)?.attrs[ATTR_STATUS], "");
    assert.equal(cache.get(taskId), undefined);
    assert.equal(publisher.changes[publisher.changes.length - 1], taskId);
});

test("Outcome、DoD 与 Stage 通过权威属性回读进入缓存并支持清空", async () => {
    // Regression: project-control fields previously had no authoritative cache or broadcast data path.
    const { api, cache, publisher, service } = setup();
    const projectId = "20260816120010-project";
    const projectBlock = api.addBlock(projectId, "d", "Ship project");
    Object.assign(projectBlock.attrs, { [ATTR_TASK]: "2", [ATTR_STATUS]: "doing" });
    cache.set(taskFactory(projectId, { taskType: "2" }));

    const project = await service.updateTask(projectId, {
        [ATTR_OUTCOME]: "Users can complete the workflow",
        [ATTR_DOD]: "Tests pass\nRelease is deployed",
    });

    assert.equal(project.outcome, "Users can complete the workflow");
    assert.equal(project.dod, "Tests pass\nRelease is deployed");
    assert.equal(projectBlock.attrs[ATTR_OUTCOME], project.outcome);
    assert.equal(projectBlock.attrs[ATTR_DOD], project.dod);
    assert.equal(cache.get(projectId)?.outcome, project.outcome);
    assert.equal(publisher.changes[publisher.changes.length - 1], projectId);

    const taskId = (await service.convertToTask(ID, "Write tests")).blockId;
    assert.equal(api.blocks.get(taskId)?.attrs[ATTR_KIND], "action");
    const stage = await service.updateTask(taskId, { [ATTR_KIND]: "stage" });
    assert.equal(stage.actionKind, "stage");
    assert.equal(cache.get(taskId)?.actionKind, "stage");

    const cleared = await service.updateTask(projectId, { [ATTR_OUTCOME]: "", [ATTR_DOD]: "" });
    assert.equal(cleared.outcome, "");
    assert.equal(cleared.dod, "");
});

test("项目控制字段校验拒绝多行 Outcome、非法 Stage 类型和 Project 上的 kind", async () => {
    // Regression: raw attribute callers must not bypass the Project/Action field contract.
    const { api, cache, service } = setup();
    const projectId = "20260816120011-project";
    const projectBlock = api.addBlock(projectId, "d", "Ship project");
    Object.assign(projectBlock.attrs, { [ATTR_TASK]: "2", [ATTR_STATUS]: "doing" });
    cache.set(taskFactory(projectId, { taskType: "2" }));
    const taskId = (await service.convertToTask(ID, "Write tests")).blockId;

    await assert.rejects(service.updateTask(projectId, { [ATTR_OUTCOME]: "line one\nline two" }), /single-line/);
    await assert.rejects(service.updateTask(taskId, { [ATTR_KIND]: "milestone" }), /action or stage/);
    await assert.rejects(service.updateTask(projectId, { [ATTR_KIND]: "stage" }), /ordinary Action/);
});

test("非法内部 URI 在 SQL、属性写入和缓存变化前失败", async () => {
    const { api, cache, service } = setup();
    await assert.rejects(service.convertToTask(`siyuan://blocks/${ID}`), (error: unknown) => {
        return error instanceof Error && (error as Error & { code?: number }).code === -32001;
    });
    assert.equal(api.requests.length, 0);
    assert.equal(cache.size(), 0);
});

test("内部 parent、after 与查询关系字段同样只接受 raw ID", async () => {
    const { api, service } = setup();
    const uri = `siyuan://blocks/${ID}`;
    await assert.rejects(service.convertToTask(ID, "Write tests", "1", { parentIdHint: uri }));
    await assert.rejects(service.reorderTask(ID, uri));
    assert.throws(() => service.getTasksByParent(uri));
    assert.equal(api.requests.length, 0);
});

test("父关系更新拒绝不存在的父任务", async () => {
    // Regression: missing parents used to be accepted after only logging a warning.
    const { service } = setup();
    const taskId = (await service.convertToTask(ID, "Write tests")).blockId;
    const missingParentId = "20260816129999-missing";

    await assert.rejects(
        service.updateTask(taskId, { [ATTR_PARENT]: missingParentId }),
        (error: unknown) =>
            error instanceof Error && (error as Error & { code?: number }).code === RPC_ERROR_TASK_NOT_FOUND,
    );
    assert.equal(service.getTask(taskId)?.parentId, "");
});

test("父关系矩阵允许跨文档 Action 归属并拒绝 Project 成为任何任务的子项", async () => {
    // Regression: Project-to-Project used to bypass the Project-as-child guard.
    const api = new FakeSiyuanApi();
    const projectId = "20260816121000-project";
    const otherProjectId = "20260816121001-project";
    const taskParentId = "20260816121002-parentx";
    const actionId = "20260816121003-actionx";
    const physicalDocumentId = "20260816121004-notedoc";
    for (const [id, title, taskType] of [
        [projectId, "Project", "2"],
        [otherProjectId, "Other project", "2"],
        [taskParentId, "Task parent", "1"],
    ]) {
        const block = api.addBlock(id, "d", title);
        Object.assign(block.attrs, { [ATTR_TASK]: taskType, [ATTR_STATUS]: "todo" });
    }
    api.addBlock(physicalDocumentId, "d", "Notes");
    const actionBlock = api.addBlock(actionId, "d", "Cross-document action", "notebook", "/Notes", {
        parentId: physicalDocumentId,
    });
    Object.assign(actionBlock.attrs, { [ATTR_TASK]: "1", [ATTR_STATUS]: "todo" });

    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    cache.set(taskFactory(projectId, { taskType: "2" }));
    cache.set(taskFactory(otherProjectId, { taskType: "2" }));
    cache.set(taskFactory(taskParentId));
    cache.set(taskFactory(actionId));

    const joined = await service.updateTask(actionId, { [ATTR_PARENT]: projectId });
    assert.equal(joined.parentId, projectId);
    assert.equal(actionBlock.parentId, physicalDocumentId);
    assert.equal((await service.updateTask(actionId, { [ATTR_PARENT]: taskParentId })).parentId, taskParentId);

    for (const parentId of [otherProjectId, taskParentId]) {
        await assert.rejects(
            service.updateTask(projectId, { [ATTR_PARENT]: parentId }),
            (error: unknown) =>
                error instanceof Error && (error as Error & { code?: number }).code === RPC_ERROR_INVALID_PARAMS,
        );
    }
    await assert.rejects(
        service.reorderTask(projectId, otherProjectId),
        (error: unknown) =>
            error instanceof Error && (error as Error & { code?: number }).code === RPC_ERROR_INVALID_PARAMS,
    );
});

test("父关系更新拒绝间接循环", async () => {
    // Regression: every parent mutation path must reject cycles beyond direct self-parenting.
    const api = new FakeSiyuanApi();
    const firstId = "20260816121100-firstxx";
    const secondId = "20260816121101-secondx";
    for (const id of [firstId, secondId]) {
        const block = api.addBlock(id, "d", id);
        Object.assign(block.attrs, { [ATTR_TASK]: "1", [ATTR_STATUS]: "todo" });
    }
    api.blocks.get(secondId)!.attrs[ATTR_PARENT] = firstId;
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    cache.set(taskFactory(firstId));
    cache.set(taskFactory(secondId, { parentId: firstId }));

    await assert.rejects(
        service.updateTask(firstId, { [ATTR_PARENT]: secondId }),
        (error: unknown) =>
            error instanceof Error && (error as Error & { code?: number }).code === RPC_ERROR_CIRCULAR_REF,
    );
});

test("Stage 重排部分写入失败时回滚父级与所有排序", async () => {
    // Regression: a later reorder write could fail after the parent or a sibling sort had already persisted.
    const api = new FakeSiyuanApi();
    const projectId = "20260816121200-project";
    const stageId = "20260816121201-stagexx";
    const firstId = "20260816121202-firstxx";
    const secondId = "20260816121203-secondx";
    for (const [id, taskType, parentId, sort] of [
        [projectId, "2", "", "0"],
        [stageId, "1", projectId, "1"],
        [firstId, "1", projectId, "2"],
        [secondId, "1", projectId, "3"],
    ]) {
        const block = api.addBlock(id, "d", id);
        Object.assign(block.attrs, {
            [ATTR_TASK]: taskType,
            [ATTR_STATUS]: "todo",
            [ATTR_PARENT]: parentId,
            [ATTR_SORT]: sort,
        });
    }
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    cache.set(taskFactory(projectId, { taskType: "2", sort: 0 }));
    cache.set(taskFactory(stageId, { parentId: projectId, actionKind: "stage", sort: 1 }));
    cache.set(taskFactory(firstId, { parentId: projectId, sort: 2 }));
    cache.set(taskFactory(secondId, { parentId: projectId, sort: 3 }));

    const originalBatchWrite = api.batchSetBlockAttrs.bind(api);
    let batchWriteCount = 0;
    api.batchSetBlockAttrs = async (requests) => {
        batchWriteCount++;
        if (batchWriteCount === 1) {
            await api.setBlockAttrs(requests[0].id, requests[0].attrs);
            throw new Error("simulated partial reorder failure");
        }
        await originalBatchWrite(requests);
    };

    await assert.rejects(service.reorderTask(stageId, projectId, firstId), /simulated partial reorder failure/);
    assert.equal(api.blocks.get(stageId)?.attrs[ATTR_PARENT], projectId);
    assert.equal(api.blocks.get(stageId)?.attrs[ATTR_SORT], "1");
    assert.equal(api.blocks.get(firstId)?.attrs[ATTR_SORT], "2");
    assert.equal(api.blocks.get(secondId)?.attrs[ATTR_SORT], "3");
    assert.equal(service.getTask(stageId)?.parentId, projectId);
    assert.equal(service.getTask(stageId)?.sort, 1);
});

test("Stage 结构写入拒绝缺失父级、自身父级与后代循环", async () => {
    // Regression: Project plan relationship edits must use the same structural validation as every other caller.
    const api = new FakeSiyuanApi();
    const projectId = "20260816121300-project";
    const stageId = "20260816121301-stagexx";
    const childId = "20260816121302-childxx";
    for (const [id, taskType, parentId] of [
        [projectId, "2", ""],
        [stageId, "1", projectId],
        [childId, "1", stageId],
    ]) {
        const block = api.addBlock(id, "d", id);
        Object.assign(block.attrs, {
            [ATTR_TASK]: taskType,
            [ATTR_STATUS]: "todo",
            [ATTR_PARENT]: parentId,
        });
    }
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    cache.set(taskFactory(projectId, { taskType: "2" }));
    cache.set(taskFactory(stageId, { parentId: projectId, actionKind: "stage" }));
    cache.set(taskFactory(childId, { parentId: stageId }));

    for (const invalidParentId of ["20260816121399-missing", stageId, childId]) {
        await assert.rejects(service.reorderTask(stageId, invalidParentId));
    }
    assert.equal(service.getTask(stageId)?.parentId, projectId);
    assert.equal(api.blocks.get(stageId)?.attrs[ATTR_PARENT], projectId);
});

test("取消 Project 只清理项目标记和直接 Action 的显式归属", async () => {
    // Regression: removing a Project used to clear every task field and reuse generic child re-parenting.
    const api = new FakeSiyuanApi();
    const projectId = "20260816122000-project";
    const actionId = "20260816122001-actionx";
    const nestedId = "20260816122002-nestedx";
    const project = api.addBlock(projectId, "d", "Project");
    const action = api.addBlock(actionId, "d", "Action", "notebook", "/Elsewhere");
    const nested = api.addBlock(nestedId, "d", "Nested action", "notebook", "/Elsewhere");
    Object.assign(project.attrs, {
        [ATTR_TASK]: "2",
        [ATTR_STATUS]: "doing",
        [ATTR_NOTE]: "A preserved project note",
    });
    Object.assign(action.attrs, { [ATTR_TASK]: "1", [ATTR_STATUS]: "todo", [ATTR_PARENT]: projectId });
    Object.assign(nested.attrs, { [ATTR_TASK]: "1", [ATTR_STATUS]: "todo", [ATTR_PARENT]: actionId });

    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    cache.set(taskFactory(projectId, { taskType: "2" }));
    cache.set(taskFactory(actionId, { parentId: projectId }));
    cache.set(taskFactory(nestedId, { parentId: actionId }));

    await service.removeTask(projectId);

    assert.equal(project.attrs[ATTR_TASK], "");
    assert.equal(project.attrs[ATTR_STATUS], "doing");
    assert.equal(project.attrs[ATTR_NOTE], "A preserved project note");
    assert.equal(cache.get(projectId), undefined);
    assert.equal(action.attrs[ATTR_PARENT], "");
    assert.equal(cache.get(actionId)?.parentId, "");
    assert.equal(nested.attrs[ATTR_PARENT], actionId);
    assert.equal(cache.get(nestedId)?.parentId, actionId);
});

test("通过属性更新取消 Project 身份复用直接 Action 清理语义", async () => {
    // Regression: changing custom-na-task from 2 to 1 used to leave Project children attached.
    const api = new FakeSiyuanApi();
    const projectId = "20260816122100-project";
    const actionId = "20260816122101-actionx";
    const project = api.addBlock(projectId, "d", "Project");
    const action = api.addBlock(actionId, "d", "Action");
    Object.assign(project.attrs, { [ATTR_TASK]: "2", [ATTR_STATUS]: "doing" });
    Object.assign(action.attrs, { [ATTR_TASK]: "1", [ATTR_STATUS]: "todo", [ATTR_PARENT]: projectId });
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    cache.set(taskFactory(projectId, { taskType: "2" }));
    cache.set(taskFactory(actionId, { parentId: projectId }));

    const demoted = await service.updateTask(projectId, { [ATTR_TASK]: "1" });

    assert.equal(demoted.taskType, "1");
    assert.equal(cache.get(projectId)?.taskType, "1");
    assert.equal(action.attrs[ATTR_PARENT], "");
    assert.equal(cache.get(actionId)?.parentId, "");
});

test("取消 Project 后原生 Action 回到结构父任务", async () => {
    // Regression: direct Project cleanup must clear the explicit relation without discarding native structure.
    const api = new FakeSiyuanApi();
    const projectId = "20260816122200-project";
    const documentId = "20260816122201-notedoc";
    const structuralParentId = "20260816122202-parentx";
    const nestedListId = "20260816122203-listxxx";
    const actionId = "20260816122204-actionx";
    const project = api.addBlock(projectId, "d", "Project");
    api.addBlock(documentId, "d", "Notes");
    api.addBlock(structuralParentId, "i", "Structural parent", "notebook", "/Notes", {
        parentId: documentId,
        subtype: "t",
        markdown: "- [ ] Structural parent",
    });
    api.addBlock(nestedListId, "l", "", "notebook", "/Notes", {
        parentId: structuralParentId,
        subtype: "u",
    });
    const action = api.addBlock(actionId, "i", "Action", "notebook", "/Notes", {
        parentId: nestedListId,
        subtype: "t",
        markdown: "- [ ] Action",
    });
    Object.assign(project.attrs, { [ATTR_TASK]: "2", [ATTR_STATUS]: "doing" });
    Object.assign(action.attrs, { [ATTR_STATUS]: "todo", [ATTR_PARENT]: projectId });
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    cache.set(taskFactory(projectId, { taskType: "2" }));
    cache.set(taskFactory(structuralParentId, { identificationSource: "native" }));
    cache.set(taskFactory(actionId, { identificationSource: "native", parentId: projectId }));

    await service.removeTask(projectId);

    assert.equal(action.attrs[ATTR_PARENT], "");
    assert.equal(cache.get(actionId)?.parentId, structuralParentId);
    assert.equal(action.parentId, nestedListId);
});

test("缓存重建检测外部取消 Project 并清理直接归属", async () => {
    // Regression: external custom-na-task changes used to leave orphaned Project parent relations after rebuild.
    const api = new DiscoveryFakeSiyuanApi();
    const projectId = "20260816122300-project";
    const actionId = "20260816122301-actionx";
    const project = api.addBlock(projectId, "d", "Project");
    const action = api.addBlock(actionId, "d", "Action");
    Object.assign(project.attrs, { [ATTR_TASK]: "2", [ATTR_STATUS]: "doing" });
    Object.assign(action.attrs, { [ATTR_TASK]: "1", [ATTR_STATUS]: "todo", [ATTR_PARENT]: projectId });
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    cache.set(taskFactory(projectId, { taskType: "2" }));
    cache.set(taskFactory(actionId, { parentId: projectId }));

    project.attrs[ATTR_TASK] = "1";
    await service.rebuildCache();

    assert.equal(cache.get(projectId)?.taskType, "1");
    assert.equal(action.attrs[ATTR_PARENT], "");
    assert.equal(cache.get(actionId)?.parentId, "");
});

test("冷启动清理指向已取消 Project 的孤儿归属", async () => {
    // Regression: cancelling a Project while the plugin was stopped used to leave its Action parent orphaned on load.
    const api = new DiscoveryFakeSiyuanApi();
    const projectId = "20260816122302-project";
    const actionId = "20260816122303-actionx";
    const project = api.addBlock(projectId, "d", "Project");
    const action = api.addBlock(actionId, "d", "Action");
    Object.assign(project.attrs, { [ATTR_TASK]: "", [ATTR_STATUS]: "doing" });
    Object.assign(action.attrs, { [ATTR_TASK]: "1", [ATTR_STATUS]: "todo", [ATTR_PARENT]: projectId });
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);

    await service.loadCache();

    assert.equal(cache.get(projectId), undefined);
    assert.equal(action.attrs[ATTR_PARENT], "");
    assert.equal(cache.get(actionId)?.parentId, "");
});

test("未缓存任务更新校验失败时不写入缓存或发布变更", async () => {
    // Regression: building an uncached update candidate must not mutate the cache before validation succeeds.
    const api = new FakeSiyuanApi();
    const block = api.addBlock(ID, "d", "Uncached project");
    Object.assign(block.attrs, {
        [ATTR_TASK]: "2",
        [ATTR_STATUS]: "todo",
        [ATTR_PRIORITY]: "medium",
    });
    const originalAttrs = { ...block.attrs };
    const cache = new CacheManager(api);
    const publisher = new FakeTaskChangePublisher();
    const repository = new TaskRepository(api, cache, new Mutex(), publisher, DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);

    await assert.rejects(
        service.updateTask(ID, { [ATTR_PARENT]: ID }),
        (error: unknown) =>
            error instanceof Error && (error as Error & { code?: number }).code === RPC_ERROR_CIRCULAR_REF,
    );

    assert.deepEqual(block.attrs, originalAttrs);
    assert.equal(cache.get(ID), undefined);
    assert.equal(
        api.requests.some((request) => request.path === "/api/attr/setBlockAttrs"),
        false,
    );
    assert.equal(publisher.broadcasts, 0);
    assert.deepEqual(publisher.changes, []);
});

test("未缓存 Project 仍拒绝加入普通任务", async () => {
    // Regression: an uncached Project used to be resolved with the caller's default Action type and accepted a parent.
    const api = new FakeSiyuanApi();
    const project = api.addBlock(ID, "d", "Uncached project");
    const parent = api.addBlock(OTHER_ID, "d", "Parent task");
    Object.assign(project.attrs, { [ATTR_TASK]: "2", [ATTR_STATUS]: "todo" });
    Object.assign(parent.attrs, { [ATTR_TASK]: "1", [ATTR_STATUS]: "todo" });
    const originalAttrs = { ...project.attrs };
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    cache.set(taskFactory(OTHER_ID));

    await assert.rejects(
        service.updateTask(ID, { [ATTR_PARENT]: OTHER_ID }),
        (error: unknown) =>
            error instanceof Error && (error as Error & { code?: number }).code === RPC_ERROR_INVALID_PARAMS,
    );

    assert.deepEqual(project.attrs, originalAttrs);
    assert.equal(cache.get(ID), undefined);
});

test("权威回读失败时不产生虚假的缓存成功状态", async () => {
    const { api, cache, service } = setup();
    api.failAtRequest.set("/api/attr/getBlockAttrs", 2);
    await assert.rejects(service.convertToTask(ID, "Write tests"));
    const native = [...api.blocks.values()].find((block) => block.type === "i" && block.subtype === "t");
    assert.equal(native?.attrs[ATTR_STATUS], undefined);
    assert.equal(cache.get(ID), undefined);
});

test("文本块转换回滚失败会报告部分写入而不是普通失败", async () => {
    const { api, service } = setup();
    api.failAtRequest.set("/api/attr/getBlockAttrs", 2);
    api.failAtRequest.set("/api/block/updateBlock", 2);

    // Regression: 回滚失败被吞掉后会错误标记为可重试 failed，尽管来源块可能已经改变。
    await assert.rejects(
        service.convertToTask(ID, "Write tests"),
        (error: unknown) => error instanceof McpToolError && error.mcpCode === "PARTIAL_SUCCESS",
    );
});

test("文本块转换失败会用原始 Markdown 回滚而不是编辑后的标题", async () => {
    const { api, service } = setup();
    api.failAtRequest.set("/api/attr/getBlockAttrs", 2);

    // Regression: 原位候选编辑标题后，转换失败会用编辑标题回滚并永久改写来源。
    await assert.rejects(service.convertToTask(ID, "Edited Action"));
    assert.equal(api.blocks.get(ID)?.content, "Write tests");
    assert.equal(api.blocks.get(ID)?.markdown, "Write tests");
});

test("空原始 Markdown 在转换失败时仍按空值回滚", async () => {
    const { api, service } = setup();
    const source = api.blocks.get(ID)!;
    source.markdown = "";
    api.failAtRequest.set("/api/attr/getBlockAttrs", 2);

    // Regression: 空原文曾被退化为来源标题，导致失败回滚永久写入并非原文的内容。
    await assert.rejects(service.convertToTask(ID, "Edited Action"));
    assert.equal(api.blocks.get(ID)?.markdown, "");
});

test("转换响应元数据无效时仍回滚已改写的来源", async () => {
    class InvalidConversionMetadataApi extends FakeSiyuanApi {
        override async request<T = unknown>(path: string, body: object = {}): Promise<T> {
            const result = await super.request<T>(path, body);
            const input = body as { dataType?: string; data?: string };
            if (
                path === "/api/block/updateBlock" &&
                input.dataType === "markdown" &&
                /^- \[ \] /.test(input.data || "")
            ) {
                return [] as T;
            }
            return result;
        }
    }

    const api = new InvalidConversionMetadataApi();
    api.addBlock(ID, "p", "Write tests");
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);

    // Regression: 响应缺少转换元数据时，来源已改写但 convertedRootId 尚未设置，回滚曾被跳过。
    await assert.rejects(service.convertToTask(ID, "Edited Action"));
    assert.equal(api.blocks.get(ID)?.markdown, "Write tests");
});

test("属性写入失败时保留既有权威缓存", async () => {
    const { api, cache, service } = setup();
    const taskId = (await service.convertToTask(ID, "Write tests")).blockId;
    const before = cache.get(taskId);
    api.failPaths.add("/api/attr/setBlockAttrs");
    await assert.rejects(service.updateTask(taskId, { [ATTR_PRIORITY]: "critical" }));
    assert.equal(cache.get(taskId), before);
    assert.equal(cache.get(taskId)?.priority, "medium");
});

test("重复规则写入规则与状态，并以回读结果更新缓存和广播", async () => {
    const { api, cache, publisher, service } = setup();
    const taskId = (await service.convertToTask(ID, "Write tests")).blockId;
    await service.updateTask(taskId, { [ATTR_DUE]: "2026-08-20" });
    const result = await service.setRepeatRule(taskId, { version: 2, frequency: "day", interval: 1 });
    assert.ok(api.blocks.get(taskId)?.attrs[ATTR_REPEAT]);
    assert.ok(api.blocks.get(taskId)?.attrs[ATTR_REPEAT_STATE]);
    assert.equal(cache.get(taskId)?.repeat, result.repeat);
    assert.equal(publisher.changes[publisher.changes.length - 1], taskId);
});

test("重复任务完成推进后保留我的一天本次完成态并只发布最终状态", async () => {
    // Regression: repeat advancement reopens the task block but must not erase today's completed occurrence.
    const { api, cache, myDay, publisher, service } = setup();
    const taskId = (await service.convertToTask(ID, "Write tests")).blockId;
    await service.updateTask(taskId, { [ATTR_DUE]: "2026-08-20" });
    await service.setRepeatRule(taskId, { version: 2, frequency: "day", interval: 1 });
    await myDay.addTask(taskId);
    const broadcastsBefore = publisher.broadcasts;
    const changesBefore = publisher.changes.length;

    const updated = await service.updateTask(taskId, { [ATTR_STATUS]: "done" });
    const myDayEntry = myDay.state.tasks.find((entry) => entry.blockId === taskId);

    assert.equal(updated.status, "todo");
    assert.equal(api.blocks.get(taskId)?.attrs[ATTR_STATUS], "todo");
    assert.equal(cache.get(taskId), updated);
    assert.match(api.blocks.get(taskId)!.markdown, /\[ \]/);
    assert.equal(typeof myDayEntry?.completedAt, "number");
    assert.equal(isMyDayEntryDone(myDayEntry, updated.status), true);
    assert.equal(publisher.broadcasts, broadcastsBefore + 1);
    assert.ok(publisher.changes.slice(changesBefore).includes(taskId));
});

test("跳过重复发生只推进状态且保留我的一天任务", async () => {
    const { api, cache, myDay, publisher, service } = setup();
    const taskId = (await service.convertToTask(ID, "Write tests")).blockId;
    await service.updateTask(taskId, { [ATTR_DUE]: "2026-08-20" });
    await service.setRepeatRule(taskId, { version: 2, frequency: "day", interval: 1 });
    await myDay.addTask(taskId);
    await myDay.markTaskCompleted(taskId, Date.now());
    const broadcastsBefore = publisher.broadcasts;
    const changesBefore = publisher.changes.length;

    const updated = await service.skipRepeatOccurrence(taskId);
    const state = JSON.parse(updated.repeatState) as { processed: number; status: string };
    const myDayEntry = myDay.state.tasks.find((entry) => entry.blockId === taskId);

    assert.equal(state.processed, 1);
    assert.equal(state.status, "active");
    assert.equal(updated.status, "todo");
    assert.equal(updated.completed, "");
    assert.equal(api.blocks.get(taskId)?.attrs[ATTR_REPEAT_STATE], updated.repeatState);
    assert.equal(cache.get(taskId), updated);
    assert.ok(myDayEntry);
    assert.equal(myDayEntry?.completedAt, undefined);
    assert.equal(publisher.broadcasts, broadcastsBefore + 1);
    assert.ok(publisher.changes.slice(changesBefore).includes(taskId));
});

test("暂停和恢复重复系列写回状态，恢复已完成任务时重开同一块", async () => {
    const { api, cache, myDay, publisher, service } = setup();
    const taskId = (await service.convertToTask(ID, "Write tests")).blockId;
    await service.updateTask(taskId, { [ATTR_DUE]: "2026-08-20" });
    await service.setRepeatRule(taskId, { version: 2, frequency: "day", interval: 1 });
    const broadcastsBeforePause = publisher.broadcasts;
    const changesBeforePause = publisher.changes.length;

    const paused = await service.setRepeatPaused(taskId, true);
    assert.equal((JSON.parse(paused.repeatState) as { status: string }).status, "paused");
    assert.equal(api.blocks.get(taskId)?.attrs[ATTR_REPEAT_STATE], paused.repeatState);
    assert.equal(cache.get(taskId), paused);
    assert.equal(publisher.broadcasts, broadcastsBeforePause + 1);
    assert.ok(publisher.changes.slice(changesBeforePause).includes(taskId));

    api.blocks.get(taskId)!.attrs[ATTR_STATUS] = "done";
    await api.updateTaskListItemMarker(taskId, "X");
    cache.set({ ...paused, status: "done" });
    await myDay.addTask(taskId);
    await myDay.markTaskCompleted(taskId, Date.now());
    const broadcastsBefore = publisher.broadcasts;
    const changesBefore = publisher.changes.length;

    const resumed = await service.setRepeatPaused(taskId, false);
    const state = JSON.parse(resumed.repeatState) as { status: string };
    const myDayEntry = myDay.state.tasks.find((entry) => entry.blockId === taskId);

    assert.equal(state.status, "active");
    assert.equal(resumed.status, "todo");
    assert.equal(api.blocks.get(taskId)?.attrs[ATTR_STATUS], "todo");
    assert.match(api.blocks.get(taskId)!.markdown, /\[ \]/);
    assert.equal(cache.get(taskId), resumed);
    assert.ok(myDayEntry);
    assert.equal(myDayEntry?.completedAt, undefined);
    assert.equal(publisher.broadcasts, broadcastsBefore + 1);
    assert.ok(publisher.changes.slice(changesBefore).includes(taskId));
});

test("下一步行动排除已完成和阻塞任务，并按统一优先级排序", () => {
    const { cache, service } = setup();
    const highId = "20260816123457-abcdefg";
    const lowId = "20260816123458-abcdefg";
    const doneId = "20260816123459-abcdefg";
    const blockedId = "20260816123500-abcdefg";
    const blockerId = "20260816123501-abcdefg";
    const somedayId = "20260816123502-abcdefg";
    cache.set(taskFactory(lowId, { priority: "low", order: 10 }));
    cache.set(taskFactory(highId, { priority: "critical", order: 100 }));
    cache.set(taskFactory(doneId, { status: "done", order: 1000 }));
    cache.set(taskFactory(blockerId, { status: "waiting", order: 1000 }));
    cache.set(taskFactory(blockedId, { depends: blockerId, order: 1000 }));
    cache.set(taskFactory(somedayId, { status: "someday", order: 2000 }));

    // Regression: every read consumer must exclude someday through the shared Next Action predicate.
    assert.deepEqual(
        service.getNextActions().map((task) => task.blockId),
        [highId, lowId],
    );
    assert.deepEqual(
        service.getReviewData().nextActions.map((task) => task.blockId),
        [lowId, highId],
    );
    assert.equal(service.getTask(highId)?.priority, "critical");
});

test("Review 与完成提醒保留叶子已完成但尚未确认的项目", () => {
    // Regression: Review only inspected direct unfinished children and hid completion candidates.
    const { cache, service } = setup();
    const projectId = "20260816123503-project";
    const parentId = "20260816123504-parentx";
    const leafId = "20260816123505-leafxxx";
    cache.set(taskFactory(projectId, { taskType: "2", status: "doing", childIds: [parentId] }));
    cache.set(taskFactory(parentId, { parentId: projectId, status: "done", childIds: [leafId] }));
    cache.set(taskFactory(leafId, { parentId, status: "done" }));

    assert.deepEqual(
        service.getProjectReminders().map((task) => task.blockId),
        [projectId],
    );
    assert.deepEqual(
        service.getReviewData().projectReviews.map((item) => item.summary.project.blockId),
        [projectId],
    );
});

test("ReviewData 以项目摘要传递唯一队列项并从通用待回顾任务中排除 Project", () => {
    // Regression: Project Review only exposed bare tasks and duplicated a project across generic Review groups.
    const { cache, service } = setup();
    const today = new Date();
    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const projectId = "20260816123506-project";
    const actionId = "20260816123507-actionx";
    const nextActionId = "20260816123507-nextact";
    cache.set(
        taskFactory(projectId, {
            taskType: "2",
            status: "doing",
            childIds: [actionId, nextActionId],
            blocked: true,
            blockedReason: "dependency",
            reviewInterval: 7,
            reviewDate: todayString,
        }),
    );
    cache.set(
        taskFactory(actionId, {
            parentId: projectId,
            blocked: true,
            blockedReason: "dependency",
            due: "2000-01-01",
        }),
    );
    cache.set(taskFactory(nextActionId, { parentId: projectId }));

    const review = service.getReviewData();

    assert.equal(review.projectReviews.length, 1);
    assert.equal(review.projectReviews[0].summary.project.blockId, projectId);
    assert.equal(review.projectReviews[0].summary.health, "blocked");
    assert.deepEqual(review.projectReviews[0].triggers, ["schedule", "risk"]);
    assert.deepEqual(review.reviewDueTasks, []);
    assert.deepEqual(review.overdueTasks, []);
    assert.deepEqual(review.nextActions, []);
    assert.equal("activeProjects" in review, false);
    assert.deepEqual(
        review.reviewableProjects.map((summary) => summary.project.blockId),
        [projectId],
    );
});

test("完成项目回顾按周期更新下次回顾日期，无周期手动回顾不制造日期", async () => {
    // Regression: project-level Review must preserve the existing authoritative reviewDate update semantics.
    const { api, cache, service } = setup();
    const scheduledId = "20260816123508-project";
    const manualId = "20260816123509-project";
    const scheduledBlock = api.addBlock(scheduledId, "d", "Scheduled project");
    const manualBlock = api.addBlock(manualId, "d", "Manual project");
    Object.assign(scheduledBlock.attrs, {
        [ATTR_TASK]: "2",
        [ATTR_STATUS]: "doing",
        [ATTR_REVIEW_INTERVAL]: "7",
    });
    Object.assign(manualBlock.attrs, { [ATTR_TASK]: "2", [ATTR_STATUS]: "doing" });
    cache.set(taskFactory(scheduledId, { taskType: "2", status: "doing", reviewInterval: 7 }));
    cache.set(taskFactory(manualId, { taskType: "2", status: "doing", reviewInterval: 0 }));
    const expectedDate = new Date();
    expectedDate.setDate(expectedDate.getDate() + 7);
    const expectedDateString = `${expectedDate.getFullYear()}-${String(expectedDate.getMonth() + 1).padStart(2, "0")}-${String(expectedDate.getDate()).padStart(2, "0")}`;

    const updated = await service.markTaskReviewed([scheduledId, manualId]);

    assert.deepEqual(
        updated.map((task) => task.blockId),
        [scheduledId],
    );
    assert.equal(updated[0].reviewDate, expectedDateString);
    assert.equal(scheduledBlock.attrs[ATTR_REVIEW_DATE], expectedDateString);
    assert.equal(manualBlock.attrs[ATTR_REVIEW_DATE], undefined);
});

test("当期完成统计不计入缺少完成时间的任务", () => {
    // Regression: done tasks without completion history must not count toward the current period.
    const { cache, service } = setup();
    const now = new Date();
    const completed = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    cache.set(taskFactory("20260816123457-statnow", { status: "done", completed }));
    cache.set(taskFactory("20260816123458-statold", { status: "done", completed: "" }));

    assert.equal(service.getStatistics("month").summary.completedInPeriod, 1);
});

test("已完成 Project 新建直属 Action 时恢复 doing、清除完成态并返回一次性风险提示", async () => {
    // Regression: a completed Project could stay silently complete after gaining new direct work.
    const { api, cache, myDay, service } = setup();
    const parentId = "20260816123457-parentx";
    const childId = "20260816123458-childxx";
    Object.assign(api.addBlock(parentId, "d", "Parent").attrs, {
        [ATTR_TASK]: "2",
        [ATTR_STATUS]: "done",
    });
    api.addBlock(childId, "p", "Child");
    cache.set(taskFactory(parentId, { taskType: "2", status: "done" }));
    await myDay.addTask(parentId);
    await myDay.markTaskCompleted(parentId, Date.now());

    const created = await service.convertToTask(childId, "Child", "1", { parentIdHint: parentId });
    const childTaskId = created.blockId;

    assert.equal(api.blocks.get(childTaskId)?.attrs[ATTR_PARENT], parentId);
    assert.equal(api.blocks.get(childTaskId)?.attrs[ATTR_SORT], "0");
    assert.equal(api.blocks.get(parentId)?.attrs[ATTR_STATUS], "doing");
    assert.equal(service.getTask(parentId)?.status, "doing");
    assert.equal(created._warning, "projectReopened");
    assert.equal(myDay.state.tasks.find((entry) => entry.blockId === parentId)?.completedAt, undefined);
});

test("已完成 Project 的直属 Action 重新打开时恢复 doing、清除完成态并返回一次性风险提示", async () => {
    // Regression: reopening direct work did not invalidate the Project's completed state.
    const { api, cache, myDay, service } = setup();
    const projectId = "20260816123600-project";
    const actionId = "20260816123601-actionx";
    Object.assign(api.addBlock(projectId, "d", "Completed project").attrs, {
        [ATTR_TASK]: "2",
        [ATTR_STATUS]: "done",
    });
    Object.assign(api.addBlock(actionId, "d", "Follow-up action").attrs, {
        [ATTR_TASK]: "1",
        [ATTR_STATUS]: "done",
        [ATTR_PARENT]: projectId,
    });
    cache.set(taskFactory(projectId, { taskType: "2", status: "done", childIds: [actionId] }));
    cache.set(taskFactory(actionId, { status: "done", parentId: projectId }));
    await myDay.addTask(projectId);
    await myDay.markTaskCompleted(projectId, Date.now());

    const reopened = await service.updateTask(actionId, { [ATTR_STATUS]: "todo" });

    assert.equal(reopened.status, "todo");
    assert.equal(api.blocks.get(projectId)?.attrs[ATTR_STATUS], "doing");
    assert.equal(service.getTask(projectId)?.status, "doing");
    assert.equal(reopened._warning, "projectReopened");
    assert.equal(myDay.state.tasks.find((entry) => entry.blockId === projectId)?.completedAt, undefined);
});

test("广播失败由 SyncEngine 隔离，已确认的权威缓存保持成功状态", async () => {
    const api = new FakeSiyuanApi();
    api.addBlock(ID, "p", "Write tests");
    api.failBroadcast = true;
    const cache = new CacheManager(api);
    const publisher = new SyncEngine(api, cache);
    const repository = new TaskRepository(api, cache, new Mutex(), publisher, DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);

    const result = await service.convertToTask(ID, "Write tests");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(cache.get(result.blockId)?.blockId, result.blockId);
    assert.equal(
        api.logs.some((log) => log.level === "error" && log.message.includes("tasksChangedV2")),
        true,
    );
    publisher.stop();
});

test("Repository 严格按写入、权威回读顺序确认状态", async () => {
    const api = new FakeSiyuanApi();
    api.addBlock(ID);
    const cache = new CacheManager(api);
    cache.set(taskFactory(ID));
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const entry = await repository.withConfirmedChanges((changes) =>
        changes.upsertAttrs({ blockId: ID, attrs: { [ATTR_PRIORITY]: "high" } }),
    );
    assert.equal(entry.priority, "high");
    assert.equal(cache.get(ID), entry);
    assert.deepEqual(
        api.requests.slice(-3).map((request) => request.path),
        ["/api/attr/getBlockAttrs", "/api/attr/setBlockAttrs", "/api/attr/getBlockAttrs"],
    );
});

test("Repository 在属性写入前拒绝缺少身份依据的物化请求", async () => {
    const api = new FakeSiyuanApi();
    api.addBlock(ID);
    const repository = new TaskRepository(
        api,
        new CacheManager(api),
        new Mutex(),
        new FakeTaskChangePublisher(),
        DEFAULT_SETTINGS,
    );

    await assert.rejects(
        repository.withConfirmedChanges((changes) =>
            changes.upsertAttrs({ blockId: ID, attrs: { [ATTR_PRIORITY]: "high" } }),
        ),
        /requires identity evidence/,
    );
    assert.equal(
        api.requests.some((request) => request.path === "/api/attr/setBlockAttrs"),
        false,
    );
});

test("Repository 批量写失败时只返回逐块确认成功项", async () => {
    const api = new FakeSiyuanApi();
    api.addBlock(ID);
    const missingId = "20260816123457-abcdefg";
    const cache = new CacheManager(api);
    cache.set(taskFactory(ID));
    cache.set(taskFactory(missingId));
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const result = await repository.withConfirmedChanges((changes) =>
        changes.upsertAttrsBatch([
            { blockId: ID, attrs: { [ATTR_PRIORITY]: "high" } },
            { blockId: missingId, attrs: { [ATTR_PRIORITY]: "low" } },
        ]),
    );
    assert.equal(result.entries[0].priority, "high");
    assert.deepEqual(result.failedBlockIds, [missingId]);
});

test("Repository 并发锁超时返回编码错误且不会窃取锁", async () => {
    const api = new FakeSiyuanApi();
    const mutex = new Mutex();
    const held = await mutex.acquire().promise;
    const repository = new TaskRepository(
        api,
        new CacheManager(api),
        mutex,
        new FakeTaskChangePublisher(),
        DEFAULT_SETTINGS,
        5,
    );
    await assert.rejects(
        repository.withConfirmedChanges(async () => {}),
        (error: unknown) => {
            return error instanceof Error && (error as Error & { code?: number }).code === RPC_ERROR_TIMEOUT;
        },
    );
    held.release();
    await repository.withConfirmedChanges(async () => {});
});

test("Repository 广播失败只记录日志，不回滚已确认缓存", async () => {
    const api = new FakeSiyuanApi();
    const cache = new CacheManager(api);
    const repository = new TaskRepository(
        api,
        cache,
        new Mutex(),
        {
            publishChanges: () => {
                throw new Error("broadcast unavailable");
            },
        },
        DEFAULT_SETTINGS,
    );
    const entry = taskFactory(ID);
    await repository.withConfirmedChanges(async (changes) => {
        changes.upsertEntry(entry);
    });
    assert.equal(cache.get(ID), entry);
    assert.equal(
        api.logs.some((log) => log.level === "error" && log.message.includes("broadcast unavailable")),
        true,
    );
});

test("Repository 分组确认多项变更只发布一次", async () => {
    const api = new FakeSiyuanApi();
    const cache = new CacheManager(api);
    const publisher = new FakeTaskChangePublisher();
    const repository = new TaskRepository(api, cache, new Mutex(), publisher, DEFAULT_SETTINGS);

    await repository.withConfirmedChanges(async (changes) => {
        changes.upsertEntry(taskFactory(ID));
        changes.upsertEntry(taskFactory(OTHER_ID));
    });

    assert.equal(publisher.broadcasts, 1);
    assert.deepEqual(new Set(publisher.changes), new Set([ID, OTHER_ID]));
});

test("Repository 回调失败释放锁且不会把未发布变更泄漏到下一次提交", async () => {
    const api = new FakeSiyuanApi();
    const cache = new CacheManager(api);
    const publisher = new FakeTaskChangePublisher();
    const repository = new TaskRepository(api, cache, new Mutex(), publisher, DEFAULT_SETTINGS);

    await assert.rejects(
        repository.withConfirmedChanges(async (changes) => {
            changes.upsertEntry(taskFactory(ID));
            throw new Error("later domain step failed");
        }),
        /later domain step failed/,
    );
    assert.equal(publisher.broadcasts, 0);

    await repository.withConfirmedChanges(async (changes) => {
        changes.upsertEntry(taskFactory(OTHER_ID));
    });
    assert.equal(publisher.broadcasts, 1);
    assert.deepEqual(publisher.changes, [OTHER_ID]);
});
