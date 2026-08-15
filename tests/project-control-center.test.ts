import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("项目控制中心提供总览、层级、看板、计划和甘特五种模式", () => {
    const view = source("../src/frontend/components/ProjectView.svelte");
    for (const mode of ["overview", "hierarchy", "board", "plan", "gantt"]) assert.match(view, new RegExp(`value: \\\"${mode}\\\"`));
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
    assert.match(view, /buildProjectTreeModel/);
    assert.match(view, /GanttView/);
    assert.match(view, /selectedTaskOverride/);
    assert.match(view, /projectSourceTasks/);
    assert.match(view, /reconcileProjectTasks\(\$taskStore\.allTasks, selectedTaskOverride\)/);
    assert.match(view, /task\.blockId === override\.blockId/);
    assert.match(view, /buildProjectSummaries\(projectSourceTasks\)/);
    assert.match(source("../src/frontend/components/NextActionApp.svelte"), /selectedTaskOverride=\{selectedTask\}/);
    assert.match(view, /projectTreeModel\?\.rows/);
    assert.match(view, /padding-left: \{row\.depth \* 18\}px/);
    assert.match(view, /matchedTaskIds/);
    assert.match(view, /selectedMatchedTaskIds/);
    assert.match(view, /onToggleCollapse=\{\(\) => toggleCollapse\(row\.task\.blockId\)\}/);
    assert.match(view, /isCollapsed=\{collapsedIds\.has\(row\.task\.blockId\)\}/);
});

test("项目视图窄屏筛选控件流式换行并与搜索区保持间距", () => {
    const view = source("../src/frontend/components/ProjectView.svelte");
    assert.match(view, /\.na-project-toolbar\s*\{[^}]*flex-wrap:\s*wrap;[^}]*gap:\s*8px 10px;[^}]*padding:\s*8px 12px;/);
    assert.doesNotMatch(view, /@container nextaction-app \(max-width:\s*780px\)[^{]*\{[^}]*\.na-project-toolbar\s*\{[^}]*flex-direction:\s*column/);
});

test("甘特视图使用单滚动账本、冻结纲要和可访问任务操作", () => {
    const gantt = source("../src/frontend/components/GanttView.svelte");
    const bar = source("../src/frontend/components/GanttBar.svelte");
    assert.match(gantt, /class="na-gantt__viewport"/);
    assert.match(gantt, /position:\s*sticky;/);
    assert.match(gantt, /calculateGanttEdges/);
    assert.match(gantt, /scheduledTaskIds/);
    assert.match(gantt, /ganttUnscheduled/);
    assert.match(gantt, /ganttAddDates/);
    assert.match(gantt, /onClick: \(\) => onEdit\(firstUnscheduledTask\)/);
    assert.match(gantt, /path\.sequential/);
    assert.match(gantt, /@container nextaction-app \(max-width: 520px\)/);
    assert.match(gantt, /--na-gantt-outline-width: 248px/);
    assert.match(gantt, /ganttScaleWeek/);
    assert.match(gantt, /ganttSortTimeline/);
    assert.match(gantt, /NaSegmentControl/);
    assert.match(gantt, /contentHeight = rowsHeight \+ 56/);
    assert.match(gantt, /na-gantt__bar-row--summary/);
    assert.doesNotMatch(gantt, /scrollTop/);
    assert.match(bar, /NaTooltip/);
    assert.match(bar, /aria-pressed=\{selected\}/);
    assert.match(bar, /:focus-visible/);
    assert.match(bar, /showOutsideLabel/);
    assert.match(bar, /na-gantt-bar-anchor--rollup/);
    assert.match(bar, /na-gantt-bar__target/);
    assert.match(bar, /na-gantt-bar-anchor--clarify/);
    assert.doesNotMatch(bar, /draggable=/);
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

test("项目入口与共享详情按条目类型使用项目语义", () => {
    const view = source("../src/frontend/components/ProjectView.svelte");
    const detail = source("../src/frontend/components/TaskDetail.svelte");
    const contextMenu = source("../src/frontend/components/task-context-menu.ts");
    const aiService = source("../src/frontend/ai/ai-feature-service.ts");
    const filterBar = source("../src/frontend/ui/NaTaskFilterBar.svelte");
    const plugin = source("../src/index.ts");

    assert.match(view, /i18n\?\.editProject/);
    assert.match(view, /i18n\?\.aiDecomposeProject/);
    assert.match(view, /searchPlaceholder=\{i18n\?\.searchProjectsAndTasks/);
    assert.match(filterBar, /export let searchPlaceholder = \"\"/);
    assert.match(detail, /\$: isProject = taskType === \"2\"/);
    assert.match(detail, /i18n\?\.projectRelations/);
    assert.match(detail, /i18n\?\.parentItem/);
    assert.match(contextMenu, /const isProject = task\.taskType === \"2\"/);
    assert.match(contextMenu, /i18n\?\.projectProperties/);
    assert.match(contextMenu, /i18n\?\.removeProject/);
    assert.match(aiService, /task\.taskType === \"2\"/);
    assert.match(aiService, /i18n\?\.aiDecomposeProject/);
    assert.match(plugin, /custom-na-task'\) === '2'/);
    assert.match(plugin, /const isProjectBlock = taskBlock/);
    assert.match(plugin, /this\.i18n\.projectProperties/);
    assert.match(plugin, /this\.i18n\.removeProject/);
});
