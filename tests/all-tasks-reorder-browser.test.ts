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

// Regression: 整个任务行曾拦截 pointerdown，导致普通触控滚动也被 preventDefault。
test("All Tasks 提供可访问的非拖拽排序并保持触控与焦点", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "nextaction-all-tasks-reorder-"));
    try {
        const allTasksPath = resolve("src/frontend/components/AllTasksView.svelte").replace(/\\/g, "/");
        const storePath = resolve("src/frontend/stores/task-store.ts").replace(/\\/g, "/");
        writeFileSync(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}');
        writeFileSync(
            join(fixtureRoot, "index.html"),
            '<!doctype html><html><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>',
        );
        writeFileSync(
            join(fixtureRoot, "siyuan.js"),
            "export class Menu { addItem() {} open() {} } export function openTab() {} export function showMessage() {}",
        );
        writeFileSync(
            join(fixtureRoot, "Harness.svelte"),
            `<script>
import AllTasksView from ${JSON.stringify(allTasksPath)};
import { taskStore } from ${JSON.stringify(storePath)};

const makeTask = (blockId, title, overrides = {}) => ({
    blockId, identificationSource: "document", attrHostId: blockId, parentId: "", status: "todo",
    priority: "medium", importance: 4, effort: 4, due: "", start: "", context: "", taskType: "1",
    order: 0, childIds: [], title, depends: "", depMode: "all", sequential: false, repeat: "",
    repeatState: "", sort: 0, completed: "", note: "", outcome: "", dod: "", actionKind: "action",
    created: "", tags: "", blocked: false, blockedReason: "", reviewInterval: 0, reviewDate: "",
    reminder: "", customFields: {}, ...overrides,
});

let tasks = [
    makeTask("a-parent", "Parent", { sort: 0 }),
    makeTask("b-moving", "Moving", { sort: 10000 }),
    makeTask("c-later", "Later", { sort: 20000 }),
    makeTask("d-child", "Existing child", { parentId: "a-parent", sort: 0 }),
    makeTask("e-project", "Project", { taskType: "2", sort: 30000 }),
];
for (const task of tasks) taskStore.applyUpdate(task);

window.reorderCalls = [];
const bridge = {
    async reorderTask(blockId, parentId = "", afterId) {
        window.reorderCalls.push({ blockId, parentId, afterId });
        const moving = tasks.find((task) => task.blockId === blockId);
        const siblings = tasks
            .filter((task) => task.blockId !== blockId && task.parentId === parentId)
            .sort((left, right) => left.sort - right.sort || left.blockId.localeCompare(right.blockId));
        const afterIndex = afterId ? siblings.findIndex((task) => task.blockId === afterId) : -1;
        const insertIndex = afterIndex < 0 ? 0 : afterIndex + 1;
        siblings.splice(insertIndex, 0, moving);
        siblings.forEach((task, index) => (task.sort = index * 10000));
        moving.parentId = parentId;
        tasks = tasks.map((task) => task.blockId === blockId ? { ...moving } : task);
        return { ...moving };
    },
};
const i18n = new Proxy({
    moveUp: "Move up", moveDown: "Move down", moveIn: "Indent", moveOut: "Outdent",
    dragToReorder: "Drag to reorder", taskMovedUnder: "{task} moved to position {position} of {total} under {parent}.",
    taskMovedTopLevel: "{task} moved to position {position} of {total} at the top level.",
    taskMoveFailed: "Could not move {task}: {error}", manualSort: "Manual order",
}, { get: (target, key) => target[key] || String(key) });
</script>

<AllTasksView {bridge} {i18n} onEdit={() => {}} onStatusClick={() => {}} onContextMenu={() => {}} onCreate={() => {}} />

<style>
    :global(.na-task-list) { width: 720px; }
    :global(.na-all-tasks__item) { min-height: 54px; }
</style>`,
        );
        writeFileSync(
            join(fixtureRoot, "main.js"),
            `import Harness from "./Harness.svelte";
new Harness({ target: document.querySelector("#app") });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const button = (label) => document.querySelector('button[aria-label="' + label + '"]');
const dragHandle = (label) => document.querySelector('[data-na-drag-handle][title="' + label + '"]');
const drag = async (label, targetId, pointerId) => {
    const source = dragHandle(label);
    const sourceRect = source.getBoundingClientRect();
    const targetRect = document.querySelector('[data-task-block-id="' + targetId + '"]').getBoundingClientRect();
    const start = { clientX: sourceRect.left + sourceRect.width / 2, clientY: sourceRect.top + sourceRect.height / 2 };
    const destination = { clientX: targetRect.left + targetRect.width * 0.8, clientY: targetRect.top + targetRect.height / 2 };
    source.dispatchEvent(new PointerEvent("pointerdown", {
        ...start, bubbles: true, cancelable: true, button: 0, pointerId,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
        ...destination, bubbles: true, cancelable: true, button: 0, pointerId,
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
        ...destination, bubbles: true, cancelable: true, button: 0, pointerId,
    }));
    await wait(80);
};
const finish = (value) => {
    const result = document.createElement("pre");
    result.id = "browser-result";
    result.textContent = JSON.stringify(value);
    document.body.appendChild(result);
};

void (async () => {
    await wait(80);
    const movingRow = document.querySelector('[data-task-block-id="b-moving"]');
    const movingBody = movingRow.querySelector(".na-task-card__body");
    const bodyPointerDown = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1 });
    movingBody.dispatchEvent(bodyPointerDown);

    const indent = button("Indent: Moving");
    indent.focus();
    indent.click();
    await wait(80);
    const announcementAfterIndent = document.querySelector(".na-all-tasks__announcement").textContent.trim();
    const focusedAfterIndent = document.activeElement.closest("[data-task-block-id]")?.dataset.taskBlockId || "";

    const movedBody = document.querySelector('[data-task-block-id="b-moving"] .na-task-card__body');
    movedBody.focus();
    const conflictingShortcut = new KeyboardEvent("keydown", {
        key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true,
    });
    movedBody.dispatchEvent(conflictingShortcut);
    const callCountAfterConflictingShortcut = window.reorderCalls.length;
    movedBody.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowLeft", altKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }));
    await wait(80);
    const announcementAfterOutdent = document.querySelector(".na-all-tasks__announcement").textContent.trim();
    const focusedAfterOutdent = document.activeElement.closest("[data-task-block-id]")?.dataset.taskBlockId || "";
    const rowOrderAfterOutdent = [...document.querySelectorAll("[data-task-block-id]")]
        .map((row) => row.dataset.taskBlockId);

    const handle = dragHandle("Drag to reorder: Later");
    const handlePointerDown = new PointerEvent("pointerdown", {
        bubbles: true, cancelable: true, button: 0, pointerId: 2, clientX: 20, clientY: 20,
    });
    handle.dispatchEvent(handlePointerDown);
    document.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true, cancelable: true, button: 0, pointerId: 2, clientX: 20, clientY: 20,
    }));

    await drag("Drag to reorder: Later", "a-parent", 3);
    const focusedAfterDrag = document.activeElement.closest("[data-task-block-id]")?.dataset.taskBlockId || "";
    const callCountAfterValidDrag = window.reorderCalls.length;
    await drag("Drag to reorder: Parent", "d-child", 4);
    await drag("Drag to reorder: Project", "b-moving", 5);

    finish({
        labels: ["Move up: Moving", "Move down: Moving", "Indent: Moving", "Outdent: Moving"]
            .map((label) => Boolean(button(label))),
        hasDragHandle: Boolean(dragHandle("Drag to reorder: Moving")),
        bodyPointerPrevented: bodyPointerDown.defaultPrevented,
        handlePointerPrevented: handlePointerDown.defaultPrevented,
        handleAriaHidden: handle.getAttribute("aria-hidden"),
        handleTagName: handle.tagName,
        handleRole: handle.getAttribute("role"),
        handleTabIndex: handle.tabIndex,
        moveShortcut: indent.getAttribute("aria-keyshortcuts"),
        conflictingShortcutPrevented: conflictingShortcut.defaultPrevented,
        callCountAfterConflictingShortcut,
        calls: window.reorderCalls,
        announcementAfterIndent,
        announcementAfterOutdent,
        focusedAfterIndent,
        focusedAfterOutdent,
        rowOrderAfterOutdent,
        focusedAfterDrag,
        callCountAfterValidDrag,
        callCountAfterInvalidDrags: window.reorderCalls.length,
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
                    { find: "siyuan", replacement: join(fixtureRoot, "siyuan.js") },
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

        const rendered = spawnSync(
            findBrowserExecutable(),
            [
                "--headless=new",
                "--disable-gpu",
                "--disable-extensions",
                "--disable-background-networking",
                "--allow-file-access-from-files",
                "--disable-web-security",
                "--no-first-run",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--virtual-time-budget=1500",
                `--user-data-dir=${join(fixtureRoot, "browser-profile")}`,
                "--dump-dom",
                pathToFileURL(join(fixtureRoot, "dist", "index.html")).href,
            ],
            { encoding: "utf8", timeout: 20_000 },
        );
        assert.equal(rendered.status, 0, rendered.stderr);
        const match = rendered.stdout.match(/<pre id="browser-result">([^<]+)<\/pre>/);
        assert.ok(match, rendered.stdout);
        const result = JSON.parse(match[1].replace(/&quot;/g, '"'));

        assert.deepEqual(result.labels, [true, true, true, true]);
        assert.equal(result.hasDragHandle, true);
        assert.equal(result.bodyPointerPrevented, false);
        assert.equal(result.handlePointerPrevented, true);
        assert.equal(result.handleAriaHidden, "true");
        assert.equal(result.handleTagName, "SPAN");
        assert.equal(result.handleRole, null);
        assert.equal(result.handleTabIndex, -1);
        assert.equal(result.moveShortcut, "Alt+Shift+ArrowRight");
        assert.equal(result.conflictingShortcutPrevented, false);
        assert.equal(result.callCountAfterConflictingShortcut, 1);
        assert.deepEqual(result.calls.slice(0, 2), [
            { blockId: "b-moving", parentId: "a-parent", afterId: "d-child" },
            { blockId: "b-moving", parentId: "", afterId: "a-parent" },
        ]);
        assert.equal(result.announcementAfterIndent, "Moving moved to position 2 of 2 under Parent.");
        assert.equal(result.announcementAfterOutdent, "Moving moved to position 2 of 4 at the top level.");
        assert.equal(result.focusedAfterIndent, "b-moving");
        assert.equal(result.focusedAfterOutdent, "b-moving");
        assert.deepEqual(result.rowOrderAfterOutdent, ["a-parent", "d-child", "b-moving", "c-later", "e-project"]);
        assert.deepEqual(result.calls[2], {
            blockId: "c-later",
            parentId: "a-parent",
        });
        assert.equal(result.focusedAfterDrag, "c-later");
        assert.equal(result.callCountAfterValidDrag, 3);
        assert.equal(result.callCountAfterInvalidDrags, 3);
    } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
    }
});
