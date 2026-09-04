import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const entry = read("../src/index.scss");
const shell = read("../src/frontend/styles/app-shell.scss");
const components = read("../src/frontend/styles/components.scss");
const host = read("../src/frontend/styles/host-integration.scss");

test("根样式入口只按稳定职责顺序汇总", () => {
    assert.equal(
        entry.replace(/\r\n/g, "\n").trim(),
        [
            '@use "./frontend/ui/tokens";',
            '@use "./frontend/ui/primitives";',
            '@use "./frontend/styles/app-shell";',
            '@use "./frontend/styles/components";',
            '@use "./frontend/styles/host-integration";',
        ].join("\n"),
    );
});

test("壳层、组件和宿主集成样式各自拥有对应选择器", () => {
    assert.match(shell, /\.na-app\s*\{/);
    assert.match(shell, /\.na-nav-rail\s*\{/);
    assert.match(host, /\.protyle-title[\s\S]*\.na-document-task-status/);
    assert.match(host, /\.na-ai-dialog \.b3-dialog__container/);
    assert.match(host, /\.na-notification-host/);
    assert.doesNotMatch(components, /\.protyle-wysiwyg|\.na-notification-host|\.na-app\s*\{/);
});

test("无调用方的旧项目条目选择器已删除", () => {
    const all = `${shell}\n${components}\n${host}`;
    assert.doesNotMatch(all, /\.na-project-item(?:__header|__children)?\b/);
});
