import test from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createWorkspaceSession } from "../src/frontend/controllers/workspace-session.ts";
import { DEFAULT_FILTER_STATE } from "../src/frontend/utils/filter.ts";

test("工作区独立保存导航与筛选，返回恢复来源视图", () => {
    // Regression: Dock 与完整面板共享筛选状态，移动端完整入口重新挂载后丢失浏览位置。
    const phone = createWorkspaceSession();
    const desktop = createWorkspaceSession();
    phone.openCatalog();
    phone.openView("byProject");
    phone.setFilterState("byProject", { ...DEFAULT_FILTER_STATE, searchText: "季度" });
    assert.equal(get(phone).activeView, "byProject");
    assert.equal(get(desktop).activeView, "nextAction");
    assert.equal(get(desktop).filterByView.byProject?.searchText ?? "", "");
    phone.back();
    assert.equal(get(phone).catalog, true);
    phone.openView("review");
    phone.openView("byProject", true);
    phone.back();
    assert.equal(get(phone).activeView, "review");
    assert.equal(get(phone).filterByView.byProject.searchText, "季度");
});
