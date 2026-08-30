import test from "node:test";
import assert from "node:assert/strict";
import { runBrowser } from "./helpers/browser.ts";

// Regression: 浏览器超时后曾遗留子进程并锁住临时 profile，导致后续清理报 EBUSY。
test("浏览器超时会终止整个进程树并返回超时结果", async () => {
    const startedAt = Date.now();
    const result = await runBrowser(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeout: 100 });

    assert.equal(result.status, null);
    assert.ok(Date.now() - startedAt < 5_000, `超时浏览器进程未及时结束：${Date.now() - startedAt}ms`);
});
