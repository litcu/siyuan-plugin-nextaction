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
    const port = address.port;
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    return port;
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
        if (!message.id) return;
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
        close() {
            socket.close();
        },
    };
}

test("任务卡片提供单一主语义与独立键盘操作", async () => {
    // Regression: nested card and tooltip buttons duplicated task semantics, while Project removed all card actions from Tab order.
    const fixtureRoot = mkdtempSync(join(tmpdir(), "nextaction-task-card-a11y-"));
    try {
        const taskCardPath = resolve("src/frontend/components/TaskCard.svelte").replace(/\\/g, "/");
        const projectHierarchyPath = resolve("src/frontend/components/project/ProjectHierarchyMode.svelte").replace(
            /\\/g,
            "/",
        );
        writeFileSync(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}');
        writeFileSync(
            join(fixtureRoot, "index.html"),
            '<!doctype html><html><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>',
        );
        writeFileSync(
            join(fixtureRoot, "siyuan.js"),
            "export class Menu {}\nexport async function openTab() {}\nexport function showMessage() {}\n",
        );
        writeFileSync(
            join(fixtureRoot, "Harness.svelte"),
            `<script>
import TaskCard from ${JSON.stringify(taskCardPath)};
import ProjectHierarchyMode from ${JSON.stringify(projectHierarchyPath)};
const baseTask = {
    blockId: "20260829000000-task", identificationSource: "document", attrHostId: "20260829000000-task",
    contentBlockId: "20260829000000-content", parentId: "", status: "todo", priority: "medium",
    importance: 4, effort: 4, due: "", start: "", context: "", taskType: "1", order: 0,
    childIds: [], title: "Plan launch", depends: "", depMode: "all", sequential: false, repeat: "",
    repeatState: "", sort: 0, completed: "", note: "", outcome: "", dod: "", actionKind: "action",
    created: "", tags: "", blocked: false, blockedReason: "", reviewInterval: 0, reviewDate: "",
    reminder: "", customFields: {},
};
const project = { ...baseTask, blockId: "20260829000001-project", contentBlockId: "", taskType: "2", title: "Launch project", childIds: [baseTask.blockId] };
const projectTask = { ...baseTask, parentId: project.blockId, title: "Child action" };
const model = {
    rows: [{ task: projectTask, depth: 0, hasChildren: true, childCount: 1, positionInSet: 1, setSize: 1, isCollapsed: false }],
    includedTasks: [projectTask], includedIds: new Set([projectTask.blockId]),
    taskById: new Map([[project.blockId, project], [projectTask.blockId, projectTask]]),
    childrenByParent: new Map([[project.blockId, [projectTask]]]),
    parentByChild: new Map([[projectTask.blockId, project.blockId]]),
};
const i18n = new Proxy({
    status: "Status", statusTodo: "Todo", priorityMedium: "Medium", importance: "Importance", effort: "Effort",
    collapseChildren: "Collapse", expandChildren: "Expand", jumpToBlock: "Jump to Block", manualSort: "Reorder",
    moveUp: "Move up", moveDown: "Move down", renameStage: "Rename", parentItem: "Parent", project: "Project",
    untitled: "Untitled",
}, { get: (target, key) => target[key] || String(key) });
let edits = 0;
let selections = 0;
let projectEdits = 0;
</script>
<div id="normal" data-edits={edits} style="height:40px;overflow:auto">
    <TaskCard task={baseTask} {i18n} hasChildren onEdit={() => (edits += 1)} onStatusClick={() => {}}
        onContextMenu={() => {}} onToggleCollapse={() => {}} />
    <div style="height:240px"></div>
</div>
<div id="project" data-selections={selections} data-edits={projectEdits}>
    <ProjectHierarchyMode {project} {model} {i18n} onSelectTask={() => (selections += 1)} onEdit={() => (projectEdits += 1)}
        onStatusClick={() => {}} onContextMenu={() => {}} onToggleCollapse={() => {}} />
</div>`,
        );
        writeFileSync(
            join(fixtureRoot, "main.js"),
            `import Harness from "./Harness.svelte";
new Harness({ target: document.querySelector("#app") });`,
        );

        await build({
            root: fixtureRoot,
            base: "./",
            configFile: false,
            logLevel: "silent",
            resolve: {
                alias: [
                    { find: "siyuan", replacement: join(fixtureRoot, "siyuan.js") },
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
        let result: unknown;
        try {
            let pageSocketUrl = "";
            for (let attempt = 0; attempt < 50 && !pageSocketUrl; attempt += 1) {
                assert.equal(browserProcess.exitCode, null, "任务卡片浏览器在连接前退出");
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
            assert.ok(pageSocketUrl, "未取得任务卡片测试页的 CDP 连接");
            const cdp = await connectCdp(pageSocketUrl);
            try {
                const evaluate = async (expression: string): Promise<unknown> => {
                    const response = (await cdp.call("Runtime.evaluate", {
                        expression,
                        returnByValue: true,
                        awaitPromise: true,
                    })) as { result?: { value?: unknown } };
                    return response.result?.value;
                };
                for (let attempt = 0; attempt < 50; attempt += 1) {
                    if (await evaluate('Boolean(document.querySelector("#normal .na-task-card__body"))')) break;
                    await delay(100);
                }
                assert.equal(await evaluate('Boolean(document.querySelector("#normal .na-task-card__body"))'), true);

                const press = async (key: string, code: string, windowsVirtualKeyCode: number) => {
                    await cdp.call("Input.dispatchKeyEvent", {
                        type: "keyDown",
                        key,
                        code,
                        windowsVirtualKeyCode,
                        ...(key === " "
                            ? { text: " ", unmodifiedText: " " }
                            : key === "Enter"
                              ? { text: "\r", unmodifiedText: "\r" }
                              : {}),
                    });
                    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
                    await delay(20);
                };
                await evaluate('document.querySelector("#normal .na-task-card__body").focus()');
                await press("Enter", "Enter", 13);
                const scrollBeforeSpace = await evaluate(
                    'document.querySelector("#normal").scrollTop = 40; document.querySelector("#normal .na-task-card__body").focus(); document.querySelector("#normal").scrollTop',
                );
                await press(" ", "Space", 32);
                const scrollAfterSpace = await evaluate('document.querySelector("#normal").scrollTop');
                await evaluate('document.querySelector("#project [role=treeitem]").focus()');
                await press("Enter", "Enter", 13);
                await press(" ", "Space", 32);

                result = await evaluate(`(() => {
                    const normal = document.querySelector("#normal .na-task-card");
                    const primary = normal.querySelector(".na-task-card__body");
                    const normalButtons = [...normal.querySelectorAll("button")].filter((button) => button.tabIndex >= 0);
                    const tooltipWrappers = [...normal.querySelectorAll(".na-tooltip")];
                    const projectRoot = document.querySelector("#project");
                    const treeItem = projectRoot.querySelector('[role="treeitem"]');
                    const managedCard = treeItem.querySelector(".na-task-card");
                    const managedPrimary = managedCard.querySelector(".na-task-card__body");
                    return {
                        outerRole: normal.getAttribute("role"), outerTabIndex: normal.getAttribute("tabindex"),
                        primaryTag: primary.tagName, primaryRole: primary.getAttribute("role"), primaryLabel: primary.getAttribute("aria-label"),
                        normalTabLabels: normalButtons.map((button) => button.getAttribute("aria-label") || button.textContent.trim()),
                        tooltipRoles: tooltipWrappers.map((wrapper) => wrapper.getAttribute("role")),
                        tooltipTabIndexes: tooltipWrappers.map((wrapper) => wrapper.getAttribute("tabindex")),
                        edits: Number(document.querySelector("#normal").dataset.edits),
                        scrollBeforeSpace: ${JSON.stringify(scrollBeforeSpace)}, scrollAfterSpace: ${JSON.stringify(scrollAfterSpace)},
                        treeLabel: treeItem.getAttribute("aria-label"), selections: Number(projectRoot.dataset.selections),
                        projectEdits: Number(projectRoot.dataset.edits), managedPrimaryTag: managedPrimary.tagName,
                        managedPrimaryHidden: managedPrimary.getAttribute("aria-hidden"), managedPrimaryTabIndex: managedPrimary.tabIndex,
                        independentLabels: [...managedCard.querySelectorAll("button")].filter((button) => button.tabIndex >= 0)
                            .map((button) => button.getAttribute("aria-label") || button.textContent.trim()),
                    };
                })()`);
            } finally {
                cdp.close();
            }
        } finally {
            browserProcess.kill();
            if (browserProcess.exitCode === null) await Promise.race([once(browserProcess, "exit"), delay(2_000)]);
        }
        assert.deepEqual(result, {
            outerRole: "group",
            outerTabIndex: null,
            primaryTag: "BUTTON",
            primaryRole: null,
            primaryLabel: "Plan launch",
            normalTabLabels: [
                "Status: Plan launch — Todo",
                "Plan launch",
                "Collapse: Plan launch",
                "Jump to Block: Plan launch",
            ],
            tooltipRoles: [
                "presentation",
                "presentation",
                "presentation",
                "presentation",
                "presentation",
                "presentation",
            ],
            tooltipTabIndexes: [null, null, null, null, null, null],
            edits: 2,
            scrollBeforeSpace: 40,
            scrollAfterSpace: 40,
            treeLabel: "Child action",
            selections: 0,
            projectEdits: 2,
            managedPrimaryTag: "DIV",
            managedPrimaryHidden: null,
            managedPrimaryTabIndex: -1,
            independentLabels: ["Status: Child action — Todo", "Collapse: Child action", "Jump to Block: Child action"],
        });
    } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
    }
});
