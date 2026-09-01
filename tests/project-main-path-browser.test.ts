import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

test("Review 打开项目后保留选择和展开状态，并显示 Stage", async () => {
    const result = await runSvelteBrowserTest({
        fixtureName: "project-main-path",
        prepareFixture(fixtureRoot) {
            const queuePath = resolve("src/frontend/components/ProjectReviewQueue.svelte").replace(/\\/g, "/");
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
        },
    });
    assert.deepEqual(result, {
        openedProjectId: "project",
        manualProjectIds: "project",
        expanded: "true",
        stageBefore: true,
        stageAfter: true,
    });
});

test("Review 打开项目并返回后恢复滚动位置", async () => {
    const result = await runSvelteBrowserTest({
        fixtureName: "review-scroll",
        indexHtml:
            '<!doctype html><html><head><style>html,body,#app{height:120px;margin:0}</style></head><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>',
        prepareFixture(fixtureRoot) {
            const reviewPath = resolve("src/frontend/components/ReviewView.svelte").replace(/\\\\/g, "/");
            writeFileSync(
                join(fixtureRoot, "siyuan.js"),
                "export class Menu {}\nexport class Dialog {}\nexport function openTab() {}\nexport function showMessage() {}\n",
            );
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import { tick } from "svelte";
import ReviewView from ${JSON.stringify(reviewPath)};

const task = {
    blockId: "action", identificationSource: "document", attrHostId: "action", parentId: "project",
    status: "todo", priority: "medium", importance: 4, effort: 4, due: "", start: "", context: "",
    taskType: "1", order: 0, childIds: [], title: "Action", depends: "", depMode: "all",
    sequential: false, repeat: "", repeatState: "", sort: 0, completed: "", note: "", outcome: "",
    dod: "", actionKind: "action", created: "", tags: "", blocked: false, blockedReason: "",
    reviewInterval: 0, reviewDate: "", reminder: "", customFields: {},
};
const project = { ...task, blockId: "project", attrHostId: "project", parentId: "", taskType: "2", title: "Project", childIds: ["action"] };
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
const bridge = {
    getReviewData: async () => reviewData, markTaskReviewed: async () => [], completeReview: async () => reviewData,
    updateTask: async () => project,
};
const i18n = new Proxy({
    reviewOpenProject: "Open project", editProject: "Edit", markReviewed: "Reviewed", reviewProjectTitle: "Projects",
    reviewProjectManualTitle: "Manual", reviewProjectManualHint: "Choose", reviewProjectManualPlaceholder: "Choose",
    reviewProjectManualEmpty: "Empty", noMatches: "No matches", loadingMore: "Loading", clearSelection: "Clear",
    reviewProjectQueueEmpty: "Empty", reviewProjectManualTrigger: "Manual", reviewProjectOnTrack: "On track",
    statusTodo: "Todo", outcome: "Outcome", definitionOfDone: "DoD", projectProgressStats: "Progress",
    reviewProjectPlan: "Plan", projectNextActions: "Next actions", projectNoNextActions: "None",
    reviewProjectWaitingBlocked: "Risks", reviewProjectNoWaitingBlocked: "None", actionKindAction: "Action",
    untitled: "Untitled", reviewGuideTitle: "Guide", reviewDueTitle: "Due", reviewChecklistStatus: "Checklist",
    reviewNeverCompleted: "Never", aiReview: "AI", reviewCompleteChecklist: "Complete", noData: "No data",
}, { get: (target, key) => target[key] || String(key) });
let showingReview = true;
let reviewScrollTop = 0;
async function openProject() {
    showingReview = false;
    await tick();
    showingReview = true;
}
const noop = () => {};
</script>

<style>
    :global(.na-view-shell) { height: 120px; }
    :global(.na-review__section) { min-height: 160px; }
</style>

{#if showingReview}
    <ReviewView {bridge} selectedTaskId="" bind:reviewScrollTop {i18n}
        manualProjectIds={["project"]} expandedProjectId="project"
        onSelectTask={noop} onEdit={noop} {openProject} onStatusClick={noop} onContextMenu={noop} />
{:else}
    <div id="project-target"></div>
{/if}`,
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
    const scroll = document.querySelector(".na-review__scroll");
    scroll.scrollTop = 48;
    scroll.dispatchEvent(new Event("scroll"));
    [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Open project")?.click();
    setTimeout(() => finish({ scrollTop: document.querySelector(".na-review__scroll")?.scrollTop }), 100);
}, 100);`,
            );
        },
    });
    assert.deepEqual(result, { scrollTop: 48 });
});

test("Project Support 隔离加载错误并支持刷新、重试和打开原文", async () => {
    const result = await runSvelteBrowserTest({
        fixtureName: "project-support",
        virtualTimeBudget: 1_500,
        prepareFixture(fixtureRoot) {
            const supportPath = resolve("src/frontend/components/project/ProjectSupportSection.svelte").replace(
                /\\/g,
                "/",
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
let extracted = "";
const i18n = new Proxy({
    projectSupport: "Project Support", projectSupportDescription: "Referenced project context",
    projectSupportRefresh: "Refresh", projectSupportEmpty: "No support yet",
    projectSupportLoadError: "Support unavailable: {error}", projectSupportRetry: "Retry",
    projectSupportForward: "Referenced by project", projectSupportBacklink: "Links to project",
    projectSupportBoth: "Linked both ways", projectSupportBlock: "Block",
    projectSupportDocument: "Document", projectSupportOpen: "Open source", extractAction: "Extract Action", loading: "Loading",
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

<div id="harness" data-attempts={attempts} data-opened={opened} data-extracted={extracted}>
    <div id="core-project-content">Project outcome remains available</div>
    <ProjectSupportSection
        {projectId} {i18n} {loadSupport} onOpen={(blockId) => (opened = blockId)}
        onExtract={(blockId) => (extracted = blockId)}
    />
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
            document.querySelector('button[aria-label="Extract Action"]')?.click();
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
                    extracted: harness?.dataset.extracted,
                });
            }, 20);
        }, 60);
    }, 60);
}, 80);`,
            );
        },
    });
    assert.deepEqual(result, {
        emptyVisible: true,
        errorVisible: true,
        coreVisibleDuringError: true,
        attempts: 3,
        titleVisible: true,
        directionVisible: true,
        opened: "20260825120001-support",
        extracted: "20260825120001-support",
    });
});
