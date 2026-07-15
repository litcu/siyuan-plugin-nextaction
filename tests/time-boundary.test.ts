import test from "node:test";
import assert from "node:assert/strict";

import {
    findNextTimeBoundary,
    formatDueDate,
    getDuePresentation,
    getNextDueBoundary,
    getNextLocalMidnight,
} from "../src/frontend/utils/time-boundary.ts";

function localTime(year: number, month: number, day: number, hour = 0, minute = 0): number {
    return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

test("具体截止时间跨过后立即变为今日已逾期", () => {
    const due = "2026-07-15T19:00";
    const before = getDuePresentation(due, localTime(2026, 7, 15, 18, 59));
    const after = getDuePresentation(due, localTime(2026, 7, 15, 19, 20));

    assert.equal(before.isOverdue, false);
    assert.equal(before.isDueSoon, true);
    assert.equal(after.isOverdue, true);
    assert.equal(formatDueDate(due, localTime(2026, 7, 15, 18, 59), { dueToday: "今日到期" }), "今日到期 19:00");
    assert.equal(formatDueDate(due, localTime(2026, 7, 15, 19, 20), { overdueToday: "今日已逾期" }), "今日已逾期 19:00");
});

test("纯日期截止日在当天结束前不算逾期", () => {
    const due = "2026-07-15";

    assert.equal(getDuePresentation(due, localTime(2026, 7, 15, 23, 59)).isOverdue, false);
    assert.equal(getDuePresentation(due, localTime(2026, 7, 16, 0, 0)).isOverdue, true);
});

test("截止时间是最近边界时按截止时间唤醒", () => {
    const now = localTime(2026, 7, 15, 18, 0);
    const due = "2026-07-15T19:00";

    assert.equal(getNextDueBoundary(due, now), localTime(2026, 7, 15, 19, 0));
    assert.equal(findNextTimeBoundary([due], now), localTime(2026, 7, 15, 19, 0));
});

test("未来日期文案会优先在本地午夜更新", () => {
    const now = localTime(2026, 7, 15, 20, 0);
    const due = "2026-07-16T10:00";

    assert.equal(getNextLocalMidnight(now), localTime(2026, 7, 16, 0, 0));
    assert.equal(findNextTimeBoundary([due], now), localTime(2026, 7, 16, 0, 0));
});

test("三天内到期样式在边界时更新", () => {
    const due = "2026-07-20T12:00";
    const boundary = localTime(2026, 7, 17, 12, 0);

    assert.equal(getNextDueBoundary(due, localTime(2026, 7, 17, 11, 0)), boundary);
    assert.equal(getDuePresentation(due, boundary - 1).isDueSoon, false);
    assert.equal(getDuePresentation(due, boundary).isDueSoon, true);
});

test("已逾期的具体时间在每满一天时更新逾期天数", () => {
    const due = "2026-07-15T19:00";
    const now = localTime(2026, 7, 16, 15, 0);

    assert.equal(getNextDueBoundary(due, now), localTime(2026, 7, 16, 19, 0));
});
