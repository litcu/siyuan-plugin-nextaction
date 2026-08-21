import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getOwnedNativeTaskActions } from "../src/frontend/controllers/native-task-dom.ts";

const source = readFileSync(new URL("../src/frontend/styles/host-integration.scss", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../src/frontend/ui/tokens.scss", import.meta.url), "utf8");
const integration = readFileSync(
    new URL("../src/frontend/controllers/editor-task-integration.ts", import.meta.url),
    "utf8",
);
const start = source.indexOf(".protyle-wysiwyg [data-node-id][custom-na-task]");
const end = source.indexOf("// Notification Host & Card", start);
const editorIconStyles = source.slice(start, end);

test("editor task status markers match the panel circular checkbox", () => {
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    assert.match(editorIconStyles, /border-radius:\s*50%/);
    assert.match(editorIconStyles, /border:\s*2px solid var\(--na-text-secondary\)/);
    assert.match(editorIconStyles, /border-style:\s*dashed/);
    assert.match(editorIconStyles, /top:\s*calc\(0\.5lh - 8px\)/);
    assert.match(editorIconStyles, /top:\s*0\.5lh/);
    assert.match(tokens, /:root\s*\{[\s\S]*--na-text-secondary:\s*var\(--b3-theme-on-surface-light\)/);
});

test("原生任务 checkbox 使用六态样式并在 capture 阶段阻止 SiYuan 二态切换", () => {
    // Regression: native checkbox clicks must always open NextAction's status menu.
    assert.match(source, /\[data-type="NodeListItem"\]\[data-subtype="t"\]/);
    assert.match(source, /\[data-type="NodeList"\]\[data-subtype="t"\] > \[data-type="NodeListItem"\]/);
    assert.match(source, /position:\s*absolute/);
    assert.match(source, /left:\s*8px/);
    assert.match(source, /top:\s*calc\(\(1\.625em \+ 8px - 18px\) \/ 2\)/);
    assert.match(source, /> svg \{[\s\S]*visibility:\s*hidden/);
    assert.match(source, /na-status-checkbox--inbox::after/);
    assert.match(source, /content:\s*none/);
    assert.match(source, /\.protyle-action--task\.na-status-checkbox/);
    assert.match(integration, /na-status-checkbox/);
    assert.match(integration, /classList\.add\("na-status-checkbox", `\$\{statusClassPrefix\}\$\{status\}`\)/);
    assert.match(integration, /document\.addEventListener\("pointerdown", this\.handleEditorStatusClick, true\)/);
    assert.match(integration, /document\.addEventListener\("mousedown", this\.handleEditorStatusClick, true\)/);
    assert.match(integration, /document\.addEventListener\("click", this\.handleEditorStatusClick, true\)/);
    assert.match(integration, /event\.stopPropagation\(\);[\s\S]*event\.preventDefault\(\)/);
    assert.match(integration, /if \(event\.type !== "click"\) return/);
});

// Regression: 父任务状态同步不能覆盖嵌套子任务自己的六态图标。
test("原生任务状态同步仅处理归属于当前列表项的按钮", () => {
    let parentTask!: HTMLElement;
    let childTask!: HTMLElement;
    const parentAction = {
        closest: () => parentTask,
    } as unknown as HTMLElement;
    const childAction = {
        closest: () => childTask,
    } as unknown as HTMLElement;
    parentTask = {
        querySelectorAll: () => [parentAction, childAction],
    } as unknown as HTMLElement;
    childTask = {
        querySelectorAll: () => [childAction],
    } as unknown as HTMLElement;
    const appliedStatuses = new Map<HTMLElement, string>();

    for (const action of getOwnedNativeTaskActions(childTask)) appliedStatuses.set(action, "doing");
    for (const action of getOwnedNativeTaskActions(parentTask)) appliedStatuses.set(action, "waiting");

    assert.equal(appliedStatuses.get(parentAction), "waiting");
    assert.equal(appliedStatuses.get(childAction), "doing");
});
