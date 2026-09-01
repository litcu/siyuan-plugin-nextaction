import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

test("公共容器通过 typed snippets 渲染内容并保留折叠与关闭行为", async () => {
    const uiRoot = resolve("src/frontend/ui").replace(/\\/g, "/");
    const result = await runSvelteBrowserTest<{
        initialAccordionContent: boolean;
        openedAccordionContent: boolean;
        accordionValues: boolean[];
        dialogContent: string[];
        closeCount: number;
        emptyNoticeCount: number;
        emptyToolbarActionsCount: number;
        drawerReasons: string[];
        drawerContentWhileClosed: boolean;
    }>({
        fixtureName: "public-container-snippets",
        files: {
            "Harness.svelte": `<script>
import NaAccordion from ${JSON.stringify(`${uiRoot}/NaAccordion.svelte`)};
import NaDialogShell from ${JSON.stringify(`${uiRoot}/NaDialogShell.svelte`)};
import NaDrawerHost from ${JSON.stringify(`${uiRoot}/NaDrawerHost.svelte`)};
import NaToolbar from ${JSON.stringify(`${uiRoot}/NaToolbar.svelte`)};

let accordionOpen = false;
let accordionValues = [];
let closeCount = 0;
let drawerOpen = false;
let drawerReasons = [];
window.__accordionValues = accordionValues;
window.__closeCount = closeCount;
window.__drawerReasons = drawerReasons;

function handleAccordionOpen(nextOpen) {
    accordionOpen = nextOpen;
    accordionValues = [...accordionValues, nextOpen];
    window.__accordionValues = accordionValues;
}
function handleDrawerClose(reason) {
    drawerReasons = [...drawerReasons, reason];
    window.__drawerReasons = drawerReasons;
    drawerOpen = false;
}
function handleDialogClose() {
    closeCount += 1;
    window.__closeCount = closeCount;
}
</script>

<NaAccordion title="Details" open={accordionOpen} onOpenChange={handleAccordionOpen}>
    {#snippet action()}<button id="accordion-action">Action</button>{/snippet}
    <p id="accordion-content">Accordion body</p>
</NaAccordion>

<NaDialogShell title="Edit task" closeLabel="Close" onClose={handleDialogClose}>
    {#snippet headerActions()}<button id="header-action">Header action</button>{/snippet}
    {#snippet notice()}<p id="dialog-notice">Notice</p>{/snippet}
    {#snippet footerEnd()}<button id="footer-action">Save</button>{/snippet}
    <p id="dialog-body">Dialog body</p>
</NaDialogShell>

<NaToolbar><button id="toolbar-main">Main</button></NaToolbar>

<button id="open-drawer" onclick={() => (drawerOpen = true)}>Open drawer</button>
<NaDrawerHost open={drawerOpen} label="Close drawer" onRequestClose={handleDrawerClose}>
    <p id="drawer-content">Drawer body</p>
</NaDrawerHost>`,
            "main.js": `import Harness from "./Harness.svelte";
import { mount, tick } from "svelte";

void (async () => {
mount(Harness, { target: document.querySelector("#app") });
await tick();
const initialAccordionContent = Boolean(document.querySelector("#accordion-content"));
document.querySelector(".na-accordion__trigger").click();
await tick();
const openedAccordionContent = Boolean(document.querySelector("#accordion-content"));
document.querySelector(".na-dialog-header .na-icon-button").click();
document.querySelector("#open-drawer").click();
await tick();
document.querySelector(".na-drawer-host__backdrop").click();
await tick();
document.querySelector("#open-drawer").click();
await tick();
window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
await tick();
window.__NA_BROWSER_RESULT__({
    initialAccordionContent,
    openedAccordionContent,
    accordionValues: window.__accordionValues,
    dialogContent: ["#header-action", "#dialog-notice", "#dialog-body", "#footer-action"]
        .filter((selector) => document.querySelector(selector))
        .map((selector) => document.querySelector(selector).textContent.trim()),
    closeCount: window.__closeCount,
    emptyNoticeCount: document.querySelectorAll(".na-dialog-shell__notice:empty").length,
    emptyToolbarActionsCount: document.querySelectorAll(".na-toolbar__actions-content:empty").length,
    drawerReasons: window.__drawerReasons,
    drawerContentWhileClosed: Boolean(document.querySelector("#drawer-content")),
});
})();`,
        },
    });

    // Regression: legacy slot presence checks曾生成空包装，并让容器无法接收 typed snippet 与领域值回调。
    assert.deepEqual(result, {
        initialAccordionContent: false,
        openedAccordionContent: true,
        accordionValues: [true],
        dialogContent: ["Header action", "Notice", "Dialog body", "Save"],
        closeCount: 1,
        emptyNoticeCount: 0,
        emptyToolbarActionsCount: 0,
        drawerReasons: ["backdrop", "escape"],
        drawerContentWhileClosed: true,
    });
});
