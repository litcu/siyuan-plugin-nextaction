import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

// Regression: 跨文档移动撤销成功后仍常驻通知，必须手动关闭。
test("移动反馈保留键盘撤销入口，撤销成功恢复选择并自动收起", async () => {
    const result = await runSvelteBrowserTest({
        fixtureName: "action-move-undo",
        virtualTimeBudget: 1_800,
        prepareFixture(fixtureRoot) {
            const hostPath = resolve("src/frontend/components/NotificationHost.svelte").replace(/\\/g, "/");
            const storePath = resolve("src/frontend/stores/action-move-undo-store.ts").replace(/\\/g, "/");
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
<button id="start" onclick={start}>Start</button>
<div id="state" data-calls={undoCalls} data-selected={selectedTaskId}></div>
<NotificationHost {bridge} {i18n} />`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import Harness from "./Harness.svelte";
import { mount } from "svelte";
mount(Harness, { target: document.querySelector("#app") });
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
        const automaticallyClosed = !document.querySelector('.na-action-move-undo');
        const reminderDismissAllVisible = Boolean(document.querySelector(".na-notification-host__dismiss-all"));
        setTimeout(() => finish({
            persistentSummary: before.includes("Source notes → Ship release"),
            shortcutVisible: before.includes("Ctrl/⌘+Z"),
            reminderDismissAllVisible,
            automaticallyClosed,
            undoCalls: state?.dataset.calls,
            selectedTaskId: state?.dataset.selected,
        }), 30);
    }, 60);
}, 1100);`,
            );
        },
    });
    assert.deepEqual(result, {
        persistentSummary: true,
        shortcutVisible: true,
        reminderDismissAllVisible: false,
        automaticallyClosed: true,
        undoCalls: "1",
        selectedTaskId: "20260825130000-actionx",
    });
});

// Regression: 自动收起只能关闭当前撤销对应的通知，不能清除等待期间产生的新移动通知。
test("按钮撤销成功自动收起，失败保留原因，旧请求不覆盖新通知", async () => {
    const modulePath = (path: string) => JSON.stringify(resolve(path).replace(/\\/g, "/"));
    const result = await runSvelteBrowserTest({
        fixtureName: "action-move-undo-results",
        virtualTimeBudget: 3_000,
        files: {
            "siyuan.js": "export function openTab() {}\nexport function showMessage() {}\nexport class Menu {}\n",
            "Harness.svelte": `<script>
import NotificationHost from ${modulePath("src/frontend/components/NotificationHost.svelte")};
import { showActionMoveUndo } from ${modulePath("src/frontend/stores/action-move-undo-store.ts")};
let calls = 0;
let selected = '';
let resolveUndo;
let rejectUndo;
const task = { blockId: '20260825130000-actionx', parentId: '', status: 'todo', context: '', tags: '',
    taskType: '1', childIds: [], reviewInterval: 0, reviewDate: '' };
const bridge = { undoActionMove: () => {
    calls++;
    return new Promise((resolve, reject) => { resolveUndo = resolve; rejectUndo = reject; });
} };
const i18n = { moveActionUndoTitle: 'Action moved', moveActionUndo: 'Undo move',
    moveActionUndoShortcut: 'Ctrl/⌘+Z', moveActionUndoFailed: 'Undo failed: {error}', close: 'Close' };
function start(credential) {
    showActionMoveUndo({ credential, actionId: task.blockId, summary: credential }, () => selected = credential);
}
</script>
<button id="start" onclick={() => start('first move')}>Start</button>
<button id="new" onclick={() => start('new move')}>New</button>
<button id="resolve" onclick={() => resolveUndo({ task, summary: 'Restored' })}>Resolve</button>
<button id="reject" onclick={() => rejectUndo(new Error('original anchor missing'))}>Reject</button>
<div id="state" data-calls={calls} data-selected={selected}></div>
<NotificationHost {bridge} {i18n} />`,
            "main.js": `import { mount, tick } from 'svelte';
import Harness from './Harness.svelte';
mount(Harness, { target: document.querySelector('#app') });
const pause = async () => { await tick(); await new Promise(resolve => setTimeout(resolve, 30)); };
const click = async id => { document.querySelector('#' + id).click(); await pause(); };
const card = () => document.querySelector('.na-action-move-undo');
const undo = () => [...card().querySelectorAll('button')].find(node => node.textContent.trim() === 'Undo move');
const close = async () => { card().querySelector('[aria-label="Close"]').click(); await pause(); };
void (async () => {
    await click('start');
    undo().click(); await pause();
    const working = undo().disabled;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await click('resolve');
    const successClosed = !card();
    const successCalls = document.querySelector('#state').dataset.calls;
    const restoredSelection = document.querySelector('#state').dataset.selected;
    await click('start'); undo().click(); await pause(); await click('reject');
    const failure = card()?.textContent;
    await pause();
    const failurePersistent = Boolean(card());
    await close();
    const manuallyClosed = !card();
    const replacements = [];
    for (const outcome of ['resolve', 'reject']) {
        await click('start'); undo().click(); await pause(); await click('new'); await click(outcome);
        replacements.push({ outcome, summary: card()?.querySelector('p')?.textContent,
            available: Boolean(card() && undo() && !undo().disabled),
            error: Boolean(card()?.querySelector('.na-inline-notice--error')),
            selected: document.querySelector('#state').dataset.selected });
        if (card()) await close();
    }
    window.__NA_BROWSER_RESULT__({ working, successClosed, successCalls, restoredSelection,
        failure, failurePersistent, manuallyClosed, replacements });
})().catch(error => window.__NA_BROWSER_RESULT__({ error: String(error.stack || error) }));`,
        },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.working, true);
    assert.equal(result.successClosed, true);
    assert.equal(result.successCalls, "1");
    assert.equal(result.restoredSelection, "first move");
    assert.match(String(result.failure), /Undo failed: original anchor missing/);
    assert.equal(result.failurePersistent, true);
    assert.equal(result.manuallyClosed, true);
    assert.deepEqual(result.replacements, [
        { outcome: "resolve", summary: "new move", available: true, error: false, selected: "first move" },
        { outcome: "reject", summary: "new move", available: true, error: false, selected: "first move" },
    ]);
});
