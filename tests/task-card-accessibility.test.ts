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

test("任务卡片提供清晰语义、可读层级与可感知状态", async () => {
    // Regression: nested card and tooltip buttons duplicated task semantics, while Project removed all card actions from Tab order.
    // Regression: low-opacity task states and low-contrast text or status outlines obscured task information.
    const fixtureRoot = mkdtempSync(join(tmpdir(), "nextaction-task-card-a11y-"));
    try {
        const taskCardPath = resolve("src/frontend/components/TaskCard.svelte").replace(/\\/g, "/");
        const taskStorePath = resolve("src/frontend/stores/task-store.ts").replace(/\\/g, "/");
        const tokensPath = resolve("src/frontend/ui/tokens.scss").replace(/\\/g, "/");
        const componentsStylePath = resolve("src/frontend/styles/components.scss").replace(/\\/g, "/");
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
import { taskStore } from ${JSON.stringify(taskStorePath)};
import ${JSON.stringify(tokensPath)};
import ${JSON.stringify(componentsStylePath)};
const baseTask = {
    blockId: "20260829000000-task", identificationSource: "document", attrHostId: "20260829000000-task",
    contentBlockId: "20260829000000-content", parentId: "", status: "todo", priority: "medium",
    importance: 4, effort: 4, due: "", start: "", context: "", taskType: "1", order: 0,
    childIds: [], title: "Plan launch", depends: "", depMode: "all", sequential: false, repeat: "",
    repeatState: "", sort: 0, completed: "", note: "", outcome: "", dod: "", actionKind: "action",
    created: "", tags: "", blocked: false, blockedReason: "", reviewInterval: 0, reviewDate: "",
    reminder: "", customFields: {},
};
const parentTask = { ...baseTask, blockId: "20260829000002-parent", title: "Launch program" };
const readableTask = {
    ...baseTask,
    blockId: "20260829000003-readable",
    parentId: parentTask.blockId,
    context: "office",
    tags: "focus",
};
taskStore.applyUpdate(parentTask);
const statusTasks = ["inbox", "todo", "doing", "waiting", "someday", "done"].map((status, index) => ({
    ...readableTask,
    blockId: "2026082900001" + index + "-status",
    parentId: "",
    title: "Status " + status,
    status,
}));
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
    status: "Status", statusInbox: "Inbox", statusTodo: "Todo", statusDoing: "In Progress", statusWaiting: "Waiting",
    statusSomeday: "Someday/Maybe", statusDone: "Done", priorityMedium: "Medium", importance: "Importance", effort: "Effort",
    changeTaskStatus: "Change status for {task}. Current status: {status}",
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
</div>
<div id="readability-light" class="nextaction" style="--b3-theme-surface:#ffffff;--b3-theme-surface-light:#f3f4f6;--b3-theme-surface-lighter:#e5e7eb;--b3-theme-background:#f9fafb;--b3-theme-on-background:#111827;--b3-theme-on-surface:#374151;--b3-theme-on-surface-light:#a0a7b2;--b3-theme-on-primary:#ffffff;--b3-theme-primary:#1d4ed8;--b3-theme-primary-light:#93c5fd;--b3-theme-primary-lightest:#eff6ff;--b3-border-color:#9ca3af;--b3-card-info-color:#1d4ed8;--b3-card-warning-color:#92400e;--b3-card-success-color:#166534;--b3-card-error-color:#b91c1c">
    <TaskCard task={readableTask} {i18n} onEdit={() => {}} onStatusClick={() => {}} onContextMenu={() => {}} />
    {#each statusTasks as statusTask}
        <TaskCard task={statusTask} {i18n} onEdit={() => {}} onStatusClick={() => {}} onContextMenu={() => {}} />
    {/each}
</div>
<div id="readability-dark" class="nextaction" style="--b3-theme-surface:#1f2937;--b3-theme-surface-light:#273548;--b3-theme-surface-lighter:#374151;--b3-theme-background:#111827;--b3-theme-on-background:#f9fafb;--b3-theme-on-surface:#e5e7eb;--b3-theme-on-surface-light:#626b78;--b3-theme-on-primary:#111827;--b3-theme-primary:#93c5fd;--b3-theme-primary-light:#3b82f6;--b3-theme-primary-lightest:#172554;--b3-border-color:#9ca3af;--b3-card-info-color:#93c5fd;--b3-card-warning-color:#fcd34d;--b3-card-success-color:#86efac;--b3-card-error-color:#fca5a5">
    <TaskCard task={readableTask} {i18n} onEdit={() => {}} onStatusClick={() => {}} onContextMenu={() => {}} />
    {#each statusTasks as statusTask}
        <TaskCard task={statusTask} {i18n} onEdit={() => {}} onStatusClick={() => {}} onContextMenu={() => {}} />
    {/each}
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
        let readabilityResult: unknown;
        let highContrastResult: unknown;
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

                readabilityResult = await evaluate(`(() => {
                    const parseRgb = (value) => (value.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
                    const luminance = (value) => {
                        const [red, green, blue] = parseRgb(value).map((channel) => {
                            const normalized = channel / 255;
                            return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
                        });
                        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
                    };
                    const contrast = (foreground, background) => {
                        const first = luminance(foreground);
                        const second = luminance(background);
                        return Number(((Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)).toFixed(2));
                    };
                    const summarizeTheme = (selector) => {
                        const root = document.querySelector(selector);
                        const card = root.querySelector(".na-task-card");
                        const title = card.querySelector(".na-task-card__title");
                        const parent = card.querySelector(".na-task-card__parent-context");
                        const metadata = card.querySelector(".na-task-card__context");
                        const cardStyle = getComputedStyle(card);
                        const titleStyle = getComputedStyle(title);
                        const parentStyle = getComputedStyle(parent);
                        const metadataStyle = getComputedStyle(metadata);
                        return {
                            titleSize: parseFloat(titleStyle.fontSize),
                            parentSize: parseFloat(parentStyle.fontSize),
                            metadataSize: parseFloat(metadataStyle.fontSize),
                            titleWeight: Number(titleStyle.fontWeight),
                            parentWeight: Number(parentStyle.fontWeight),
                            titleContrast: contrast(titleStyle.color, cardStyle.backgroundColor),
                            parentContrast: contrast(parentStyle.color, cardStyle.backgroundColor),
                            metadataContrast: contrast(metadataStyle.color, cardStyle.backgroundColor),
                        };
                    };
                    const statusCards = [...document.querySelectorAll("#readability-light .na-task-card")].slice(1);
                    const statusShapes = statusCards.map((card) => {
                        const button = card.querySelector(".na-status-checkbox");
                        const style = getComputedStyle(button);
                        const after = getComputedStyle(button, "::after");
                        return [style.borderStyle, style.backgroundImage, after.content, after.borderTopStyle].join("|");
                    });
                    const statusLabels = statusCards.map((card) =>
                        card.querySelector(".na-status-checkbox").getAttribute("aria-label"),
                    );
                    const statusContrasts = (selector) =>
                        [...document.querySelectorAll(selector)].slice(1).map((card) => {
                            const cardStyle = getComputedStyle(card);
                            const statusStyle = getComputedStyle(card.querySelector(".na-status-checkbox"));
                            return contrast(statusStyle.borderTopColor, cardStyle.backgroundColor);
                        });
                    const waitingTitle = statusCards[3].querySelector(".na-task-card__title");
                    const doneCard = statusCards[5];
                    return {
                        light: summarizeTheme("#readability-light"),
                        dark: summarizeTheme("#readability-dark"),
                        waitingTitleOpacity: Number(getComputedStyle(waitingTitle).opacity),
                        doneCardOpacity: Number(getComputedStyle(doneCard).opacity),
                        statusShapes,
                        statusLabels,
                        lightStatusContrasts: statusContrasts("#readability-light .na-task-card"),
                        darkStatusContrasts: statusContrasts("#readability-dark .na-task-card"),
                    };
                })()`);
                await cdp.call("Emulation.setEmulatedMedia", {
                    features: [{ name: "prefers-contrast", value: "more" }],
                });
                highContrastResult = await evaluate(`(() => {
                    const card = document.querySelector("#readability-light .na-task-card");
                    const parent = card.querySelector(".na-task-card__parent-context");
                    return {
                        cardBorderWidth: parseFloat(getComputedStyle(card).borderTopWidth),
                        parentColor: getComputedStyle(parent).color,
                        titleColor: getComputedStyle(card.querySelector(".na-task-card__title")).color,
                    };
                })()`);

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
                        statusPopup: normal.querySelector(".na-status-checkbox").getAttribute("aria-haspopup"),
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
            statusPopup: "menu",
            normalTabLabels: [
                "Change status for Plan launch. Current status: Todo",
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
            independentLabels: [
                "Change status for Child action. Current status: Todo",
                "Collapse: Child action",
                "Jump to Block: Child action",
            ],
        });
        const readability = readabilityResult as {
            light: Record<string, number>;
            dark: Record<string, number>;
            waitingTitleOpacity: number;
            doneCardOpacity: number;
            statusShapes: string[];
            statusLabels: string[];
            lightStatusContrasts: number[];
            darkStatusContrasts: number[];
        };
        for (const theme of [readability.light, readability.dark]) {
            assert.ok(theme.titleSize >= 14, "任务标题字号不应低于 14px");
            assert.ok(theme.parentSize >= 12, "父级上下文字号不应低于 12px");
            assert.ok(theme.metadataSize >= 12, "任务元数据字号不应低于 12px");
            assert.ok(theme.titleSize > theme.parentSize, "任务标题应通过字号高于父级上下文");
            assert.ok(theme.titleWeight > theme.parentWeight, "任务标题应通过字重高于父级上下文");
            assert.ok(theme.titleContrast >= 4.5, "任务标题对比度应达到 4.5:1");
            assert.ok(theme.parentContrast >= 4.5, "父级上下文对比度应达到 4.5:1");
            assert.ok(theme.metadataContrast >= 4.5, "任务元数据对比度应达到 4.5:1");
        }
        assert.equal(readability.waitingTitleOpacity, 1, "等待中任务标题不应通过低透明度弱化");
        assert.equal(readability.doneCardOpacity, 1, "已完成任务卡片不应整体降低透明度");
        assert.equal(new Set(readability.statusShapes).size, 6, "六种状态应使用可区分的形状或图标");
        for (const ratio of [...readability.lightStatusContrasts, ...readability.darkStatusContrasts]) {
            assert.ok(ratio >= 3, "状态控件轮廓对比度应达到 3:1");
        }
        assert.deepEqual(readability.statusLabels, [
            "Change status for Status inbox. Current status: Inbox",
            "Change status for Status todo. Current status: Todo",
            "Change status for Status doing. Current status: In Progress",
            "Change status for Status waiting. Current status: Waiting",
            "Change status for Status someday. Current status: Someday/Maybe",
            "Change status for Status done. Current status: Done",
        ]);
        const highContrast = highContrastResult as { cardBorderWidth: number; parentColor: string; titleColor: string };
        assert.ok(highContrast.cardBorderWidth >= 2, "增加对比度模式应强化任务卡片边界");
        assert.equal(highContrast.parentColor, highContrast.titleColor, "增加对比度模式应使用最清晰的正文颜色");
    } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
    }
});
