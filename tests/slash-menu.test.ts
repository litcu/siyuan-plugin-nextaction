import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

test("slash command cleanup uses SiYuan's update transaction path", () => {
    assert.match(source, /private async clearSlashCommand\(protyle: any, nodeElement: HTMLElement\): Promise<string>/);
    assert.match(source, /const oldHTML = nodeElement\.outerHTML/);
    assert.match(source, /nodeElement\.setAttribute\("data-editing", "true"\)/);
    assert.match(source, /protyle\.transaction\(\[\{[\s\S]*action: "update"/);
    assert.match(source, /data: oldHTML/);
    assert.match(source, /waitForSlashCommandPersistence\(blockId, slashCommand\)/);
});

test("AI extraction slash callback uses the persisted cleanup helper", () => {
    assert.match(source, /id: "aiExtractTasks",[\s\S]*?this\.clearSlashCommand\(protyle, nodeElement\);[\s\S]*?runAiExtractTasks\(\[blockId\]\)/);
});

test("slash menu supports semantic and legacy task triggers", () => {
    assert.match(source, /filter:\s*\[this\.i18n\.convertToTask,\s*"convert to task",\s*"ntask",\s*"zrw"\]/);
});

test("slash menu supports semantic and legacy project triggers", () => {
    assert.match(source, /filter:\s*\[this\.i18n\.convertToProject,\s*"convert to project",\s*"nproject",\s*"zxm"\]/);
});

test("slash menu supports semantic and legacy subtree task triggers", () => {
    assert.match(source, /filter:\s*\[this\.i18n\.convertToTaskWithChildren,\s*"convert to task with children",\s*"ntaskchildren",\s*"zrwz"\]/);
});
