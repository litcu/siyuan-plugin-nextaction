import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

const listViews = [
    "AllTasksView.svelte",
    "InboxView.svelte",
    "NextActionView.svelte",
    "ProjectView.svelte",
    "SomedayView.svelte",
    "WaitingView.svelte",
];

test("六个任务列表视图统一使用公共视图、筛选和列表骨架", () => {
    for (const file of listViews) {
        const view = source(`../src/frontend/components/${file}`);
        assert.match(view, /NaViewShell/, file);
        assert.match(view, /NaTaskFilterBar/, file);
        assert.match(view, /NaTaskList/, file);
        assert.doesNotMatch(view, /SearchFilterBar|na-search-filter-bar/, file);
    }
});

test("我的一天、回顾、统计和提醒视图使用对应的 Na 公共组件", () => {
    const myDay = source("../src/frontend/components/MyDayView.svelte");
    assert.match(myDay, /NaViewShell/);
    assert.match(myDay, /NaToolbar/);
    assert.match(myDay, /NaMetricStrip/);
    assert.match(myDay, /NaSegmentControl/);

    const review = source("../src/frontend/components/ReviewView.svelte");
    const reviewDue = source("../src/frontend/components/ReviewDueList.svelte");
    assert.match(review, /NaViewShell/);
    assert.match(review, /NaToolbar/);
    assert.match(review, /NaButton/);
    assert.match(reviewDue, /NaAccordion/);

    const statistics = source("../src/frontend/components/StatisticsView.svelte");
    assert.match(statistics, /NaMetricStrip/);
    assert.match(statistics, /NaProgressBar/);

    const reminder = source("../src/frontend/components/ReminderView.svelte");
    assert.match(reminder, /NaBadge/);
    assert.match(reminder, /NaIconButton/);
    assert.match(reminder, /reminderOverdueMinutes/);
});

test("三个 Dock 页面共享壳层、工具栏和任务列表密度", () => {
    for (const file of ["DockNextAction.svelte", "DockInbox.svelte", "DockMyDay.svelte"]) {
        const dock = source(`../src/frontend/components/${file}`);
        assert.match(dock, /NaViewShell/, file);
        assert.match(dock, /NaToolbar/, file);
        assert.match(dock, /NaTaskList/, file);
        assert.match(dock, /density="compact"/, file);
    }
    assert.match(source("../src/frontend/components/DockMyDay.svelte"), /@container na-dock \(max-width: 260px\)/);
});

test("公共筛选栏由 props 驱动并通过 change 事件返回完整状态", () => {
    const filterBar = source("../src/frontend/ui/NaTaskFilterBar.svelte");
    assert.match(filterBar, /export let customFields/);
    assert.match(filterBar, /createEventDispatcher<\{ change: FilterState \}>/);
    assert.match(filterBar, /dispatch\("change", next\)/);
    assert.doesNotMatch(filterBar, /taskStore/);
});

test("公共按钮、工具栏和折叠区覆盖加载、操作插槽及合法交互结构", () => {
    const button = source("../src/frontend/ui/NaButton.svelte");
    assert.match(button, /disabled=\{disabled \|\| loading\}/);
    assert.match(button, /"button" \| "submit" \| "reset"/);
    assert.match(button, /prefers-reduced-motion/);

    const toolbar = source("../src/frontend/ui/NaToolbar.svelte");
    assert.match(toolbar, /slot name="actions"/);

    const accordion = source("../src/frontend/ui/NaAccordion.svelte");
    assert.match(accordion, /class="na-accordion__header"/);
    assert.match(accordion, /class="na-accordion__action"/);
    const triggerStart = accordion.indexOf("<button type=\"button\" class=\"na-accordion__trigger\"");
    const triggerEnd = accordion.indexOf("</button>", triggerStart);
    assert.doesNotMatch(accordion.slice(triggerStart, triggerEnd), /slot name="action"/);
});

test("旧筛选栏和未接入的 Dock 提醒组件已删除", () => {
    assert.equal(existsSync(new URL("../src/frontend/components/SearchFilterBar.svelte", import.meta.url)), false);
    assert.equal(existsSync(new URL("../src/frontend/components/DockReminder.svelte", import.meta.url)), false);
    const styles = source("../src/index.scss");
    assert.doesNotMatch(styles, /na-search-filter-bar|na-view__list|na-project-reminders/);
});
