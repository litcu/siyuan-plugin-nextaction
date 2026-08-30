import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { build } from "vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { findBrowserExecutable, removeBrowserFixture, runBrowser } from "./helpers/browser.ts";

const require = createRequire(import.meta.url);
const svelteRoot = resolve(require.resolve("svelte/package.json"), "..");

test("Action 移动对话框展示结构变化，恢复失败可重试且成功后返回权威任务", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "nextaction-action-move-"));
    try {
        const componentPath = resolve("src/frontend/components/project/ActionMoveDialog.svelte").replace(/\\/g, "/");
        writeFileSync(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}');
        writeFileSync(
            join(fixtureRoot, "index.html"),
            '<!doctype html><html><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>',
        );
        writeFileSync(join(fixtureRoot, "siyuan.js"), "export function openTab() {}\n");
        writeFileSync(
            join(fixtureRoot, "Harness.svelte"),
            `<script>
import ActionMoveDialog from ${JSON.stringify(componentPath)};

const actionId = "20260825110000-actionx";
const projectId = "20260825110001-project";
let attempts = 0;
let movedTaskId = "";
let closed = false;
let selectedPreviousId = "";
const task = { blockId: actionId, title: "Move safely" };
const project = { blockId: projectId, title: "Ship release" };
const bridge = {
    previewActionMove: async () => ({
        actionId, actionTitle: task.title,
        source: { documentId: "20260825110002-sourced", title: "Source notes" },
        target: { projectId, title: project.title },
        placements: [
            { id: "start", destination: { previousId: "", nextId: "20260825110003-heading" }, previousTitle: "", nextTitle: "Plan", documentEnd: false },
            { id: "between", destination: { previousId: "20260825110003-heading", nextId: "20260825110004-notesxx" }, previousTitle: "Plan", nextTitle: "Notes", documentEnd: false },
            { id: "end", destination: { previousId: "20260825110004-notesxx", nextId: "" }, previousTitle: "Notes", nextTitle: "", documentEnd: true },
        ],
        destination: { previousId: "20260825110004-notesxx", nextId: "" },
        currentEffectiveParentId: "",
        nextEffectiveParentId: projectId,
        effectiveParentWillChange: true,
        explicitParentPreserved: false,
    }),
    moveActionToProject: async (_actionId, _projectId, destination) => {
        attempts++;
        selectedPreviousId = destination?.previousId || "";
        if (attempts === 1) {
            const error = new Error("restored");
            error.code = -32011;
            throw error;
        }
        return { task: { ...task, parentId: projectId }, preview: {} };
    },
};
const unchangedBridge = {
    ...bridge,
    previewActionMove: async () => ({
        actionId, actionTitle: task.title,
        source: { documentId: projectId, title: project.title },
        target: { projectId, title: project.title },
        placements: [
            { id: "end", destination: { previousId: "20260825110004-notesxx", nextId: "" }, previousTitle: "Notes", nextTitle: "", documentEnd: true },
        ],
        destination: { previousId: "20260825110004-notesxx", nextId: "" },
        currentEffectiveParentId: projectId,
        nextEffectiveParentId: projectId,
        effectiveParentWillChange: false,
        explicitParentPreserved: false,
    }),
};
const i18n = new Proxy({
    moveActionTitle: "Move Action", moveActionDescription: "Move the native Action and its full subtree",
    moveActionSource: "Source", moveActionTarget: "Target", moveActionDestinationEnd: "Project document end",
    moveActionDestination: "Destination", moveActionDestinationStart: "Document start",
    moveActionDestinationBetween: "Between {previous} and {next}",
    moveActionParentChange: "Effective parent will change", moveActionParentUnchanged: "Explicit parent is preserved",
    moveActionEffectiveParentUnchanged: "Effective parent will not change",
    moveActionConfirm: "Move to project document", moveActionRecovered: "Move failed; original position restored.",
    moveActionNotMoved: "Action was not moved.", moveActionRecoveryFailed: "Recovery failed; inspect documents.",
    moveActionPreviewFailed: "Cannot preview move: {error}", cancel: "Cancel", close: "Close", loading: "Loading",
}, { get: (target, key) => target[key] || String(key) });
</script>

<div id="harness" data-attempts={attempts} data-moved={movedTaskId} data-closed={closed} data-previous={selectedPreviousId}>
    <ActionMoveDialog {bridge} {i18n} {task} {project}
        onMoved={(moved) => (movedTaskId = moved.task.blockId)} onClose={() => (closed = true)} />
</div>
<div id="unchanged-parent"><ActionMoveDialog bridge={unchangedBridge} {i18n} {task} {project} /></div>`,
        );
        writeFileSync(
            join(fixtureRoot, "main.js"),
            `import Harness from "./Harness.svelte";
new Harness({ target: document.querySelector("#app") });
const findButton = (label) => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
const finish = (value) => {
    const result = document.createElement("pre"); result.id = "browser-result";
    result.textContent = JSON.stringify(value); document.body.appendChild(result);
};
setTimeout(() => {
    const before = document.body.textContent;
    const placement = document.querySelector("#na-action-move-destination");
    if (placement) {
        placement.value = "between";
        placement.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const placementVisible = document.body.textContent.includes("Between Plan and Notes");
    findButton("Move to project document")?.click();
    setTimeout(() => {
        const recovered = document.querySelector('[role="alert"]')?.textContent || "";
        findButton("Move to project document")?.click();
        setTimeout(() => {
            const harness = document.querySelector("#harness");
            finish({
                sourceVisible: before.includes("Source notes"), targetVisible: before.includes("Ship release"),
                parentChangeVisible: before.includes("Effective parent will change"),
                unchangedParentVisible: document.querySelector("#unchanged-parent")?.textContent.includes("Effective parent will not change"),
                recoveredVisible: recovered.includes("original position restored"),
                placementVisible, selectedPreviousId: harness?.dataset.previous,
                attempts: harness?.dataset.attempts, moved: harness?.dataset.moved, closed: harness?.dataset.closed,
            });
        }, 60);
    }, 60);
}, 60);`,
        );

        await build({
            root: fixtureRoot,
            base: "./",
            configFile: false,
            logLevel: "silent",
            resolve: {
                alias: [
                    { find: "siyuan", replacement: join(fixtureRoot, "siyuan.js") },
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

        const rendered = await runBrowser(
            findBrowserExecutable(),
            [
                "--headless=new",
                "--disable-gpu",
                "--disable-extensions",
                "--allow-file-access-from-files",
                "--disable-web-security",
                "--no-first-run",
                "--no-sandbox",
                "--virtual-time-budget=1200",
                `--user-data-dir=${join(fixtureRoot, "browser-profile")}`,
                "--dump-dom",
                pathToFileURL(join(fixtureRoot, "dist", "index.html")).href,
            ],
            { encoding: "utf8", timeout: 20_000 },
        );
        assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message || "浏览器测试启动失败");
        const match = rendered.stdout.match(/<pre id="browser-result">([^<]+)<\/pre>/);
        assert.ok(match, `浏览器未输出结果：${rendered.stdout.slice(0, 2_000)}`);
        // Regression: 无显式父级且有效父级不变时，不得误称“显式父级已保留”。
        assert.deepEqual(JSON.parse(match[1].replace(/&quot;/g, '"')), {
            sourceVisible: true,
            targetVisible: true,
            parentChangeVisible: true,
            unchangedParentVisible: true,
            recoveredVisible: true,
            placementVisible: true,
            selectedPreviousId: "20260825110003-heading",
            attempts: "2",
            moved: "20260825110000-actionx",
            closed: "false",
        });
    } finally {
        removeBrowserFixture(fixtureRoot);
    }
});

test("移动对话框在动态组件加载完成前关闭时不会实例化已脱离 DOM 的组件", async () => {
    // Regression: 动态 import 尚未完成时关闭 Dialog，不能继续挂载组件或发起预览 RPC。
    const fixtureRoot = mkdtempSync(join(tmpdir(), "nextaction-action-move-close-"));
    try {
        const dialogPath = resolve("src/frontend/dialogs/action-move-dialog.ts").replace(/\\/g, "/");
        writeFileSync(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}');
        writeFileSync(
            join(fixtureRoot, "index.html"),
            '<!doctype html><html><body><script type="module" src="./main.js"></script></body></html>',
        );
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
export function showMessage() {}
export function openTab() {}`,
        );
        writeFileSync(
            join(fixtureRoot, "main.js"),
            `import { latestDialog } from "siyuan";
import { openActionMoveDialog } from ${JSON.stringify(dialogPath)};
void (async () => {
let previews = 0;
const task = { blockId: "20260825110000-actionx", title: "Move safely" };
const project = { blockId: "20260825110001-project", title: "Ship release" };
const bridge = {
    previewActionMove: async () => { previews++; return {}; },
    moveActionToProject: async () => ({}),
};
const i18n = new Proxy({ moveActionPreviewFailed: "Cannot preview move: {error}" }, { get: (target, key) => target[key] || String(key) });
const opening = openActionMoveDialog({ bridge, i18n, task, project });
latestDialog.destroy();
await opening;
await new Promise((resolve) => setTimeout(resolve, 20));
const result = document.createElement("pre");
result.id = "browser-result";
result.textContent = JSON.stringify({ previews, dialogs: document.querySelectorAll(".na-action-move-dialog").length });
document.body.appendChild(result);
})();`,
        );

        await build({
            root: fixtureRoot,
            base: "./",
            configFile: false,
            logLevel: "silent",
            resolve: {
                alias: [
                    { find: "siyuan", replacement: join(fixtureRoot, "siyuan.js") },
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

        const rendered = await runBrowser(
            findBrowserExecutable(),
            [
                "--headless=new",
                "--disable-gpu",
                "--disable-extensions",
                "--allow-file-access-from-files",
                "--disable-web-security",
                "--no-first-run",
                "--no-sandbox",
                "--virtual-time-budget=5000",
                `--user-data-dir=${join(fixtureRoot, "browser-profile")}`,
                "--dump-dom",
                pathToFileURL(join(fixtureRoot, "dist", "index.html")).href,
            ],
            { encoding: "utf8", timeout: 20_000 },
        );
        assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message || "浏览器测试启动失败");
        const match = rendered.stdout.match(/<pre id="browser-result">([^<]+)<\/pre>/);
        assert.ok(match, `浏览器未输出结果：${rendered.stdout.slice(0, 2_000)}`);
        assert.deepEqual(JSON.parse(match[1].replace(/&quot;/g, '"')), { previews: 0, dialogs: 0 });
    } finally {
        removeBrowserFixture(fixtureRoot);
    }
});
