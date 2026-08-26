import test from "node:test";
import assert from "node:assert/strict";
import { SiyuanActionMoveStructurePort } from "../src/kernel/action-move-structure-port.ts";
import { FakeSiyuanApi } from "./helpers/fakes.ts";

const SOURCE_DOCUMENT_ID = "20260825100000-sourced";
const SOURCE_LIST_ID = "20260825100001-sourcel";
const ACTION_ID = "20260825100002-actionx";
const CONTENT_ID = "20260825100003-content";
const CHILD_LIST_ID = "20260825100004-childli";
const CHILD_ACTION_ID = "20260825100005-childax";
const PROJECT_ID = "20260825100006-project";
const SOURCE_GUARD_ID = "20260825100007-srcgard";
const TARGET_LIST_ID = "20260825100008-targetl";
const TARGET_ANCHOR_ID = "20260825100009-tgtanch";
const TARGET_HEADING_ID = "20260825100010-heading";
const TARGET_PARAGRAPH_ID = "20260825100011-paragr";
const SOURCE_AFTER_ID = "20260825100012-srcnext";
const SOURCE_HEADING_ID = "20260825100013-srchead";

class MoveFakeSiyuanApi extends FakeSiyuanApi {
    override async request<T = unknown>(path: string, body: object = {}): Promise<T> {
        const input = body as { id?: string; parentID?: string; previousID?: string; nextID?: string };
        if (path === "/api/block/insertBlock") {
            this.requests.push({ path, body });
            const anchor = this.blocks.get(input.previousID || input.nextID || "");
            assert.ok(anchor);
            if (anchor.parentId === PROJECT_ID) {
                const project = this.blocks.get(PROJECT_ID);
                assert.ok(project);
                this.addBlock(TARGET_LIST_ID, "l", "", project.box, project.hpath, {
                    subtype: "t",
                    parentId: project.id,
                });
                this.addBlock(TARGET_ANCHOR_ID, "i", "NextAction move anchor", project.box, project.hpath, {
                    subtype: "t",
                    parentId: TARGET_LIST_ID,
                    markdown: "- [ ] NextAction move anchor",
                });
                return [{ doOperations: [{ action: "insert", id: TARGET_LIST_ID, parentID: project.id }] }] as T;
            }
            this.addBlock(SOURCE_GUARD_ID, "i", "NextAction move guard", anchor.box, anchor.hpath, {
                subtype: "t",
                parentId: anchor.parentId,
                markdown: "- [ ] NextAction move guard",
            });
            return [{ doOperations: [{ action: "insert", id: SOURCE_GUARD_ID, parentID: anchor.parentId }] }] as T;
        }
        if (path === "/api/block/appendBlock") {
            this.requests.push({ path, body });
            const project = this.blocks.get(input.parentID || "");
            assert.ok(project);
            this.addBlock(TARGET_LIST_ID, "l", "", project.box, project.hpath, {
                subtype: "t",
                parentId: project.id,
            });
            this.addBlock(TARGET_ANCHOR_ID, "i", "NextAction move anchor", project.box, project.hpath, {
                subtype: "t",
                parentId: TARGET_LIST_ID,
                markdown: "- [ ] NextAction move anchor",
            });
            return [{ doOperations: [{ action: "insert", id: TARGET_LIST_ID, parentID: project.id }] }] as T;
        }
        if (path === "/api/block/moveBlock") {
            this.requests.push({ path, body });
            const block = this.blocks.get(input.id || "");
            assert.ok(block);
            const previous = this.blocks.get(input.previousID || "");
            const requestedParent = this.blocks.get(input.parentID || "");
            if (requestedParent?.type === "h") throw new Error("A heading cannot receive children through parentID");
            const parentId = (previous?.type === "h" ? previous.id : previous?.parentId) || input.parentID || "";
            assert.ok(parentId);
            block.parentId = parentId;
            this.blocks.delete(block.id);
            this.blocks.set(block.id, block);
            return null as T;
        }
        return super.request<T>(path, body);
    }
}

class LaggingMoveFakeSiyuanApi extends MoveFakeSiyuanApi {
    staleAncestryReads = 0;
    private moved = false;

    override async request<T = unknown>(path: string, body: object = {}): Promise<T> {
        const result = await super.request<T>(path, body);
        if (path === "/api/block/moveBlock" && (body as { id?: string }).id === ACTION_ID) this.moved = true;
        return result;
    }

    override async query<T = Record<string, unknown>>(statement: string): Promise<T[]> {
        if (!this.moved || !/WITH\s+RECURSIVE\s+ancestors/i.test(statement) || this.staleAncestryReads > 0) {
            return super.query<T>(statement);
        }
        const action = this.blocks.get(ACTION_ID);
        assert.ok(action);
        const currentParentId = action.parentId;
        action.parentId = SOURCE_LIST_ID;
        this.staleAncestryReads++;
        try {
            return await super.query<T>(statement);
        } finally {
            action.parentId = currentParentId;
        }
    }
}

