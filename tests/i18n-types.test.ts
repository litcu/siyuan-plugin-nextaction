import test from "node:test";
import assert from "node:assert/strict";
import en from "../src/i18n/en.json";
import type { I18nStrings } from "../src/shared/i18n";
import {
    customFieldTypeI18nKey,
    priorityI18nKey,
    projectPlanI18nKey,
    projectRiskI18nKey,
    reminderSoundI18nKey,
    statusI18nKey,
    translateKey,
} from "../src/frontend/i18n";

const i18n = en as I18nStrings;

test("动态状态、风险、日期和设置键通过受约束映射访问", () => {
    assert.equal(statusI18nKey("doing"), "statusDoing");
    assert.equal(priorityI18nKey("veryLow"), "priorityVeryLow");
    assert.equal(projectRiskI18nKey("noNextAction"), "projectRiskNoNextAction");
    assert.equal(projectPlanI18nKey("thisWeek"), "projectPlanThisWeek");
    assert.equal(reminderSoundI18nKey("gentle"), "reminderSoundGentle");
    assert.equal(customFieldTypeI18nKey("multiSelect"), "customFieldTypeMultiSelect");
});

test("未知动态状态不会逃逸为任意翻译键", () => {
    assert.equal(statusI18nKey("unknown"), undefined);
    assert.equal(translateKey(i18n, statusI18nKey("unknown"), "unknown"), "unknown");
    assert.equal(translateKey(i18n, statusI18nKey("done"), "done"), en.statusDone);
});
