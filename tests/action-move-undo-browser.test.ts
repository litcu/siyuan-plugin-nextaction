import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

test("移动成功反馈持续显示并支持键盘撤销、恢复选择和主动关闭", async () => {
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
        },
    });
    assert.deepEqual(result, {
        persistentSummary: true,
        shortcutVisible: true,
        reminderDismissAllVisible: false,
        successVisible: true,
        undoCalls: "1",
        selectedTaskId: "20260825130000-actionx",
        closed: true,
    });
});