function setup() {
    const api = new MoveFakeSiyuanApi();
    api.addBlock(SOURCE_DOCUMENT_ID, "d", "Source notes");
    api.addBlock(SOURCE_LIST_ID, "l", "", "notebook", "/Source notes", {
        subtype: "t",
        parentId: SOURCE_DOCUMENT_ID,
    });
    api.addBlock(ACTION_ID, "i", "Move safely", "notebook", "/Source notes", {
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
    api.addBlock(SOURCE_AFTER_ID, "p", "Source tail", "notebook", "/Source notes", {
        parentId: SOURCE_DOCUMENT_ID,
    });
    api.addBlock(PROJECT_ID, "d", "Ship release", "notebook", "/Ship release");
    api.addBlock(TARGET_HEADING_ID, "h", "Plan", "notebook", "/Ship release", { parentId: PROJECT_ID });
    api.addBlock(TARGET_PARAGRAPH_ID, "p", "Notes", "notebook", "/Ship release", { parentId: PROJECT_ID });
    return { api, port: new SiyuanActionMoveStructurePort(api) };
}

test("结构端口把 Action 移到用户选择的 Project 文档相邻锚点之间", async () => {
    const { api, port } = setup();
    const plan = await port.prepare(ACTION_ID, PROJECT_ID, {
        previousId: TARGET_HEADING_ID,
        nextId: TARGET_PARAGRAPH_ID,
    });

    await port.execute(plan);

    const targetInsert = api.requests.find(
        (request) =>
            request.path === "/api/block/insertBlock" &&
            (request.body as { previousID?: string }).previousID === TARGET_HEADING_ID,
    );
    assert.ok(targetInsert);
    assert.equal(api.blocks.get(ACTION_ID)?.parentId, SOURCE_LIST_ID);
    assert.equal(api.blocks.get(SOURCE_LIST_ID)?.parentId, PROJECT_ID);
});

test("指定落点锚点在写入前失效时停止移动", async () => {
    // Regression: 预览后目标相邻锚点被删除时，不得退化为其他落点继续写入。
    const { api, port } = setup();
    const plan = await port.prepare(ACTION_ID, PROJECT_ID, {
        previousId: TARGET_HEADING_ID,
        nextId: TARGET_PARAGRAPH_ID,
    });
    api.blocks.delete(TARGET_PARAGRAPH_ID);

    await assert.rejects(
        () => port.execute(plan),
        (error: Error & { code?: number }) => error.code === -32013,
    );

    assert.equal(api.blocks.get(ACTION_ID)?.parentId, SOURCE_LIST_ID);
    assert.equal(api.blocks.has(TARGET_LIST_ID), false);
    assert.equal(api.blocks.has(SOURCE_GUARD_ID), false);
});

test("结构端口把唯一原生任务列表项及其子树移动到 Project 文档末尾并清理临时锚点", async () => {
    const { api, port } = setup();
    const plan = await port.prepare(ACTION_ID, PROJECT_ID);

    await port.execute(plan);
    assert.equal(api.blocks.get(ACTION_ID)?.parentId, SOURCE_LIST_ID);
    assert.equal(api.blocks.has(SOURCE_GUARD_ID), false);
    assert.ok(api.blocks.has(TARGET_ANCHOR_ID));

    await port.commit(plan);
    const moved = await port.inspect(ACTION_ID, plan);
    assert.equal(moved.location.documentId, PROJECT_ID);
    assert.equal(moved.location.parentId, SOURCE_LIST_ID);
    assert.deepEqual(new Set(moved.subtreeIds), new Set(plan.source.subtreeIds));
    assert.equal(api.blocks.has(SOURCE_LIST_ID), true);
    assert.equal(api.blocks.get(SOURCE_LIST_ID)?.parentId, PROJECT_ID);
    assert.equal(api.blocks.has(TARGET_LIST_ID), false);
    assert.equal(api.blocks.has(SOURCE_GUARD_ID), false);
    assert.equal(api.blocks.has(TARGET_ANCHOR_ID), false);
    assert.equal(api.blocks.get(CONTENT_ID)?.parentId, ACTION_ID);
    assert.equal(api.blocks.get(CHILD_LIST_ID)?.parentId, ACTION_ID);
    assert.equal(api.blocks.get(CHILD_ACTION_ID)?.parentId, CHILD_LIST_ID);
});

test("结构端口可在提交前把已移动 Action 恢复到原列表并清理目标临时结构", async () => {
    const { api, port } = setup();
    const plan = await port.prepare(ACTION_ID, PROJECT_ID);

    await port.execute(plan);
    await port.restore(plan);

    const restored = await port.inspect(ACTION_ID, plan);
    assert.equal(port.isAtSource(plan, restored), true);
    assert.equal(restored.location.documentId, SOURCE_DOCUMENT_ID);
    assert.equal(restored.location.parentId, SOURCE_LIST_ID);
    assert.equal(api.blocks.has(SOURCE_GUARD_ID), false);
    assert.equal(api.blocks.has(TARGET_LIST_ID), false);
    assert.equal(api.blocks.has(TARGET_ANCHOR_ID), false);
});

test("唯一 Action 成功提交后仍可恢复原列表容器和相邻位置", async () => {
    const { api, port } = setup();
    const plan = await port.prepare(ACTION_ID, PROJECT_ID);

    await port.execute(plan);
    await port.commit(plan);
    await port.validateUndoSource(plan);
    await port.restore(plan);

    const restored = await port.inspect(ACTION_ID, plan);
    assert.equal(port.isAtSource(plan, restored), true);
    assert.equal(api.blocks.get(ACTION_ID)?.parentId, SOURCE_LIST_ID);
    assert.equal(api.blocks.get(SOURCE_LIST_ID)?.parentId, SOURCE_DOCUMENT_ID);
    assert.equal(api.blocks.has(TARGET_LIST_ID), false);
});

test("标题下的唯一 Action 撤销时使用标题前置锚点恢复列表", async () => {
    // Regression: 思源拒绝 parentID 指向标题，标题首个子块必须通过 previousID 恢复。
    const { api, port } = setup();
    api.addBlock(SOURCE_HEADING_ID, "h", "Source section", "notebook", "/Source notes", {
        parentId: SOURCE_DOCUMENT_ID,
    });
    api.blocks.get(SOURCE_LIST_ID)!.parentId = SOURCE_HEADING_ID;

    const plan = await port.prepare(ACTION_ID, PROJECT_ID);
    await port.execute(plan);
    await port.commit(plan);
    await port.validateUndoSource(plan);
    await port.restore(plan);

    const restoreRequest = [...api.requests]
        .reverse()
        .find(
            (request) =>
                request.path === "/api/block/moveBlock" && (request.body as { id?: string }).id === SOURCE_LIST_ID,
        );
    assert.equal((restoreRequest?.body as { previousID?: string }).previousID, SOURCE_HEADING_ID);
    assert.equal(api.blocks.get(SOURCE_LIST_ID)?.parentId, SOURCE_HEADING_ID);
});

test("原位置相邻锚点删除后拒绝撤销且保持目标结构", async () => {
    // Regression: 原锚点缺失时不得猜测一个近似来源位置执行反向移动。
    const { api, port } = setup();
    const plan = await port.prepare(ACTION_ID, PROJECT_ID);
    await port.execute(plan);
    await port.commit(plan);
    api.blocks.delete(SOURCE_AFTER_ID);

    await assert.rejects(
        () => port.validateUndoSource(plan),
        (error: Error & { code?: number }) => error.code === -32013,
    );

    const current = await port.inspect(ACTION_ID, plan);
    assert.equal(await port.isAtTarget(plan, current), true);
    assert.equal(api.blocks.get(SOURCE_LIST_ID)?.parentId, PROJECT_ID);
});

test("结构端口等待 SQL 祖先链与实时子块结构在移动后重新一致", async () => {
    // Regression: moveBlock 后 SQL 短暂保留源祖先链时，不应误判移动失败并进入恢复。
    const api = new LaggingMoveFakeSiyuanApi();
    api.addBlock(SOURCE_DOCUMENT_ID, "d", "Source notes");
    api.addBlock(SOURCE_LIST_ID, "l", "", "notebook", "/Source notes", {
        subtype: "t",
        parentId: SOURCE_DOCUMENT_ID,
    });
    api.addBlock(ACTION_ID, "i", "Move safely", "notebook", "/Source notes", {
        subtype: "t",
        parentId: SOURCE_LIST_ID,
        markdown: "- [ ] Move safely",
    });
    api.addBlock(CONTENT_ID, "p", "Move safely", "notebook", "/Source notes", { parentId: ACTION_ID });
    api.addBlock(PROJECT_ID, "d", "Ship release", "notebook", "/Ship release");
    const port = new SiyuanActionMoveStructurePort(api, { consistencyDelayMs: 0 });
    const plan = await port.prepare(ACTION_ID, PROJECT_ID);

    await port.execute(plan);
    const moved = await port.inspect(ACTION_ID, plan);

    assert.equal(api.staleAncestryReads, 0);
    assert.equal(moved.location.documentId, PROJECT_ID);
    assert.equal(moved.location.parentId, SOURCE_LIST_ID);
});
