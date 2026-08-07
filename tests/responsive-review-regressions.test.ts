import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

const taskDetailSource = source("../src/frontend/components/TaskDetail.svelte");
const navRailSource = source("../src/frontend/components/NavRail.svelte");
const timelineSource = source("../src/frontend/components/timeline/TimelineView.svelte");
const unscheduledSource = source("../src/frontend/components/timeline/UnscheduledPanel.svelte");
const myDaySource = source("../src/frontend/components/MyDayView.svelte");
const reviewViewSource = source("../src/frontend/components/ReviewView.svelte");
const bridgeSource = source("../src/frontend/kernel-bridge.ts");
const rpcSource = source("../src/kernel/rpc-server.ts");
const kernelSource = source("../src/kernel.ts");
const typesSource = source("../src/shared/types.ts");
const settingsSource = source("../src/shared/settings.ts");
const stylesheetSource = source("../src/index.scss");
const iconButtonSource = source("../src/frontend/ui/NaIconButton.svelte");
const zhI18nSource = source("../src/i18n/zh-CN.json");
const enI18nSource = source("../src/i18n/en.json");

test("任务属性面板的跳转操作使用统一的图标按钮", () => {
    assert.match(taskDetailSource, /<NaIconButton symbol="iconOpenWindow"/);
    assert.match(iconButtonSource, /aria-label=\{label\}/);
    assert.match(iconButtonSource, /title=\{label\}/);
});

test("完整任务面板极窄时侧栏收缩为带 tooltip 的图标栏", () => {
    assert.match(navRailSource, /navGroups/);
    assert.match(navRailSource, /class="na-nav-rail__group"/);
    assert.match(navRailSource, /collapsed=\{compact\}/);
    assert.match(navRailSource, /na-nav-rail__action-label/);
    assert.match(stylesheetSource, /container-type:\s*inline-size/);
    assert.match(stylesheetSource, /@container nextaction-app \(max-width:\s*520px\)/);
    assert.match(stylesheetSource, /\.na-nav-rail\s*\{[\s\S]*?width:\s*44px/);
    assert.match(stylesheetSource, /\.na-nav-rail__label[\s\S]*display:\s*none/);
    assert.match(stylesheetSource, /content:\s*attr\(data-tooltip\)/);
});

test("我的一天窄模式纵向排列并保留可用的未排期卡片宽度", () => {
    assert.match(timelineSource, /class:na-timeline-view--narrow=\{isNarrow\}/);
    assert.match(timelineSource, /horizontal=\{true\}/);
    assert.match(timelineSource, /\.na-timeline-view--narrow\s*\{[\s\S]*flex-direction:\s*column/);
    assert.match(unscheduledSource, /class:na-unscheduled--horizontal=\{horizontal\}/);
    assert.match(unscheduledSource, /grid-auto-columns:\s*minmax\(180px,\s*240px\)/);
    assert.match(unscheduledSource, /overflow-x:\s*auto/);
});

test("我的一天顶部按插件面板宽度重排而不是按主窗口宽度", () => {
    assert.match(myDaySource, /container-name:\s*myday-view/);
    assert.match(myDaySource, /container-type:\s*inline-size/);
    assert.doesNotMatch(myDaySource, /@media \(max-width:\s*760px\)/);
});

test("回顾清单完成时间有默认值并参与设置合并", () => {
    assert.match(settingsSource, /interface PluginSettings[\s\S]*lastReviewAt:\s*string/);
    assert.match(settingsSource, /DEFAULT_SETTINGS[\s\S]*lastReviewAt:\s*""/);
    assert.match(settingsSource, /lastReviewAt:\s*override\.lastReviewAt \?\? base\.lastReviewAt/);
});

test("回顾清单通过独立 RPC 记录完成时间并在视图中展示", () => {
    assert.match(typesSource, /interface ReviewData[\s\S]*lastReviewAt:\s*string/);
    assert.match(bridgeSource, /async completeReview\(\): Promise<ReviewData>/);
    assert.match(rpcSource, /rpc\.bind\("completeReview"/);
    assert.match(kernelSource, /completeReview:\s*this\.completeReview\.bind\(this\)/);
    assert.match(kernelSource, /lastReviewAt:\s*new Date\(\)\.toISOString\(\)/);
    assert.match(reviewViewSource, /handleCompleteReview/);
    assert.match(reviewViewSource, /bridge\.completeReview\(\)/);
    assert.match(reviewViewSource, /reviewLastCompleted/);
    assert.match(reviewViewSource, /reviewCompleteChecklist/);
    for (const translation of [zhI18nSource, enI18nSource]) {
        assert.match(translation, /"reviewLastCompleted"/);
        assert.match(translation, /"reviewCompleteChecklist"/);
    }
});
