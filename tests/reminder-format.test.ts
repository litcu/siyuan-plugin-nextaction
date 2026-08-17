import test from "node:test";
import assert from "node:assert/strict";

import { parseReminderItems, serializeReminderItems } from "../src/frontend/utils/reminder-utils.ts";
import { validateTaskAttrs } from "../src/kernel/utils.ts";
import { ATTR_REMINDER } from "../src/shared/constants.ts";

test("结构化提醒支持空值、空数组和当前对象数组", () => {
    const items = [
        { type: "relative" as const, minutes: 60 },
        { type: "absolute" as const, time: "2026-08-18T09:30" },
    ];
    assert.deepEqual(parseReminderItems(""), []);
    assert.deepEqual(parseReminderItems("[]"), []);
    assert.deepEqual(parseReminderItems(serializeReminderItems(items)), items);
    assert.equal(validateTaskAttrs({ [ATTR_REMINDER]: JSON.stringify(items) }), null);
});

test("旧 enabled 和数字数组提醒不再被接受", () => {
    // Regression: legacy reminder sentinels and numeric offsets must not be migrated.
    assert.deepEqual(parseReminderItems("enabled"), []);
    assert.deepEqual(parseReminderItems("[60,1440]"), []);
    assert.match(validateTaskAttrs({ [ATTR_REMINDER]: "enabled" }) ?? "", /valid JSON/);
    assert.match(validateTaskAttrs({ [ATTR_REMINDER]: "[60,1440]" }) ?? "", /must be objects/);
});
