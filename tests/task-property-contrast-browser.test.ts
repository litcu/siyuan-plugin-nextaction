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

type ContrastResult = Record<string, Record<string, number>>;

// Regression: 部分主题的半透明前景色曾使任务属性面板文字低于 4.5:1。
test("任务属性面板文字在明暗低对比主题下保持可读", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "nextaction-task-property-contrast-"));
    try {
        const headerPath = resolve("src/frontend/ui/NaDialogHeader.svelte").replace(/\\/g, "/");
        const rowPath = resolve("src/frontend/ui/NaPropertyRow.svelte").replace(/\\/g, "/");
        const sectionPath = resolve("src/frontend/ui/NaPropertySection.svelte").replace(/\\/g, "/");
        const tokensPath = resolve("src/frontend/ui/tokens.scss").replace(/\\/g, "/");

        writeFileSync(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}');
        writeFileSync(
            join(fixtureRoot, "index.html"),
            '<!doctype html><html><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>',
        );
        writeFileSync(
            join(fixtureRoot, "Harness.svelte"),
            `<script>
import NaDialogHeader from ${JSON.stringify(headerPath)};
import NaPropertyRow from ${JSON.stringify(rowPath)};
import NaPropertySection from ${JSON.stringify(sectionPath)};
</script>

{#each ["light", "dark"] as theme}
    <div class="nextaction sample sample--{theme}" data-theme={theme}>
        <NaDialogHeader title="Task title" subtitle="Created yesterday" status="Todo" closeLabel="Close" />
        <NaPropertySection title="Relations" description="Optional settings" summary="Not configured" collapsible={true} />
        <NaPropertySection title="Core properties">
            <NaPropertyRow label="Status" description="Current task state"><input value="Todo" readonly /></NaPropertyRow>
        </NaPropertySection>
    </div>
{/each}

<style>
    .sample {
        width: 440px;
        margin-bottom: 24px;
        --b3-border-radius: 6px;
        --b3-border-color: #cbd2df;
        --b3-list-hover: rgb(50 58 73 / 8%);
        --b3-theme-primary: #498fff;
        --b3-theme-primary-lightest: rgb(73 143 255 / 20%);
        --b3-theme-on-primary: #ffffff;
    }
    .sample--light {
        --b3-theme-on-background: #323a49;
        --b3-theme-on-surface: rgb(50 58 73 / 65%);
        --b3-theme-on-surface-light: rgb(132 144 162 / 68%);
        --b3-theme-surface: #e7ebf3;
        --b3-theme-background: #f8f9fc;
    }
    .sample--dark {
        --b3-theme-on-background: #edf1f7;
        --b3-theme-on-surface: rgb(237 241 247 / 65%);
        --b3-theme-on-surface-light: rgb(180 190 204 / 68%);
        --b3-theme-surface: #202630;
        --b3-theme-background: #171b22;
        --b3-border-color: #3b4350;
        --b3-theme-primary-lightest: rgb(126 176 255 / 20%);
    }
</style>`,
        );
        writeFileSync(
            join(fixtureRoot, "main.js"),
            `import ${JSON.stringify(tokensPath)};
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

function luminance([red, green, blue]) {
    const channels = [red, green, blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
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

function contrast(element, background, backgroundBase) {
    const foreground = rgba(getComputedStyle(element).color);
    const rawBackdrop = rgba(getComputedStyle(background).backgroundColor);
    const backdrop = backgroundBase
        ? composite(rawBackdrop, rgba(getComputedStyle(backgroundBase).backgroundColor))
        : rawBackdrop;
    const visibleForeground = composite(foreground, backdrop);
    const foregroundLuminance = luminance(visibleForeground);
    const backgroundLuminance = luminance(backdrop);
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

const result = {};
for (const sample of document.querySelectorAll(".sample")) {
    const theme = sample.dataset.theme;
    const header = sample.querySelector(".na-dialog-header");
    const status = sample.querySelector(".na-dialog-header__status");
    const section = sample.querySelector(".na-property-section");
    result[theme] = {
        title: contrast(sample.querySelector(".na-dialog-header h2"), header),
        subtitle: contrast(sample.querySelector(".na-dialog-header p"), header),
        status: contrast(status, status, header),
        sectionTitle: contrast(sample.querySelector(".na-property-section__heading strong"), section),
        sectionDescription: contrast(sample.querySelector(".na-property-section__heading small"), section),
        sectionSummary: contrast(sample.querySelector(".na-property-section__summary"), section),
        rowLabel: contrast(sample.querySelector(".na-property-row__label-text"), section),
        rowDescription: contrast(sample.querySelector(".na-property-row__label small"), section),
    };
}
const output = document.createElement("pre");
output.id = "browser-result";
output.textContent = JSON.stringify(result);
document.body.appendChild(output);`,
        );

        await build({
            root: fixtureRoot,
            base: "./",
            configFile: false,
            logLevel: "silent",
            resolve: {
                alias: [
                    {
                        find: /^svelte\/internal\/flags\/legacy$/,
                        replacement: join(svelteRoot, "src/internal/flags/legacy.js"),
                    },
                    { find: /^svelte\/internal\/(.+)$/, replacement: join(svelteRoot, "src/internal/$1") },
                    {
                        find: /^svelte\/internal\/disclose-version$/,
                        replacement: join(svelteRoot, "src/internal/disclose-version.js"),
                    },
                    { find: /^svelte\/internal$/, replacement: join(svelteRoot, "src/internal/index.js") },
                    { find: /^svelte\/store$/, replacement: join(svelteRoot, "src/store/index-client.js") },
                    { find: /^svelte\/legacy$/, replacement: join(svelteRoot, "src/legacy/legacy-client.js") },
                    { find: /^svelte$/, replacement: join(svelteRoot, "src/index-client.js") },
                ],
            },
            plugins: [
                svelte({ preprocess: vitePreprocess(), compilerOptions: { compatibility: { componentApi: 4 } } }),
            ],
            build: { outDir: "dist" },
        });

        const rendered = await runBrowser(
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
                "--virtual-time-budget=1000",
                `--user-data-dir=${join(fixtureRoot, "browser-profile")}`,
                "--dump-dom",
                pathToFileURL(join(fixtureRoot, "dist", "index.html")).href,
            ],
            { encoding: "utf8", timeout: 20_000 },
        );
        assert.equal(rendered.status, 0, rendered.stderr);
        const match = rendered.stdout.match(/<pre id="browser-result">([^<]+)<\/pre>/);
        assert.ok(match, `${rendered.stdout}\n${rendered.stderr}`);
        const result = JSON.parse(match[1].replace(/&quot;/g, '"')) as ContrastResult;

        for (const [theme, ratios] of Object.entries(result)) {
            for (const [element, ratio] of Object.entries(ratios)) {
                assert.ok(ratio >= 4.5, `${theme}.${element} 对比度 ${ratio.toFixed(2)}:1 低于 4.5:1`);
            }
        }
    } finally {
        removeBrowserFixture(fixtureRoot);
    }
});
