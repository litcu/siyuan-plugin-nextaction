import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const detail = source("../src/frontend/components/TaskDetail.svelte");
const shell = source("../src/frontend/ui/NaDialogShell.svelte");
const drawer = source("../src/frontend/ui/NaDrawerHost.svelte");
const app = source("../src/frontend/components/NextActionApp.svelte");
const dock = source("../src/frontend/components/DockSidebar.svelte");
const editorIntegration = source("../src/frontend/controllers/editor-task-integration.ts");
const dialogAdapter = source("../src/frontend/dialogs/task-detail-dialog.ts");
const controller = source("../src/frontend/dialogs/task-property-dialogs.ts");
const stateController = source("../src/frontend/controllers/task-detail-controller.ts");
const stylesheet = ["../src/frontend/styles/app-shell.scss", "../src/frontend/styles/components.scss"]
    .map(source)
    .join("\n");
const propertyRow = source("../src/frontend/ui/NaPropertyRow.svelte");
const propertySection = source("../src/frontend/ui/NaPropertySection.svelte");
const tokens = source("../src/frontend/ui/tokens.scss");

test("任务属性面板关闭底部操作栏并保持正文独立滚动", () => {
    assert.match(shell, /grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto/);
    assert.match(shell, /na-dialog-shell__body[\s\S]*overflow-x:\s*hidden[\s\S]*overflow-y:\s*auto/);
    assert.match(shell, /export let showFooter = true/);
    assert.match(detail, /showFooter=\{false\}/);
    assert.doesNotMatch(detail, /slot="footer(?:Start|End)"/);
    assert.match(
        stylesheet,
        /\.na-app__detail-inner\s*\{[\s\S]*position:\s*absolute;[\s\S]*inset:\s*0;[\s\S]*overflow:\s*hidden/,
    );
    assert.match(shell, /max-height:\s*100%/);
});

test("属性行不再逐行绘制分割线，仅保留分区边界", () => {
    assert.doesNotMatch(propertyRow, /border-bottom/);
    assert.match(propertySection, /\.na-property-section\s*\{[\s\S]*border-top/);
    assert.match(propertySection, /\.na-property-section:first-child\s*\{\s*border-top:\s*0/);
});

test("遮罩、关闭按钮和 Esc 统一请求关闭", () => {
    assert.match(detail, /export async function requestClose/);
    assert.match(detail, /on:close=\{requestClose\}/);
    assert.match(app, /on:requestClose=\{requestDetailClose\}/);
    assert.match(drawer, /dispatch\("requestClose", "backdrop"\)/);
    assert.match(drawer, /dispatch\("requestClose", "escape"\)/);
    assert.match(controller, /b3-dialog__scrim/);
    assert.match(tokens, /--na-color-overlay-bg:\s*var\(--b3-mask-background\)/);
});

test("属性子弹窗提升到打开的任务抽屉之上", () => {
    assert.match(
        controller,
        /querySelectorAll<HTMLElement>\([\s\S]*na-drawer-host--open[\s\S]*na-drawer-host__backdrop/,
    );
    assert.match(controller, /window\.getComputedStyle\(element\)\.zIndex/);
    assert.match(controller, /drawerZIndex >= currentDialogZIndex/);
    assert.match(controller, /dialogRoot\.style\.zIndex = String\(nextZIndex\)/);
    assert.match(controller, /siyuan\.zIndex = nextZIndex/);
});

test("自动保存、未保存修改确认和错误状态保持可见", () => {
    assert.match(detail, /const decision = await session\.transition\(queuedTarget\)/);
    assert.match(detail, /onConfirmDiscard/);
    assert.match(detail, /session\.edit\(buildDraft\(\)\)/);
    assert.match(stateController, /options\.debounceMs \?\? 500/);
    assert.match(stateController, /void this\.flush\(\)/);
    assert.match(detail, /<div class="na-task-detail__notice"><NaInlineNotice message=\{noticeMessage\}/);
    assert.match(shell, /aria-live="polite"/);
});

test("任务草稿显式声明响应式字段依赖", () => {
    assert.match(
        detail,
        /function buildDraft\(\): TaskDetailDraft \{[\s\S]*status,[\s\S]*customFieldValues,[\s\S]*\};/,
    );
    assert.match(stateController, /dirtyFieldsFor\(this\.state\.draft, this\.state\.baseline\)/);
    assert.match(detail, /\$:\s*dateError\s*=\s*getDateError\(start, due\)/);
});

test("全部既有任务属性进入统一保存载荷", () => {
    for (const attribute of [
        "na-status",
        "na-priority",
        "na-importance",
        "na-effort",
        "na-due",
        "na-start",
        "na-context",
        "na-tags",
        "na-parent",
        "na-task",
        "na-depends",
        "na-dep-mode",
        "na-sequential",
        "na-note",
        "na-review-interval",
        "na-review-date",
        "na-ext-",
    ])
        assert.match(attribute === "na-ext-" ? detail : stateController, new RegExp(attribute));
});

test("任务类型与标签保持同行，极窄视口再由公共属性行换行", () => {
    assert.match(detail, /<NaPropertyRow label=\{i18n\?\.taskType[\s\S]*?<NaSegmentControl/);
    assert.doesNotMatch(detail, /<NaPropertyRow label=\{i18n\?\.taskType[^>]*stacked=\{true\}/);
    assert.match(propertyRow, /@media \(max-width: 520px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("任务关系提供只读子任务并保留依赖编辑", () => {
    assert.match(detail, /childTasks = allTasks[\s\S]*entry\.parentId === task\.blockId/);
    assert.match(detail, /<NaTaskLinkList\s+items=\{childTasks\}/);
    assert.match(detail, /<NaSearchSelect\s+multi=\{true\}\s+bind:selected=\{depends\}/);
    assert.match(detail, /bind:value=\{depMode\}/);
    assert.match(detail, /bind:checked=\{sequentialEnabled\}/);
});

test("任务详情子任务导航和跳转使用统一 Session 与 Dialog 静态接线", () => {
    assert.match(detail, /export async function openTask\(blockId: string\)/);
    assert.match(detail, /async function handleOpenTask\(blockId: string\)[\s\S]*await openTask\(blockId\)/);
    assert.match(
        detail,
        /async function handleJumpToBlock\(blockId: string\)[\s\S]*requestTransition\(\{ type: "close" \}\)[\s\S]*await jump\(blockId\)/,
    );
    assert.match(detail, /onOpen=\{handleJumpToBlock\}[\s\S]*onSelect=\{handleOpenTask\}/);
    assert.match(app, /detailComponent\.openTask\(task\.blockId\)/);
    assert.match(app, /onTaskChange=\{handleDetailTaskChange\}/);
    assert.match(dock, /openTaskDetailDialog\(\{/);
    assert.match(editorIntegration, /openSharedTaskDetailDialog\(\{/);
    assert.match(dialogAdapter, /onConfirmDiscard:[\s\S]*confirm\(/);
    assert.match(dialogAdapter, /taskStore\.applyUpdate\(task\)/);
    assert.doesNotMatch(dialogAdapter, /onOpenTask/);
    assert.match(detail, /snapshot\.removalReason === "external"/);
    assert.match(detail, /<NaPropertySection title=\{i18n\?\.detailGroupBasics[\s\S]*label=\{i18n\?\.note/);
    assert.doesNotMatch(detail, /<NaPropertySection title=\{i18n\?\.detailGroupNotes/);
    assert.match(detail, /<NaPropertySection title=\{i18n\?\.customFields/);
});

// Regression: Dock 和编辑器任务弹窗曾显示新建子任务按钮，却未提供点击回调。
test("任务属性弹窗的新建子任务按钮接通创建回调", () => {
    assert.match(dock, /onCreateChild:\s*openCreateChild/);
    assert.match(editorIntegration, /onCreateChild:\s*this\.openCreateChildDialog/);
    assert.match(dock, /openCreateTaskDialog\(\{[\s\S]*parentTask:\s*task/);
    assert.match(editorIntegration, /openCreateTaskDialog\(\{[\s\S]*parentTask/);
});

test("极窄布局无横向溢出", () => {
    assert.match(drawer, /@media \(max-width: 520px\)[\s\S]*width:\s*100%/);
    assert.match(shell, /overflow-x:\s*hidden/);
});
