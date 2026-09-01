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
let moves = [];
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
async function moveTask(intent) {
    moves = [...moves, { ...intent, task: intent.task.blockId }];
}
</script>

<div id="state" data-group={preference.groupBy} data-sort={preference.sortBy} data-changes={JSON.stringify(changes)} data-moves={JSON.stringify(moves)}></div>
<ProjectBoardMode
    tasks={[task()]}
    projectTasks={[project, task()]}
    {i18n}
    {preference}
    onPreferenceChange={updatePreference}
    onEdit={noop}
    onStatusClick={noop}
    onContextMenu={noop}
    onMoveTask={moveTask}
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
            const dataTransfer = new DataTransfer();
            document.querySelector(".na-project-board__card").dispatchEvent(
                new DragEvent("dragstart", { bubbles: true, dataTransfer }),
            );
            const criticalColumn = [...document.querySelectorAll(".na-project-board__column")]
                .find((column) => column.querySelector("header")?.textContent.includes("critical"));
            criticalColumn.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer }));
        }, 25);
        setTimeout(() => {
            const state = document.querySelector("#state");
            finish({
                groupValue: group.value,
                sortValue: sort.value,
                parentGroup: state?.dataset.group,
                parentSort: state?.dataset.sort,
                changes: JSON.parse(state?.dataset.changes || "[]"),
                moves: JSON.parse(state?.dataset.moves || "[]"),
                priorityColumnVisible: [...document.querySelectorAll(".na-project-board__column header")]
                    .some((node) => node.textContent.includes("critical")),
            });
        }, 100);
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
        moves: [
            {
                task: "20260825141736-actionx",
                status: "",
                groupBy: "priority",
                value: "critical",
                sortBy: "due",
                visibleTaskIds: ["20260825141736-actionx"],
            },
        ],
        priorityColumnVisible: true,
    });
});
