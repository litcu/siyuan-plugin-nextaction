import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const taskDetail = readFileSync(new URL("../src/frontend/components/TaskDetail.svelte", import.meta.url), "utf8");
const customFieldInput = readFileSync(new URL("../src/frontend/ui/NaCustomFieldInput.svelte", import.meta.url), "utf8");
const pluginEntry = readFileSync(new URL("../src/frontend/controllers/frontend-runtime.ts", import.meta.url), "utf8");
const zh = JSON.parse(readFileSync(new URL("../src/i18n/zh-CN.json", import.meta.url), "utf8"));
const en = JSON.parse(readFileSync(new URL("../src/i18n/en.json", import.meta.url), "utf8"));

test("插件启动和内核重连时先加载自定义字段设置再加载任务", () => {
    const loader = pluginEntry.match(/private async loadTaskStoreState\(\): Promise<void> \{([\s\S]*?)\n    \}/)?.[1] || "";
    const settingsIndex = loader.indexOf("await taskStore.loadSettings()");
    const tasksIndex = loader.indexOf("await taskStore.loadTasks()");

    assert.ok(settingsIndex >= 0, "统一初始化入口应加载持久化设置");
    assert.ok(tasksIndex > settingsIndex, "任务加载必须发生在设置加载之后");
    assert.match(pluginEntry, /kernelStateHandler[\s\S]*?await this\.loadTaskStoreState\(\)/);
    assert.match(pluginEntry, /eventBus\.on\("kernel-plugin-state-change", this\.kernelStateHandler\)/);
    assert.match(pluginEntry, /void this\.loadTaskStoreState\(\)/);
});

test("单选字段复用可翻转的搜索选择器，而不是原生 select", () => {
    const singleSelectBranch = customFieldInput.match(/\{:else if def\.type === "singleSelect"\}([\s\S]*?)\{:else if def\.type === "multiSelect"\}/)?.[1] || "";
    assert.match(singleSelectBranch, /<NaSearchSelect[\s\S]*?multi=\{false\}/);
    assert.doesNotMatch(singleSelectBranch, /<select/);
    assert.match(singleSelectBranch, /\{fixedDropdown\}/);
});

test("自定义字段新增文案均提供中英文翻译", () => {
    const keys = [
        "customFieldKeyLabel",
        "customFieldProjectIds",
        "customFieldArchivedOptionSuffix",
        "customFieldPurgePartial",
        "customFieldPurgeSuccess",
        "customFieldInvalidNumber",
        "customFieldInvalidDate",
        "customFieldInvalidDatetime",
        "customFieldInvalidSelection",
        "customFieldTextTooLong",
        "customFieldTextareaTooLong",
        "customFieldInvalidValue",
        "customFieldBooleanYes",
        "customFieldBooleanNo",
    ];
    for (const key of keys) {
        assert.equal(typeof zh[key], "string", `zh-CN missing ${key}`);
        assert.equal(typeof en[key], "string", `en missing ${key}`);
        assert.ok(zh[key].length > 0, `zh-CN empty ${key}`);
        assert.ok(en[key].length > 0, `en empty ${key}`);
    }
});

test("布尔自定义字段使用独立的国际化是/否文案", () => {
    assert.match(customFieldInput, /i18n\?\.customFieldBooleanYes/);
    assert.match(customFieldInput, /i18n\?\.customFieldBooleanNo/);
});
