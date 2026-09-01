import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

type StageCreateBrowserResult = {
    kind: string;
    submitted: { kind: string; properties: { actionKind: string; parentId: string } };
    created: string;
    destroyed: string;
};

type StageEditBrowserResult = {
    calls: string[];
    failed: boolean;
    selectedAfterFailure: string;
    selectedTaskId: string;
    errorAfterRetry: boolean;
    focusedRename: boolean;
    focusedAfterSave: string;
    focusedAfterMove: boolean;
    focusedAfterFailure: boolean;
    focusedAfterRetry: boolean;
    moveDownLabel: string;
    physicalMoveLabel: string;
    errorBeforeProjectSwitch: boolean;
    errorAfterProjectSwitch: boolean;
    retryAfterProjectSwitch: boolean;
};

test("从当前 Project 创建 Stage 会提交普通 Action 的 Stage 标记和逻辑父级", async () => {
    const result = await runSvelteBrowserTest<StageCreateBrowserResult>({
        fixtureName: "project-stage-create",
        prepareFixture(fixtureRoot) {
            const componentPath = resolve("src/frontend/components/CreateTaskDialog.svelte").replace(/\\/g, "/");
            writeFileSync(
                join(fixtureRoot, "siyuan.js"),
                "export class Menu {}\nexport function showMessage() {}\nexport function openTab() {}\n",
            );
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import CreateTaskDialog from ${JSON.stringify(componentPath)};

const projectId = "20260825170000-project";
const createdId = "20260825170001-stagexx";
const parentTask = {
    blockId: projectId, identificationSource: "document", attrHostId: projectId, parentId: "",
    status: "doing", priority: "medium", importance: 4, effort: 4, due: "", start: "", context: "",
    taskType: "2", order: 0, childIds: [], title: "Delivery project", depends: "", depMode: "all",
    sequential: false, repeat: "", repeatState: "", sort: 0, completed: "", note: "", outcome: "",
    dod: "", actionKind: "", created: "", tags: "", blocked: false, blockedReason: "",
    reviewInterval: 0, reviewDate: "", reminder: "", customFields: {},
};
let submitted = null;
let created = null;
let destroyed = false;
const bridge = {
    listMcpTargetNotebooks: async () => [],
    createTask: async (input) => {
        submitted = input;
        return { task: { id: createdId, title: input.title }, destination: {}, warnings: [] };
    },
    getTask: async () => ({ ...parentTask, blockId: createdId, attrHostId: createdId, taskType: "1",
        parentId: projectId, title: "Plan delivery", status: "todo", actionKind: "stage" }),
};
const dialog = { destroy: () => (destroyed = true) };
const i18n = new Proxy({
    createStage: "Create Stage", createTask: "Create task", createTitlePlaceholder: "Title",
    taskType: "Task type", task: "Task", project: "Project", actionKind: "Action kind",
    actionKindAction: "Action", actionKindStage: "Stage", createProperties: "Properties",
    status: "Status", priority: "Priority", startDate: "Start", dueDate: "Due",
    createMoreProperties: "More", context: "Context", tag: "Tag", note: "Note",
    createSaveOptions: "Save", createLocation: "Location", createChildTask: "Child task",
    cancel: "Cancel", statusTodo: "Todo", priorityMedium: "Medium",
}, { get: (target, key) => target[key] || String(key) });
</script>

<div id="harness" data-submitted={JSON.stringify(submitted)} data-created={created?.blockId || ""} data-destroyed={destroyed}>
    <CreateTaskDialog {bridge} {i18n} {dialog} {parentTask} initialActionKind="stage" onCreated={(task) => (created = task)} />
</div>`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import Harness from "./Harness.svelte";
import { mount } from "svelte";
mount(Harness, { target: document.querySelector("#app") });
const finish = (value) => {
    const result = document.createElement("pre");
    result.id = "browser-result";
    result.textContent = JSON.stringify(value);
    document.body.appendChild(result);
};
setTimeout(() => {
    const title = document.querySelector('input[aria-label="Create task"]');
    title.value = "Plan delivery";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    const kind = document.querySelector('select[aria-label="Action kind"]')?.value || "";
    document.querySelector('form')?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    setTimeout(() => {
        const harness = document.querySelector("#harness");
        finish({ kind, submitted: JSON.parse(harness?.dataset.submitted || "null"),
            created: harness?.dataset.created, destroyed: harness?.dataset.destroyed });
    }, 80);
}, 50);`,
            );
        },
    });
    assert.equal(result.kind, "stage");
    assert.equal(result.submitted.kind, "task");
    assert.equal(result.submitted.properties.actionKind, "stage");
    assert.equal(result.submitted.properties.parentId, "20260825170000-project");
    assert.equal(result.created, "20260825170001-stagexx");
    assert.equal(result.destroyed, "true");
});

