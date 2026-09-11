import test from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createWorkspaceCompleted } from "../src/frontend/controllers/workspace-completed.ts";

test("已完成分页和排序在工作区之间隔离，刷新保留当前位置", async () => {
    // Regression: 共享任务 store 的分页状态会使一个面板翻页改变另一面板。
    const requests: Array<{ page: number; sortBy: string }> = [];
    const load = async (request: { page: number; pageSize: number; sortBy: string; sortAsc: boolean }) => {
        requests.push(request);
        return { items: [], page: request.page, pageSize: request.pageSize, total: 100, hasMore: true };
    };
    const first = createWorkspaceCompleted(load);
    const second = createWorkspaceCompleted(load);
    await first.toggleCompleted();
    await first.setCompletedSort("due", true);
    await first.setCompletedPage(2);
    await second.toggleCompleted();
    assert.equal(get(first).completedPage, 2);
    assert.equal(get(second).completedPage, 1);
    assert.equal(get(second).completedSortBy, "completed");
    await first.refresh();
    assert.deepEqual(requests[requests.length - 1], { page: 2, pageSize: 50, sortBy: "due", sortAsc: true });
    first.dispose();
    second.dispose();
});
