import test from "node:test";
import assert from "node:assert/strict";
import { ActionMoveService } from "../src/kernel/action-move-service.ts";
import type {
    ActionMoveStructurePlan,
    ActionMoveStructurePort,
    ActionMoveStructureSnapshot,
} from "../src/kernel/action-move-structure-port.ts";
import { CacheManager } from "../src/kernel/cache-manager.ts";
import { Mutex } from "../src/kernel/mutex.ts";
import { TaskIdentityResolver } from "../src/kernel/task-identity-resolver.ts";
import { TaskRepository } from "../src/kernel/task-repository.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import {
    ATTR_DEPENDS,
    ATTR_NOTE,
    ATTR_STATUS,
    ATTR_TASK,
    RPC_ERROR_ACTION_MOVE_NOT_MOVED,
    RPC_ERROR_ACTION_MOVE_RECOVERED,
    RPC_ERROR_ACTION_MOVE_RECOVERY_FAILED,
    RPC_ERROR_CIRCULAR_REF,
} from "../src/shared/constants.ts";
import { FakeSiyuanApi, FakeTaskChangePublisher, taskFactory } from "./helpers/fakes.ts";

const SOURCE_DOCUMENT_ID = "20260825090000-sourced";
const SOURCE_LIST_ID = "20260825090001-sourcel";
const ACTION_ID = "20260825090002-actionx";
const CONTENT_ID = "20260825090003-content";
const CHILD_LIST_ID = "20260825090004-childli";
const CHILD_ACTION_ID = "20260825090005-childax";
const CHILD_CONTENT_ID = "20260825090006-childco";
const PROJECT_ID = "20260825090007-project";
const TARGET_LIST_ID = "20260825090008-targetl";

class InMemoryActionMoveStructurePort implements ActionMoveStructurePort {
    private currentDocumentId = SOURCE_DOCUMENT_ID;
    private inspectTargetCount = 0;
    private activePrepares = 0;
    maxConcurrentPrepares = 0;

    constructor(
        private readonly api: FakeSiyuanApi,
        private readonly failure: "" | "before" | "after" | "confirm" | "restore" = "",
        private readonly delayPrepare = false,
    ) {}

    async prepare(actionId: string, projectId: string): Promise<ActionMoveStructurePlan> {
        this.activePrepares++;
        this.maxConcurrentPrepares = Math.max(this.maxConcurrentPrepares, this.activePrepares);
        try {
            if (this.delayPrepare) await new Promise((resolve) => setTimeout(resolve, 0));
            assert.equal(actionId, ACTION_ID);
            assert.equal(projectId, PROJECT_ID);
            return {
                actionId,
                projectId,
                source: await this.inspect(actionId),
                target: { documentId: PROJECT_ID, documentTitle: "Ship release" },
            };
        } finally {
            this.activePrepares--;
        }
    }

    async execute(plan: ActionMoveStructurePlan): Promise<void> {
        assert.equal(plan.actionId, ACTION_ID);
        if (this.failure === "before") throw new Error("move rejected before mutation");
        this.api.blocks.get(ACTION_ID)!.parentId = TARGET_LIST_ID;
        this.currentDocumentId = PROJECT_ID;
        if (this.failure === "after") throw new Error("transport failed after mutation");
    }

    async commit(_plan: ActionMoveStructurePlan): Promise<void> {}

    async restore(plan: ActionMoveStructurePlan): Promise<void> {
        if (this.failure === "restore") throw new Error("restore failed");
        this.api.blocks.get(ACTION_ID)!.parentId = plan.source.location.parentId;
        this.currentDocumentId = plan.source.location.documentId;
    }

    async inspect(actionId: string): Promise<ActionMoveStructureSnapshot> {
        assert.equal(actionId, ACTION_ID);
        const parentId = this.api.blocks.get(ACTION_ID)?.parentId || "";
        const subtreeIds = [ACTION_ID, CONTENT_ID, CHILD_LIST_ID, CHILD_ACTION_ID, CHILD_CONTENT_ID];
        if (this.currentDocumentId === PROJECT_ID) this.inspectTargetCount++;
        return {
            location: {
                documentId: this.currentDocumentId,
                documentTitle: this.currentDocumentId === PROJECT_ID ? "Ship release" : "Source notes",
                parentId,
                previousId: "",
                nextId: "",
            },
            subtreeIds:
                (this.failure === "confirm" || this.failure === "restore") &&
                this.currentDocumentId === PROJECT_ID &&
                this.inspectTargetCount === 1
                    ? subtreeIds.slice(0, -1)
                    : subtreeIds,
        };
    }

    isAtSource(plan: ActionMoveStructurePlan, snapshot: ActionMoveStructureSnapshot): boolean {
        return (
            snapshot.location.documentId === plan.source.location.documentId &&
            snapshot.location.parentId === plan.source.location.parentId
        );
    }
}

