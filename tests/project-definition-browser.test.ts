import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

// Regression: 键盘触发保存、取消或冲突处理后，失效/移除的按钮曾导致焦点丢失。
// Regression: 切换当前项目曾销毁尚未保存的项目定义草稿。
// Regression: 离开项目主导航卸载编辑器后，重新进入曾静默丢失未保存草稿。
// Regression: 保存中重挂载后，异步失败曾让新编辑器永久停留在保存中且无法重试。
test("项目详情可显式保存定义并安全处理外部更新冲突", async () => {
    const result = await runSvelteBrowserTest({
        fixtureName: "project-definition",
        prepareFixture(fixtureRoot) {
            const componentPath = resolve("src/frontend/components/project/ProjectDefinitionEditor.svelte").replace(
                /\\/g,
                "/",
            );
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import ProjectDefinitionEditor from ${JSON.stringify(componentPath)};
import { ProjectDefinitionControllerRegistry } from ${JSON.stringify(
                    resolve("src/frontend/controllers/project-definition-controller.ts").replace(/\\/g, "/"),
                )};
import { tick } from "svelte";

const base = {
    blockId: "project", identificationSource: "document", attrHostId: "project", parentId: "",
    status: "doing", priority: "medium", importance: 4, effort: 4, due: "", start: "", context: "",
    taskType: "2", order: 0, childIds: [], title: "Control center", depends: "", depMode: "all",
    sequential: false, repeat: "", repeatState: "", sort: 0, completed: "", note: "",
    outcome: "Original outcome", dod: "Original DoD", actionKind: "", created: "", tags: "",
    blocked: false, blockedReason: "", reviewInterval: 0, reviewDate: "", reminder: "", customFields: {},
};
let firstProject = base;
const secondProject = { ...base, blockId: "project-two", attrHostId: "project-two", title: "Second project",
    outcome: "Second outcome", dod: "Second DoD" };
let project = firstProject;
let editorMounted = true;
let writes = [];
let failNextSave = false;
const controllerRegistry = new ProjectDefinitionControllerRegistry();
const i18n = new Proxy({
    projectDefinitionTitle: "Project definition", outcome: "Outcome", definitionOfDone: "Definition of Done",
    outcomeHint: "One-line result", dodHint: "Completion conditions", outcomePlaceholder: "Outcome placeholder",
    dodPlaceholder: "DoD placeholder", save: "Save", cancel: "Cancel", saving: "Saving…", saved: "Saved",
    projectDefinitionRetry: "Retry",
    projectDefinitionConflict: "This field changed elsewhere.", projectDefinitionReloadRemote: "Reload remote",
    projectDefinitionKeepDraft: "Keep draft",
}, { get: (target, key) => target[key] || String(key) });

async function saveDefinition(_task, attrs) {
    writes = [...writes, attrs];
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (failNextSave) {
        failNextSave = false;
        throw new Error("Remote write failed");
    }
    project = {
        ...project,
        outcome: attrs["custom-na-outcome"] ?? project.outcome,
        dod: attrs["custom-na-dod"] ?? project.dod,
    };
    if (project.blockId === firstProject.blockId) firstProject = project;
    return project;
}

function pushRemoteDod() {
    project = { ...project, dod: "Remote DoD" };
    if (project.blockId === firstProject.blockId) firstProject = project;
}

async function remountEditor() {
    editorMounted = false;
    await tick();
    editorMounted = true;
}
</script>

<button id="push-remote" on:click={pushRemoteDod}>Push remote</button>
<button id="switch-second" on:click={() => (project = secondProject)}>Second project</button>
<button id="switch-first" on:click={() => (project = firstProject)}>First project</button>
<button id="remount-editor" on:click={remountEditor}>Remount editor</button>
<button id="fail-next-save" on:click={() => (failNextSave = true)}>Fail next save</button>
<div id="write-count">{writes.length}</div>
{#if editorMounted}<ProjectDefinitionEditor {project} {i18n} onSave={saveDefinition} {controllerRegistry} />{/if}`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import Harness from "./Harness.svelte";
new Harness({ target: document.querySelector("#app") });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clickByText = (text, root = document) => [...root.querySelectorAll("button")].find((button) => button.textContent.trim() === text)?.click();
const inputValue = (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
};
const finish = (value) => {
    const result = document.createElement("pre");
    result.id = "browser-result";
    result.textContent = JSON.stringify(value);
    document.body.appendChild(result);
};

void (async () => {
await wait(50);
const outcome = document.querySelector("#na-project-definition-outcome");
const dod = document.querySelector("#na-project-definition-dod");
inputValue(outcome, "Saved outcome");
await wait(0);
const outcomeField = outcome.closest(".na-project-definition__field");
const outcomeSave = [...outcomeField.querySelectorAll("button")].find((button) => button.textContent.trim() === "Save");
outcomeSave.focus();
outcomeSave.click();
await wait(0);
const disabledWhileSaving = outcome.disabled && [...outcomeField.querySelectorAll("button")].every((button) => button.disabled);
clickByText("Save", outcomeField);
await wait(70);
const focusRestoredAfterSave = document.activeElement === outcome;

inputValue(dod, "Local DoD");
document.querySelector("#push-remote").click();
await wait(20);
const dodField = dod.closest(".na-project-definition__field");
const conflictVisible = dodField.textContent.includes("This field changed elsewhere.");
const localDraftPreserved = dod.value === "Local DoD";
const keepDraft = [...dodField.querySelectorAll("button")].find((button) => button.textContent.trim() === "Keep draft");
keepDraft.focus();
keepDraft.click();
await wait(0);
const focusRestoredAfterKeepDraft = document.activeElement === dod;
clickByText("Save", dodField);
await wait(70);
const savedVisible = document.body.textContent.includes("Saved");

inputValue(dod, "Discarded DoD");
document.querySelector("#push-remote").click();
await wait(20);
const reloadRemote = [...dodField.querySelectorAll("button")].find((button) => button.textContent.trim() === "Reload remote");
reloadRemote.focus();
reloadRemote.click();
await wait(0);
const focusRestoredAfterReload = document.activeElement === dod;

inputValue(outcome, "Unsaved across switch");
document.querySelector("#switch-second").click();
await wait(20);
document.querySelector("#switch-first").click();
await wait(20);
const draftPreservedAcrossProjects = document.querySelector("#na-project-definition-outcome").value === "Unsaved across switch";
document.querySelector("#remount-editor").click();
await wait(20);
const remountedOutcome = document.querySelector("#na-project-definition-outcome");
const draftPreservedAcrossRemount = remountedOutcome.value === "Unsaved across switch";
const remountedOutcomeField = remountedOutcome.closest(".na-project-definition__field");
const cancel = [...remountedOutcomeField.querySelectorAll("button")].find((button) => button.textContent.trim() === "Cancel");
cancel.focus();
cancel.click();
await wait(0);
const focusRestoredAfterCancel = document.activeElement === remountedOutcome;

inputValue(remountedOutcome, "Recovered after remount");
await wait(0);
document.querySelector("#fail-next-save").click();
const retryField = remountedOutcome.closest(".na-project-definition__field");
const failureSave = [...retryField.querySelectorAll("button")].find((button) => button.textContent.trim() === "Save");
failureSave.click();
await wait(0);
document.querySelector("#remount-editor").click();
await wait(70);
const failedFieldAfterRemount = document.querySelector("#na-project-definition-outcome").closest(".na-project-definition__field");
const failureVisibleAfterRemount = failedFieldAfterRemount.textContent.includes("Remote write failed") &&
    [...failedFieldAfterRemount.querySelectorAll("button")].some((button) => button.textContent.trim() === "Retry" && !button.disabled);
clickByText("Retry", failedFieldAfterRemount);
await wait(70);

finish({
    outcomeTag: outcome.tagName,
    outcomeType: outcome.type,
    dodTag: dod.tagName,
    disabledWhileSaving,
    writeCount: Number(document.querySelector("#write-count").textContent),
    outcomeValue: remountedOutcome.value,
    dodValue: document.querySelector("#na-project-definition-dod").value,
    conflictVisible,
    localDraftPreserved,
    focusRestoredAfterSave,
    focusRestoredAfterKeepDraft,
    focusRestoredAfterReload,
    focusRestoredAfterCancel,
    draftPreservedAcrossProjects,
    draftPreservedAcrossRemount,
    failureVisibleAfterRemount,
    savedVisible,
});
})();`,
            );
        },
    });
    assert.deepEqual(result, {
        outcomeTag: "INPUT",
        outcomeType: "text",
        dodTag: "TEXTAREA",
        disabledWhileSaving: true,
        writeCount: 4,
        outcomeValue: "Recovered after remount",
        dodValue: "Remote DoD",
        conflictVisible: true,
        localDraftPreserved: true,
        focusRestoredAfterSave: true,
        focusRestoredAfterKeepDraft: true,
        focusRestoredAfterReload: true,
        focusRestoredAfterCancel: true,
        draftPreservedAcrossProjects: true,
        draftPreservedAcrossRemount: true,
        failureVisibleAfterRemount: true,
        savedVisible: true,
    });
});

// Regression: 切换项目视图模式曾卸载定义编辑器并静默丢弃未保存草稿。
test("项目定义草稿在切换视图模式后仍然保留", async () => {
    const result = await runSvelteBrowserTest({
        fixtureName: "project-definition-mode",
        prepareFixture(fixtureRoot) {
            const componentPath = resolve("src/frontend/components/ProjectView.svelte").replace(/\\/g, "/");
            writeFileSync(
                join(fixtureRoot, "siyuan.js"),
                "export class Dialog {}\nexport class Menu {}\nexport function openTab() {}\nexport function showMessage() {}\n",
            );
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import ProjectView from ${JSON.stringify(componentPath)};
import { ProjectDefinitionControllerRegistry } from ${JSON.stringify(
                    resolve("src/frontend/controllers/project-definition-controller.ts").replace(/\\/g, "/"),
                )};
import { taskStore } from ${JSON.stringify(resolve("src/frontend/stores/task-store.ts").replace(/\\/g, "/"))};

const project = {
    blockId: "project", identificationSource: "document", attrHostId: "project", parentId: "",
    status: "doing", priority: "medium", importance: 4, effort: 4, due: "", start: "", context: "",
    taskType: "2", order: 0, childIds: [], title: "Control center", depends: "", depMode: "all",
    sequential: false, repeat: "", repeatState: "", sort: 0, completed: "", note: "",
    outcome: "Original outcome", dod: "Original DoD", actionKind: "", created: "", tags: "",
    blocked: false, blockedReason: "", reviewInterval: 0, reviewDate: "", reminder: "", customFields: {},
};
taskStore.applyUpdate(project);
const i18n = new Proxy({
    projectViewOverview: "Overview", projectViewHierarchy: "Hierarchy", outcome: "Outcome",
    definitionOfDone: "Definition of Done", save: "Save", cancel: "Cancel",
}, { get: (target, key) => target[key] || String(key) });
const noop = () => {};
const updateTask = async (task) => task;
const loadProjectSupport = async (projectId) => ({ projectId, items: [] });
const projectDefinitionControllerRegistry = new ProjectDefinitionControllerRegistry();
</script>

<ProjectView
    onEdit={noop}
    onStatusClick={noop}
    onContextMenu={noop}
    {i18n}
    requestedProjectId="project"
    onSelectTask={noop}
    onTaskUpdate={updateTask}
    onCreateChild={noop}
    {loadProjectSupport}
    onExtractAction={noop}
    {projectDefinitionControllerRegistry}
/>`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import Harness from "./Harness.svelte";
new Harness({ target: document.querySelector("#app") });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clickByText = (text) => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === text)?.click();
const finish = (value) => {
    const result = document.createElement("pre");
    result.id = "browser-result";
    result.textContent = JSON.stringify(value);
    document.body.appendChild(result);
};

void (async () => {
await wait(80);
const outcome = document.querySelector("#na-project-definition-outcome");
outcome.value = "Draft across modes";
outcome.dispatchEvent(new Event("input", { bubbles: true }));
clickByText("Hierarchy");
await wait(20);
clickByText("Overview");
await wait(20);
finish({
    draft: document.querySelector("#na-project-definition-outcome")?.value,
});
})();`,
            );
        },
    });
    assert.deepEqual(result, { draft: "Draft across modes" });
});
