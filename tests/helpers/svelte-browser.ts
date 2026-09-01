import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build, type Alias } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import svelteConfig from "../../svelte.config.js";
import { frontendInlineDynamicImports, frontendViteAliases } from "../../vite.shared.ts";
import { findBrowserExecutable, removeBrowserFixture, runBrowser } from "./browser.ts";

const require = createRequire(import.meta.url);
const svelteRoot = resolve(require.resolve("svelte/package.json"), "..");

const svelteBrowserAliases: Alias[] = [
    {
        find: /^svelte\/internal\/flags\/legacy$/,
        replacement: join(svelteRoot, "src/internal/flags/legacy.js"),
    },
    {
        find: /^svelte\/internal\/disclose-version$/,
        replacement: join(svelteRoot, "src/internal/disclose-version.js"),
    },
    { find: /^svelte\/internal\/(.+)$/, replacement: join(svelteRoot, "src/internal/$1") },
    { find: /^svelte\/internal$/, replacement: join(svelteRoot, "src/internal/index.js") },
    { find: /^svelte\/store$/, replacement: join(svelteRoot, "src/store/index-client.js") },
    { find: /^svelte\/transition$/, replacement: join(svelteRoot, "src/transition/index.js") },
    { find: /^svelte\/legacy$/, replacement: join(svelteRoot, "src/legacy/legacy-client.js") },
    { find: /^svelte$/, replacement: join(svelteRoot, "src/index-client.js") },
];

const defaultIndexHtml = `<!doctype html>
<html>
    <body>
        <div id="app"></div>
        <script>
            window.__NA_BROWSER_RESULT__ = (value) => {
                const result = document.createElement("pre");
                result.id = "browser-result";
                result.textContent = "na-json:" + encodeURIComponent(JSON.stringify(value));
                document.body.appendChild(result);
            };
        </script>
        <script type="module" src="./main.js"></script>
    </body>
</html>`;

export type SvelteBrowserTestOptions = {
    fixtureName: string;
    files?: Record<string, string>;
    aliases?: Alias[] | ((fixtureRoot: string) => Alias[]);
    browserArgs?: string[];
    browserExecutable?: string;
    indexHtml?: string;
    prepareFixture?: (fixtureRoot: string) => void;
    timeout?: number;
    virtualTimeBudget?: number;
};

function fixturePrefix(name: string): string {
    const safeName = name.replace(/[^a-zA-Z0-9-]+/g, "-");
    return `nextaction-${safeName}-`;
}

function writeFixtureFiles(fixtureRoot: string, files: Record<string, string>): void {
    const fixtureFiles = {
        "package.json": '{"private":true,"type":"module"}',
        "index.html": defaultIndexHtml,
        ...files,
    };
    for (const [relativePath, contents] of Object.entries(fixtureFiles)) {
        const target = join(fixtureRoot, relativePath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, contents);
    }
}

function browserArgs(fixtureRoot: string, options: SvelteBrowserTestOptions): string[] {
    return [
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--allow-file-access-from-files",
        "--disable-web-security",
        "--no-first-run",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        `--virtual-time-budget=${options.virtualTimeBudget ?? 1_000}`,
        `--user-data-dir=${join(fixtureRoot, "browser-profile")}`,
        ...(options.browserArgs ?? []),
        "--dump-dom",
        pathToFileURL(join(fixtureRoot, "dist", "index.html")).href,
    ];
}

export async function runSvelteBrowserTest<Result = Record<string, unknown>>(
    options: SvelteBrowserTestOptions,
): Promise<Result> {
    const fixtureRoot = mkdtempSync(join(tmpdir(), fixturePrefix(options.fixtureName)));
    try {
        writeFixtureFiles(fixtureRoot, {
            ...(options.indexHtml ? { "index.html": options.indexHtml } : {}),
            ...(options.files ?? {}),
        });
        options.prepareFixture?.(fixtureRoot);
        const aliases = typeof options.aliases === "function" ? options.aliases(fixtureRoot) : options.aliases;
        const fixtureAliases: Alias[] = existsSync(join(fixtureRoot, "siyuan.js"))
            ? [{ find: "siyuan", replacement: join(fixtureRoot, "siyuan.js") }]
            : [];
        await build({
            root: fixtureRoot,
            base: "./",
            configFile: false,
            logLevel: "silent",
            resolve: {
                alias: [
                    ...Object.entries(frontendViteAliases).map(([find, replacement]) => ({ find, replacement })),
                    ...fixtureAliases,
                    ...(aliases ?? []),
                    ...svelteBrowserAliases,
                ],
            },
            plugins: [svelte(svelteConfig as Parameters<typeof svelte>[0])],
            css: {
                preprocessorOptions: {
                    scss: {
                        api: "modern-compiler",
                    },
                },
            },
            build: {
                outDir: "dist",
                rollupOptions: { output: { inlineDynamicImports: frontendInlineDynamicImports } },
            },
        });

        const rendered = await runBrowser(
            options.browserExecutable ?? findBrowserExecutable(),
            browserArgs(fixtureRoot, options),
            { encoding: "utf8", timeout: options.timeout ?? 20_000 },
        );
        assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message || "浏览器执行失败");
        const match = rendered.stdout.match(/<pre id="browser-result">([^<]+)<\/pre>/);
        assert.ok(
            match,
            `浏览器未输出行为结果（status=${rendered.status}, signal=${rendered.signal}）：${rendered.stderr.slice(0, 1_000)}\n${rendered.stdout.slice(0, 2_000)}`,
        );
        const payload = match[1];
        if (payload.startsWith("na-json:")) {
            return JSON.parse(decodeURIComponent(payload.slice("na-json:".length))) as Result;
        }
        return JSON.parse(payload.replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as Result;
    } finally {
        removeBrowserFixture(fixtureRoot);
    }
}
