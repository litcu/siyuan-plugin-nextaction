import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const taskCardSource = read("../src/frontend/components/TaskCard.svelte");
const navItemSource = read("../src/frontend/ui/NaNavItem.svelte");
const iconButtonSource = read("../src/frontend/ui/NaIconButton.svelte");
const tooltipSource = read("../src/frontend/ui/NaTooltip.svelte");
const primitivesSource = read("../src/frontend/ui/primitives.scss");
const datePickerSource = read("../src/frontend/ui/NaDatePicker.svelte");
const searchSelectSource = read("../src/frontend/ui/NaSearchSelect.svelte");
const dragHandlerSource = read("../src/frontend/components/drag-handler.ts");
const stylesheetSource = [
    "../src/frontend/styles/app-shell.scss",
    "../src/frontend/styles/components.scss",
    "../src/frontend/styles/host-integration.scss",
].map(read).join("\n");
const zh = JSON.parse(read("../src/i18n/zh-CN.json"));
const en = JSON.parse(read("../src/i18n/en.json"));

test("紧凑任务卡片没有可见元数据时移除空白第二行", () => {
    assert.match(taskCardSource, /\$: hasCardMetadata = Boolean\(/);
    assert.match(taskCardSource, /class:na-task-card__body--metadata-empty=\{!hasCardMetadata\}/);
    assert.match(
        stylesheetSource,
        /\.na-task-card__body--metadata-empty \.na-task-card__meta\s*\{\s*display:\s*none;/,
    );
    assert.match(
        stylesheetSource,
        /@container nextaction-app \(max-width: 520px\)[\s\S]*\.na-task-card__body--metadata-empty \.na-task-card__meta \{ display: none; \}/,
    );
});

test("任务面板建立独立层叠上下文且折叠导航低于抽屉", () => {
    const appRule = stylesheetSource.match(/\.na-app\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const navRule = stylesheetSource.match(/\.na-nav-rail\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    assert.match(appRule, /isolation:\s*isolate/);
    assert.match(navRule, /position:\s*relative/);
    assert.match(navRule, /z-index:\s*0/);
    assert.doesNotMatch(stylesheetSource, /\.na-nav-rail\s*\{[^}]*z-index:\s*30/s);
    assert.match(stylesheetSource, /\.na-notification-host\s*\{[\s\S]*?z-index:\s*9;/);
    assert.match(datePickerSource, /z-index:\$\{getCurrentUiZIndex\(\)\}/);
    assert.match(searchSelectSource, /z-index:\$\{getCurrentUiZIndex\(\)\}/);
    assert.match(dragHandlerSource, /getCurrentUiZIndex\(9\)/);
    for (const source of [stylesheetSource, datePickerSource, searchSelectSource, dragHandlerSource]) {
        assert.doesNotMatch(source, /z-index\s*:\s*9999|zIndex\s*=\s*"9999"/);
    }
});

test("公共 Tooltip 使用 Portal、主题样式和统一定位", () => {
    for (const source of [tooltipSource, primitivesSource]) {
        assert.match(source, /color-mix\(in srgb, var\(--b3-border-color\) 62%, transparent\)/);
        assert.match(source, /border-radius:\s*var\(--na-radius-sm\)/);
    }
    assert.match(iconButtonSource, /<NaTooltip text=\{label\}/);
    assert.match(iconButtonSource, /followCursor=\{false\}/);
    assert.doesNotMatch(iconButtonSource, /title=\{label\}/);
    assert.match(navItemSource, /<NaTooltip text=\{tooltip \|\| label\}/);
    assert.match(navItemSource, /position="right"/);
    assert.doesNotMatch(navItemSource, /title=\{tooltip \|\| label\}/);
    assert.match(tooltipSource, /use:portal/);
    assert.match(tooltipSource, /calculateTooltipPosition/);
    assert.match(tooltipSource, /z-index:\$\{getCurrentUiZIndex\(\)\}/);
});

test("搜索选择器下拉项使用等宽主题菜单样式", () => {
    const dropdownRule = searchSelectSource.match(/\.na-search-select__dropdown\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
    const optionRule = searchSelectSource.match(/\.na-search-select__option\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";

    assert.match(dropdownRule, /overflow-x:\s*hidden/);
    assert.match(optionRule, /display:\s*block/);
    assert.match(optionRule, /width:\s*100%/);
    assert.match(optionRule, /box-sizing:\s*border-box/);
    assert.match(optionRule, /border:\s*0/);
    assert.match(optionRule, /background:\s*transparent/);
    assert.match(optionRule, /text-align:\s*left/);
    assert.match(optionRule, /overflow-wrap:\s*anywhere/);
    assert.match(searchSelectSource, /&:focus-visible[\s\S]*background:\s*var\(--b3-list-hover\)/);
});

test("设置界面将内置 AI 重命名为 AI 功能", () => {
    assert.equal(zh.settingAi, "AI 功能");
    assert.equal(zh.settingAiPromptTitle, "AI 功能提示词");
    assert.equal(en.settingAi, "AI features");
    assert.equal(en.settingAiPromptTitle, "AI feature prompts");
});
