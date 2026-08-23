import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
    return readFileSync(path, "utf8");
}

test("cache discovery reuses SiYuan's configured SQL row limit until all tasks are loaded", () => {
    const cache = read("src/kernel/cache-manager.ts");
    const identities = read("src/kernel/task-identity-resolver.ts");
    assert.match(identities, /let lastBlockId = ""/);
    assert.match(identities, /const stmt = sql`WITH RECURSIVE native_tasks/);
    assert.match(identities, /WHERE \(\$\{lastBlockId\} = '' OR task\.id > \$\{lastBlockId\}\)/);
    assert.match(identities, /ORDER BY task\.id/);
    assert.doesNotMatch(identities, /TASK_DISCOVERY_PAGE_SIZE|OFFSET \$\{offset\}/);
    assert.match(identities, /rows\.push\(\.\.\.page\)/);
    assert.match(identities, /lastBlockId = nextBlockId/);
    assert.match(identities, /if \(!page\?\.length\) break/);
    assert.match(cache, /COUNT\(DISTINCT a\.block_id\)/);
    assert.match(cache, /INNER JOIN blocks b ON b\.id = a\.block_id/);
    assert.match(identities, /b\.type = 'd'/);
    assert.match(identities, /task\.type = 'i'/);
    assert.match(identities, /task\.subtype = 't'/);
    assert.match(identities, /task_list\.subtype = 't'/);
    assert.doesNotMatch(identities, /name\s*=\s*'custom-na-task'/);
});

test("editor detail waits for a task and retries after rebuilding cache", () => {
    const source = read("src/frontend/controllers/editor-task-integration.ts");
    assert.match(source, /private async openTaskDetailDialog/);
    assert.match(source, /await this\.getBridge\(\)\.rebuildCache\(\)/);
    assert.match(source, /if \(!task\) \{[\s\S]*errTaskNotFound[\s\S]*return;/);
    assert.doesNotMatch(source, /new Dialog\([\s\S]{0,1500}this\.bridge\.getTask\(blockId\)\.then/);
});
