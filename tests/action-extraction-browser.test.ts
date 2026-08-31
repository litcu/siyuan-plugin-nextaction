import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

test("Action 提取确认保留真实来源、默认当前 Project，并阻止重复提交", async () => {
    const result = await runSvelteBrowserTest({
        fixtureName: "action-extraction",
        aliases: (fixtureRoot) => [{ find: "siyuan", replacement: join(fixtureRoot, "siyuan.js") }],
        virtualTimeBudget: 1_000,
        prepareFixture(fixtureRoot) {
            const componentPath = resolve("src/frontend/components/ExtractActionDialog.svelte").replace(/\\/g, "/");
            writeFileSync(
                join(fixtureRoot, "siyuan.js"),
                "export class Menu {}\nexport function openTab() {}\nexport function showMessage() {}\n",
            );
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import ExtractActionDialog from ${JSON.stringify(componentPath)};

const sourceBlockId = "20260825180000-source1";
const projectId = "20260825180002-project";
const project = {
    blockId: projectId, identificationSource: "document", attrHostId: projectId, parentId: "",
    status: "doing", priority: "medium", importance: 4, effort: 4, due: "", start: "", context: "",
    taskType: "2", order: 0, childIds: [], title: "Launch Project", depends: "", depMode: "all",
    sequential: false, repeat: "", repeatState: "", sort: 0, completed: "", note: "", outcome: "",
    dod: "", actionKind: "", created: "", tags: "", blocked: false, blockedReason: "",
    reviewInterval: 0, reviewDate: "", reminder: "", customFields: {},
};
const i18n = new Proxy({
    extractActionTitle: "Keep source and create Action", extractActionDescription: "Create an Action with a source link",
    extractActionSource: "Source", extractActionSourcePreserved: "The source note remains unchanged.",
    extractActionInPlaceHint: "To convert the source in place, use Convert to task instead.",
    extractActionTaskTitle: "Action title", extractActionTitlePlaceholder: "What needs to be done?",
    extractActionProject: "Project", extractActionNoProject: "No Project", extractActionProjectPlaceholder: "Choose Project",
    extractActionProjectEmpty: "No projects", extractActionSubmit: "Keep source and create Action",
    actionKind: "Action kind", actionKindAction: "Action", actionKindStage: "Stage", actionKindHint: "Same lifecycle",
    status: "Status", statusInbox: "Inbox", statusTodo: "Todo", statusDoing: "Doing", statusWaiting: "Waiting",
    statusSomeday: "Someday", statusDone: "Done", startDate: "Start", dueDate: "Due", cancel: "Cancel",
    close: "Close", loading: "Loading", noMatches: "No matches", clearSelection: "Clear",
}, { get: (target, key) => target[key] || String(key) });
let calls = [];
let created = "";
let closed = 0;
const bridge = {
    async extractAction(input) {
        calls = [...calls, input];
        await new Promise((resolve) => setTimeout(resolve, 60));
        return { task: { ...project, blockId: "20260825180005-created", taskType: "1", title: input.title }, sourceBlockId, projectId };
    },
};
</script>

<div id="harness" data-calls={JSON.stringify(calls)} data-created={created} data-closed={closed}>
    <ExtractActionDialog
        {bridge} {i18n} {sourceBlockId} sourceTitle="Discuss launch plan" projects={[project]}
        defaultProjectId={projectId} onCreated={(task) => (created = task.blockId)} onClose={() => (closed += 1)}
    />
</div>`,
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
    const title = document.querySelector("#na-extract-action-title");
    title.value = "Prepare launch checklist";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Stage")?.click();
    const submit = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Keep source and create Action");
    submit?.click();
    submit?.click();
    let projectLocked = false;
    setTimeout(() => {
        const projectControl = document.querySelector('[role="combobox"]');
        projectLocked = projectControl?.getAttribute("aria-disabled") === "true" && projectControl?.getAttribute("tabindex") === "-1";
    }, 10);
    setTimeout(() => {
        const harness = document.querySelector("#harness");
        finish({
            calls: JSON.parse(harness?.dataset.calls || "[]"),
            created: harness?.dataset.created,
            sourceNotice: document.body.textContent.includes("The source note remains unchanged."),
            inPlaceHint: document.body.textContent.includes("Convert to task instead"),
            misleadingNoProject: document.body.textContent.includes("No Project"),
            projectLocked,
        });
    }, 120);
}, 50);`,
            );
        },
    });
    assert.deepEqual(result, {
        calls: [
            {
                sourceBlockId: "20260825180000-source1",
                title: "Prepare launch checklist",
                status: "inbox",
                actionKind: "stage",
                projectId: "20260825180002-project",
            },
        ],
        created: "20260825180005-created",
        sourceNotice: true,
        inPlaceHint: true,
        misleadingNoProject: false,
        projectLocked: true,
    });
});