class StaleIdentitySiyuanApi extends FakeSiyuanApi {
    override async query<T = Record<string, unknown>>(statement: string): Promise<T[]> {
        const action = this.blocks.get(ACTION_ID);
        if (/WITH\s+RECURSIVE\s+ancestry/i.test(statement) && action?.parentId === TARGET_LIST_ID) {
            action.parentId = SOURCE_LIST_ID;
            try {
                return await super.query<T>(statement);
            } finally {
                action.parentId = TARGET_LIST_ID;
            }
        }
        return super.query<T>(statement);
    }
}

function setup(
    failure: "" | "before" | "after" | "confirm" | "restore" = "",
    options: { staleIdentity?: boolean; projectParentId?: string; delayPrepare?: boolean } = {},
) {
    const api = options.staleIdentity ? new StaleIdentitySiyuanApi() : new FakeSiyuanApi();
    api.addBlock(SOURCE_DOCUMENT_ID, "d", "Source notes");
    api.addBlock(SOURCE_LIST_ID, "l", "", "notebook", "/Source notes", {
        subtype: "t",
        parentId: SOURCE_DOCUMENT_ID,
    });
    const action = api.addBlock(ACTION_ID, "i", "Move safely", "notebook", "/Source notes", {
        subtype: "t",
        parentId: SOURCE_LIST_ID,
        markdown: "- [ ] Move safely",
    });
    api.addBlock(CONTENT_ID, "p", "Move safely", "notebook", "/Source notes", { parentId: ACTION_ID });
    api.addBlock(CHILD_LIST_ID, "l", "", "notebook", "/Source notes", {
        subtype: "t",
        parentId: ACTION_ID,
    });
    api.addBlock(CHILD_ACTION_ID, "i", "Keep child", "notebook", "/Source notes", {
        subtype: "t",
        parentId: CHILD_LIST_ID,
        markdown: "- [ ] Keep child",
    });
    api.addBlock(CHILD_CONTENT_ID, "p", "Keep child", "notebook", "/Source notes", {
        parentId: CHILD_ACTION_ID,
    });
    const project = api.addBlock(PROJECT_ID, "d", "Ship release", "notebook", "/Ship release");
    api.addBlock(TARGET_LIST_ID, "l", "", "notebook", "/Ship release", {
        subtype: "t",
        parentId: PROJECT_ID,
    });
    Object.assign(action.attrs, {
        [ATTR_STATUS]: "doing",
        [ATTR_DEPENDS]: CHILD_ACTION_ID,
        [ATTR_NOTE]: "Preserve this note",
    });
    Object.assign(project.attrs, { [ATTR_TASK]: "2", [ATTR_STATUS]: "doing" });

    const identities = new TaskIdentityResolver(api);
    const cache = new CacheManager(api, identities);
    cache.set(
        taskFactory(ACTION_ID, {
            identificationSource: "native",
            attrHostId: ACTION_ID,
            contentBlockId: CONTENT_ID,
            parentId: "",
            status: "doing",
            depends: CHILD_ACTION_ID,
            note: "Preserve this note",
            title: "Move safely",
        }),
    );
    cache.set(
        taskFactory(PROJECT_ID, {
            taskType: "2",
            title: "Ship release",
            status: "doing",
            parentId: options.projectParentId || "",
        }),
    );
    const publisher = new FakeTaskChangePublisher();
    const repository = new TaskRepository(api, cache, new Mutex(), publisher, DEFAULT_SETTINGS);
    const structure = new InMemoryActionMoveStructurePort(api, failure, options.delayPrepare);
    const service = new ActionMoveService(cache, repository, identities, structure);
    return { api, cache, publisher, service, structure };
}

test("移动原生 Action 到 Project 文档末尾时保留身份、属性和完整内容子树", async () => {
    const { api, cache, publisher, service, structure } = setup();
    const attrsBefore = { ...api.blocks.get(ACTION_ID)!.attrs };
    const subtreeBefore = (await structure.inspect(ACTION_ID)).subtreeIds;

    const preview = await service.preview({ actionId: ACTION_ID, projectId: PROJECT_ID });
    assert.deepEqual(preview.source, { documentId: SOURCE_DOCUMENT_ID, title: "Source notes" });
    assert.deepEqual(preview.target, { projectId: PROJECT_ID, title: "Ship release" });
    assert.equal(preview.currentEffectiveParentId, "");
    assert.equal(preview.nextEffectiveParentId, PROJECT_ID);
    assert.equal(preview.effectiveParentWillChange, true);
    assert.equal(preview.explicitParentPreserved, false);

    const result = await service.move({ actionId: ACTION_ID, projectId: PROJECT_ID });

    assert.equal(result.task.blockId, ACTION_ID);
    assert.equal(result.task.identificationSource, "native");
    assert.equal(result.task.contentBlockId, CONTENT_ID);
    assert.equal(result.task.parentId, PROJECT_ID);
    assert.equal(result.task.depends, CHILD_ACTION_ID);
    assert.equal(result.task.note, "Preserve this note");
    assert.deepEqual(api.blocks.get(ACTION_ID)!.attrs, attrsBefore);
    assert.deepEqual((await structure.inspect(ACTION_ID)).subtreeIds, subtreeBefore);
    assert.equal(api.blocks.get(CONTENT_ID)?.parentId, ACTION_ID);
    assert.equal(api.blocks.get(CHILD_LIST_ID)?.parentId, ACTION_ID);
    assert.equal(api.blocks.get(CHILD_ACTION_ID)?.parentId, CHILD_LIST_ID);
    assert.equal(cache.get(ACTION_ID)?.parentId, PROJECT_ID);
    assert.ok(publisher.changes.includes(ACTION_ID));
    assert.ok(publisher.changes.includes(PROJECT_ID));
});

