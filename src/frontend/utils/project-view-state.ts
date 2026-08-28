import type { CustomFieldDef } from "../../shared/settings";
import type {
    ProjectControlProject,
    ProjectControlRisk,
    ProjectControlState,
    ProjectRisk,
    ProjectSummary,
    TaskCacheEntry,
} from "../../shared/types";
import { ATTR_IMPORTANCE, ATTR_PRIORITY, ATTR_STATUS } from "../../shared/constants";
import { isProjectBoardTask, type ProjectBoardGroupBy } from "../../shared/project-board";
import { applyFilters, hasActiveTaskFilters, sortTasksBy, type FilterState } from "./filter";
import { sortProjectBoardTasks } from "./project-board-sort";
import { getProjectDateBucket, isProjectTask, type ProjectDateBucket } from "../../shared/project-domain";
import { buildProjectControlState } from "../../shared/project-control";
import { buildProjectTreeModel, type ProjectTreeModel, type ProjectTreeSortMode } from "./project-tree";
import type { ProjectBoardSortBy } from "../../shared/project-board-preferences";
import type { ProjectBoardMoveInput, ProjectBoardMoveResult } from "../../shared/project-board-move";

export type ProjectViewMode = "overview" | "hierarchy" | "board" | "plan" | "gantt";
export type ProjectRiskFilter = "all" | "attention" | "blocked";
export type ProjectDateFilter = "all" | "overdue" | "week";
export type ProjectActionFilter = "all" | "missing" | "available";

export interface ProjectBoardMoveIntent {
    task: TaskCacheEntry;
    status: string;
    groupBy?: ProjectBoardGroupBy;
    value?: string | number;
    afterId?: string;
    afterParentId?: string;
    sortBy?: ProjectBoardSortBy;
    visibleTaskIds?: string[];
}

export interface ProjectBoardMoveHandlers {
    updateTask?: (task: TaskCacheEntry, attrs: Record<string, string>) => Promise<unknown>;
    reorderTask?: (blockId: string, parentId: string, afterId?: string) => Promise<void>;
    moveProjectBoardTask?: (input: ProjectBoardMoveInput) => Promise<ProjectBoardMoveResult>;
}

export async function executeProjectBoardMove(
    intent: ProjectBoardMoveIntent,
    projectId: string,
    handlers: ProjectBoardMoveHandlers,
): Promise<void> {
    const groupBy = intent.groupBy || "status";
    const targetValue = intent.value ?? intent.status;
    const attrs: Record<string, string> = {};
    const manualOrder = !intent.sortBy || intent.sortBy === "order";
    if (groupBy === "status" && intent.task.status !== targetValue) {
        attrs[ATTR_STATUS] = String(targetValue);
    } else if (groupBy === "priority" && intent.task.priority !== targetValue) {
        attrs[ATTR_PRIORITY] = String(targetValue);
    } else if (groupBy === "importance" && intent.task.importance !== targetValue) {
        attrs[ATTR_IMPORTANCE] = String(targetValue);
    }
    if (handlers.moveProjectBoardTask && manualOrder) {
        await handlers.moveProjectBoardTask({
            taskId: intent.task.blockId,
            projectId,
            groupBy,
            value: targetValue,
            afterId: intent.afterId,
            afterParentId: intent.afterParentId,
            visibleTaskIds: intent.visibleTaskIds,
        });
        return;
    }
    if (Object.keys(attrs).length > 0 && handlers.updateTask) {
        await handlers.updateTask(intent.task, attrs);
    }
    const sameParentTarget = !intent.afterParentId || intent.afterParentId === (intent.task.parentId || projectId);
    if (handlers.reorderTask && manualOrder && (groupBy !== "stage" || (intent.afterId && sameParentTarget))) {
        await handlers.reorderTask(intent.task.blockId, intent.task.parentId || projectId, intent.afterId);
    }
}

export async function confirmProjectCompletion(
    summary: ProjectSummary,
    updateTask: (task: TaskCacheEntry, attrs: Record<string, string>) => Promise<unknown>,
): Promise<void> {
    if (!shouldShowProjectCompletionPanel(summary)) {
        throw new Error("Project is not ready for completion confirmation");
    }
    await updateTask(summary.project, { [ATTR_STATUS]: "done" });
}

export function shouldShowProjectCompletionPanel(summary: ProjectSummary): boolean {
    if (summary.project.status === "done") return false;
    return summary.completionCandidate || (summary.empty && ["todo", "doing"].includes(summary.project.status));
}

