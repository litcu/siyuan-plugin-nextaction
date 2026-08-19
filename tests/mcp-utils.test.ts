import test from "node:test";
import assert from "node:assert/strict";

import type { TaskCacheEntry } from "../src/shared/types.ts";
import {
    READ_MCP_TOOL_NAMES,
    WRITE_MCP_TOOL_NAMES,
    buildTaskAttrsFromMcpPatch,
    buildListItemBlockDom,
    createNodeId,
    escapeMarkdownText,
    extractBlockId,
    extractDocumentIdFromPath,
    extractInsertedBlockMeta,
    extractInsertedBlockId,
    searchTasksForMcp,
    getMcpCapabilityEffects,
    getDesiredMcpToolNames,
    taskToMcpDto,
} from "../src/kernel/mcp-utils.ts";

function task(overrides: Partial<TaskCacheEntry> = {}): TaskCacheEntry {
    return {
        blockId: "20260802120000-abcdefg",
        identificationSource: "document",
        attrHostId: "20260802120000-abcdefg",
        parentId: "",
        status: "todo",
        priority: "medium",
        importance: 4,
        effort: 4,
        due: "",
        start: "",
        context: "@office|@phone",
        taskType: "1",
        order: 42,
        childIds: [],
        title: "Call Alice",
        depends: "",
        depMode: "all",
        sequential: false,
        repeat: "",
        repeatState: "",
        sort: 0,
        completed: "",
        note: "Discuss contract",
        created: "2026-08-02T12:00:00",
        tags: "work|calls",
        blocked: false,
        blockedReason: "",
        reviewInterval: 0,
        reviewDate: "",
        reminder: "",
        customFields: {},
        ...overrides,
    };
}

test("MCP 工具清单稳定区分只读和写入工具", () => {
    assert.deepEqual(READ_MCP_TOOL_NAMES, [
        "get_task_metadata",
        "search_tasks",
        "get_tasks",
        "get_next_actions",
        "list_projects",
        "get_my_day",
        "get_review",
        "get_statistics",
    ]);
    assert.deepEqual(WRITE_MCP_TOOL_NAMES, [
        "create_tasks",
        "update_tasks",
        "delete_tasks",
        "convert_blocks_to_tasks",
        "update_my_day",
        "mark_tasks_reviewed",
    ]);
    assert.deepEqual(getDesiredMcpToolNames(false, false), []);
    assert.deepEqual(getDesiredMcpToolNames(true, false), READ_MCP_TOOL_NAMES);
    assert.deepEqual(getDesiredMcpToolNames(true, true), [...READ_MCP_TOOL_NAMES, ...WRITE_MCP_TOOL_NAMES]);
    assert.deepEqual(getMcpCapabilityEffects("get_tasks"), { localRead: true });
    assert.deepEqual(getMcpCapabilityEffects("update_tasks"), { localRead: true, localWrite: true });
});

test("任务 DTO 将内部字符串转换为 MCP 友好结构", () => {
    const dto = taskToMcpDto(
        task({
            depends: "20260802120001-bbbbbbb|20260802120002-ccccccc",
            completed: "2026-08-01T09:00:00|2026-08-02T10:00:00",
            reminder: "[]",
            customFields: { ghost: "internal" },
        }),
        [],
        true,
    );

    assert.equal(dto.id, "20260802120000-abcdefg");
    assert.equal(dto.siyuanUrl, "siyuan://blocks/20260802120000-abcdefg");
    assert.deepEqual(dto.contexts, ["office", "phone"]);
    assert.deepEqual(dto.tags, ["work", "calls"]);
    assert.equal(dto.start, null);
    assert.equal(dto.due, null);
    assert.deepEqual(dto.dependencyIds, ["20260802120001-bbbbbbb", "20260802120002-ccccccc"]);
    assert.deepEqual(dto.completedAt, ["2026-08-01T09:00:00", "2026-08-02T10:00:00"]);
    assert.deepEqual(dto.reminders, { mode: "disabled", items: [] });
    assert.deepEqual(dto.customFields, {});
    assert.equal(dto.isNextAction, true);
    assert.equal((dto as any).repeatState, undefined);
});

test("任务查询支持关键词、项目后代、状态过滤和分页", () => {
    const project = task({ blockId: "project", taskType: "2", title: "Launch", tags: "", order: 5 });
    const child = task({ blockId: "child", parentId: "project", title: "Call Alice", order: 9 });
    const grandchild = task({ blockId: "grandchild", parentId: "child", title: "Email contract", tags: "", order: 8 });
    const done = task({
        blockId: "done",
        parentId: "project",
        title: "Call Bob",
        tags: "",
        status: "done",
        order: 100,
    });

    const result = searchTasksForMcp([project, child, grandchild, done], {
        query: "call",
        projectId: "project",
        statuses: ["todo"],
        limit: 1,
    });

    assert.equal(result.total, 1);
    assert.equal(result.items[0].blockId, "child");
    assert.equal(result.hasMore, false);

    const byContext = searchTasksForMcp([child], { contexts: ["office"] });
    assert.equal(byContext.total, 1);
    assert.equal(searchTasksForMcp([project, child, grandchild, done]).total, 4);
});

