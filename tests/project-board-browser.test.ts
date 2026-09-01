import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

// Regression: Svelte 5 下 bind:value 可能在 change 处理器之后更新，持久化曾经保存旧偏好。
test("看板分组和排序切换会立即更新控件、内容与持久化偏好", async () => {
    const result = await runSvelteBrowserTest({
        fixtureName: "project-board",
        virtualTimeBudget: 3_000,
        prepareFixture(fixtureRoot) {
            const componentPath = resolve("src/frontend/components/project/ProjectBoardMode.svelte").replace(
                /\\/g,
                "/",
            );
            writeFileSync(
                join(fixtureRoot, "siyuan.js"),
                "export class Menu {}\nexport function openTab() {}\nexport function showMessage() {}\n",
            );
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import ProjectBoardMode from ${JSON.stringify(componentPath)};

const projectId = "20260825141735-project";
const task = (overrides = {}) => ({
    blockId: "20260825141736-actionx", identificationSource: "native", contentBlockId: "20260825141736-actionx",
    attrHostId: "20260825141736-actionx", parentId: projectId, status: "doing", priority: "medium",
    importance: 4, effort: 4, due: "", start: "", context: "", taskType: "1", order: 0, childIds: [],
    title: "Board task", depends: "", depMode: "all", sequential: false, repeat: "", repeatState: "",
    sort: 0, completed: "", note: "", outcome: "", dod: "", actionKind: "action", created: "",
    tags: "", blocked: false, blockedReason: "", reviewInterval: 0, reviewDate: "", reminder: "",
    customFields: {}, ...overrides,
});
const project = task({
    blockId: projectId, identificationSource: "document", contentBlockId: projectId, attrHostId: projectId,
    parentId: "", taskType: "2", title: "Board project", actionKind: "", childIds: ["20260825141736-actionx"],
});
let preference = { groupBy: "status", sortBy: "order", sortAsc: false, narrowColumnIndex: 0 };
let changes = [];
const i18n = new Proxy({
    projectBoardGroupBy: "Group by", sortBy: "Sort by", status: "Status", priority: "Priority",
    importance: "Importance", priorityCritical: "critical", priorityHigh: "high", priorityMedium: "medium",
    priorityLow: "low", priorityVeryLow: "very low", priorityNone: "none", projectBoardStage: "Stage",
    sortByOrder: "Manual order", sortByDue: "Due date",
    sortByImportance: "Importance", sortByPriority: "Priority", projectBoardSortDirection: "Sort direction",
    sortDesc: "Descending", sortAsc: "Ascending", projectBoardUnassignedStage: "Unassigned stage",
    projectDropHere: "Drop tasks here", loading: "Loading", untitled: "Untitled", cancel: "Cancel",
}, { get: (target, key) => target[key] || String(key) });
const noop = () => {};
function updatePreference(next) {
    changes = [...changes, next];
    preference = next;
}
</script>

<div id="state" data-group={preference.groupBy} data-sort={preference.sortBy} data-changes={JSON.stringify(changes)}></div>
<ProjectBoardMode
    tasks={[task()]}
    projectTasks={[project, task()]}
    {i18n}
    {preference}
    onPreferenceChange={updatePreference}
    onEdit={noop}
    onStatusClick={noop}
    onContextMenu={noop}
    onMoveTask={async () => {}}
/>
`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import Harness from "./Harness.svelte";
new Harness({ target: document.querySelector("#app") });
const finish = (value) => {
    const result = document.createElement("pre");
    result.id = "browser-result";
    result.textContent = JSON.stringify(value);
    document.body.appendChild(result);
};
setTimeout(() => {
    try {
        const group = document.querySelector("#na-project-board-group-by");
        const sort = document.querySelector("#na-project-board-sort");
        group.value = "priority";
        group.dispatchEvent(new Event("change", { bubbles: true }));
        sort.value = "due";
        sort.dispatchEvent(new Event("change", { bubbles: true }));
        setTimeout(() => {
            const state = document.querySelector("#state");
            finish({
                groupValue: group.value,
                sortValue: sort.value,
                parentGroup: state?.dataset.group,
                parentSort: state?.dataset.sort,
                changes: JSON.parse(state?.dataset.changes || "[]"),
                priorityColumnVisible: [...document.querySelectorAll(".na-project-board__column header")]
                    .some((node) => node.textContent.includes("critical")),
            });
        }, 50);
    } catch (error) {
        finish({ error: String(error?.message || error) });
    }
}, 50);`,
            );
        },
    });
    assert.deepEqual(result, {
        groupValue: "priority",
        sortValue: "due",
        parentGroup: "priority",
        parentSort: "due",
        changes: [
            { groupBy: "priority", sortBy: "order", sortAsc: false, narrowColumnIndex: 0 },
            { groupBy: "priority", sortBy: "due", sortAsc: false, narrowColumnIndex: 0 },
        ],
        priorityColumnVisible: true,
    });
});