export function shouldOfferProjectRiskAction(risk: Pick<ProjectRisk, "kind">): boolean {
    return risk.kind === "noNextAction";
}

export interface ProjectViewState {
    mode: ProjectViewMode;
    activeProjectId: string;
    filterBypassProjectId: string;
    selectedTaskId: string;
    selectedTaskOverride: TaskCacheEntry | null;
    preferActiveProject: boolean;
    showCompleted: boolean;
    riskFilter: ProjectRiskFilter;
    dateFilter: ProjectDateFilter;
    actionFilter: ProjectActionFilter;
    filterState: FilterState;
    collapsedIds?: ReadonlySet<string>;
    collapsedByProject?: Readonly<Record<string, readonly string[]>>;
    ganttSortMode: ProjectTreeSortMode;
    startPreviewDays: number;
}

export interface ProjectViewModel {
    sourceTasks: TaskCacheEntry[];
    summaries: ProjectSummary[];
    visibleSummaries: ProjectSummary[];
    activeProjectId: string;
    selectedProject: ProjectControlProject | null;
    selectedSummary: ProjectSummary | null;
    matchedTaskIds: ReadonlySet<string>;
    taskFiltersActive: boolean;
    projectTreeModel: ProjectTreeModel | null;
    detailTasks: TaskCacheEntry[];
    boardTasks: TaskCacheEntry[];
    planGroups: Array<{ bucket: ProjectDateBucket; tasks: TaskCacheEntry[] }>;
    riskItems: Array<{ summary: ProjectSummary; risk: ProjectControlRisk }>;
    metrics: {
        activeProjects: number;
        attention: number;
        overdue: number;
        dueSoon: number;
        noAction: number;
    };
}

const DATE_BUCKETS: ProjectDateBucket[] = ["overdue", "today", "thisWeek", "later", "unscheduled"];

export function reconcileProjectTasks(tasks: TaskCacheEntry[], override: TaskCacheEntry | null): TaskCacheEntry[] {
    if (!override) return tasks;
    return tasks.map((task) => (task.blockId === override.blockId ? override : task));
}

export function buildProjectViewControl(tasks: TaskCacheEntry[], state: ProjectViewState): ProjectControlState {
    return buildProjectControlState(reconcileProjectTasks(tasks, state.selectedTaskOverride), {
        startPreviewDays: state.startPreviewDays,
        selection: {
            projectId: state.preferActiveProject || !state.selectedTaskId ? state.activeProjectId : "",
            taskId: state.preferActiveProject ? "" : state.selectedTaskId,
        },
    });
}

