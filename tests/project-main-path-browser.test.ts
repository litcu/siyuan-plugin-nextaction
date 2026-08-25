import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { build } from "vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const require = createRequire(import.meta.url);
const svelteRoot = resolve(require.resolve("svelte/package.json"), "..");

function findBrowserExecutable(): string {
    const configured = process.env.NA_LAYOUT_BROWSER;
    const candidates = [
        configured,
        process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined,
        process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined,
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ].filter((candidate): candidate is string => Boolean(candidate));

    const executable = candidates.find((candidate) => existsSync(candidate));
    assert.ok(executable, "未找到浏览器；可通过 NA_LAYOUT_BROWSER 指定 Chrome/Edge 路径");
    return executable;
}

test("Review 打开项目后保留选择和展开状态，并显示 Stage", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "nextaction-project-main-path-"));
    try {
        const queuePath = resolve("src/frontend/components/ProjectReviewQueue.svelte").replace(/\\/g, "/");
        writeFileSync(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}');
        writeFileSync(
            join(fixtureRoot, "index.html"),
            '<!doctype html><html><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>',
        );
        writeFileSync(
            join(fixtureRoot, "siyuan.js"),
            "export class Menu {}\nexport function openTab() {}\nexport function showMessage() {}\n",
        );
        writeFileSync(
            join(fixtureRoot, "Harness.svelte"),
            `<script>
import { tick } from "svelte";
import ProjectReviewQueue from ${JSON.stringify(queuePath)};

const task = {
    blockId: "stage", identificationSource: "document", attrHostId: "stage", parentId: "project",
    status: "todo", priority: "medium", importance: 4, effort: 4, due: "", start: "", context: "",
    taskType: "1", order: 0, childIds: [], title: "Stage task", depends: "", depMode: "all",
    sequential: false, repeat: "", repeatState: "", sort: 0, completed: "", note: "", outcome: "",
    dod: "", actionKind: "stage", created: "", tags: "", blocked: false, blockedReason: "",
    reviewInterval: 0, reviewDate: "", reminder: "", customFields: {},
};
const project = { ...task, blockId: "project", attrHostId: "project", parentId: "", taskType: "2",
    title: "Review project", actionKind: "action", childIds: ["stage"], outcome: "Outcome", dod: "DoD" };
const summary = {
    project, descendants: [task], leafActions: [task], subtreeProgress: {}, empty: false,
    clarificationNeeded: false, completionCandidate: false, incompleteNonLeafActions: [], openCount: 1,
    doneCount: 0, progress: 0, nextActions: [task], overdueTasks: [], blockedTasks: [], waitingTasks: [],
    risks: [], health: "onTrack",
};
const reviewData = {
    lastReviewAt: "", overdueTasks: [], nextActions: [], inboxTasks: [], waitingTasks: [], somedayTasks: [],
    reviewDueTasks: [], projectReviews: [], reviewableProjects: [summary],
};
const i18n = new Proxy({
    reviewOpenProject: "Open project", editProject: "Edit project", markReviewed: "Reviewed",
    reviewProjectManualTitle: "Manual review", reviewProjectManualHint: "Choose a project",
    reviewProjectManualPlaceholder: "Choose", reviewProjectManualEmpty: "Empty", noMatches: "No matches",
    loadingMore: "Loading", clearSelection: "Clear", reviewProjectQueueEmpty: "Empty",
    reviewProjectManualTrigger: "Manual", reviewProjectOnTrack: "On track", statusTodo: "Todo",
    outcome: "Outcome", definitionOfDone: "DoD", projectProgressStats: "Progress",
    reviewProjectPlan: "Plan", projectNextActions: "Next actions", reviewProjectNoNextActions: "None",
    reviewProjectWaitingBlocked: "Risks", reviewProjectNoWaitingBlocked: "None", actionKindStage: "Stage",
    priorityMedium: "Medium", untitled: "Untitled",
}, { get: (target, key) => target[key] || String(key) });
let manualProjectIds = ["project"];
let expandedProjectId = "project";
let openedProjectId = "";
let showingReview = true;
const noop = () => {};

async function openProject(nextProject) {
    openedProjectId = nextProject.blockId;
    showingReview = false;
    await tick();
    showingReview = true;
}
</script>

<div id="harness" data-opened={openedProjectId} data-manual={manualProjectIds.join(",")}>
    {#if showingReview}
        <ProjectReviewQueue
            {reviewData} {i18n} selectedTaskId="" bind:manualProjectIds bind:expandedProjectId
            onSelectTask={noop} onEdit={noop} onOpenProject={openProject} onStatusClick={noop}
            onContextMenu={noop} onMarkReviewed={async () => true}
        />
    {:else}
        <div id="project-target">{openedProjectId}</div>
    {/if}
</div>`,
        );
        writeFileSync(
            join(fixtureRoot, "main.js"),
            `import Harness from "./Harness.svelte";
new Harness({ target: document.querySelector("#app") });
const finish = (value) => {
    const result = document.createElement("pre");
    result.id = "browser-result";
    result.textContent = JSON.stringify(value);
    document.body.appendChild(result);
};
setTimeout(() => {
    const openButton = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Open project");
    const stageBefore = [...document.querySelectorAll(".na-task-card__kind")].some((node) => node.textContent.trim() === "Stage");
    openButton?.click();
    setTimeout(() => {
        const harness = document.querySelector("#harness");
        finish({
            openedProjectId: harness?.dataset.opened,
            manualProjectIds: harness?.dataset.manual,
            expanded: document.querySelector(".na-accordion__trigger")?.getAttribute("aria-expanded"),
            stageBefore,
            stageAfter: [...document.querySelectorAll(".na-task-card__kind")].some((node) => node.textContent.trim() === "Stage"),
        });
    }, 50);
}, 50);`,
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
                    {
                        find: /^svelte\/internal$/,
                        replacement: join(svelteRoot, "src/runtime/internal/index.js"),
                    },
                    { find: /^svelte\/store$/, replacement: join(svelteRoot, "src/runtime/store/index.js") },
                    { find: /^svelte$/, replacement: join(svelteRoot, "src/runtime/index.js") },
                ],
            },
            plugins: [svelte({ preprocess: vitePreprocess() })],
            build: { outDir: "dist" },
        });

        const browser = findBrowserExecutable();
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
                "--virtual-time-budget=1000",
                `--user-data-dir=${join(fixtureRoot, "browser-profile")}`,
                "--dump-dom",
                pathToFileURL(join(fixtureRoot, "dist", "index.html")).href,
            ],
            { encoding: "utf8", timeout: 20_000 },
        );
        assert.equal(
            rendered.status,
            0,
            rendered.stderr ||
                rendered.error?.message ||
                `浏览器主路径测试执行失败（signal: ${rendered.signal || "none"}）`,
        );

        const match = rendered.stdout.match(/<pre id="browser-result">([^<]+)<\/pre>/);
        assert.ok(match, `浏览器未输出主路径结果：${rendered.stdout.slice(0, 2_000)}`);
        const result = JSON.parse(match[1].replace(/&quot;/g, '"'));
        assert.deepEqual(result, {
            openedProjectId: "project",
            manualProjectIds: "project",
            expanded: "true",
            stageBefore: true,
            stageAfter: true,
        });
    } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
    }
});

