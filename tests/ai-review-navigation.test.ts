import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dialogSource = readFileSync(
    new URL("../src/frontend/components/AiReviewDialog.svelte", import.meta.url),
    "utf8",
);
const utilsSource = readFileSync(new URL("../src/frontend/utils.ts", import.meta.url), "utf8");

test("智能回顾的任务链接复用统一块跳转实现", () => {
    assert.match(dialogSource, /import \{ jumpToBlock \} from "\.\.\/utils"/);
    assert.match(dialogSource, /jumpToBlock\(blockId\)/);
    assert.doesNotMatch(dialogSource, /openTab|siYuanApp/);
});

test("统一块跳转使用思源应用实例并请求加载块上下文", () => {
    assert.match(utilsSource, /siyuan\?\.ws\?\.app/);
    assert.match(utilsSource, /"cb-get-focus", "cb-get-context", "cb-get-hl"/);
});
