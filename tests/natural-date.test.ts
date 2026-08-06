import test from "node:test";
import assert from "node:assert/strict";
import { parseNaturalDate, parseNaturalDates, parseTaskTitleDates } from "../src/shared/natural-date.ts";

const reference = new Date(2026, 7, 6, 10, 0);

test("解析中文相对日期、星期、月末和时间", () => {
    assert.equal(parseNaturalDate("下周一", { referenceDate: reference })?.value, "2026-08-10");
    assert.equal(parseNaturalDate("三天后", { referenceDate: reference })?.value, "2026-08-09");
    assert.equal(parseNaturalDate("月底", { referenceDate: reference })?.value, "2026-08-31");
    assert.equal(parseNaturalDate("下月底", { referenceDate: reference })?.value, "2026-09-30");
    assert.equal(parseNaturalDate("明天下午三点", { referenceDate: reference })?.value, "2026-08-07T15:00");
    assert.equal(parseNaturalDate("这周六去爬山。", { referenceDate: reference })?.value, "2026-08-08");
});

test("思源运行时缺少正则命名捕获组时仍可解析中文星期", () => {
    const originalExec = RegExp.prototype.exec;
    RegExp.prototype.exec = function (value: string): RegExpExecArray | null {
        const match = originalExec.call(this, value);
        if (match && this.source.includes("(?<weekday>")) match.groups = undefined;
        return match;
    };
    try {
        assert.equal(parseNaturalDate("这周六去爬山。", { referenceDate: reference })?.value, "2026-08-08");
        assert.equal(parseNaturalDate("周六", { referenceDate: reference })?.value, "2026-08-08");
    } finally {
        RegExp.prototype.exec = originalExec;
    }
});

test("解析英文相对日期、月末和时间", () => {
    assert.equal(parseNaturalDate("next Monday", { referenceDate: reference })?.value, "2026-08-10");
    assert.equal(parseNaturalDate("in three days", { referenceDate: reference })?.value, "2026-08-09");
    assert.equal(parseNaturalDate("end of month", { referenceDate: reference })?.value, "2026-08-31");
    assert.equal(parseNaturalDate("tomorrow 3pm", { referenceDate: reference })?.value, "2026-08-07T15:00");
});

test("相邻的中英文日期与时间可以组成同一个结果", () => {
    assert.equal(parseNaturalDate("明天 3pm", { referenceDate: reference })?.value, "2026-08-07T15:00");
    assert.equal(parseNaturalDate("tomorrow 下午三点", { referenceDate: reference })?.value, "2026-08-07T15:00");
    assert.equal(parseNaturalDate("三天后的下午四点", { referenceDate: reference })?.value, "2026-08-09T16:00");
});

test("强制时间控件使用默认时间，无效或多个日期不猜测", () => {
    assert.equal(parseNaturalDate("明天", { referenceDate: reference, requireTime: true, defaultTime: "09:30" })?.value, "2026-08-07T09:30");
    assert.equal(parseNaturalDate("不是日期", { referenceDate: reference }), null);
    assert.equal(parseNaturalDate("明天或后天", { referenceDate: reference }), null);
    assert.equal(parseNaturalDates("明天或后天", { referenceDate: reference }).length, 2);
});

test("任务标题映射开始与截止日期并让后续星期跟随开始日期", () => {
    const pair = parseTaskTitleDates("下周一开始、周五截止", reference);
    assert.equal(pair.start?.value, "2026-08-10");
    assert.equal(pair.due?.value, "2026-08-14");

    const english = parseTaskTitleDates("start next Monday, due Friday", reference);
    assert.equal(english.start?.value, "2026-08-10");
    assert.equal(english.due?.value, "2026-08-14");
});

test("单个无角色日期默认为截止日期，歧义和非法范围不写入", () => {
    assert.equal(parseTaskTitleDates("提交报告 下周一", reference).due?.value, "2026-08-10");
    assert.deepEqual(parseTaskTitleDates("明天讨论，后天确认", reference), {});
    assert.deepEqual(parseTaskTitleDates("2026年8月10日开始，2026年8月7日截止", reference), {});
});

test("月末规则正确处理跨年和闰年", () => {
    assert.equal(parseNaturalDate("下月底", { referenceDate: new Date(2026, 11, 20) })?.value, "2027-01-31");
    assert.equal(parseNaturalDate("月底", { referenceDate: new Date(2028, 1, 3) })?.value, "2028-02-29");
});