test("Project Support 隔离加载错误并支持刷新、重试和打开原文", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "nextaction-project-support-"));
    try {
        const supportPath = resolve("src/frontend/components/project/ProjectSupportSection.svelte").replace(/\\/g, "/");
        writeFileSync(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}');
        writeFileSync(
            join(fixtureRoot, "index.html"),
            '<!doctype html><html><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>',
        );
        writeFileSync(join(fixtureRoot, "siyuan.js"), "export class Menu {}\nexport function openTab() {}\n");
        writeFileSync(
            join(fixtureRoot, "Harness.svelte"),
            `<script>
import ProjectSupportSection from ${JSON.stringify(supportPath)};

const projectId = "20260825120000-project";
const supportId = "20260825120001-support";
let attempts = 0;
let opened = "";
const i18n = new Proxy({
    projectSupport: "Project Support", projectSupportDescription: "Referenced project context",
    projectSupportRefresh: "Refresh", projectSupportEmpty: "No support yet",
    projectSupportLoadError: "Support unavailable: {error}", projectSupportRetry: "Retry",
    projectSupportForward: "Referenced by project", projectSupportBacklink: "Links to project",
    projectSupportBoth: "Linked both ways", projectSupportBlock: "Block",
    projectSupportDocument: "Document", projectSupportOpen: "Open source", loading: "Loading",
}, { get: (target, key) => target[key] || String(key) });

const delay = () => new Promise((resolve) => setTimeout(resolve, 20));
async function loadSupport(requestedProjectId) {
    attempts++;
    await delay();
    if (attempts === 1) return { projectId: requestedProjectId, items: [] };
    if (attempts === 2) throw new Error("reference index delayed");
    return {
        projectId: requestedProjectId,
        items: [{
            blockId: supportId, documentId: supportId, title: "Source note", kind: "document",
            blockType: "d", directions: ["forward", "backlink"],
        }],
    };
}
</script>

<div id="harness" data-attempts={attempts} data-opened={opened}>
    <div id="core-project-content">Project outcome remains available</div>
    <ProjectSupportSection {projectId} {i18n} {loadSupport} onOpen={(blockId) => (opened = blockId)} />
</div>`,
        );
        writeFileSync(
            join(fixtureRoot, "main.js"),
            `import Harness from "./Harness.svelte";
new Harness({ target: document.querySelector("#app") });
const findButton = (label) => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
const finish = (value) => {
    const result = document.createElement("pre");
    result.id = "browser-result";
    result.textContent = JSON.stringify(value);
    document.body.appendChild(result);
};
setTimeout(() => {
    const emptyVisible = document.body.textContent.includes("No support yet");
    findButton("Refresh")?.click();
    setTimeout(() => {
        const errorVisible = document.querySelector('[role="alert"]')?.textContent.includes("reference index delayed") || false;
        const coreVisibleDuringError = Boolean(document.querySelector("#core-project-content"));
        findButton("Retry")?.click();
        setTimeout(() => {
            document.querySelector('button[aria-label="Open source"]')?.click();
            setTimeout(() => {
                const harness = document.querySelector("#harness");
                finish({
                    emptyVisible,
                    errorVisible,
                    coreVisibleDuringError,
                    attempts: Number(harness?.dataset.attempts),
                    titleVisible: document.body.textContent.includes("Source note"),
                    directionVisible: document.body.textContent.includes("Linked both ways"),
                    opened: harness?.dataset.opened,
                });
            }, 20);
        }, 60);
    }, 60);
}, 80);`,
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
                    {
                        find: /^svelte\/internal$/,
                        replacement: join(svelteRoot, "src/runtime/internal/index.js"),
                    },
                    { find: /^svelte\/store$/, replacement: join(svelteRoot, "src/runtime/store/index.js") },
                    { find: /^svelte$/, replacement: join(svelteRoot, "src/runtime/index.js") },
                ],
            },
            plugins: [svelte({ preprocess: vitePreprocess() })],
            build: { outDir: "dist" },
        });

        const browser = findBrowserExecutable();
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
                "--virtual-time-budget=1500",
                `--user-data-dir=${join(fixtureRoot, "browser-profile")}`,
                "--dump-dom",
                pathToFileURL(join(fixtureRoot, "dist", "index.html")).href,
            ],
            { encoding: "utf8", timeout: 20_000 },
        );
        assert.equal(
            rendered.status,
            0,
            rendered.stderr ||
                rendered.error?.message ||
                `Project Support 浏览器测试执行失败（signal: ${rendered.signal || "none"}）`,
        );
        const match = rendered.stdout.match(/<pre id="browser-result">([^<]+)<\/pre>/);
        assert.ok(match, `浏览器未输出 Project Support 结果：${rendered.stdout.slice(0, 2_000)}`);
        const result = JSON.parse(match[1].replace(/&quot;/g, '"'));
        assert.deepEqual(result, {
            emptyVisible: true,
            errorVisible: true,
            coreVisibleDuringError: true,
            attempts: 3,
            titleVisible: true,
            directionVisible: true,
            opened: "20260825120001-support",
        });
    } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
    }
});
