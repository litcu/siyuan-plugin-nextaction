import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("移动和桌面宿主使用共用工作区及各自的展示策略", () => {
    for (const [file, host] of [
        ["MobileDockHost", "mobile-dock"],
        ["DockSidebar", "desktop-dock"],
        ["NextActionApp", "desktop-tab"],
    ]) {
        const component = source(`../src/frontend/components/${file}.svelte`);
        assert.match(component, /<Workspace/);
        assert.ok(component.includes(`host="${host}"`));
    }
});

test("移动端隐藏顶部栏和命令入口，但保留 Dock 内部入口", () => {
    const panels = source("../src/frontend/controllers/panel-host-registrar.ts");
    const commands = source("../src/frontend/controllers/task-command-controller.ts");
    assert.match(panels, /if \(this\.isMobile\) return/);
    assert.match(panels, /registrar\.isMobile[\s\S]*MobileDockHost\.svelte/);
    assert.match(panels, /if \(!this\.isMobile\) \{[\s\S]*this\.plugin\.addTopBar/);
    assert.match(commands, /if \(!this\.isMobile\) \{[\s\S]*langKey: "openTaskPanel"/);
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
        /noticeMessage = \$derived\(dateError \|\| depError \|\| customFieldError \|\| saveError \|\| repeatDateError\)/,
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
