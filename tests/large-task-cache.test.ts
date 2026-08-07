import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
    return readFileSync(path, "utf8");
}

test("cache discovery reuses SiYuan's configured SQL row limit until all tasks are loaded", () => {
    const cache = read("src/kernel/cache-manager.ts");
    assert.match(cache, /let lastBlockId = ""/);
    assert.match(cache, /cursorCondition = lastBlockId \? ` AND b\.id > /);
    assert.match(cache, /ORDER BY b\.id/);
    assert.doesNotMatch(cache, /TASK_DISCOVERY_PAGE_SIZE|OFFSET \$\{offset\}/);
    assert.match(cache, /rows\.push\(\.\.\.page\)/);
    assert.match(cache, /lastBlockId = nextBlockId/);
    assert.match(cache, /if \(!page \|\| page\.length === 0\) break/);
    assert.match(cache, /COUNT\(DISTINCT block_id\)/);
});

test("editor detail waits for a task and retries after rebuilding cache", () => {
    const source = read("src/index.ts");
    assert.match(source, /private async openTaskDetailDialog/);
    assert.match(source, /await this\.bridge\.rebuildCache\(\)/);
    assert.match(source, /if \(!task\) \{[\s\S]*errTaskNotFound[\s\S]*return;/);
    assert.doesNotMatch(source, /new Dialog\([\s\S]{0,1500}this\.bridge\.getTask\(blockId\)\.then/);
});
