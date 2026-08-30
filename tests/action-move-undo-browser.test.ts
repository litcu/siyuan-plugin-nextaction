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

test("移动成功反馈持续显示并支持键盘撤销、恢复选择和主动关闭", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "nextaction-action-move-undo-"));
    try {
        const hostPath = resolve("src/frontend/components/NotificationHost.svelte").replace(/\\/g, "/");
        const storePath = resolve("src/frontend/stores/action-move-undo-store.ts").replace(/\\/g, "/");
        writeFileSync(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}');
        writeFileSync(
            join(fixtureRoot, "index.html"),
            '<!doctype html><html><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>',
        );
        writeFileSync(
            join(fixtureRoot, "siyuan.js"),
            "export function openTab() {}\nexport function showMessage() {}\nexport class Menu { addItem() {} open() {} }\n",
        );
        writeFileSync(
            join(fixtureRoot, "Harness.svelte"),
            `<script>
import NotificationHost from ${JSON.stringify(hostPath)};
import { showActionMoveUndo } from ${JSON.stringify(storePath)};
let undoCalls = 0;
let selectedTaskId = "";
const actionId = "20260825130000-actionx";
const bridge = {
    undoActionMove: async () => {
        undoCalls++;
        return {
            task: {
                blockId: actionId, parentId: "", status: "todo", context: "", tags: "", taskType: "1",
                childIds: [], reviewInterval: 0, reviewDate: "",
            },
            summary: "Move safely: Ship release → Source notes",
        };
    },
};
const i18n = new Proxy({
    moveActionUndoTitle: "Action moved",
    moveActionUndo: "Undo move",
    moveActionUndoShortcut: "Ctrl/⌘+Z",
    moveActionUndoSuccess: "Move undone",
    moveActionUndoFailed: "Undo failed: {error}",
    close: "Close",
}, { get: (target, key) => target[key] || String(key) });
function start() {
    showActionMoveUndo(
        { credential: "opaque-credential", actionId, summary: "Move safely: Source notes → Ship release" },
        (task) => (selectedTaskId = task.blockId),
    );
}
</script>
<button id="start" on:click={start}>Start</button>
<div id="state" data-calls={undoCalls} data-selected={selectedTaskId}></div>
<NotificationHost {bridge} {i18n} />`,
        );
        writeFileSync(
            join(fixtureRoot, "main.js"),
            `import Harness from "./Harness.svelte";
new Harness({ target: document.querySelector("#app") });
const finish = (value) => {
    const result = document.createElement("pre"); result.id = "browser-result";
    result.textContent = JSON.stringify(value); document.body.appendChild(result);
};
document.querySelector("#start")?.click();
setTimeout(() => {
    const before = document.body.textContent;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    setTimeout(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
        const state = document.querySelector("#state");
        const afterUndo = document.body.textContent;
        const reminderDismissAllVisible = Boolean(document.querySelector(".na-notification-host__dismiss-all"));
        [...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Close")?.click();
        setTimeout(() => finish({
            persistentSummary: before.includes("Source notes → Ship release"),
            shortcutVisible: before.includes("Ctrl/⌘+Z"),
            reminderDismissAllVisible,
            successVisible: afterUndo.includes("Move undone") && afterUndo.includes("Ship release → Source notes"),
            undoCalls: state?.dataset.calls,
            selectedTaskId: state?.dataset.selected,
            closed: !document.body.textContent.includes("Move undone"),
        }), 30);
    }, 60);
}, 1100);`,
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
                    { find: /^svelte\/internal$/, replacement: join(svelteRoot, "src/runtime/internal/index.js") },
                    { find: /^svelte\/store$/, replacement: join(svelteRoot, "src/runtime/store/index.js") },
                    { find: /^svelte\/transition$/, replacement: join(svelteRoot, "src/runtime/transition/index.js") },
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
                "--virtual-time-budget=1800",
                `--user-data-dir=${join(fixtureRoot, "browser-profile")}`,
                "--dump-dom",
                pathToFileURL(join(fixtureRoot, "dist", "index.html")).href,
            ],
            { encoding: "utf8", timeout: 20_000 },
        );
        assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message || "浏览器测试启动失败");
        const match = rendered.stdout.match(/<pre id="browser-result">([^<]+)<\/pre>/);
        assert.ok(match, `浏览器未输出结果：${rendered.stdout.slice(0, 2_000)}`);
        assert.deepEqual(JSON.parse(match[1].replace(/&quot;/g, '"')), {
            persistentSummary: true,
            shortcutVisible: true,
            reminderDismissAllVisible: false,
            successVisible: true,
            undoCalls: "1",
            selectedTaskId: "20260825130000-actionx",
            closed: true,
        });
    } finally {
        removeBrowserFixture(fixtureRoot);
    }
});
