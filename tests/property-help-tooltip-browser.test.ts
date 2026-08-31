import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

test("属性帮助通过图标按需显示，并支持指针、键盘与点击访问", async () => {
    const result = await runSvelteBrowserTest({
        fixtureName: "property-help",
        virtualTimeBudget: 2_000,
        prepareFixture(fixtureRoot) {
            const rowComponentPath = resolve("src/frontend/ui/NaPropertyRow.svelte").replace(/\\/g, "/");
            const sectionComponentPath = resolve("src/frontend/ui/NaPropertySection.svelte").replace(/\\/g, "/");
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import NaPropertyRow from ${JSON.stringify(rowComponentPath)};
import NaPropertySection from ${JSON.stringify(sectionComponentPath)};
</script>

<div class="nextaction">
    <div id="help-section">
        <NaPropertySection title="Project definition" helpText="These properties control the project">
            <div>Project fields</div>
        </NaPropertySection>
    </div>
    <div id="collapsible-section">
        <NaPropertySection
            title="Review"
            helpText="Review this item on a regular cadence"
            summary="Every 7 days"
            collapsible={true}
        >
            <div>Review fields</div>
        </NaPropertySection>
    </div>
    <div id="help-row">
        <NaPropertyRow
            label="Importance"
            helpText="Task value; higher values raise automatic ranking and preserve a deliberately long explanation."
        >
            <input aria-label="Importance value" />
        </NaPropertyRow>
    </div>
    <div id="plain-row"><NaPropertyRow label="Status"><input aria-label="Status value" /></NaPropertyRow></div>
</div>`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import Harness from "./Harness.svelte";
new Harness({ target: document.querySelector("#app") });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const popup = () => document.querySelector('.na-tooltip__popup[role="tooltip"]');
const finish = (value) => {
    const result = document.createElement("pre");
    result.id = "browser-result";
    result.textContent = JSON.stringify(value);
    document.body.appendChild(result);
};

setTimeout(async () => {
    const trigger = document.querySelector("#help-row .na-help-tooltip .na-tooltip");
    const helpRow = trigger?.closest(".na-property-row");
    const initial = {
        triggerCount: document.querySelectorAll(".na-help-tooltip").length,
        sectionTriggerCount: document.querySelectorAll("#help-section .na-help-tooltip").length,
        sectionInlineDescriptionCount: document.querySelectorAll("#help-section small").length,
        collapsibleTriggerCount: document.querySelectorAll("#collapsible-section .na-help-tooltip").length,
        nestedInteractiveCount: document.querySelectorAll("#collapsible-section button .na-help-tooltip").length,
        summaryInTriggerCount: document.querySelectorAll("#collapsible-section button .na-property-section__summary").length,
        collapsibleTriggerMinHeight: getComputedStyle(document.querySelector("#collapsible-section button")).minHeight,
        plainTriggerCount: document.querySelectorAll("#plain-row .na-help-tooltip").length,
        inlineDescriptionCount: helpRow?.querySelectorAll(".na-property-row__label small").length ?? -1,
        ariaLabel: trigger?.getAttribute("aria-label") || "",
    };

    trigger?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX: 80, clientY: 40 }));
    await wait(350);
    const hoveredPopup = popup();
    const hovered = {
        visible: Boolean(hoveredPopup),
        text: hoveredPopup?.textContent?.trim() || "",
        wraps: hoveredPopup ? getComputedStyle(hoveredPopup).whiteSpace === "normal" : false,
        widthLimited: hoveredPopup ? getComputedStyle(hoveredPopup).maxWidth !== "none" : false,
    };

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wait(20);
    const hiddenOnGlobalEscape = !popup();

    trigger?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX: 80, clientY: 40 }));
    await wait(350);
    window.dispatchEvent(new Event("scroll"));
    await wait(20);
    const hiddenOnViewportChange = !popup();

    trigger?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX: 80, clientY: 40 }));
    await wait(350);
    trigger?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    await wait(20);
    const hiddenAfterLeave = !popup();

    trigger?.focus();
    await wait(350);
    const visibleOnFocus = Boolean(popup());
    trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(20);
    const hiddenOnEscape = !popup();

    trigger?.click();
    await wait(20);
    const visibleOnClick = Boolean(popup());
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await wait(20);
    const hiddenOnOutsideClick = !popup();

    finish({
        initial,
        hovered,
        hiddenOnGlobalEscape,
        hiddenOnViewportChange,
        hiddenAfterLeave,
        visibleOnFocus,
        hiddenOnEscape,
        visibleOnClick,
        hiddenOnOutsideClick,
    });
}, 0);`,
            );
        },
    });

    assert.deepEqual(result, {
        initial: {
            triggerCount: 3,
            sectionTriggerCount: 1,
            sectionInlineDescriptionCount: 0,
            collapsibleTriggerCount: 1,
            nestedInteractiveCount: 0,
            summaryInTriggerCount: 1,
            collapsibleTriggerMinHeight: "36px",
            plainTriggerCount: 0,
            inlineDescriptionCount: 0,
            ariaLabel:
                "Importance: Task value; higher values raise automatic ranking and preserve a deliberately long explanation.",
        },
        hovered: {
            visible: true,
            text: "Task value; higher values raise automatic ranking and preserve a deliberately long explanation.",
            wraps: true,
            widthLimited: true,
        },
        hiddenOnGlobalEscape: true,
        hiddenOnViewportChange: true,
        hiddenAfterLeave: true,
        visibleOnFocus: true,
        hiddenOnEscape: true,
        visibleOnClick: true,
        hiddenOnOutsideClick: true,
    });
});
