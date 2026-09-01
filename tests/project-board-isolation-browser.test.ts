import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

// Regression: 快速切换 Project 时，排队保存曾可能把前一个 Project 的看板偏好写到后一个 Project。
test("看板偏好在 Project 切换和排队持久化期间保持隔离", async () => {
    const result = await runSvelteBrowserTest({
        fixtureName: "project-board-isolation",
        browserArgs: ["--window-size=390,844"],
        virtualTimeBudget: 4_000,
        prepareFixture(fixtureRoot) {
            const componentPath = resolve("src/frontend/components/ProjectView.svelte").replace(/\\/g, "/");
            const taskStorePath = resolve("src/frontend/stores/task-store.ts").replace(/\\/g, "/");
            const registryPath = resolve("src/frontend/controllers/project-definition-controller.ts").replace(
                /\\/g,
                "/",
            );
            writeFileSync(
                join(fixtureRoot, "siyuan.js"),
                "export class Dialog {}\nexport class Menu {}\nexport function confirm() {}\nexport function openTab() {}\nexport function showMessage() {}\n",
            );
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import ProjectView from ${JSON.stringify(componentPath)};
import { taskStore } from ${JSON.stringify(taskStorePath)};
import { ProjectDefinitionControllerRegistry } from ${JSON.stringify(registryPath)};

const createTaskEntry = (blockId, title, overrides = {}) => ({
    blockId, identificationSource: "native", contentBlockId: blockId, attrHostId: blockId,
    parentId: "", status: "doing", priority: "medium", importance: 4, effort: 4, due: "", start: "",
    context: "", taskType: "1", order: 0, childIds: [], title, depends: "", depMode: "all",
    sequential: false, repeat: "", repeatState: "", sort: 0, completed: "", note: "", outcome: "",
    dod: "", actionKind: "action", created: "", tags: "", blocked: false, blockedReason: "",
    reviewInterval: 0, reviewDate: "", reminder: "", customFields: {}, ...overrides,
});
const projectA = createTaskEntry("project-a", "Project A", { identificationSource: "document", taskType: "2", actionKind: "", childIds: ["action-a"] });
const projectB = createTaskEntry("project-b", "Project B", { identificationSource: "document", taskType: "2", actionKind: "", childIds: ["action-b"] });
const actionA = createTaskEntry("action-a", "Action A", { parentId: "project-a" });
const actionB = createTaskEntry("action-b", "Action B", { parentId: "project-b" });
for (const task of [projectA, actionA, projectB, actionB]) taskStore.applyUpdate(task);

let writes = [];
const bridge = {
    getProjectBoardPreferences: async () => ({ version: 1, projects: {} }),
    updateProjectBoardPreference: async (projectId, preference) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        writes = [...writes, { projectId, preference }];
        return { version: 1, projects: { [projectId]: preference } };
    },
};
const i18n = new Proxy({
    projectViewOverview: "Overview", projectViewBoard: "Board", projectList: "Projects", project: "Project",
    projectBoardGroupBy: "Group by", sortBy: "Sort by", status: "Status", priority: "Priority",
    importance: "Importance", projectBoardStage: "Stage", sortByOrder: "Manual order", sortByDue: "Due date",
    sortByImportance: "Importance", sortByPriority: "Priority", projectBoardSortDirection: "Sort direction",
    sortDesc: "Descending", sortAsc: "Ascending", projectBoardUnassignedStage: "Unassigned stage",
    projectDropHere: "Drop tasks here", editProject: "Edit project", completedTasks: "completed",
    previousPage: "Previous", nextPage: "Next",
}, { get: (target, key) => target[key] || String(key) });
const noop = () => {};
const registry = new ProjectDefinitionControllerRegistry();
</script>

<div id="writes" data-value={JSON.stringify(writes)}></div>
<ProjectView
    onEdit={noop} onStatusClick={noop} onContextMenu={noop} {i18n}
    loadProjectSupport={async (projectId) => ({ projectId, items: [] })}
    onExtractAction={noop} projectDefinitionControllerRegistry={registry} {bridge}
/>
<style>:global(.na-project-board) { min-width: 0 !important; width: 600px !important; }</style>
`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import { mount } from "svelte";
import Harness from "./Harness.svelte";
mount(Harness, { target: document.querySelector("#app") });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clickText = (selector, text) => [...document.querySelectorAll(selector)].find((node) => node.textContent.trim().includes(text))?.click();
const setSelect = (id, value) => {
    const select = document.querySelector(id);
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
};
const snapshot = () => ({
    project: document.querySelector(".na-project-index__item.active strong")?.textContent,
    group: document.querySelector("#na-project-board-group-by")?.value,
    sort: document.querySelector("#na-project-board-sort")?.value,
});

void (async () => {
    await wait(80);
    clickText('.na-segment-control__option', "Board");
    await wait(30);
    setSelect("#na-project-board-group-by", "priority");
    await wait(30);
    document.querySelector('[aria-label="Next"]')?.click();
    clickText(".na-project-index__item", "Project B");
    await wait(30);
    const projectBInitial = snapshot();
    setSelect("#na-project-board-sort", "due");
    clickText(".na-project-index__item", "Project A");
    await wait(30);
    const projectARestored = snapshot();
    clickText(".na-project-index__item", "Project B");
    await wait(80);
    window.__NA_BROWSER_RESULT__({
        viewportWidth: window.innerWidth,
        projectBInitial,
        projectARestored,
        projectBRestored: snapshot(),
        writes: JSON.parse(document.querySelector("#writes").dataset.value || "[]"),
    });
})().catch((error) => window.__NA_BROWSER_RESULT__({ error: String(error?.stack || error) }));`,
            );
        },
    });

    const viewportWidth = (result as { viewportWidth: number }).viewportWidth;
    assert.ok(viewportWidth >= 390 && viewportWidth <= 500);
    assert.deepEqual(
        { ...result, viewportWidth: 390 },
        {
            viewportWidth: 390,
            projectBInitial: { project: "Project B", group: "status", sort: "order" },
            projectARestored: { project: "Project A", group: "priority", sort: "order" },
            projectBRestored: { project: "Project B", group: "status", sort: "due" },
            writes: [
                {
                    projectId: "project-a",
                    preference: { groupBy: "priority", sortBy: "order", sortAsc: false, narrowColumnIndex: 0 },
                },
                {
                    projectId: "project-a",
                    preference: { groupBy: "priority", sortBy: "order", sortAsc: false, narrowColumnIndex: 1 },
                },
                {
                    projectId: "project-b",
                    preference: { groupBy: "status", sortBy: "due", sortAsc: false, narrowColumnIndex: 0 },
                },
            ],
        },
    );
});
