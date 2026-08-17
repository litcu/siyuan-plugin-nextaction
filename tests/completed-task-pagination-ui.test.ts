import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
    return readFileSync(path, "utf8");
}

test("completed task pagination is wired through RPC and bridge", () => {
    const rpc = read("src/kernel/rpc-server.ts");
    const bridge = read("src/frontend/kernel-bridge.ts");
    const store = read("src/frontend/stores/task-store.ts");
    const view = read("src/frontend/components/AllTasksView.svelte");

    assert.match(rpc, /getCompletedTasksPage:\s*\(params\)\s*=>/);
    assert.match(rpc, /for \(const method of RPC_METHOD_NAMES\)/);
    assert.match(bridge, /getCompletedTasksPage\(/);
    assert.match(store, /completedLoadSeq/);
    assert.match(store, /completedPageSize/);
    assert.match(view, /completedPageNumbers/);
    assert.match(view, /setCompletedSort/);
    assert.match(view, /setCompletedPage/);
    assert.match(view, /class="na-completed-tasks"/);
    assert.match(view, /\.na-completed-tasks\s*\{\s*flex: 0 0 auto;/);
    const styles = read("src/frontend/styles/components.scss");
    assert.match(styles, /\.na-all-tasks__item \{[\s\S]*?flex: 0 0 auto;/);
    assert.doesNotMatch(styles, /\.na-all-tasks__item \{[\s\S]*?content-visibility:/);
});
