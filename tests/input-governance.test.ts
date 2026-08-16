import test from "node:test";
import assert from "node:assert/strict";
import type * as kernel from "siyuan/kernel";
import { areBlockIds, assertBlockId, extractBlockId, isBlockId, isBlockIdPipe, isOptionalBlockId } from "../src/shared/block-id.ts";
import { escapeSqlLiteral, sql } from "../src/shared/sql.ts";
import { buildTaskAttrsFromMcpPatch } from "../src/kernel/mcp-utils.ts";
import { McpToolManager } from "../src/kernel/mcp-tool-manager.ts";
import type { TaskService } from "../src/kernel/task-service.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import { ATTR_DEPENDS, ATTR_PARENT } from "../src/shared/constants.ts";
import { FakeSiyuanApi, taskFactory } from "./helpers/fakes.ts";

const ID = "20260816123456-abcdefg";

test("block ID 只接受规范 raw ID，外部入口可接受锚定 URI", () => {
    assert.equal(isBlockId(ID), true);
    assert.equal(isBlockId(ID.toUpperCase()), false);
    assert.equal(isBlockId(` ${ID}`), false);
    assert.equal(extractBlockId(ID), ID);
    assert.equal(extractBlockId(`siyuan://blocks/${ID}`), ID);
    assert.equal(extractBlockId(`prefix siyuan://blocks/${ID}`), "");
    assert.equal(extractBlockId(`siyuan://blocks/${ID}/child`), "");
    assert.equal(isOptionalBlockId(""), true);
    assert.equal(areBlockIds([ID, ID]), true);
    assert.equal(areBlockIds([ID, `siyuan://blocks/${ID}`]), false);
    assert.equal(isBlockIdPipe(`${ID}|${ID}`), true);
    assert.equal(isBlockIdPipe(`${ID}|siyuan://blocks/${ID}`), false);
    assert.throws(() => assertBlockId(`siyuan://blocks/${ID}`), (error: unknown) => {
        return error instanceof Error && (error as Error & { code?: number }).code === -32001;
    });
});

test("MCP 任务关系输入接受链接并在进入业务服务前规范化", () => {
    const attrs = buildTaskAttrsFromMcpPatch({
        parentId: `siyuan://blocks/${ID}`,
        dependencyIds: [ID, `siyuan://blocks/${ID}`],
    }, [], taskFactory(ID));
    assert.equal(attrs[ATTR_PARENT], ID);
    assert.equal(attrs[ATTR_DEPENDS], ID);
});

test("MCP 文档入口接受完整块链接并只向 SQL 传递 raw ID", async () => {
    const api = new FakeSiyuanApi();
    api.addBlock(ID, "d", "Inbox", "notebook", "/Inbox");
    api.notebooks.push({ id: "notebook", name: "Notebook" });
    const siyuan = {
        plugin: { name: "nextaction", version: "test" },
        logger: { info: async () => {}, warn: async () => {}, error: async () => {} },
    } as unknown as kernel.ISiyuan;
    const manager = new McpToolManager(
        siyuan,
        {} as TaskService,
        DEFAULT_SETTINGS,
        api,
    );

    const result = await manager.resolveDocumentTarget(`siyuan://blocks/${ID}`);
    assert.equal(result.id, ID);
    const sqlRequest = api.requests.find(request => request.path === "/api/query/sql");
    assert.match(String((sqlRequest?.body as { stmt?: string }).stmt), new RegExp(`'${ID}'`));
    assert.doesNotMatch(String((sqlRequest?.body as { stmt?: string }).stmt), /siyuan:\/\//);
});

test("SQL helper 对字面量统一做单引号 doubling", () => {
    assert.equal(escapeSqlLiteral("O'Brien"), "O''Brien");
    assert.equal(sql`SELECT * FROM blocks WHERE content = ${"O'Brien"}`, "SELECT * FROM blocks WHERE content = 'O''Brien'");
});
