import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const taskServiceSource = readFileSync(new URL("../src/kernel/task-lifecycle-service.ts", import.meta.url), "utf8");
const datePickerSource = readFileSync(new URL("../src/frontend/ui/NaDatePicker.svelte", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/shared/settings.ts", import.meta.url), "utf8");

test("语义日期设置默认开启并支持安全合并和校验", () => {
    assert.match(settingsSource, /semanticDateParsingEnabled:\s*true/);
    assert.match(
        settingsSource,
        /semanticDateParsingEnabled: override\.semanticDateParsingEnabled \?\? base\.semanticDateParsingEnabled/,
    );
    assert.match(settingsSource, /semanticDateParsingEnabled must be boolean/);
});

test("单个和递归转换都通过共享解析器且只填充空日期", () => {
    assert.match(taskServiceSource, /parseTaskTitleDates\(title, new Date\(\)\)/);
    assert.match(taskServiceSource, /parseTaskTitleDates\(effectiveTitle, semanticDateReference\)/);
    assert.match(taskServiceSource, /!existingAttrs\[ATTR_START\] && parsedDates\.start/);
    assert.match(taskServiceSource, /!existingAttrs\[ATTR_DUE\] && parsedDates\.due/);
    assert.match(taskServiceSource, /!attrs\?\.\[ATTR_START\] && parsedDates\.start/);
    assert.match(taskServiceSource, /!attrs\?\.\[ATTR_DUE\] && parsedDates\.due/);
    assert.match(taskServiceSource, /this\.settings\.semanticDateParsingEnabled/);
    assert.match(taskServiceSource, /if \(attrs && attrs\[ATTR_TASK\]/);
});

test("日期输入框支持回车/失焦解析，并在无效时保留输入", () => {
    assert.match(datePickerSource, /import \{ parseNaturalDate \} from "\.\.\/\.\.\/shared\/natural-date"/);
    assert.match(datePickerSource, /on:blur=\{handleInputBlur\}/);
    assert.match(datePickerSource, /on:keydown=\{handleInputKeydown\}/);
    assert.match(datePickerSource, /parseNaturalDate\(raw, \{ requireTime, defaultTime \}\)/);
    assert.match(datePickerSource, /inputError = i18n\?\.dpNaturalDateInvalid/);
    assert.match(datePickerSource, /aria-invalid=\{inputError \? "true" : "false"\}/);
    assert.match(datePickerSource, /if \(!parsed\)/);
    assert.match(datePickerSource, /\.na-date-picker__control \.na-date-picker__input:focus-visible/);
    assert.match(datePickerSource, /overflow: hidden/);
});
