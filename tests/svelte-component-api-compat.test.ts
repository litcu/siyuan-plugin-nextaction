import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { build } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { findBrowserExecutable, removeBrowserFixture, runBrowser } from "./helpers/browser.ts";

const require = createRequire(import.meta.url);
const svelteRoot = resolve(require.resolve("svelte/package.json"), "..");

// Regression: the production Svelte 5 config must preserve class-style startup mounts until all callers migrate.
test("生产 Svelte 配置兼容现有组件挂载与销毁 API", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "nextaction-svelte-component-api-"));
    try {
        const configUrl = pathToFileURL(resolve("svelte.config.js")).href;
        const configModule = (await import(configUrl)) as { default: Parameters<typeof svelte>[0] };

        writeFileSync(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}');
        writeFileSync(
            join(fixtureRoot, "index.html"),
            '<!doctype html><html><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>',
        );
        writeFileSync(join(fixtureRoot, "Fixture.svelte"), "<script>export let message;</script><p>{message}</p>");
        writeFileSync(
            join(fixtureRoot, "main.js"),
            `import Fixture from "./Fixture.svelte";
const finish = (value) => {
    const result = document.createElement("pre");
    result.id = "browser-result";
    result.textContent = JSON.stringify(value);
    document.body.appendChild(result);
};
try {
    const component = new Fixture({ target: document.querySelector("#app"), props: { message: "ready" } });
    const text = document.querySelector("#app p")?.textContent;
    component.$destroy();
    finish({ text, childCount: document.querySelector("#app")?.childElementCount });
} catch (error) {
    finish({ error: String(error?.message || error) });
}`,
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
            plugins: [svelte(configModule.default)],
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
                "--virtual-time-budget=1000",
                `--user-data-dir=${join(fixtureRoot, "browser-profile")}`,
                "--dump-dom",
                pathToFileURL(join(fixtureRoot, "dist", "index.html")).href,
            ],
            { encoding: "utf8", timeout: 20_000 },
        );
        assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message || "浏览器执行失败");
        const match = rendered.stdout.match(/<pre id="browser-result">([^<]+)<\/pre>/);
        assert.ok(match, `浏览器未输出 Svelte 组件 API 结果：${rendered.stdout.slice(0, 2_000)}`);
        assert.deepEqual(JSON.parse(match[1].replace(/&quot;/g, '"')), { text: "ready", childCount: 0 });
    } finally {
        removeBrowserFixture(fixtureRoot);
    }
});
