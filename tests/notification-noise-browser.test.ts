import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

type NotificationNoiseResult = {
    notificationsAfterStatus: number;
    notificationsAfterWarning: number;
    notificationsAfterQuickComplete: number;
    notificationsAfterContextStatus: number;
    notificationsAfterConversions: number;
    notificationsAfterCountResult: number;
    updatedStatuses: string[];
    convertedTypes: string[];
    messages: Array<{ message: string; type: string }>;
};

// Regression: UI 已即时更新的成功操作曾重复弹出思源内置消息，造成通知噪音。
test("即时可见的任务操作保持静默，但警告与转换计数仍通知", async () => {
    const result = await runSvelteBrowserTest<NotificationNoiseResult>({
        fixtureName: "notification-noise",
        prepareFixture(fixtureRoot) {
            const statusMenuPath = resolve("src/frontend/utils.ts").replace(/\\/g, "/");
            const quickMenuPath = resolve("src/frontend/components/timeline/TaskQuickMenu.ts").replace(/\\/g, "/");
            const contextMenuPath = resolve("src/frontend/components/task-context-menu.ts").replace(/\\/g, "/");
            const commandControllerPath = resolve("src/frontend/controllers/task-command-controller.ts").replace(
                /\\/g,
                "/",
            );
            writeFileSync(
                join(fixtureRoot, "siyuan.js"),
                `export const menus = [];
export const messages = [];
export class Menu {
    constructor(id) { this.id = id; this.items = []; menus.push(this); }
    addItem(item) { this.items.push(item); }
    addSeparator() {}
    open() {}
}
export class Dialog {}
export function confirm() {}
export function getAllEditor() { return []; }
export async function openTab() {}
export function showMessage(message, _timeout, type) { messages.push({ message, type }); }
`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import { menus, messages } from "siyuan";
import { showStatusMenu } from ${JSON.stringify(statusMenuPath)};
import { showTaskQuickMenu } from ${JSON.stringify(quickMenuPath)};
import { showTaskContextMenu } from ${JSON.stringify(contextMenuPath)};
import { TaskCommandController } from ${JSON.stringify(commandControllerPath)};

const task = {
    blockId: "20260825191000-task001", status: "todo", priority: "medium", repeat: "", repeatState: "",
    taskType: "1", parentId: "", title: "Visible task", childIds: [],
};
const i18n = new Proxy({
    statusInbox: "Inbox", statusTodo: "Todo", statusDoing: "Doing", statusWaiting: "Waiting",
    statusSomeday: "Someday", statusDone: "Done", markComplete: "Mark complete",
    cancelSchedule: "Unschedule", setPriority: "Set priority", removeFromMyDay: "Remove from My Day",
    projectReopenedNotice: "Project reopened warning", convertToTask: "Convert to task",
    convertToProject: "Convert to project", convertToTaskWithChildren: "Convert with children",
    convertToTaskWithChildrenResult: "Converted {converted}, skipped {skipped}", pluginName: "NextAction",
}, { get: (target, key) => target[key] || String(key) });
let warningNext = false;
let updatedStatuses = [];
let convertedTypes = [];
const bridge = {
    async updateTask(_blockId, attrs) {
        updatedStatuses = [...updatedStatuses, attrs["na-status"]];
        return { ...task, status: attrs["na-status"], ...(warningNext ? { _warning: "projectReopened" } : {}) };
    },
    async convertToTask(_blockId, _title, taskType) {
        convertedTypes = [...convertedTypes, taskType];
        return task;
    },
    async convertToTaskWithChildren() { return { converted: 2, skipped: 1 }; },
};

async function run() {
const firstStatus = showStatusMenu(task, new MouseEvent("click", { clientX: 10, clientY: 10 }), bridge, i18n);
await menus.at(-1).items.find((item) => item.label === "Done").click();
await firstStatus;
const notificationsAfterStatus = messages.length;

warningNext = true;
const warningStatus = showStatusMenu(task, new MouseEvent("click", { clientX: 10, clientY: 10 }), bridge, i18n);
await menus.at(-1).items.find((item) => item.label === "Waiting").click();
await warningStatus;
warningNext = false;
const notificationsAfterWarning = messages.length;

showTaskQuickMenu(task, 10, 10, bridge, i18n, {
    onScheduleRemoved() {}, onTaskUpdated() {}, onRemovedFromMyDay() {},
});
await menus.at(-1).items.find((item) => item.label === "Mark complete").click();
const notificationsAfterQuickComplete = messages.length;

showTaskContextMenu(task, new MouseEvent("click"), bridge, i18n, {
    onUpdated() {}, onRemoved() {},
});
await menus.at(-1).items.find((item) => item.label === "Done").click();
const notificationsAfterContextStatus = messages.length;

const plugin = { i18n, protyleSlash: [], addCommand() {} };
const controller = new TaskCommandController(plugin, false, () => bridge, () => {});
controller.registerSlashCommands();
const node = document.createElement("div");
node.dataset.nodeId = task.blockId;
node.innerHTML = '<div contenteditable="true">Visible task</div>';
await plugin.protyleSlash.find((item) => item.id === "convertToTask").callback({}, node);
await plugin.protyleSlash.find((item) => item.id === "convertToProject").callback({}, node);
const notificationsAfterConversions = messages.length;
await plugin.protyleSlash.find((item) => item.id === "convertToTaskWithChildren").callback({}, node);

window.__NA_BROWSER_RESULT__({
    notificationsAfterStatus,
    notificationsAfterWarning,
    notificationsAfterQuickComplete,
    notificationsAfterContextStatus,
    notificationsAfterConversions,
    notificationsAfterCountResult: messages.length,
    updatedStatuses,
    convertedTypes,
    messages,
});
}
run().catch((error) => window.__NA_BROWSER_RESULT__({ error: String(error?.message || error) }));
`,
            );
        },
    });

    assert.equal(result.notificationsAfterStatus, 0);
    assert.equal(result.notificationsAfterWarning, 1);
    assert.equal(result.notificationsAfterQuickComplete, 1);
    assert.equal(result.notificationsAfterContextStatus, 1);
    assert.equal(result.notificationsAfterConversions, 1);
    assert.equal(result.notificationsAfterCountResult, 2);
    assert.deepEqual(result.updatedStatuses, ["done", "waiting", "done", "done"]);
    assert.deepEqual(result.convertedTypes, ["1", "2"]);
    assert.deepEqual(result.messages, [
        { message: "[NextAction] Project reopened warning", type: "info" },
        { message: "[NextAction] Converted 2, skipped 1", type: "info" },
    ]);
});
