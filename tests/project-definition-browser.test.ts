import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { build } from "vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { findBrowserExecutable } from "./helpers/browser.ts";

const require = createRequire(import.meta.url);
const svelteRoot = resolve(require.resolve("svelte/package.json"), "..");

test("项目详情可显式保存定义并安全处理外部更新冲突", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "nextaction-project-definition-"));
    try {
        const componentPath = resolve("src/frontend/components/project/ProjectDefinitionEditor.svelte").replace(
            /\\/g,
            "/",
        );
        writeFileSync(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}');
        writeFileSync(
            join(fixtureRoot, "index.html"),
            '<!doctype html><html><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>',
        );
        writeFileSync(
            join(fixtureRoot, "Harness.svelte"),
            `<script>
import ProjectDefinitionEditor from ${JSON.stringify(componentPath)};

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
let writes = [];
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
</script>

<button id="push-remote" on:click={pushRemoteDod}>Push remote</button>
<button id="switch-second" on:click={() => (project = secondProject)}>Second project</button>
<button id="switch-first" on:click={() => (project = firstProject)}>First project</button>
<div id="write-count">{writes.length}</div>
<ProjectDefinitionEditor {project} {i18n} onSave={saveDefinition} />`,
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
clickByText("Keep draft", dodField);
await wait(0);
clickByText("Save", dodField);
await wait(70);
const savedVisible = document.body.textContent.includes("Saved");

inputValue(outcome, "Unsaved across switch");
document.querySelector("#switch-second").click();
await wait(20);
document.querySelector("#switch-first").click();
await wait(20);
const draftPreservedAcrossProjects = document.querySelector("#na-project-definition-outcome").value === "Unsaved across switch";

finish({
    outcomeTag: outcome.tagName,
    outcomeType: outcome.type,
    dodTag: dod.tagName,
    disabledWhileSaving,
    writeCount: Number(document.querySelector("#write-count").textContent),
    outcomeValue: outcome.value,
    dodValue: dod.value,
    conflictVisible,
    localDraftPreserved,
    focusRestoredAfterSave,
    draftPreservedAcrossProjects,
    savedVisible,
});
})();`,
        );

        await build({
            root: fixtureRoot,
            base: "./",
            configFile: false,
            logLevel: "silent",
            resolve: {
                alias: [
                    {
                        find: /^svelte\/internal\/disclose-version$/,
                        replacement: join(svelteRoot, "src/runtime/internal/disclose-version/index.js"),
                    },
                    {
                        find: /^svelte\/internal$/,
                        replacement: join(svelteRoot, "src/runtime/internal/index.js"),
                    },
                    { find: /^svelte\/store$/, replacement: join(svelteRoot, "src/runtime/store/index.js") },
                    { find: /^svelte$/, replacement: join(svelteRoot, "src/runtime/index.js") },
                ],
            },
            plugins: [svelte({ preprocess: vitePreprocess() })],
            build: { outDir: "dist" },
        });

        const rendered = spawnSync(
            findBrowserExecutable(),
            [
                "--headless=new",
                "--disable-gpu",
                "--disable-extensions",
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-sync",
                "--allow-file-access-from-files",
                "--disable-web-security",
                "--no-first-run",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--virtual-time-budget=1000",
                `--user-data-dir=${join(fixtureRoot, "browser-profile")}`,
                "--dump-dom",
                pathToFileURL(join(fixtureRoot, "dist", "index.html")).href,
            ],
            { encoding: "utf8", timeout: 20_000 },
        );
        assert.equal(rendered.status, 0, rendered.stderr);
        const match = rendered.stdout.match(/<pre id="browser-result">([^<]+)<\/pre>/);
        assert.ok(match, `${rendered.stdout}\n${rendered.stderr}`);
        const result = JSON.parse(match[1].replace(/&quot;/g, '"'));
        assert.deepEqual(result, {
            outcomeTag: "INPUT",
            outcomeType: "text",
            dodTag: "TEXTAREA",
            disabledWhileSaving: true,
            writeCount: 2,
            outcomeValue: "Unsaved across switch",
            dodValue: "Local DoD",
            conflictVisible: true,
            localDraftPreserved: true,
            focusRestoredAfterSave: true,
            draftPreservedAcrossProjects: true,
            savedVisible: true,
        });
    } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
    }
});
