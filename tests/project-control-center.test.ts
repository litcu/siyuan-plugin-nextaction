import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("项目控制中心提供总览、层级、看板、计划和甘特五种模式", () => {
    const view = source("../src/frontend/components/ProjectView.svelte");
    const state = source("../src/frontend/utils/project-view-state.ts");
    const overview = source("../src/frontend/components/project/ProjectOverviewMode.svelte");
    const hierarchy = source("../src/frontend/components/project/ProjectHierarchyMode.svelte");
    for (const mode of ["overview", "hierarchy", "board", "plan", "gantt"])
        assert.match(view, new RegExp(`value: \\\"${mode}\\\"`));
    assert.match(view, /buildProjectViewModel/);
    assert.match(state, /getProjectDateBucket/);
    assert.match(view, /NaTaskFilterBar/);
    assert.match(overview, /NaTaskList/);
    assert.match(view, /NaToggle/);
    assert.match(view, /showCompleted/);
    assert.match(state, /matchesProjectFilters/);
    assert.match(view, /riskFilter/);
    assert.match(view, /dateFilter/);
    assert.match(view, /actionFilter/);
    assert.match(state, /buildProjectTreeModel/);
    assert.match(view, /GanttView/);
    assert.match(view, /selectedTaskOverride/);
    assert.match(source("../src/frontend/components/NextActionApp.svelte"), /selectedTaskOverride=\{selectedTask\}/);
    assert.match(hierarchy, /model\.rows/);
    assert.match(hierarchy, /padding-left: \{row\.depth \* 18\}px/);
    assert.match(state, /matchedTaskIds/);
    assert.match(state, /selectedMatchedTaskIds/);
    assert.match(hierarchy, /onToggleCollapse\(row\.task\.blockId\)/);
    assert.match(hierarchy, /isCollapsed=\{collapsedIds\.has\(row\.task\.blockId\)\}/);
});

test("项目视图窄屏筛选控件流式换行并与搜索区保持间距", () => {
    const view = source("../src/frontend/components/ProjectView.svelte");
    assert.match(
        view,
        /\.na-project-toolbar\s*\{[^}]*flex-wrap:\s*wrap;[^}]*gap:\s*8px 10px;[^}]*padding:\s*8px 12px;/,
    );
    assert.doesNotMatch(
        view,
        /@container nextaction-app \(max-width:\s*780px\)[^{]*\{[^}]*\.na-project-toolbar\s*\{[^}]*flex-direction:\s*column/,
    );
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
    const board = source("../src/frontend/components/project/ProjectBoardMode.svelte");
    const plan = source("../src/frontend/components/project/ProjectPlanMode.svelte");
    const app = source("../src/frontend/components/NextActionApp.svelte");
    assert.match(view, /onTaskUpdate/);
    assert.match(view, /onTaskReorder/);
    assert.match(board, /draggable=\{!busy\}/);
    assert.match(board, /onMoveTask\(\{ task: draggingTask, status, afterId:/);
    assert.match(app, /handleProjectTaskUpdate/);
    assert.match(app, /handleProjectTaskReorder/);
    assert.match(app, /onTaskUpdate=\{handleProjectTaskUpdate\}/);
    assert.match(app, /onTaskReorder=\{handleProjectTaskReorder\}/);
    assert.match(plan, /group\.bucket !== "unscheduled"/);
    assert.doesNotMatch(board, /KernelBridge|bridge\.updateTask|bridge\.reorderTask/);
});

test("项目入口与共享详情按条目类型使用项目语义", () => {
    const view = source("../src/frontend/components/ProjectView.svelte");
    const detail = source("../src/frontend/components/TaskDetail.svelte");
    const contextMenu = source("../src/frontend/components/task-context-menu.ts");
    const aiService = source("../src/frontend/ai/ai-feature-service.ts");
    const filterBar = source("../src/frontend/ui/NaTaskFilterBar.svelte");
    const plugin = source("../src/frontend/controllers/editor-task-integration.ts");

    assert.match(view, /i18n\?\.editProject/);
    assert.match(view, /i18n\?\.aiDecomposeProject/);
    assert.match(view, /searchPlaceholder=\{i18n\?\.searchProjectsAndTasks/);
    assert.match(filterBar, /export let searchPlaceholder = \"\"/);
    assert.match(
        detail,
        /\$: isProject = isProjectTask\(\{ identificationSource: task\.identificationSource, taskType \}\)/,
    );
    assert.match(detail, /i18n\?\.projectRelations/);
    assert.match(detail, /i18n\?\.parentItem/);
    assert.match(contextMenu, /const isProject = isProjectTask\(task\)/);
    assert.match(contextMenu, /i18n\?\.projectProperties/);
    assert.match(contextMenu, /i18n\?\.removeProject/);
    assert.match(aiService, /isProjectTask\(task\)/);
    assert.match(aiService, /i18n\?\.aiDecomposeProject/);
    assert.doesNotMatch(plugin, /getAttribute\(["']custom-na-task["']\) === ["']2["']/);
    assert.match(plugin, /const isProjectBlock = !!resolvedTaskEntry && isProjectTask\(resolvedTaskEntry\)/);
    assert.match(plugin, /this\.plugin\.i18n\.projectProperties/);
    assert.match(plugin, /this\.plugin\.i18n\.removeProject/);
});
