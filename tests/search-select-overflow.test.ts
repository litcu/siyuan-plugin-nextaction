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

// Regression: 多选搜索框的选项总宽度超过控件宽度时不得横向溢出。
test("多选搜索框会在固定宽度内容纳过长选项", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "nextaction-search-select-"));
    try {
        const componentPath = resolve("src/frontend/ui/NaSearchSelect.svelte").replace(/\\/g, "/");
        writeFileSync(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}');
        writeFileSync(
            join(fixtureRoot, "index.html"),
            '<!doctype html><html><body><div id="control"></div><script type="module" src="./main.js"></script></body></html>',
        );
        writeFileSync(
            join(fixtureRoot, "main.js"),
            `import NaSearchSelect from ${JSON.stringify(componentPath)};
const control = document.querySelector("#control");
control.style.width = "394px";
new NaSearchSelect({
    target: control,
    props: {
        multi: true,
        selected: ["上下文上下文", "下上下文下上下文", "中中中中中中", "第四个上下文"],
        removeLabel: "移除",
    },
});
const box = control.querySelector(".na-search-select__box");
const result = document.createElement("pre");
result.id = "layout-result";
result.textContent = JSON.stringify({
    clientWidth: control.clientWidth,
    scrollWidth: control.scrollWidth,
    boxClientWidth: box.clientWidth,
    boxScrollWidth: box.scrollWidth,
    overflow: control.scrollWidth > control.clientWidth,
});
document.body.appendChild(result);`,
        );

        await build({
            root: fixtureRoot,
            base: "./",
            configFile: false,
            logLevel: "silent",
            resolve: {
                alias: [
                    {
                        find: /^svelte\/internal\/disclose-version$/,
                        replacement: join(svelteRoot, "src/runtime/internal/disclose-version/index.js"),
                    },
                    {
                        find: /^svelte\/internal$/,
                        replacement: join(svelteRoot, "src/runtime/internal/index.js"),
                    },
                    { find: /^svelte$/, replacement: join(svelteRoot, "src/runtime/index.js") },
                ],
            },
            plugins: [svelte({ preprocess: vitePreprocess() })],
            build: { outDir: "dist" },
        });

        const browser = findBrowserExecutable();
        const profileDir = join(fixtureRoot, "browser-profile");
        const rendered = spawnSync(
            browser,
            [
                "--headless=new",
                "--disable-gpu",
                "--disable-extensions",
                "--allow-file-access-from-files",
                "--disable-web-security",
                "--no-first-run",
                "--no-sandbox",
                `--user-data-dir=${profileDir}`,
                "--dump-dom",
                pathToFileURL(join(fixtureRoot, "dist", "index.html")).href,
            ],
            { encoding: "utf8", timeout: 20_000 },
        );
        assert.equal(rendered.status, 0, rendered.stderr || "浏览器布局测试执行失败");

        const match = rendered.stdout.match(/<pre id="layout-result">([^<]+)<\/pre>/);
        assert.ok(match, `浏览器未输出布局测量结果：${rendered.stdout.slice(0, 2_000)}`);
        const metrics = JSON.parse(match[1].replace(/&quot;/g, '"')) as {
            clientWidth: number;
            scrollWidth: number;
            boxClientWidth: number;
            boxScrollWidth: number;
            overflow: boolean;
        };
        assert.equal(metrics.overflow, false, `多选框发生横向溢出：${JSON.stringify(metrics)}`);
    } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
    }
});