test("项目计划提供重命名、转换、父级和排序操作，失败后保留选择并可重试", async () => {
    // Regression: plan writes used to lose keyboard focus, and stale errors survived switching Projects.
    const result = await runSvelteBrowserTest<StageEditBrowserResult>({
        fixtureName: "project-stage-edit",
        virtualTimeBudget: 1_500,
        prepareFixture(fixtureRoot) {
            const componentPath = resolve("src/frontend/components/project/ProjectStagePlan.svelte").replace(
                /\\/g,
                "/",
            );
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import ProjectStagePlan from ${JSON.stringify(componentPath)};

const base = {
    identificationSource: "document", status: "todo", priority: "medium", importance: 4, effort: 4,
    due: "", start: "", context: "", taskType: "1", order: 0, childIds: [], depends: "",
    depMode: "all", sequential: false, repeat: "", repeatState: "", completed: "", note: "",
    outcome: "", dod: "", actionKind: "action", created: "", tags: "", blocked: false,
    blockedReason: "", reviewInterval: 0, reviewDate: "", reminder: "", customFields: {},
};
let project = { ...base, blockId: "project", attrHostId: "project", parentId: "", taskType: "2",
    actionKind: "", title: "Project", childIds: ["stage", "sibling"] };
const otherProject = { ...project, blockId: "other-project", attrHostId: "other-project", title: "Other Project", childIds: [] };
let tasks = [
    { ...base, blockId: "stage", attrHostId: "stage", parentId: "project", actionKind: "stage", title: "Draft", sort: 0 },
    { ...base, blockId: "sibling", attrHostId: "sibling", parentId: "project", title: "Sibling", sort: 10000 },
];
let calls = [];
let failNext = false;
let selectedTaskId = "stage";
const i18n = new Proxy({
    projectStagePlan: "Stage plan", projectStagePlanHint: "Organize Actions and Stages",
    createStage: "Create Stage", renameStage: "Rename", save: "Save", cancel: "Cancel",
    actionKind: "Action kind", actionKindAction: "Action", actionKindStage: "Stage",
    parentItem: "Parent", moveUp: "Move up", moveDown: "Move down", retry: "Retry",
    moveActionConfirm: "Move to project document",
    projectPlanWriteFailed: "Plan update failed: {error}", untitled: "Untitled",
}, { get: (target, key) => target[key] || String(key) });

$: taskById = new Map([[project.blockId, project], ...tasks.map((task) => [task.blockId, task])]);
$: childrenByParent = (() => {
    const result = new Map();
    for (const task of tasks) result.set(task.parentId, [...(result.get(task.parentId) || []), task]);
    return result;
})();
$: model = {
    rows: [{ task: project, depth: 0, hasChildren: true, childCount: tasks.length },
        ...tasks.map((task) => ({ task, depth: task.parentId === project.blockId ? 1 : 2, hasChildren: false, childCount: 0 }))],
    includedTasks: [project, ...tasks], includedIds: new Set([project.blockId, ...tasks.map((task) => task.blockId)]),
    taskById, childrenByParent, parentByChild: new Map(tasks.map((task) => [task.blockId, task.parentId])),
};

function maybeFail() {
    if (!failNext) return;
    failNext = false;
    throw new Error("temporary failure");
}
async function renameTask(task, title) {
    maybeFail();
    calls = [...calls, "rename:" + task.blockId + ":" + title];
    const updated = { ...task, title };
    tasks = tasks.map((entry) => entry.blockId === task.blockId ? updated : entry);
    return updated;
}
async function updateTask(task, attrs) {
    maybeFail();
    calls = [...calls, "kind:" + task.blockId + ":" + attrs["custom-na-kind"]];
    const updated = { ...task, actionKind: attrs["custom-na-kind"] };
    tasks = tasks.map((entry) => entry.blockId === task.blockId ? updated : entry);
    return updated;
}
async function reorderTask(blockId, parentId, afterId) {
    maybeFail();
    calls = [...calls, "reorder:" + blockId + ":" + parentId + ":" + (afterId || "first")];
    const moving = tasks.find((entry) => entry.blockId === blockId);
    const siblings = tasks.filter((entry) => entry.blockId !== blockId && entry.parentId === parentId)
        .sort((left, right) => left.sort - right.sort);
    const insertIndex = afterId ? siblings.findIndex((entry) => entry.blockId === afterId) + 1 : 0;
    siblings.splice(Math.max(0, insertIndex), 0, { ...moving, parentId });
    const reordered = new Map(siblings.map((entry, index) => [entry.blockId, { ...entry, sort: index * 10000 }]));
    tasks = tasks.map((entry) => reordered.get(entry.blockId) || entry);
}
function moveAction(task, targetProject) {
    calls = [...calls, "physical:" + task.blockId + ":" + targetProject.blockId];
}
</script>

<button id="fail-next" onclick={() => (failNext = true)}>fail</button>
<button id="switch-project" onclick={() => { project = otherProject; tasks = []; selectedTaskId = ""; }}>switch</button>
<div id="harness" data-calls={JSON.stringify(calls)} data-selected={selectedTaskId}>
    <ProjectStagePlan
        {project} {model} {i18n} {selectedTaskId}
        onSelectTask={(task) => (selectedTaskId = task.blockId)}
        onCreateStage={() => (calls = [...calls, "create"])}
        onRenameTask={renameTask} onTaskUpdate={updateTask} onTaskReorder={reorderTask} onMoveAction={moveAction}
    />
</div>`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import Harness from "./Harness.svelte";
import { mount } from "svelte";
mount(Harness, { target: document.querySelector("#app") });
const row = () => document.querySelector('[data-task-id="stage"]');
const button = (label) => [...row().querySelectorAll("button")].find((item) => item.textContent.trim() === label);
let focusedRename = false;
let focusedAfterSave = "";
let focusedAfterMove = false;
const change = (selector, value) => {
    const control = row().querySelector(selector);
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
};
const finish = (value) => {
    const result = document.createElement("pre");
    result.id = "browser-result";
    result.textContent = JSON.stringify(value);
    document.body.appendChild(result);
};
setTimeout(() => {
    button("Rename")?.click();
    setTimeout(() => {
        const input = row().querySelector('input[data-role="rename"]');
        focusedRename = document.activeElement === input;
        input.value = "Delivery";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        row().querySelector('form')?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        setTimeout(() => {
            focusedAfterSave = document.activeElement?.textContent?.trim() || "";
            change('select[data-role="kind"]', "action");
            setTimeout(() => {
                button("Move down")?.click();
                setTimeout(() => {
                    focusedAfterMove = document.activeElement?.textContent?.includes("Delivery") || false;
                    change('select[data-role="parent"]', "sibling");
                    setTimeout(() => {
                        document.querySelector("#fail-next")?.click();
                        change('select[data-role="kind"]', "stage");
                        setTimeout(() => {
                            const failed = Boolean(document.querySelector('[role="alert"]'));
                            const selectedAfterFailure = row()?.getAttribute("aria-current");
                            const selectedTaskAtFailure = document.querySelector("#harness")?.dataset.selected;
                            const kindControl = row().querySelector('select[data-role="kind"]');
                            const focusedAfterFailure = document.activeElement === kindControl;
                            const retry = [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "Retry");
                            retry?.focus();
                            retry?.click();
                            setTimeout(() => {
                                const harness = document.querySelector("#harness");
                                const focusedAfterRetry = document.activeElement === kindControl;
                                const errorAfterRetry = Boolean(document.querySelector('[role="alert"]'));
                                const moveDownLabel = button("Move down")?.getAttribute("aria-label");
                                const physicalMove = button("Move to project document");
                                const physicalMoveLabel = physicalMove?.getAttribute("aria-label") || "";
                                physicalMove?.click();
                                document.querySelector("#fail-next")?.click();
                                change('select[data-role="kind"]', "action");
                                setTimeout(() => {
                                    const errorBeforeProjectSwitch = Boolean(document.querySelector('[role="alert"]'));
                                    document.querySelector("#switch-project")?.click();
                                    setTimeout(() => finish({ calls: JSON.parse(harness?.dataset.calls || "[]"), failed,
                                        selectedAfterFailure, selectedTaskId: selectedTaskAtFailure, errorAfterRetry, focusedRename,
                                        focusedAfterSave, focusedAfterMove, focusedAfterFailure, focusedAfterRetry,
                                        moveDownLabel, physicalMoveLabel, errorBeforeProjectSwitch,
                                        errorAfterProjectSwitch: Boolean(document.querySelector('[role="alert"]')),
                                        retryAfterProjectSwitch: [...document.querySelectorAll("button")]
                                            .some((item) => item.textContent.trim() === "Retry") }), 50);
                                }, 50);
                            }, 50);
                        }, 50);
                    }, 50);
                }, 50);
            }, 50);
        }, 50);
    }, 50);
}, 50);`,
            );
        },
    });
    assert.deepEqual(result.calls, [
        "rename:stage:Delivery",
        "kind:stage:action",
        "reorder:stage:project:sibling",
        "reorder:stage:sibling:first",
        "kind:stage:stage",
        "physical:stage:project",
    ]);
    assert.equal(result.failed, true);
    assert.equal(result.selectedAfterFailure, "true");
    assert.equal(result.selectedTaskId, "stage");
    assert.equal(result.errorAfterRetry, false);
    assert.equal(result.focusedRename, true);
    assert.match(result.focusedAfterSave, /Delivery/);
    assert.equal(result.focusedAfterMove, true);
    assert.equal(result.focusedAfterFailure, true);
    assert.equal(result.focusedAfterRetry, true);
    assert.equal(result.moveDownLabel, "Move down: Delivery");
    assert.equal(result.physicalMoveLabel, "Move to project document: Delivery");
    assert.equal(result.errorBeforeProjectSwitch, true);
    assert.equal(result.errorAfterProjectSwitch, false);
    assert.equal(result.retryAfterProjectSwitch, false);
});
