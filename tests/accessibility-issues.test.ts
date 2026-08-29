import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { build } from "vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { findBrowserExecutable } from "./helpers/browser.ts";

const require = createRequire(import.meta.url);
const svelteRoot = resolve(require.resolve("svelte/package.json"), "..");
const delay = (milliseconds: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function reservePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    return address.port;
}

async function connectCdp(url: string) {
    const socket = new WebSocket(url);
    await new Promise<void>((resolveOpen, rejectOpen) => {
        socket.addEventListener("open", () => resolveOpen(), { once: true });
        socket.addEventListener("error", () => rejectOpen(new Error("CDP WebSocket 连接失败")), { once: true });
    });
    let id = 0;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (cause: Error) => void }>();
    socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
    });
    return {
        call(method: string, params: Record<string, unknown> = {}) {
            const requestId = ++id;
            return new Promise<unknown>((resolveCall, rejectCall) => {
                pending.set(requestId, { resolve: resolveCall, reject: rejectCall });
                socket.send(JSON.stringify({ id: requestId, method, params }));
            });
        },
        close: () => socket.close(),
    };
}

// Regression: 任务抽屉曾允许焦点穿透，列表错误曾伪装成空状态，筛选弹层也无法用 Escape 安全返回。
test("#39 和 #40 的模态、状态与筛选控件支持完整键盘和辅助技术语义", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "nextaction-accessibility-"));
    try {
        const component = (path: string) => JSON.stringify(resolve(path).replace(/\\/g, "/"));
        writeFileSync(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}');
        writeFileSync(
            join(fixtureRoot, "index.html"),
            '<!doctype html><html><head><style>:root{--b3-theme-primary:#2563eb}</style></head><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>',
        );
        writeFileSync(
            join(fixtureRoot, "Harness.svelte"),
            `<script>
import NaDrawerHost from ${component("src/frontend/ui/NaDrawerHost.svelte")};
import NaViewShell from ${component("src/frontend/ui/NaViewShell.svelte")};
import NaFilterDropdown from ${component("src/frontend/ui/NaFilterDropdown.svelte")};
import NaSortSelect from ${component("src/frontend/ui/NaSortSelect.svelte")};
let drawerOpen = false;
let closeCount = 0;
let mode = "loading";
let retryCount = 0;
let emptyActionCount = 0;
let selected = ["work"];
let sort = "order";
const i18n = { selectAll: "Select all", clearFilter: "Clear", sortBy: "Sort by" };
</script>
<div id="background">
    <button id="opener" on:click={() => (drawerOpen = true)}>Open task</button>
    <button id="outside">Outside</button>
</div>
<NaDrawerHost open={drawerOpen} label="Close task" titleId="task-title"
    on:requestClose={() => { closeCount += 1; drawerOpen = false; }}>
    <h2 id="task-title">Plan launch</h2>
    <button id="drawer-first">First</button>
    <button id="drawer-last">Last</button>
</NaDrawerHost>
<section id="states" data-retries={retryCount} data-empty-actions={emptyActionCount}>
    <button id="show-error" on:click={() => (mode = "error")}>Error</button>
    <button id="show-empty" on:click={() => (mode = "empty")}>Empty</button>
    <NaViewShell loading={mode === "loading"} error={mode === "error" ? "Load failed" : ""}
        empty={mode === "empty"} loadingText="Loading tasks" emptyText="No tasks"
        retryAction={{ label: "Retry now", onClick: () => (retryCount += 1) }}
        emptyAction={{ label: "Create task", onClick: () => (emptyActionCount += 1) }}>
        <div>Task list</div>
    </NaViewShell>
</section>
<div id="filter"><NaFilterDropdown label="Context" options={[{ value: "work", label: "Work" }]}
    {selected} {i18n} onChange={(value) => (selected = value)} /></div>
<div id="sort"><NaSortSelect options={[{ value: "order", label: "Order" }, { value: "due", label: "Due" }]}
    selected={sort} ascending={false} {i18n} onChange={(value) => (sort = value)} /></div>
<output id="close-count">{closeCount}</output>`,
        );
        writeFileSync(
            join(fixtureRoot, "main.js"),
            'import Harness from "./Harness.svelte"; new Harness({ target: document.querySelector("#app") });',
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
                    { find: /^svelte\/internal$/, replacement: join(svelteRoot, "src/runtime/internal/index.js") },
                    { find: /^svelte\/store$/, replacement: join(svelteRoot, "src/runtime/store/index.js") },
                    { find: /^svelte$/, replacement: join(svelteRoot, "src/runtime/index.js") },
                ],
            },
            plugins: [svelte({ preprocess: vitePreprocess() })],
            build: { outDir: "dist" },
        });

        const debuggingPort = await reservePort();
        const browserProcess = spawn(findBrowserExecutable(), [
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
            "--remote-allow-origins=*",
            `--remote-debugging-port=${debuggingPort}`,
            `--user-data-dir=${join(fixtureRoot, "browser-profile")}`,
            pathToFileURL(join(fixtureRoot, "dist", "index.html")).href,
        ]);
        try {
            let pageSocketUrl = "";
            for (let attempt = 0; attempt < 50 && !pageSocketUrl; attempt += 1) {
                try {
                    const targets = (await fetch(`http://127.0.0.1:${debuggingPort}/json/list`).then((response) =>
                        response.json(),
                    )) as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>;
                    pageSocketUrl =
                        targets.find((target) => target.type === "page" && target.url?.includes("/dist/index.html"))
                            ?.webSocketDebuggerUrl || "";
                } catch {
                    // Chromium may not have opened its debugging endpoint yet.
                }
                if (!pageSocketUrl) await delay(100);
            }
            assert.ok(pageSocketUrl, "未取得无障碍测试页的 CDP 连接");
            const cdp = await connectCdp(pageSocketUrl);
            try {
                const evaluate = async (expression: string): Promise<any> => {
                    const response = (await cdp.call("Runtime.evaluate", {
                        expression,
                        returnByValue: true,
                        awaitPromise: true,
                    })) as {
                        result?: { value?: unknown };
                        exceptionDetails?: { text?: string; exception?: { description?: string } };
                    };
                    if (response.exceptionDetails) {
                        throw new Error(
                            response.exceptionDetails.exception?.description ||
                                response.exceptionDetails.text ||
                                "浏览器表达式执行失败",
                        );
                    }
                    return response.result?.value;
                };
                const press = async (key: string, code: string, windowsVirtualKeyCode: number, modifiers = 0) => {
                    await cdp.call("Input.dispatchKeyEvent", {
                        type: "keyDown",
                        key,
                        code,
                        windowsVirtualKeyCode,
                        modifiers,
                        ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
                    });
                    await cdp.call("Input.dispatchKeyEvent", {
                        type: "keyUp",
                        key,
                        code,
                        windowsVirtualKeyCode,
                        modifiers,
                    });
                    await delay(30);
                };

                for (let attempt = 0; attempt < 50; attempt += 1) {
                    if (await evaluate('Boolean(document.querySelector("#opener"))')) break;
                    await delay(50);
                }
                assert.equal(await evaluate('Boolean(document.querySelector("#opener"))'), true, "测试组件未挂载");
                await evaluate('document.querySelector("#opener").focus()');
                assert.equal(await evaluate("document.activeElement.id"), "opener");
                await evaluate('document.querySelector("#opener").click()');
                await delay(250);
                assert.deepEqual(
                    await evaluate(`(() => {
                        const dialog = document.querySelector('[role="dialog"]');
                        return { modal: dialog.getAttribute("aria-modal"), title: document.getElementById(dialog.getAttribute("aria-labelledby")).textContent,
                            active: document.activeElement.id, backgroundInert: document.querySelector("#background").inert };
                    })()`),
                    { modal: "true", title: "Plan launch", active: "drawer-first", backgroundInert: true },
                );
                await evaluate('document.querySelector("#drawer-last").focus()');
                await press("Tab", "Tab", 9);
                assert.equal(await evaluate("document.activeElement.id"), "drawer-first");
                await press("Tab", "Tab", 9, 8);
                assert.equal(await evaluate("document.activeElement.id"), "drawer-last");
                assert.equal(
                    await evaluate(`(() => {
                        window.siyuan = { dialogs: [{}] };
                        return window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
                    })()`),
                    true,
                );
                await evaluate("window.siyuan.dialogs = []");
                await press("Escape", "Escape", 27);
                await delay(250);
                assert.deepEqual(
                    await evaluate(`({ active: document.activeElement.id, inert: document.querySelector("#background").inert,
                        closes: Number(document.querySelector("#close-count").textContent) })`),
                    { active: "opener", inert: false, closes: 1 },
                );

                assert.deepEqual(
                    await evaluate(`(() => { const state = document.querySelector('[role="status"]');
                        return { busy: state.getAttribute("aria-busy"), text: state.textContent.trim() }; })()`),
                    { busy: "true", text: "Loading tasks" },
                );
                await evaluate('document.querySelector("#show-error").click()');
                assert.equal(
                    await evaluate('document.querySelector("[role=alert]").textContent.includes("Load failed")'),
                    true,
                );
                await evaluate(
                    '[...document.querySelectorAll("button")].find((button) => button.textContent.includes("Retry now")).click()',
                );
                assert.equal(await evaluate('document.querySelector("#states").dataset.retries'), "1");
                await evaluate('document.querySelector("#show-empty").click()');
                await evaluate(
                    '[...document.querySelectorAll("button")].find((button) => button.textContent.includes("Create task")).click()',
                );
                assert.equal(await evaluate('document.querySelector("#states").dataset.emptyActions'), "1");

                await evaluate('document.querySelector("#filter .na-filter-dropdown__trigger").click()');
                assert.equal(
                    await evaluate(
                        'document.querySelector("#filter .na-filter-dropdown__trigger").getAttribute("aria-expanded")',
                    ),
                    "true",
                );
                await delay(100);
                assert.equal(
                    await evaluate(
                        'document.querySelector("#filter .na-filter-dropdown__panel").contains(document.activeElement)',
                    ),
                    true,
                );
                await evaluate('document.querySelector("#filter input").focus()');
                assert.equal(
                    await evaluate(
                        'getComputedStyle(document.querySelector("#filter .na-filter-dropdown__checkbox")).outlineStyle',
                    ),
                    "solid",
                );
                await press("Escape", "Escape", 27);
                const filterState =
                    await evaluate(`({ expanded: document.querySelector("#filter button").getAttribute("aria-expanded"),
                        active: document.activeElement.className })`);
                assert.equal(filterState.expanded, "false");
                assert.match(filterState.active, /^na-filter-dropdown__trigger(?: |$)/);

                await evaluate('document.querySelector("#sort .na-sort-select__trigger").click()');
                assert.equal(
                    await evaluate(
                        'document.querySelector("#sort .na-sort-select__trigger").getAttribute("aria-expanded")',
                    ),
                    "true",
                );
                await press("Escape", "Escape", 27);
                assert.match(await evaluate("document.activeElement.className"), /^na-sort-select__trigger(?: |$)/);
                await evaluate('document.querySelector("#sort .na-sort-select__trigger").click()');
                await press("Enter", "Enter", 13);
                assert.deepEqual(
                    await evaluate(`({ expanded: document.querySelector("#sort .na-sort-select__trigger").getAttribute("aria-expanded"),
                        focused: document.activeElement.classList.contains("na-sort-select__trigger") })`),
                    { expanded: "false", focused: true },
                );
            } finally {
                cdp.close();
            }
        } finally {
            browserProcess.kill();
            if (browserProcess.exitCode === null) await Promise.race([once(browserProcess, "exit"), delay(2_000)]);
        }
    } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
    }
});
