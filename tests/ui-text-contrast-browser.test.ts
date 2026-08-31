import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

type ContrastResult = Record<string, Record<string, number>>;

// Regression: 插件界面曾直接使用宿主的半透明、强调色和反色文字，导致多处小字号文字低于 4.5:1。
test("插件信息文字在默认与低对比明暗主题下保持可读", async () => {
    const result = await runSvelteBrowserTest<ContrastResult>({
        fixtureName: "ui-text-contrast",
        prepareFixture(fixtureRoot) {
            const source = (path: string) => JSON.stringify(resolve(path).replace(/\\/g, "/"));

            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import NaButton from ${source("src/frontend/ui/NaButton.svelte")};
import NaBadge from ${source("src/frontend/ui/NaBadge.svelte")};
import NaDatePicker from ${source("src/frontend/ui/NaDatePicker.svelte")};
import NaInlineNotice from ${source("src/frontend/ui/NaInlineNotice.svelte")};
import NaNavItem from ${source("src/frontend/ui/NaNavItem.svelte")};
import NaProgressBar from ${source("src/frontend/ui/NaProgressBar.svelte")};
import NaSegmentControl from ${source("src/frontend/ui/NaSegmentControl.svelte")};
import NaSettingRow from ${source("src/frontend/ui/NaSettingRow.svelte")};
import NaViewHint from ${source("src/frontend/ui/NaViewHint.svelte")};

const themes = ["daylight", "midnight", "low-light", "low-dark"];
const segments = [{ value: "all", label: "All" }, { value: "open", label: "Open" }];
</script>

{#each themes as theme}
    <section class="nextaction sample sample--{theme}" data-theme={theme}>
        <div class="sample__surface">
            <p class="audit-primary">Primary information</p>
            <p class="audit-secondary">Secondary information</p>
            <NaButton variant="primary">Save changes</NaButton>
            <NaButton variant="danger">Delete task</NaButton>
            <NaButton variant="text">Open details</NaButton>
            <div><NaBadge text="Primary" tone="primary" /> <NaBadge text="Warning" tone="warning" /> <NaBadge text="Danger" tone="danger" /></div>
            <NaInlineNotice message="The task could not be saved" tone="error" />
            <NaSegmentControl options={segments} value="open" label="Task status" />
            <NaDatePicker value="2026-08-30" placeholder="Schedule" />
            <NaNavItem label="Inbox" />
            <NaNavItem label="Today" active={true} badge={3} />
            <NaSettingRow title="Review interval" description="Choose how often projects are reviewed" />
            <NaProgressBar percent={42} label="Completion" />
            <NaViewHint text="Showing tasks available today" />
            <div class="na-task-card na-task-card--done">
                <div class="na-task-card__body">
                    <span class="na-task-card__title">Completed task remains readable</span>
                    <span class="na-task-card__meta">Completed yesterday</span>
                </div>
            </div>
            <div class="na-reminder-popover__summary na-reminder-popover__summary--next-action">
                <strong>Next action</strong>
                <span class="na-reminder-popover__summary__message">A reminder message from the host overlay</span>
            </div>
        </div>
    </section>
{/each}

<style>
    :global(body) {
        margin: 0;
        background: #fff;
    }
    .sample {
        width: 460px;
        padding: 16px;
        font-family: sans-serif;
        --b3-border-radius: 6px;
        --b3-border-radius-b: 8px;
        --b3-list-hover: rgb(50 58 73 / 8%);
        --b3-theme-primary: #3575f0;
        --b3-theme-primary-light: rgb(53 117 240 / 54%);
        --b3-theme-primary-lighter: rgb(53 117 240 / 38%);
        --b3-theme-primary-lightest: rgb(53 117 240 / 14%);
        --b3-theme-on-primary: #fff;
        --b3-theme-error: #d23f31;
        --b3-card-error-color: #790600;
        --b3-card-warning-color: #8a4f00;
        --b3-card-info-color: #005599;
        --b3-card-success-color: #006b04;
    }
    .sample__surface {
        display: grid;
        gap: 10px;
        padding: 16px;
        color: var(--b3-theme-on-background);
        background: var(--b3-theme-surface);
    }
    .sample p {
        margin: 0;
        font-size: 12px;
    }
    .audit-primary {
        color: var(--na-text-primary);
    }
    .audit-secondary {
        color: var(--na-text-secondary);
    }
    .sample--daylight {
        --b3-theme-on-background: #222;
        --b3-theme-on-surface: #5f6368;
        --b3-theme-on-surface-light: rgb(95 99 104 / 68%);
        --b3-theme-surface: #f6f6f6;
        --b3-theme-surface-light: rgb(243 243 243 / 86%);
        --b3-theme-surface-lighter: #e0e0e0;
        --b3-theme-background: #fff;
        --b3-border-color: #e0e0e0;
    }
    .sample--midnight {
        --b3-theme-on-background: #dadada;
        --b3-theme-on-surface: #9aa0a6;
        --b3-theme-on-surface-light: #bababa;
        --b3-theme-surface: #2c2c2c;
        --b3-theme-surface-light: rgb(41 42 45 / 86%);
        --b3-theme-surface-lighter: rgb(230 230 230 / 10%);
        --b3-theme-background: #1e1e1e;
        --b3-border-color: #484848;
        --b3-card-error-color: rgb(243 153 147);
        --b3-card-warning-color: rgb(255 213 153);
        --b3-card-info-color: rgb(166 213 250);
        --b3-card-success-color: rgb(183 223 185);
    }
    .sample--low-light {
        --b3-theme-on-background: #323a49;
        --b3-theme-on-surface: rgb(50 58 73 / 65%);
        --b3-theme-on-surface-light: rgb(132 144 162 / 68%);
        --b3-theme-surface: #e7ebf3;
        --b3-theme-surface-light: rgb(224 229 238 / 82%);
        --b3-theme-surface-lighter: #d3d9e4;
        --b3-theme-background: #f8f9fc;
        --b3-border-color: #cbd2df;
    }
    .sample--low-dark {
        --b3-theme-on-background: #edf1f7;
        --b3-theme-on-surface: rgb(237 241 247 / 65%);
        --b3-theme-on-surface-light: rgb(180 190 204 / 68%);
        --b3-theme-surface: #202630;
        --b3-theme-surface-light: rgb(43 50 62 / 86%);
        --b3-theme-surface-lighter: #343c49;
        --b3-theme-background: #171b22;
        --b3-border-color: #3b4350;
        --b3-card-error-color: #ffb4ad;
        --b3-card-warning-color: #ffd699;
        --b3-card-info-color: #a8d7ff;
        --b3-card-success-color: #b7dfb9;
    }
</style>`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import ${source("src/frontend/ui/tokens.scss")};
import ${source("src/frontend/styles/components.scss")};
import ${source("src/frontend/styles/host-integration.scss")};
import Harness from "./Harness.svelte";
new Harness({ target: document.querySelector("#app") });

function rgba(value) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
}

function composite(foreground, background) {
    const alpha = foreground[3] / 255;
    const backgroundAlpha = background[3] / 255;
    const outputAlpha = alpha + backgroundAlpha * (1 - alpha);
    return [
        ...foreground.slice(0, 3).map(
            (channel, index) =>
                (channel * alpha + background[index] * backgroundAlpha * (1 - alpha)) / outputAlpha,
        ),
        outputAlpha * 255,
    ];
}

function backdrop(element) {
    const chain = [];
    for (let current = element; current; current = current.parentElement) chain.push(current);
    let result = [255, 255, 255, 255];
    for (const current of chain.reverse()) result = composite(rgba(getComputedStyle(current).backgroundColor), result);
    return result;
}

function luminance([red, green, blue]) {
    const channels = [red, green, blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(element) {
    const background = backdrop(element);
    const foreground = composite(rgba(getComputedStyle(element).color), background);
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

const selectors = {
    primary: ".audit-primary",
    secondary: ".audit-secondary",
    primaryButton: ".na-button--primary span",
    dangerButton: ".na-button--danger span",
    textButton: ".na-button--text span",
    primaryBadge: ".na-badge--primary",
    warningBadge: ".na-badge--warning",
    dangerBadge: ".na-badge--danger",
    errorNotice: ".na-inline-notice--error span",
    segment: ".na-segment-control__option:not(.na-segment-control__option--active)",
    segmentActive: ".na-segment-control__option--active",
    dateInput: ".na-date-picker__input",
    nav: ".na-nav-item:not(.na-nav-item--active) .na-nav-item__label",
    navActive: ".na-nav-item--active .na-nav-item__label",
    navBadge: ".na-nav-item__badge",
    settingTitle: ".na-setting-row__title",
    settingDescription: ".na-setting-row__description",
    progressLabel: ".na-progress__label",
    progressPercent: ".na-progress__percent",
    viewHint: ".na-view-hint",
    completedTitle: ".na-task-card--done .na-task-card__title",
    completedMeta: ".na-task-card--done .na-task-card__meta",
    hostMessage: ".na-reminder-popover__summary__message",
};

const result = {};
for (const sample of document.querySelectorAll(".sample")) {
    result[sample.dataset.theme] = Object.fromEntries(
        Object.entries(selectors).map(([name, selector]) => [name, contrast(sample.querySelector(selector))]),
    );
}
const output = document.createElement("pre");
output.id = "browser-result";
output.textContent = JSON.stringify(result);
document.body.appendChild(output);`,
            );
        },
    });

    for (const [theme, ratios] of Object.entries(result)) {
        for (const [element, ratio] of Object.entries(ratios)) {
            assert.ok(ratio >= 4.5, `${theme}.${element} 对比度 ${ratio.toFixed(2)}:1 低于 4.5:1`);
        }
    }
});
