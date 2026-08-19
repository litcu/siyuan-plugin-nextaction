import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
    return readFileSync(path, "utf8");
}

test("cache discovery reuses SiYuan's configured SQL row limit until all tasks are loaded", () => {
    const cache = read("src/kernel/cache-manager.ts");
    assert.match(cache, /let lastBlockId = ""/);
    assert.match(cache, /const stmt = sql`SELECT \* FROM \(/);
    assert.match(cache, /WHERE \(\$\{lastBlockId\} = '' OR task\.id > \$\{lastBlockId\}\)/);
    assert.match(cache, /ORDER BY task\.id/);
    assert.doesNotMatch(cache, /TASK_DISCOVERY_PAGE_SIZE|OFFSET \$\{offset\}/);
    assert.match(cache, /rows\.push\(\.\.\.page\)/);
    assert.match(cache, /lastBlockId = nextBlockId/);
    assert.match(cache, /if \(!page \|\| page\.length === 0\) break/);
    assert.match(cache, /COUNT\(DISTINCT a\.block_id\)/);
    assert.match(cache, /INNER JOIN blocks b ON b\.id = a\.block_id/);
    assert.match(cache, /b\.type = 'd'/);
    assert.match(cache, /task\.type = 'i'/);
    assert.match(cache, /task\.subtype = 't'/);
    assert.match(cache, /task_list\.subtype = 't'/);
});

test("editor detail waits for a task and retries after rebuilding cache", () => {
    const source = read("src/frontend/controllers/editor-task-integration.ts");
    assert.match(source, /private async openTaskDetailDialog/);
    assert.match(source, /await this\.getBridge\(\)\.rebuildCache\(\)/);
    assert.match(source, /if \(!task\) \{[\s\S]*errTaskNotFound[\s\S]*return;/);
    assert.doesNotMatch(source, /new Dialog\([\s\S]{0,1500}this\.bridge\.getTask\(blockId\)\.then/);
});
