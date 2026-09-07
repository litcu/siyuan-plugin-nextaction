import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

test("窄面板提供创建任务入口并打开现有创建对话框", async () => {
    const result = await runSvelteBrowserTest<{
        buttonLabel: string | null;
        createDialogVisible: boolean;
        detailDialogVisible: boolean;
        createCalls: number;
        noHorizontalOverflow: boolean;
    }>({
        fixtureName: "dock-create-task-entry",
        browserArgs: ["--window-size=390,844"],
        virtualTimeBudget: 2_000,
        prepareFixture(fixtureRoot) {
            const dockPath = resolve("src/frontend/components/DockSidebar.svelte").replace(/\\/g, "/");
            const taskStorePath = resolve("src/frontend/stores/task-store.ts").replace(/\\/g, "/");
            writeFileSync(
                join(fixtureRoot, "siyuan.js"),
                `export let latestDialog;
export class Dialog {
    constructor(options) {
        this.options = options;
        this.element = document.createElement("div");
        this.element.innerHTML = '<div class="b3-dialog__scrim"></div><div class="b3-dialog__container"><div class="b3-dialog__header"></div>' + options.content + '</div>';
        document.body.appendChild(this.element);
        latestDialog = this;
    }
    destroy() {
        this.options.destroyCallback?.();
        this.element.remove();
    }
}
export class Menu {}
export function confirm() {}
export function openTab() {}
export function showMessage() {}
`,
            );
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import DockSidebar from ${JSON.stringify(dockPath)};
import { taskStore } from ${JSON.stringify(taskStorePath)};
taskStore.applySettingsUpdate({ taskCreationSettings: { defaultCreateTarget: "inbox", inboxDocumentId: "", dailyNoteNotebookId: "", recentTargets: [], presets: [] } });
const i18n = new Proxy({
    pluginName: "NextAction", nextAction: "Next Actions", myDay: "My Day", inbox: "Inbox",
    createTask: "Create task", task: "Task", project: "Project", taskType: "Task type",
}, { get: (target, key) => target[key] || String(key) });
const createdTask = {
    blockId: "20260907120000-docktask", identificationSource: "native", contentBlockId: "20260907120000-docktask",
    attrHostId: "20260907120000-docktask", parentId: "", status: "inbox", priority: "medium", importance: 4,
    effort: 4, due: "", start: "", context: "", taskType: "1", order: 0, childIds: [], title: "Dock task",
    depends: "", depMode: "all", sequential: false, repeat: "", repeatState: "", sort: 0, completed: "",
    note: "", outcome: "", dod: "", actionKind: "action", created: "", tags: "", blocked: false,
    blockedReason: "", reviewInterval: 0, reviewDate: "", reminder: "", customFields: {},
};
let createCalls = 0;
const bridge = {
    listMcpTargetNotebooks: async () => [],
    createTask: async () => {
        createCalls += 1;
        window.__NA_CREATE_CALLS__ = createCalls;
        return { task: { id: createdTask.blockId, title: createdTask.title }, destination: {}, warnings: [] };
    },
    getTask: async () => createdTask,
};
</script>
<main><DockSidebar {bridge} {i18n} /></main>
<style>
:global(html), :global(body), :global(#app), main { width: 100%; height: 100%; margin: 0; }
</style>
`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import { mount, tick } from "svelte";
import Harness from "./Harness.svelte";
mount(Harness, { target: document.querySelector("#app") });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
void (async () => {
    await tick();
    const button = document.querySelector('button[aria-label="Create task"]');
    button?.click();
    await wait(120);
    const title = document.querySelector('input[aria-label="Create task"]');
    title.value = "Dock task";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await wait(300);
    const dock = document.querySelector(".na-dock");
    window.__NA_BROWSER_RESULT__({
        buttonLabel: button?.getAttribute("aria-label") || null,
        createDialogVisible: Boolean(document.querySelector(".na-create-task")),
        detailDialogVisible: Boolean(document.querySelector(".na-task-dialog-content")),
        createCalls: window.__NA_CREATE_CALLS__ || 0,
        noHorizontalOverflow: dock ? dock.scrollWidth <= dock.clientWidth : false,
    });
})().catch((error) => window.__NA_BROWSER_RESULT__({ error: String(error?.stack || error) }));`,
            );
        },
    });

    assert.deepEqual(result, {
        buttonLabel: "Create task",
        createDialogVisible: false,
        detailDialogVisible: true,
        createCalls: 1,
        noHorizontalOverflow: true,
    });
});
