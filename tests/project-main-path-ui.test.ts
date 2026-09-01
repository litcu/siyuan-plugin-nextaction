import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("项目回顾可以打开对应项目并将目标选择传递给项目视图", () => {
    const app = source("../src/frontend/components/NextActionApp.svelte");
    const review = source("../src/frontend/components/ReviewView.svelte");
    const queue = source("../src/frontend/components/ProjectReviewQueue.svelte");
    const projectView = source("../src/frontend/components/ProjectView.svelte");

    assert.match(queue, /export let onOpenProject:/);
    assert.match(queue, /onclick=\{\(\) => onOpenProject\(project\)\}/);
    assert.match(review, /\{onOpenProject\}/);
    assert.match(app, /function handleOpenProject\(project: TaskCacheEntry\)/);
    assert.match(app, /onOpenProject=\{handleOpenProject\}/);
    assert.match(app, /requestedProjectId=\{projectFocusId\}/);
    assert.match(app, /let reviewManualProjectIds: string\[\] = \[\]/);
    assert.match(app, /let reviewExpandedProjectId = ""/);
    assert.match(app, /bind:manualProjectIds=\{reviewManualProjectIds\}/);
    assert.match(app, /bind:expandedProjectId=\{reviewExpandedProjectId\}/);
    assert.match(app, /bind:reviewScrollTop/);
    assert.match(review, /export let manualProjectIds: string\[\]/);
    assert.match(review, /export let expandedProjectId: string/);
    assert.match(review, /export let reviewScrollTop = 0/);
    assert.match(review, /on:scroll=\{\(\) => \(reviewScrollTop = reviewScrollElement\?\.scrollTop \|\| 0\)\}/);
    assert.match(queue, /export let expandedProjectId: string/);
    assert.match(projectView, /export let requestedProjectId/);
    assert.match(projectView, /activeProjectId = requestedProjectId/);
    assert.match(projectView, /let requestedProjectFilterBypassId = ""/);
    assert.match(
        projectView,
        /function handleFilterChange\(state: FilterState\) \{\s*requestedProjectFilterBypassId = "";/,
    );
});

test("风险处置入口提供创建下一步行动与统一完成确认", () => {
    const overview = source("../src/frontend/components/project/ProjectOverviewMode.svelte");
    const queue = source("../src/frontend/components/ProjectReviewQueue.svelte");
    const review = source("../src/frontend/components/ReviewView.svelte");

    assert.match(overview, /shouldOfferProjectRiskAction\(item\)/);
    assert.match(overview, /onCreateAction\?\.\(summary\.project\)/);
    assert.match(queue, /shouldOfferProjectRiskAction\(risk\)/);
    assert.match(queue, /onCreateAction\?\.\(project\)/);
    assert.match(queue, /onConfirmCompletion/);
    assert.match(review, /confirmProjectCompletion\(summary/);
});

test("任务详情区分逻辑加入项目、物理移动和取消项目身份", () => {
    const detail = source("../src/frontend/components/TaskDetail.svelte");
    const en = source("../src/i18n/en.json");
    const zh = source("../src/i18n/zh-CN.json");

    assert.match(
        detail,
        /\{#if !isProject\}[\s\S]*?<NaPropertyRow[\s\S]*?label=\{i18n\?\.projectAssignment[\s\S]*?helpText=\{i18n\?\.projectAssignmentHint[\s\S]*?<NaSearchSelect/,
    );
    assert.match(detail, /clearLabel=\{i18n\?\.clearProjectAssignment/);
    assert.match(detail, /i18n\?\.removeProject/);
    for (const translation of [en, zh]) {
        assert.match(translation, /"projectAssignment"/);
        assert.match(translation, /"projectAssignmentHint"/);
        assert.match(translation, /"clearProjectAssignment"/);
        assert.match(translation, /"confirmRemoveProject"/);
    }
});

test("Stage 在项目计划、Next Action 和 Review 共用的任务卡片中可见", () => {
    const card = source("../src/frontend/components/TaskCard.svelte");
    const styles = source("../src/frontend/styles/components.scss");

    assert.match(card, /\$: isStage = !isProject && task\.actionKind === "stage"/);
    assert.match(card, /\{#if isStage\}<span class="na-task-card__kind">\{i18n\?\.actionKindStage/);
    assert.match(styles, /\.na-task-card__kind\s*\{/);
});