test("写入映射只接受白名单字段并正确处理清空", () => {
    const attrs = buildTaskAttrsFromMcpPatch(
        {
            priority: "high",
            contexts: ["office", "@office", "@@phone"],
            tags: [],
            due: null,
            sequential: true,
            dependencyIds: ["20260802120001-bbbbbbb"],
            reminders: { mode: "disabled" },
            kind: "project",
            status: "done",
            repeat: null,
        },
        [],
        task(),
    );

    assert.deepEqual(attrs, {
        "custom-na-priority": "high",
        "custom-na-context": "office|phone",
        "custom-na-tags": "",
        "custom-na-due": "",
        "custom-na-sequential": "1",
        "custom-na-depends": "20260802120001-bbbbbbb",
        "custom-na-reminder": "[]",
        "custom-na-task": "2",
        "custom-na-status": "done",
        "custom-na-repeat": "",
    });

    assert.throws(() => buildTaskAttrsFromMcpPatch({ rawAttribute: "done" } as any, [], task()), /not allowed/);
    assert.throws(() => buildTaskAttrsFromMcpPatch({ due: "2026-02-31" }, [], task()), /valid date/);
    assert.throws(() => buildTaskAttrsFromMcpPatch({ dependencyMode: "some" } as any, [], task()), /dependencyMode/);
    assert.throws(() => buildTaskAttrsFromMcpPatch({ sequential: "yes" } as any, [], task()), /sequential/);
    assert.throws(
        () =>
            buildTaskAttrsFromMcpPatch(
                { reminders: { mode: "custom", items: [{ type: "relative", minutes: 0 }] } },
                [],
                task(),
            ),
        /relative reminder/,
    );
    assert.throws(
        () =>
            buildTaskAttrsFromMcpPatch(
                { reminders: { mode: "custom", items: [{ type: "absolute", time: "2026-02-31T09:00" }] } },
                [],
                task(),
            ),
        /absolute reminder/,
    );
});

test("块 ID、插入结果和 Markdown 标题解析安全", () => {
    assert.equal(extractBlockId("siyuan://blocks/20260802120000-abcdefg"), "20260802120000-abcdefg");
    assert.equal(extractBlockId("siyuan://blocks/20260802120000-abcdefg?focus=1"), "");
    assert.equal(extractBlockId("bad-id"), "");
    assert.equal(extractDocumentIdFromPath("/20260808123456-abcdefg.sy"), "20260808123456-abcdefg");
    assert.equal(extractDocumentIdFromPath("/parent/20260808123456-abcdefg.sy"), "20260808123456-abcdefg");
    assert.equal(extractDocumentIdFromPath("/parent/not-a-document.sy"), "");
    assert.equal(
        extractInsertedBlockId([{ doOperations: [{ action: "insert", id: "20260802120000-abcdefg" }] }]),
        "20260802120000-abcdefg",
    );
    assert.deepEqual(
        extractInsertedBlockMeta([
            {
                doOperations: [
                    {
                        action: "insert",
                        id: "20260802120000-abcdefg",
                        parentID: "20260802119999-parentx",
                        data: '<div data-node-id="20260802120000-abcdefg" data-type="NodeParagraph"><div>Call Alice</div></div>',
                    },
                ],
            },
        ]),
        {
            id: "20260802120000-abcdefg",
            parentId: "20260802119999-parentx",
            nodeType: "NodeParagraph",
        },
    );
    assert.deepEqual(
        extractInsertedBlockMeta([
            {
                doOperations: [
                    {
                        action: "insert",
                        id: "20260802120000-listabc",
                        parentID: "20260802119999-parentx",
                        data: '<div data-node-id="20260802120000-listabc" data-type="NodeList"><div data-node-id="20260802120001-taskitm" data-type="NodeListItem" data-subtype="t"><div data-node-id="20260802120002-tasktxt" data-type="NodeParagraph"><div>Child</div></div></div></div>',
                    },
                ],
            },
        ]),
        {
            id: "20260802120001-taskitm",
            parentId: "20260802119999-parentx",
            nodeType: "NodeListItem",
            contentBlockId: "20260802120002-tasktxt",
            rootId: "20260802120000-listabc",
        },
    );
    assert.deepEqual(
        extractInsertedBlockMeta([
            {
                doOperations: [
                    {
                        action: "insert",
                        id: "20260802120000-listabc",
                        parentID: "20260802119999-parentx",
                        data: '<div data-node-id="20260802120000-listabc" data-type="NodeList"><div data-node-id="20260802120001-childaa" data-type="NodeParagraph"><div>Child</div></div></div>',
                    },
                ],
            },
        ]),
        {
            id: "20260802120001-childaa",
            parentId: "20260802119999-parentx",
            nodeType: "NodeParagraph",
            rootId: "20260802120000-listabc",
        },
    );
    assert.equal(escapeMarkdownText("[Call] *Alice*\nnow"), "\\[Call\\] \\*Alice\\* now");
});

test("列表容器插入使用列表项包裹段落，而不是生成嵌套列表", () => {
    const id = createNodeId();
    assert.match(id, /^\d{14}-[a-z0-9]{7}$/);
    const dom = buildListItemBlockDom("任务 <一>", "o");
    assert.match(dom, /data-type="NodeListItem"/);
    assert.match(dom, /data-subtype="o"/);
    assert.match(dom, /data-type="NodeParagraph"/);
    assert.doesNotMatch(dom, /data-type="NodeList"/);
    assert.match(dom, /任务 &lt;一&gt;/);
});
