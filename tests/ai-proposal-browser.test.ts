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

test("AI Action 预览支持编辑与选择，确认前不写入", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "nextaction-ai-proposal-"));
    try {
        const componentPath = resolve("src/frontend/components/AiProposalDialog.svelte").replace(/\\/g, "/");
        writeFileSync(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}');
        writeFileSync(
            join(fixtureRoot, "index.html"),
            '<!doctype html><html><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>',
        );
        writeFileSync(
            join(fixtureRoot, "siyuan.js"),
            "export class Menu {}\nexport function openTab() {}\nexport function showMessage() {}\n",
        );
        writeFileSync(
            join(fixtureRoot, "Harness.svelte"),
            `<script>
import AiProposalDialog from ${JSON.stringify(componentPath)};

const firstSourceId = "20260825191000-source1";
const secondSourceId = "20260825191001-source2";
const defaultProjectId = "20260825191002-project";
const sourceBlockIds = [firstSourceId, secondSourceId];
const proposal = {
    feature: "extractTasks", summary: "Choose Actions", target: { type: "mcp_default" },
    tasks: [
        { title: "Draft title", sourceBlockId: firstSourceId, actionKind: "action" },
        { title: "Skip this", sourceBlockId: secondSourceId, actionKind: "action" },
    ],
};
const i18n = new Proxy({
    aiChanges: "Suggested changes", aiDetectedItems: "Detected {count} items", aiSelectedItems: "{count} selected",
    aiWriteTarget: "Creation target", aiWriteTargetHint: "Written only after confirmation", aiTargetDefault: "Default",
    aiTargetSourceChild: "Source child", aiTargetCurrentDocument: "Current document", aiTargetSourceDocument: "Source document",
    aiTargetDocument: "Specific document", aiTargetOriginal: "Convert in place", aiCandidateTitle: "Action title",
    aiProposalKindTask: "Action", aiProposalEyebrow: "AI Proposal", cancel: "Cancel", confirm: "Confirm",
    loading: "Loading", aiApplied: "Applied", aiRetryFailed: "Retry failed", aiItemFailed: "Not applied",
    aiRetryAvailable: "Can retry", aiPartialSummary: "{count} suggestions need attention", aiItemCreated: "Action created",
}, { get: (target, key) => target[key] || String(key) });
let validateCalls = [];
let applyCalls = [];
let destroyed = 0;
const dialog = { destroy: () => (destroyed += 1) };
const bridge = {
    async validateAiProposal(next, context) {
        validateCalls = [...validateCalls, { proposal: next, context }];
        return { proposal: next, errors: [] };
    },
    async applyAiProposal(next, context) {
        applyCalls = [...applyCalls, { proposal: next, context }];
        if (applyCalls.length === 1) {
            return {
                feature: "extractTasks", created: [], converted: [], myDay: null, warnings: [],
                items: [{
                    index: 0, sourceBlockId: firstSourceId, target: "mcp_default", status: "failed",
                    error: "temporary write failure", retryable: true,
                }],
            };
        }
        return {
            feature: "extractTasks", created: [], converted: [], myDay: null, warnings: [],
            items: [{ index: 0, sourceBlockId: firstSourceId, target: "mcp_default", status: "created", retryable: false }],
        };
    },
};
</script>

<div id="harness" data-validates={JSON.stringify(validateCalls)} data-applies={JSON.stringify(applyCalls)} data-destroyed={destroyed}>
    <AiProposalDialog {proposal} {bridge} {i18n} {dialog} {sourceBlockIds} {defaultProjectId} />
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
    const harness = document.querySelector("#harness");
    const beforeConfirm = JSON.parse(harness?.dataset.applies || "[]").length;
    const title = document.querySelector(".na-ai-proposal__title-input");
    if (title) {
        title.value = "";
        title.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setTimeout(() => {
        const confirmButton = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Confirm");
        const disabledWithEmptyTitle = Boolean(confirmButton?.disabled);
        if (title) {
            title.value = "Edited Action";
            title.dispatchEvent(new Event("input", { bubbles: true }));
        }
        const checkboxes = [...document.querySelectorAll('.na-ai-proposal__row input[type="checkbox"]')];
        checkboxes[1]?.click();
        setTimeout(() => {
            confirmButton?.click();
            setTimeout(() => {
                const partialVisible = document.body.textContent.includes("Not applied") &&
                    document.body.textContent.includes("Can retry");
                const destroyedAfterPartial = Number(harness?.dataset.destroyed || 0);
                [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Retry failed")?.click();
                setTimeout(() => {
                    finish({
                        beforeConfirm,
                        titleInputFound: Boolean(title),
                        disabledWithEmptyTitle,
                        partialVisible,
                        destroyedAfterPartial,
                        validateCalls: JSON.parse(harness?.dataset.validates || "[]"),
                        applyCalls: JSON.parse(harness?.dataset.applies || "[]"),
                        destroyed: Number(harness?.dataset.destroyed || 0),
                    });
                }, 100);
            }, 100);
        }, 100);
    }, 50);
}, 50);`,
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
                        find: "chrono-node/en",
                        replacement: resolve("node_modules/chrono-node/dist/esm/locales/en/index.js"),
                    },
                    {
                        find: "chrono-node/zh/hans",
                        replacement: resolve("node_modules/chrono-node/dist/esm/locales/zh/hans/index.js"),
                    },
                    {
                        find: /^svelte\/internal\/disclose-version$/,
                        replacement: join(svelteRoot, "src/runtime/internal/disclose-version/index.js"),
                    },
                    { find: /^svelte\/internal$/, replacement: join(svelteRoot, "src/runtime/internal/index.js") },
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
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-sync",
                "--allow-file-access-from-files",
                "--disable-web-security",
                "--no-first-run",
                "--no-sandbox",
                "--virtual-time-budget=1000",
                `--user-data-dir=${join(fixtureRoot, "browser-profile")}`,
                "--dump-dom",
                pathToFileURL(join(fixtureRoot, "dist", "index.html")).href,
            ],
            { encoding: "utf8", timeout: 20_000 },
        );
        assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message || "AI proposal 浏览器测试失败");
        const match = rendered.stdout.match(/<pre id="browser-result">([^<]+)<\/pre>/);
        assert.ok(match, `浏览器未输出 AI proposal 结果：${rendered.stderr.slice(0, 1_000)}`);
        const result = JSON.parse(match[1].replace(/&quot;/g, '"'));
        assert.equal(result.beforeConfirm, 0);
        assert.equal(result.titleInputFound, true);
        assert.equal(result.disabledWithEmptyTitle, true);
        assert.equal(result.partialVisible, true);
        assert.equal(result.destroyedAfterPartial, 0);
        assert.equal(result.validateCalls.length, 2);
        assert.deepEqual(result.validateCalls[0].context.sourceBlockIds, [
            "20260825191000-source1",
            "20260825191001-source2",
        ]);
        const expectedTask = {
            title: "Edited Action",
            sourceBlockId: "20260825191000-source1",
            actionKind: "action",
            parentId: "20260825191002-project",
        };
        assert.deepEqual(result.applyCalls[0].proposal.tasks, [expectedTask]);
        assert.deepEqual(result.applyCalls[1].proposal.tasks, [expectedTask]);
        assert.deepEqual(result.applyCalls[0].context, result.validateCalls[0].context);
        assert.deepEqual(result.applyCalls[1].context, result.validateCalls[1].context);
        assert.equal(result.destroyed, 1);
    } finally {
        removeBrowserFixture(fixtureRoot);
    }
});
