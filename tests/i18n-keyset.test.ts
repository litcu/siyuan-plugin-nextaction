import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const zh = JSON.parse(readFileSync(new URL("../src/i18n/zh-CN.json", import.meta.url), "utf8"));
const en = JSON.parse(readFileSync(new URL("../src/i18n/en.json", import.meta.url), "utf8"));

test("中英文翻译键集合完全一致", () => {
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
});