test("移动后身份 SQL 祖先链滞后时仍按已确认的物理目标刷新有效父级", async () => {
    // Regression: moveBlock 已完成但身份 SQL 仍指向源文档时，缓存父级不应回退为空。
    const { service } = setup("", { staleIdentity: true });

    const result = await service.move({ actionId: ACTION_ID, projectId: PROJECT_ID });

    assert.equal(result.task.parentId, PROJECT_ID);
});

test("并发移动在共享任务锁内重新准备结构计划", async () => {
    // Regression: 两个移动不能在共享锁外同时捕获同一份过期来源结构。
    const { service, structure } = setup("", { delayPrepare: true });

    await Promise.all([
        service.move({ actionId: ACTION_ID, projectId: PROJECT_ID }),
        service.move({ actionId: ACTION_ID, projectId: PROJECT_ID }),
    ]);

    assert.equal(structure.maxConcurrentPrepares, 1);
});

test("移动会拒绝把 Action 设为其逻辑后代 Project 的有效父级", async () => {
    // Regression: Project 已以 Action 为父级时，反向把 Action 移入 Project 会形成父级环。
    const { api, service } = setup("", { projectParentId: ACTION_ID });

    await assert.rejects(
        () => service.move({ actionId: ACTION_ID, projectId: PROJECT_ID }),
        (error: Error & { code?: number }) => error.code === RPC_ERROR_CIRCULAR_REF,
    );

    assert.equal(api.blocks.get(ACTION_ID)?.parentId, SOURCE_LIST_ID);
});

test("移动调用前失败时报告未移动并保持权威缓存状态", async () => {
    const { api, cache, publisher, service } = setup("before");

    await assert.rejects(
        () => service.move({ actionId: ACTION_ID, projectId: PROJECT_ID }),
        (error: Error & { code?: number }) => error.code === RPC_ERROR_ACTION_MOVE_NOT_MOVED,
    );

    assert.equal(api.blocks.get(ACTION_ID)?.parentId, SOURCE_LIST_ID);
    assert.equal(cache.get(ACTION_ID)?.parentId, "");
    assert.equal(publisher.broadcasts, 0);
});

for (const failure of ["after", "confirm"] as const) {
    test(`${failure === "after" ? "移动调用后失败" : "权威校验失败"}时自动恢复并发布恢复后的任务状态`, async () => {
        const { api, cache, publisher, service } = setup(failure);

        await assert.rejects(
            () => service.move({ actionId: ACTION_ID, projectId: PROJECT_ID }),
            (error: Error & { code?: number }) => error.code === RPC_ERROR_ACTION_MOVE_RECOVERED,
        );

        assert.equal(api.blocks.get(ACTION_ID)?.parentId, SOURCE_LIST_ID);
        assert.equal(cache.get(ACTION_ID)?.parentId, "");
        assert.ok(publisher.changes.includes(ACTION_ID));
    });
}

test("自动恢复失败时按实际目标结构刷新缓存并报告需人工检查", async () => {
    // Regression: 恢复失败且身份 SQL 滞后时，缓存必须跟随已确认的目标物理结构。
    const { api, cache, publisher, service } = setup("restore", { staleIdentity: true });

    await assert.rejects(
        () => service.move({ actionId: ACTION_ID, projectId: PROJECT_ID }),
        (error: Error & { code?: number }) => error.code === RPC_ERROR_ACTION_MOVE_RECOVERY_FAILED,
    );

    assert.equal(api.blocks.get(ACTION_ID)?.parentId, TARGET_LIST_ID);
    assert.equal(cache.get(ACTION_ID)?.parentId, PROJECT_ID);
    assert.ok(publisher.changes.includes(ACTION_ID));
    assert.ok(publisher.changes.includes(PROJECT_ID));
});