export function buildProjectViewModel(
    control: ProjectControlState,
    customFields: CustomFieldDef[],
    state: ProjectViewState,
): ProjectViewModel {
    const sourceTasks = control.tasks;
    const summaries = control.projects.map((project) => project.summary);
    const taskFiltersActive = hasActiveTaskFilters(state.filterState);
    const includeCompletedTasks = state.showCompleted || state.mode === "board";
    const filterCandidates = sourceTasks.filter(
        (task) => includeCompletedTasks || task.status !== "done" || isProjectTask(task),
    );
    const matchedTasks = taskFiltersActive
        ? applyFilters(filterCandidates, state.filterState, customFields)
        : filterCandidates;
    const matchedTaskIds = new Set(matchedTasks.map((task) => task.blockId));
    const matchingSummaries = summaries.filter((summary) => {
        const explicitlyRequested = summary.project.blockId === state.filterBypassProjectId;
        return (
            (!taskFiltersActive ||
                matchedTaskIds.has(summary.project.blockId) ||
                summary.descendants.some((task) => matchedTaskIds.has(task.blockId)) ||
                explicitlyRequested) &&
            (state.showCompleted || summary.health !== "complete") &&
            matchesProjectFilters(summary, state)
        );
    });
    const orderedProjectIds = sortTasksBy(
        matchingSummaries.map((summary) => summary.project),
        state.filterState.sortBy,
        state.filterState.sortAsc,
        customFields,
    ).map((task) => task.blockId);
    const summaryByProjectId = new Map(matchingSummaries.map((summary) => [summary.project.blockId, summary]));
    const visibleSummaries = orderedProjectIds
        .map((blockId) => summaryByProjectId.get(blockId))
        .filter((summary): summary is ProjectSummary => Boolean(summary));
    const preferredProjectId = control.selection.projectId;
    const activeProjectId = visibleSummaries.some((summary) => summary.project.blockId === preferredProjectId)
        ? preferredProjectId
        : visibleSummaries[0]?.project.blockId || "";
    const selectedSummary = visibleSummaries.find((summary) => summary.project.blockId === activeProjectId) || null;
    const selectedProject = selectedSummary
        ? control.projects.find((project) => project.summary.project.blockId === selectedSummary.project.blockId) ||
          null
        : null;
    const selectedMatchedTaskIds =
        !selectedSummary || !taskFiltersActive
            ? null
            : new Set(
                  selectedSummary.descendants
                      .filter((task) => matchedTaskIds.has(task.blockId))
                      .map((task) => task.blockId),
              );
    const projectTreeModel = selectedSummary
        ? buildProjectTreeModel(
              selectedSummary,
              new Set(state.collapsedByProject?.[activeProjectId] || state.collapsedIds || []),
              {
                  showCompleted: state.showCompleted,
                  matchedTaskIds: selectedMatchedTaskIds,
                  revealedTaskIds: state.selectedTaskId ? new Set([state.selectedTaskId]) : null,
                  sortMode: state.mode === "gantt" ? state.ganttSortMode : "manual",
              },
          )
        : null;
    const detailTasks = (selectedSummary?.descendants || []).filter(
        (task) =>
            (state.showCompleted || task.status !== "done") && (!taskFiltersActive || matchedTaskIds.has(task.blockId)),
    );
    const sortedDetailTasks = sortTasksBy(
        detailTasks,
        state.filterState.sortBy,
        state.filterState.sortAsc,
        customFields,
    );
    // The board owns its ordering.  Do not reuse the project overview filter's
    // sort state: changing the global view sort must not reshuffle a board.
    const boardTasks = sortProjectBoardTasks(
        (selectedSummary?.descendants || [])
            .filter((task) => !taskFiltersActive || matchedTaskIds.has(task.blockId))
            .filter((task, _index, tasks) => isProjectBoardTask(task, selectedSummary?.descendants || tasks)),
        "order",
        false,
        customFields,
    );
    const planGroups = DATE_BUCKETS.map((bucket) => ({
        bucket,
        tasks: sortedDetailTasks.filter((task) => !isProjectTask(task) && getProjectDateBucket(task) === bucket),
    })).filter((group) => group.tasks.length > 0);
    const visibleProjectIds = new Set(visibleSummaries.map((summary) => summary.project.blockId));
    const visibleSummaryById = new Map(visibleSummaries.map((summary) => [summary.project.blockId, summary]));
    const riskItems = control.risks
        .filter((risk) => visibleProjectIds.has(risk.projectId))
        .map((risk) => ({ summary: visibleSummaryById.get(risk.projectId)!, risk }));

    return {
        sourceTasks,
        summaries,
        visibleSummaries,
        activeProjectId,
        selectedProject,
        selectedSummary,
        matchedTaskIds,
        taskFiltersActive,
        projectTreeModel,
        detailTasks: sortedDetailTasks,
        boardTasks,
        planGroups,
        riskItems,
        metrics: {
            activeProjects: summaries.filter((summary) => summary.health !== "complete").length,
            attention: summaries.filter((summary) => summary.health === "attention" || summary.health === "blocked")
                .length,
            overdue: summaries.reduce((count, summary) => count + summary.overdueTasks.length, 0),
            dueSoon: summaries.reduce(
                (count, summary) =>
                    count +
                    summary.descendants.filter(
                        (task) =>
                            task.status !== "done" &&
                            (getProjectDateBucket(task) === "today" || getProjectDateBucket(task) === "thisWeek"),
                    ).length,
                0,
            ),
            noAction: summaries.filter((summary) => summary.risks.some((risk) => risk.kind === "noNextAction")).length,
        },
    };
}

function matchesProjectFilters(summary: ProjectSummary, state: ProjectViewState): boolean {
    if (state.riskFilter === "attention" && summary.health !== "attention") return false;
    if (state.riskFilter === "blocked" && summary.health !== "blocked") return false;
    if (state.dateFilter === "overdue" && summary.overdueTasks.length === 0) return false;
    if (
        state.dateFilter === "week" &&
        !summary.descendants.some(
            (task) =>
                task.status !== "done" &&
                (getProjectDateBucket(task) === "today" || getProjectDateBucket(task) === "thisWeek"),
        )
    )
        return false;
    if (state.actionFilter === "missing" && !summary.risks.some((risk) => risk.kind === "noNextAction")) return false;
    if (state.actionFilter === "available" && summary.nextActions.length === 0) return false;
    return true;
}
