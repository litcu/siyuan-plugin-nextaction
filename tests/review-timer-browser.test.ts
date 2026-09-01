import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

// Regression: ReviewView 迁移到 $effect 后必须随任务变化去抖刷新，并在卸载时清除真实定时器。
test("真实 Review 页面去抖刷新并在卸载后停止定时器", async () => {
    const result = await runSvelteBrowserTest<{ afterMount: number; afterUpdate: number; afterUnmount: number }>({
        fixtureName: "review-timer-cleanup",
        virtualTimeBudget: 3_000,
        prepareFixture(fixtureRoot) {
            const reviewPath = resolve("src/frontend/components/ReviewView.svelte").replace(/\\/g, "/");
            const taskStorePath = resolve("src/frontend/stores/task-store.ts").replace(/\\/g, "/");
            writeFileSync(
                join(fixtureRoot, "siyuan.js"),
                "export class Dialog {}\nexport class Menu {}\nexport function confirm() {}\nexport function openTab() {}\nexport function showMessage() {}\n",
            );
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import ReviewView from ${JSON.stringify(reviewPath)};

let calls = 0;
window.__reviewCalls = 0;
const reviewData = {
    lastReviewAt: "", overdueTasks: [], nextActions: [], inboxTasks: [], waitingTasks: [], somedayTasks: [],
    reviewDueTasks: [], projectReviews: [], reviewableProjects: [],
};
const bridge = {
    getReviewData: async () => { calls += 1; window.__reviewCalls = calls; return reviewData; },
    markTaskReviewed: async () => [], completeReview: async () => reviewData,
};
const i18n = new Proxy({}, { get: (_target, key) => String(key) });
const noop = () => {};
</script>

<div id="calls" data-value={calls}></div>
<ReviewView
    {bridge} {i18n} selectedTaskId="" onSelectTask={noop} onEdit={noop} onOpenProject={noop}
    onStatusClick={noop} onContextMenu={noop}
/>
`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import { mount, unmount } from "svelte";
import Harness from "./Harness.svelte";
import { taskStore } from ${JSON.stringify(taskStorePath)};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const task = (blockId) => ({
    blockId, identificationSource: "native", contentBlockId: blockId, attrHostId: blockId,
    parentId: "", status: "todo", priority: "medium", importance: 4, effort: 4, due: "", start: "",
    context: "", taskType: "1", order: 0, childIds: [], title: blockId, depends: "", depMode: "all",
    sequential: false, repeat: "", repeatState: "", sort: 0, completed: "", note: "", outcome: "",
    dod: "", actionKind: "action", created: "", tags: "", blocked: false, blockedReason: "",
    reviewInterval: 0, reviewDate: "", reminder: "", customFields: {},
});

void (async () => {
    const component = mount(Harness, { target: document.querySelector("#app") });
    await wait(450);
    const afterMount = Number(document.querySelector("#calls").dataset.value);
    taskStore.applyUpdate(task("timer-one"));
    await wait(450);
    const afterUpdate = Number(document.querySelector("#calls").dataset.value);
    await unmount(component);
    taskStore.applyUpdate(task("timer-two"));
    await wait(450);
    window.__NA_BROWSER_RESULT__({
        afterMount,
        afterUpdate,
        afterUnmount: window.__reviewCalls,
    });
})().catch((error) => window.__NA_BROWSER_RESULT__({ error: String(error?.stack || error) }));`,
            );
        },
    });

    assert.equal(result.afterMount >= 1, true);
    assert.equal(result.afterUpdate, result.afterMount + 1);
    assert.equal(result.afterUnmount, result.afterUpdate);
});
