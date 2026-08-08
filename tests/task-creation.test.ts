import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    DEFAULT_TASK_CREATION_SETTINGS,
    mergeTaskCreationSettings,
    validateTaskCreationSettings,
} from "../src/shared/task-creation.ts";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("任务创建设置限制最近目标并保留命名预设", () => {
    const recentTargets = [0, 1, 2, 3].map(index => ({
        type: "document" as const,
        format: "paragraph" as const,
        documentId: `20260808120${index}00-abcdefg`,
        documentTitle: `文档 ${index}`,
    }));
    const settings = mergeTaskCreationSettings(DEFAULT_TASK_CREATION_SETTINGS, {
        recentTargets,
        presets: [{ id: "work", name: "工作", target: recentTargets[0] }],
    });

    assert.equal(settings.recentTargets.length, 3);
    assert.equal(settings.presets[0].name, "工作");
});

test("任务创建设置拒绝非法目标和重复预设 ID", () => {
    assert.match(validateTaskCreationSettings({ recentTargets: [{ type: "nowhere", format: "paragraph" } as any] }), /invalid target/);
    assert.match(validateTaskCreationSettings({
        presets: [
            { id: "same", name: "A", target: { type: "inbox", format: "paragraph" } },
            { id: "same", name: "B", target: { type: "inbox", format: "list" } },
        ],
    }), /unique/);
});

test("面板创建与 MCP 共用 createTask 内核入口和 canonical 返回值", () => {
    const kernel = source("../src/kernel.ts");
    const rpc = source("../src/kernel/rpc-server.ts");
    const bridge = source("../src/frontend/kernel-bridge.ts");
    const dialog = source("../src/frontend/components/CreateTaskDialog.svelte");
    const dialogHost = source("../src/frontend/dialogs/create-task-dialog.ts");

    assert.match(kernel, /createTask:\s*\(input\)\s*=>\s*this\.mcpToolManager\.createTaskForPlugin\(input\)/);
    assert.match(rpc, /rpc\.bind\("createTask"/);
    assert.match(bridge, /createTask\(input:\s*CreateTaskInput\)/);
    assert.match(dialog, /bridge\.createTask\(input\)/);
    assert.match(dialog, /bridge\.getTask\(result\.task\.id\)/);
    assert.match(dialogHost, /create-task-dialog\.scss\?inline/);
    assert.match(dialogHost, /style\.textContent = createTaskDialogStyles/);
});

test("MCP 创建目标向后兼容并支持段落与列表形式", () => {
    const manager = source("../src/kernel/mcp-tool-manager.ts");

    assert.match(manager, /format:\s*\{\s*type:\s*"string",\s*enum:\s*\[\.\.\.CREATE_TASK_FORMATS\]/);
    assert.match(manager, /destination\.format === undefined[\s\S]*\? "paragraph"/);
    assert.match(manager, /format === "list" \? "- " \+ escapeMarkdownText\(title\)/);
    assert.match(manager, /block destinations always use list format/);
});

test("项目创建使用子文档并通过文档接口回滚", () => {
    const manager = source("../src/kernel/mcp-tool-manager.ts");

    assert.match(manager, /createProjectDocument\(title, destination\)/);
    assert.match(manager, /\/api\/filetree\/createDocWithMd/);
    assert.match(manager, /parentID:\s*parent\.id/);
    assert.match(manager, /projects require an inbox, daily_note, or document destination/);
    assert.match(manager, /\/api\/filetree\/removeDocByID/);
});

test("文档选择器只使用思源搜索接口且不暴露 ID 输入", () => {
    const manager = source("../src/kernel/mcp-tool-manager.ts");
    const picker = source("../src/frontend/ui/NaDocumentPicker.svelte");
    const dialog = source("../src/frontend/components/CreateTaskDialog.svelte");

    assert.match(manager, /\/api\/filetree\/searchDocs/);
    assert.match(manager, /\/api\/filetree\/getIDsByHPath/);
    assert.match(manager, /extractDocumentIdFromPath\(result\.path\)/);
    assert.match(picker, /searchMcpTargetDocuments/);
    assert.doesNotMatch(picker, /listMcpTargetDocuments|createCurrentDocument|openChildren|breadcrumbs/);
    assert.match(dialog, /NaDocumentPicker/);
    assert.doesNotMatch(dialog, /preset|recentTargets|NaAccordion|NaDotRating/);
    assert.doesNotMatch(dialog, /placeholder=.*202\d{11}|siyuan:\/\/blocks/);
});

test("面板提供全局和上下文创建入口", () => {
    const app = source("../src/frontend/components/NextActionApp.svelte");
    const project = source("../src/frontend/components/ProjectView.svelte");
    const detail = source("../src/frontend/components/TaskDetail.svelte");

    assert.match(app, /openCreateTaskDialog/);
    assert.match(app, /variant="primary" icon="iconAdd"/);
    assert.match(project, /onCreateChild/);
    assert.match(detail, /createChildTask/);
});
