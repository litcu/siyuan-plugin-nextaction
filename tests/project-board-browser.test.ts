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

test("看板分组和排序切换会立即更新控件、内容与持久化偏好", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "nextaction-project-board-"));
    try {
        const componentPath = resolve("src/frontend/components/project/ProjectBoardMode.svelte").replace(/\\/g, "/");
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
import ProjectBoardMode from ${JSON.stringify(componentPath)};

const projectId = "20260825141735-project";
const task = (overrides = {}) => ({
    blockId: "20260825141736-actionx", identificationSource: "native", contentBlockId: "20260825141736-actionx",
    attrHostId: "20260825141736-actionx", parentId: projectId, status: "doing", priority: "medium",
    importance: 4, effort: 4, due: "", start: "", context: "", taskType: "1", order: 0, childIds: [],
    title: "Board task", depends: "", depMode: "all", sequential: false, repeat: "", repeatState: "",
    sort: 0, completed: "", note: "", outcome: "", dod: "", actionKind: "action", created: "",
    tags: "", blocked: false, blockedReason: "", reviewInterval: 0, reviewDate: "", reminder: "",
    customFields: {}, ...overrides,
});
const project = task({
    blockId: projectId, identificationSource: "document", contentBlockId: projectId, attrHostId: projectId,
    parentId: "", taskType: "2", title: "Board project", actionKind: "", childIds: ["20260825141736-actionx"],
});
let preference = { groupBy: "status", sortBy: "order", sortAsc: false, narrowColumnIndex: 0 };
let changes = [];
const i18n = new Proxy({
    projectBoardGroupBy: "Group by", sortBy: "Sort by", status: "Status", priority: "Priority",
    importance: "Importance", priorityCritical: "critical", priorityHigh: "high", priorityMedium: "medium",
    priorityLow: "low", priorityVeryLow: "very low", priorityNone: "none", projectBoardStage: "Stage",
    sortByOrder: "Manual order", sortByDue: "Due date",
    sortByImportance: "Importance", sortByPriority: "Priority", projectBoardSortDirection: "Sort direction",
    sortDesc: "Descending", sortAsc: "Ascending", projectBoardUnassignedStage: "Unassigned stage",
    projectDropHere: "Drop tasks here", loading: "Loading", untitled: "Untitled", cancel: "Cancel",
}, { get: (target, key) => target[key] || String(key) });
const noop = () => {};
function updatePreference(next) {
    changes = [...changes, next];
    preference = next;
}
</script>

<div id="state" data-group={preference.groupBy} data-sort={preference.sortBy} data-changes={JSON.stringify(changes)}></div>
<ProjectBoardMode
    tasks={[task()]}
    projectTasks={[project, task()]}
    {i18n}
    {preference}
    onPreferenceChange={updatePreference}
    onEdit={noop}
    onStatusClick={noop}
    onContextMenu={noop}
    onMoveTask={async () => {}}
/>
`,
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
    try {
        const group = document.querySelector("#na-project-board-group-by");
        const sort = document.querySelector("#na-project-board-sort");
        group.value = "priority";
        group.dispatchEvent(new Event("change", { bubbles: true }));
        sort.value = "due";
        sort.dispatchEvent(new Event("change", { bubbles: true }));
        setTimeout(() => {
            const state = document.querySelector("#state");
            finish({
                groupValue: group.value,
                sortValue: sort.value,
                parentGroup: state?.dataset.group,
                parentSort: state?.dataset.sort,
                changes: JSON.parse(state?.dataset.changes || "[]"),
                priorityColumnVisible: [...document.querySelectorAll(".na-project-board__column header")]
                    .some((node) => node.textContent.includes("critical")),
            });
        }, 50);
    } catch (error) {
        finish({ error: String(error?.message || error) });
    }
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
                svelte({
                    configFile: false,
                    preprocess: vitePreprocess(),
                    compilerOptions: { compatibility: { componentApi: 4 } },
                }),
            ],
            build: { outDir: "dist", rollupOptions: { output: { inlineDynamicImports: true } } },
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
                "--virtual-time-budget=3000",
                `--user-data-dir=${join(fixtureRoot, "browser-profile")}`,
                "--dump-dom",
                pathToFileURL(join(fixtureRoot, "dist", "index.html")).href,
            ],
            { encoding: "utf8", timeout: 20_000 },
        );
        assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message || "浏览器测试启动失败");
        const match = rendered.stdout.match(/<pre id="browser-result">([^<]+)<\/pre>/);
        assert.ok(match, `浏览器未输出看板结果：${rendered.stdout.slice(0, 2_000)}`);
        // Regression: Svelte 5 下 bind:value 可能在 change 处理器之后更新，持久化曾经保存旧偏好。
        assert.deepEqual(JSON.parse(match[1].replace(/&quot;/g, '"')), {
            groupValue: "priority",
            sortValue: "due",
            parentGroup: "priority",
            parentSort: "due",
            changes: [
                { groupBy: "priority", sortBy: "order", sortAsc: false, narrowColumnIndex: 0 },
                { groupBy: "priority", sortBy: "due", sortAsc: false, narrowColumnIndex: 0 },
            ],
            priorityColumnVisible: true,
        });
    } finally {
        removeBrowserFixture(fixtureRoot);
    }
});
