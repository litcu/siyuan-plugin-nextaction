import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentNavigator } from "../src/frontend/controllers/document-navigation.ts";

test("移动端原文跳转使用移动文档 API，桌面保持标签页", async () => {
    // Regression: 移动端 openTab 是空实现，任务和支持材料的原文跳转无效。
    const calls: string[] = [];
    const navigator = createDocumentNavigator({
        openMobile: (id) => {
            calls.push(`mobile:${id}`);
        },
        openDesktop: async (id) => {
            calls.push(`desktop:${id}`);
        },
    });
    await navigator("browser-mobile", "content-block");
    await navigator("desktop", "task-block");
    assert.deepEqual(calls, ["mobile:content-block", "desktop:task-block"]);
});
