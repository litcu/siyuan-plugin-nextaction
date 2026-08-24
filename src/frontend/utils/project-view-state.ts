import type { CustomFieldDef } from "../../shared/settings";
import type { ProjectRisk, ProjectSummary, TaskCacheEntry } from "../../shared/types";
import { applyFilters, hasActiveTaskFilters, sortTasksBy, type FilterState } from "./filter";
import {
    buildProjectSummaries,
    getProjectDateBucket,
    isProjectTask,
    type ProjectDateBucket,
} from "../../shared/project-domain";
import { buildProjectTreeModel, type ProjectTreeModel, type ProjectTreeSortMode } from "./project-tree";

export type ProjectViewMode = "overview" | "hierarchy" | "board" | "plan" | "gantt";
export type ProjectRiskFilter = "all" | "attention" | "blocked";
export type ProjectDateFilter = "all" | "overdue" | "week";
export type ProjectActionFilter = "all" | "missing" | "available";

export interface ProjectBoardMoveIntent {
    task: TaskCacheEntry;
    status: string;
    afterId?: string;
}

export interface ProjectBoardMoveHandlers {
    updateTask?: (task: TaskCacheEntry, attrs: Record<string, string>) => Promise<void>;
    reorderTask?: (blockId: string, parentId: string, afterId?: string) => Promise<void>;
}

export async function executeProjectBoardMove(
    intent: ProjectBoardMoveIntent,
    projectId: string,
    handlers: ProjectBoardMoveHandlers,
): Promise<void> {
    if (intent.task.status !== intent.status && handlers.updateTask) {
        await handlers.updateTask(intent.task, { "na-status": intent.status });
    }
    if (handlers.reorderTask) {
        await handlers.reorderTask(intent.task.blockId, intent.task.parentId || projectId, intent.afterId);
    }
}

export interface ProjectViewState {
    mode: ProjectViewMode;
    activeProjectId: string;
    selectedTaskId: string;
    selectedTaskOverride: TaskCacheEntry | null;
    showCompleted: boolean;
    riskFilter: ProjectRiskFilter;
    dateFilter: ProjectDateFilter;
    actionFilter: ProjectActionFilter;
    filterState: FilterState;
    collapsedIds: ReadonlySet<string>;
    ganttSortMode: ProjectTreeSortMode;
    startPreviewDays: number;
}

export interface ProjectViewModel {
    sourceTasks: TaskCacheEntry[];
    summaries: ProjectSummary[];
    visibleSummaries: ProjectSummary[];
    activeProjectId: string;
    selectedSummary: ProjectSummary | null;
    matchedTaskIds: ReadonlySet<string>;
    taskFiltersActive: boolean;
    projectTreeModel: ProjectTreeModel | null;
    detailTasks: TaskCacheEntry[];
    boardTasks: TaskCacheEntry[];
    planGroups: Array<{ bucket: ProjectDateBucket; tasks: TaskCacheEntry[] }>;
    riskItems: Array<{ summary: ProjectSummary; risk: ProjectRisk; target: TaskCacheEntry }>;
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

export function buildProjectViewModel(
    tasks: TaskCacheEntry[],
    customFields: CustomFieldDef[],
    state: ProjectViewState,
): ProjectViewModel {
    const sourceTasks = reconcileProjectTasks(tasks, state.selectedTaskOverride);
    const summaries = buildProjectSummaries(sourceTasks, { startPreviewDays: state.startPreviewDays });
    const taskFiltersActive = hasActiveTaskFilters(state.filterState);
    const filterCandidates = sourceTasks.filter(
        (task) => state.showCompleted || task.status !== "done" || isProjectTask(task),
    );
    const matchedTasks = taskFiltersActive
        ? applyFilters(filterCandidates, state.filterState, customFields)
        : filterCandidates;
    const matchedTaskIds = new Set(matchedTasks.map((task) => task.blockId));
    const matchingSummaries = summaries.filter(
        (summary) =>
            (!taskFiltersActive ||
                matchedTaskIds.has(summary.project.blockId) ||
                summary.descendants.some((task) => matchedTaskIds.has(task.blockId))) &&
            (state.showCompleted || summary.health !== "complete") &&
            matchesProjectFilters(summary, state),
    );
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
    const containingSelection = state.selectedTaskId
        ? summaries.find(
              (summary) =>
                  summary.project.blockId === state.selectedTaskId ||
                  summary.descendants.some((task) => task.blockId === state.selectedTaskId),
          )
        : undefined;
    const preferredProjectId = containingSelection?.project.blockId || state.activeProjectId;
    const activeProjectId = visibleSummaries.some((summary) => summary.project.blockId === preferredProjectId)
        ? preferredProjectId
        : visibleSummaries[0]?.project.blockId || "";
    const selectedSummary = visibleSummaries.find((summary) => summary.project.blockId === activeProjectId) || null;
    const selectedMatchedTaskIds =
        !selectedSummary || !taskFiltersActive
            ? null
            : new Set(
                  selectedSummary.descendants
                      .filter((task) => matchedTaskIds.has(task.blockId))
                      .map((task) => task.blockId),
              );
    const projectTreeModel = selectedSummary
        ? buildProjectTreeModel(selectedSummary, state.collapsedIds, {
              showCompleted: state.showCompleted,
              matchedTaskIds: selectedMatchedTaskIds,
              sortMode: state.mode === "gantt" ? state.ganttSortMode : "manual",
          })
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
    const planGroups = DATE_BUCKETS.map((bucket) => ({
        bucket,
        tasks: sortedDetailTasks.filter((task) => !isProjectTask(task) && getProjectDateBucket(task) === bucket),
    })).filter((group) => group.tasks.length > 0);
    const riskItems = visibleSummaries
        .flatMap((summary) =>
            summary.risks.map((risk) => ({
                summary,
                risk,
                target: summary.descendants.find((task) => task.blockId === risk.taskId) || summary.project,
            })),
        )
        .sort((a, b) => riskWeight(b.risk.severity) - riskWeight(a.risk.severity));

    return {
        sourceTasks,
        summaries,
        visibleSummaries,
        activeProjectId,
        selectedSummary,
        matchedTaskIds,
        taskFiltersActive,
        projectTreeModel,
        detailTasks: sortedDetailTasks,
        boardTasks: sortedDetailTasks,
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

function riskWeight(severity: ProjectRisk["severity"]): number {
    return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}
