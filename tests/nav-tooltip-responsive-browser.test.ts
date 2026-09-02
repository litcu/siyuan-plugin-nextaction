import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

test("侧边栏 tooltip 仅在窄屏折叠导航中启用", async () => {
    const navItemPath = resolve("src/frontend/ui/NaNavItem.svelte").replace(/\\/g, "/");
    const result = await runSvelteBrowserTest<{
        tooltipTriggers: number;
        wideButtonLabel: string | null;
        narrowPopupCount: number;
        widePopupCount: number;
    }>({
        fixtureName: "nav-tooltip-responsive",
        virtualTimeBudget: 1_000,
        files: {
            "Harness.svelte": `<script>
import NaNavItem from ${JSON.stringify(navItemPath)};
</script>
<NaNavItem label="Wide" icon="iconList" tooltip="Wide tooltip" />
<NaNavItem label="Narrow" icon="iconList" tooltip="Narrow tooltip" collapsed />`,
            "main.js": `import { mount } from "svelte";
import Harness from "./Harness.svelte";
mount(Harness, { target: document.querySelector("#app") });
setTimeout(() => {
    const triggers = [...document.querySelectorAll(".na-tooltip")];
    const narrow = triggers[0];
    narrow?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX: 20, clientY: 20 }));
    setTimeout(() => {
        window.__NA_BROWSER_RESULT__({
            tooltipTriggers: document.querySelectorAll(".na-tooltip").length,
            wideButtonLabel: document.querySelector("button")?.getAttribute("aria-label") ?? null,
            narrowPopupCount: document.querySelectorAll(".na-tooltip__popup").length,
            widePopupCount: document.querySelectorAll(".na-tooltip:not(:has(button)) .na-tooltip__popup").length,
        });
    }, 350);
}, 0);`,
        },
    });

    assert.deepEqual(result, {
        tooltipTriggers: 1,
        wideButtonLabel: "Wide",
        narrowPopupCount: 1,
        widePopupCount: 0,
    });
});
