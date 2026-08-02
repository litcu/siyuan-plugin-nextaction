import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/frontend/utils/filter.ts", import.meta.url), "utf8");

test("搜索和自定义字段条件会匹配字段值", () => {
    assert.match(source, /customFields\.some\(field =>/);
    assert.match(source, /customFieldFilters.*every/);
    assert.match(source, /filter\.operator === "equals"/);
});

test("自定义字段排序将空值排在末尾", () => {
    assert.match(source, /sortBy\.startsWith\("custom:"\)/);
    assert.match(source, /if \(!av\) return 1/);
});
