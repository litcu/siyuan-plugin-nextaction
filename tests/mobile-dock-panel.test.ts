import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("移动 Dock 在精简侧栏和完整任务面板之间切换", () => {
    const host = source("../src/frontend/components/MobileDockHost.svelte");
    assert.equal(existsSync(new URL("../src/frontend/components/MobileDockHost.svelte", import.meta.url)), true);
    assert.match(host, /type MobileDockMode = "sidebar" \| "full"/);
    assert.match(host, /let mode: MobileDockMode = "sidebar"/);
    assert.match(host, /<DockSidebar[\s\S]*onOpenFullPanel=\{openFullPanel\}/);
    assert.match(host, /<NextActionApp \{bridge\} \{i18n\}/);
    assert.match(host, /onclick=\{backToSidebar\}/);
    assert.match(host, /min-height: 44px/);
    assert.match(host, /safe-area-inset-bottom/);
    assert.match(source("../src/frontend/components/DockSidebar.svelte"), /onOpenFullPanel/);
});

test("移动端隐藏顶部栏和命令入口，但保留 Dock 内部入口", () => {
    const panels = source("../src/frontend/controllers/panel-host-registrar.ts");
    const commands = source("../src/frontend/controllers/task-command-controller.ts");
    assert.match(panels, /if \(this\.isMobile\) return/);
    assert.match(panels, /registrar\.isMobile[\s\S]*MobileDockHost\.svelte/);
    assert.match(panels, /if \(!this\.isMobile\) \{[\s\S]*this\.plugin\.addTopBar/);
    assert.match(commands, /if \(!this\.isMobile\) \{[\s\S]*langKey: "openTaskPanel"/);
});

test("侧边栏标题和页签使用同一行的弹性布局", () => {
    const dock = source("../src/frontend/components/DockSidebar.svelte");
    assert.doesNotMatch(dock, /class="na-dock__tabs"/);
    assert.match(dock, /NaPanelHeader compact title=\{i18n\?\.pluginName/);
    assert.match(dock, /na-panel-header__actions/);
    assert.match(dock, /@container na-dock \(max-width: 260px\)/);
});

test("Tooltip 点击后立即隐藏，避免与任务详情叠加", () => {
    const tooltip = source("../src/frontend/ui/NaTooltip.svelte");
    assert.match(tooltip, /function handleClick\(\)/);
    assert.match(tooltip, /onclick=\{handleClick\}/);
    assert.match(tooltip, /visible = false/);
});

test("任务详情错误固定在滚动正文顶部 Notice", () => {
    const detail = source("../src/frontend/components/TaskDetail.svelte");
    assert.match(
        detail,
        /noticeMessage = dateError \|\| depError \|\| customFieldError \|\| saveError \|\| repeatDateError/,
    );
    assert.doesNotMatch(detail, /<NaPropertyRow label=\{i18n\?\.repeat \|\| "Repeat"\} error=/);
    assert.doesNotMatch(detail, /<NaPropertyRow label=\{i18n\?\.dueTime[\s\S]*?error=\{dateError\}/);
    assert.doesNotMatch(detail, /<NaPropertyRow label=\{i18n\?\.depMode[\s\S]*?error=\{depError\}/);
    assert.match(detail, /repeatDateErrorTimer = setTimeout/);
});

test("任务详情错误直接位于滚动正文顶部", () => {
    const detail = source("../src/frontend/components/TaskDetail.svelte");
    const shell = source("../src/frontend/ui/NaDialogShell.svelte");
    assert.match(detail, /<div class="na-task-detail__notice"><NaInlineNotice message=\{noticeMessage\}/);
    assert.match(detail, /\.na-task-detail__notice \{[\s\S]*position: sticky/);
    assert.doesNotMatch(detail, /slot="notice"/);
    assert.doesNotMatch(shell, /noticePosition/);
});
