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
const stylesheetSource = read("../src/index.scss");
const zh = JSON.parse(read("../src/i18n/zh-CN.json"));
const en = JSON.parse(read("../src/i18n/en.json"));

test("紧凑任务卡片没有可见元数据时移除空白第二行", () => {
    assert.match(taskCardSource, /\$: hasCardMetadata = Boolean\(/);
    assert.match(taskCardSource, /class:na-task-card__body--metadata-empty=\{!hasCardMetadata\}/);
    assert.match(
        stylesheetSource,
        /\.na-task-list--compact \.na-task-card__body--metadata-empty \.na-task-card__meta\s*\{\s*display:\s*none;/,
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

test("公共 Tooltip 使用浅边框、主题表面色和轻圆角", () => {
    for (const source of [tooltipSource, primitivesSource, stylesheetSource]) {
        assert.match(source, /color-mix\(in srgb, var\(--b3-border-color\) 62%, transparent\)/);
        assert.match(source, /border-radius:\s*var\(--na-radius-sm\)/);
    }
    assert.match(iconButtonSource, /b3-tooltips b3-tooltips__n/);
    assert.doesNotMatch(iconButtonSource, /title=\{label\}/);
    assert.match(navItemSource, /data-tooltip=\{tooltip \|\| label\}/);
    assert.doesNotMatch(navItemSource, /title=\{tooltip \|\| label\}/);
    assert.match(tooltipSource, /use:portal/);
    assert.match(tooltipSource, /z-index:\$\{getCurrentUiZIndex\(\)\}/);
});

test("设置界面将内置 AI 重命名为 AI 功能", () => {
    assert.equal(zh.settingAi, "AI 功能");
    assert.equal(zh.settingAiPromptTitle, "AI 功能提示词");
    assert.equal(en.settingAi, "AI features");
    assert.equal(en.settingAiPromptTitle, "AI feature prompts");
});
