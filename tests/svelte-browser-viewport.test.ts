import test from "node:test";
import assert from "node:assert/strict";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

test("浏览器夹具按指定移动窗口提供真实窄视口", async () => {
    // Regression: 移动窗口参数在宿主浏览器中未形成预期的 CSS 视口，导致四组移动交互测试失败。
    const result = await runSvelteBrowserTest<{ width: number; ratio: number }>({
        fixtureName: "mobile-viewport",
        browserArgs: ["--window-size=390,844"],
        files: {
            "main.js": "window.__NA_BROWSER_RESULT__({ width: window.innerWidth, ratio: window.devicePixelRatio });",
        },
    });
    assert.ok(result.width >= 390 && result.width <= 500, JSON.stringify(result));
});
