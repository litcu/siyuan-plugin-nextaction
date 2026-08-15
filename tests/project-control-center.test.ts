import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("项目控制中心提供总览、层级、看板和计划四种模式", () => {
    const view = source("../src/frontend/components/ProjectView.svelte");
    for (const mode of ["overview", "hierarchy", "board", "plan"]) assert.match(view, new RegExp(`value: \\\"${mode}\\\"`));
    assert.match(view, /buildProjectSummaries/);
    assert.match(view, /getProjectDateBucket/);
    assert.match(view, /NaTaskFilterBar/);
    assert.match(view, /NaTaskList/);
    assert.match(view, /NaToggle/);
    assert.match(view, /showCompleted/);
    assert.match(view, /matchesProjectFilters/);
    assert.match(view, /riskFilter/);
    assert.match(view, /dateFilter/);
    assert.match(view, /actionFilter/);
    assert.match(view, /rows: TreeRow\[\] = \[\{ task: summary\.project, depth: 0 \}\]/);
    assert.match(view, /visit\(summary\.project\.blockId, 1\)/);
    assert.match(view, /hasTreeChildren/);
    assert.match(view, /padding-left: \{row\.depth \* 18\}px/);
    assert.match(view, /for \(const parent of \[summary\.project, \.\.\.summary\.descendants\]\)/);
    assert.match(view, /buildTreeRows\(selectedSummary, collapsedIds\)/);
    assert.match(view, /!collapseState\.has\(summary\.project\.blockId\)/);
    assert.match(view, /connectedIds\.has\(task\.blockId\)/);
    assert.match(view, /onToggleCollapse=\{\(\) => toggleCollapse\(row\.task\.blockId\)\}/);
    assert.match(view, /isCollapsed=\{collapsedIds\.has\(row\.task\.blockId\)\}/);
});

test("项目视图窄屏筛选控件流式换行并与搜索区保持间距", () => {
    const view = source("../src/frontend/components/ProjectView.svelte");
    assert.match(view, /\.na-project-toolbar\s*\{[^}]*flex-wrap:\s*wrap;[^}]*gap:\s*8px 10px;[^}]*padding:\s*8px 12px;/);
    assert.doesNotMatch(view, /@container nextaction-app \(max-width:\s*780px\)[^{]*\{[^}]*\.na-project-toolbar\s*\{[^}]*flex-direction:\s*column/);
});

test("看板通过父组件回调进入统一任务写入链路", () => {
    const view = source("../src/frontend/components/ProjectView.svelte");
    const app = source("../src/frontend/components/NextActionApp.svelte");
    assert.match(view, /onTaskUpdate/);
    assert.match(view, /onTaskReorder/);
    assert.match(view, /draggable=\"true\"/);
    assert.match(app, /handleProjectTaskUpdate/);
    assert.match(app, /handleProjectTaskReorder/);
    assert.match(app, /onTaskUpdate=\{handleProjectTaskUpdate\}/);
    assert.match(app, /onTaskReorder=\{handleProjectTaskReorder\}/);
    assert.match(view, /group\.bucket !== \"unscheduled\"/);
});
