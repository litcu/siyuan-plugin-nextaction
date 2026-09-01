import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

// Regression: Svelte 5 迁移后的移动 Dock 必须继续用真实任务组件完成搜索、页签切换和 Inbox 状态更新。
test("移动 Dock 的真实任务列表保留搜索、页签切换和状态更新", async () => {
    const result = await runSvelteBrowserTest({
        fixtureName: "dock-mobile-interactions",
        browserArgs: ["--window-size=390,844"],
        virtualTimeBudget: 2_000,
        prepareFixture(fixtureRoot) {
            const dockPath = resolve("src/frontend/components/DockSidebar.svelte").replace(/\\/g, "/");
            const taskStorePath = resolve("src/frontend/stores/task-store.ts").replace(/\\/g, "/");
            writeFileSync(
                join(fixtureRoot, "siyuan.js"),
                "export class Dialog {}\nexport class Menu {}\nexport function confirm() {}\nexport function openTab() {}\nexport function showMessage() {}\n",
            );
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import DockSidebar from ${JSON.stringify(dockPath)};
import { taskStore } from ${JSON.stringify(taskStorePath)};

const createTaskEntry = (blockId, title, overrides = {}) => ({
    blockId, identificationSource: "native", contentBlockId: blockId, attrHostId: blockId,
    parentId: "", status: "todo", priority: "medium", importance: 4, effort: 4, due: "", start: "",
    context: "", taskType: "1", order: 0, childIds: [], title, depends: "", depMode: "all",
    sequential: false, repeat: "", repeatState: "", sort: 0, completed: "", note: "", outcome: "",
    dod: "", actionKind: "action", created: "", tags: "", blocked: false, blockedReason: "",
    reviewInterval: 0, reviewDate: "", reminder: "", customFields: {}, ...overrides,
});
for (const task of [
    createTaskEntry("alpha", "Alpha task"),
    createTaskEntry("beta", "Beta task"),
    createTaskEntry("inbox", "Inbox item", { status: "inbox" }),
]) taskStore.applyUpdate(task);

let writes = [];
const bridge = {
    updateTask: async (blockId, attrs) => {
        writes = [...writes, { blockId, attrs }];
        return createTaskEntry(blockId, "Inbox item", { status: attrs["na-status"] || "inbox" });
    },
};
const i18n = new Proxy({
    pluginName: "NextAction", nextAction: "Next Actions", myDay: "My Day", inbox: "Inbox",
    searchPlaceholder: "Search tasks", noResults: "No results", noInboxTasks: "No inbox tasks",
    noTasks: "No tasks", clarify: "Clarify",
}, { get: (target, key) => target[key] || String(key) });
</script>

<div id="writes" data-value={JSON.stringify(writes)}></div>
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
const titles = () => [...document.querySelectorAll(".na-task-card__title")].map((node) => node.textContent.trim());

void (async () => {
    await tick();
    const initialTitles = titles();
    const search = document.querySelector('input[type="search"]');
    search.value = "beta";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    const filteredTitles = titles();
    document.querySelector('button[aria-label="Inbox"]').click();
    await tick();
    const inboxTitles = titles();
    document.querySelector(".na-task-card__activate-btn").click();
    await wait(30);
    const dock = document.querySelector(".na-dock");
    window.__NA_BROWSER_RESULT__({
        viewportWidth: window.innerWidth,
        initialTitles,
        filteredTitles,
        inboxTitles,
        inboxAfterClarify: titles(),
        writes: JSON.parse(document.querySelector("#writes").dataset.value || "[]"),
        noHorizontalOverflow: dock.scrollWidth <= dock.clientWidth,
    });
})().catch((error) => window.__NA_BROWSER_RESULT__({ error: String(error?.stack || error) }));`,
            );
        },
    });

    assert.ok(result.viewportWidth >= 390 && result.viewportWidth <= 500);
    assert.deepEqual(
        { ...result, viewportWidth: 390 },
        {
            viewportWidth: 390,
            initialTitles: ["Alpha task", "Beta task"],
            filteredTitles: ["Beta task"],
            inboxTitles: ["Inbox item"],
            inboxAfterClarify: [],
            writes: [{ blockId: "inbox", attrs: { "na-status": "todo" } }],
            noHorizontalOverflow: true,
        },
    );
});
