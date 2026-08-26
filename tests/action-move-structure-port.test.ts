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

class MoveFakeSiyuanApi extends FakeSiyuanApi {
    override async request<T = unknown>(path: string, body: object = {}): Promise<T> {
        const input = body as { id?: string; parentID?: string; previousID?: string };
        if (path === "/api/block/insertBlock") {
            this.requests.push({ path, body });
            const previous = this.blocks.get(input.previousID || "");
            assert.ok(previous);
            this.addBlock(SOURCE_GUARD_ID, "i", "NextAction move guard", previous.box, previous.hpath, {
                subtype: "t",
                parentId: previous.parentId,
                markdown: "- [ ] NextAction move guard",
            });
            return [{ doOperations: [{ action: "insert", id: SOURCE_GUARD_ID, parentID: previous.parentId }] }] as T;
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
            const parentId = previous?.parentId || input.parentID || "";
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
    api.addBlock(PROJECT_ID, "d", "Ship release", "notebook", "/Ship release");
    return { api, port: new SiyuanActionMoveStructurePort(api) };
}

test("结构端口把唯一原生任务列表项及其子树移动到 Project 文档末尾并清理临时锚点", async () => {
    const { api, port } = setup();
    const plan = await port.prepare(ACTION_ID, PROJECT_ID);

    await port.execute(plan);
    assert.equal(api.blocks.get(ACTION_ID)?.parentId, TARGET_LIST_ID);
    assert.ok(api.blocks.has(SOURCE_GUARD_ID));
    assert.ok(api.blocks.has(TARGET_ANCHOR_ID));

    await port.commit(plan);
    const moved = await port.inspect(ACTION_ID, plan);
    assert.equal(moved.location.documentId, PROJECT_ID);
    assert.equal(moved.location.parentId, TARGET_LIST_ID);
    assert.deepEqual(new Set(moved.subtreeIds), new Set(plan.source.subtreeIds));
    assert.equal(api.blocks.has(SOURCE_LIST_ID), false);
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
    assert.equal(moved.location.parentId, TARGET_LIST_ID);
});
