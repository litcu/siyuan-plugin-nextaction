import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));

test("插件清单声明支持桌面端与 Web 前端", () => {
    assert.deepEqual(manifest.frontends, [
        "desktop",
        "desktop-window",
        "browser-desktop",
        "browser-mobile",
    ]);
});
