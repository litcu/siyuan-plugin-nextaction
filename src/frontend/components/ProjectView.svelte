<script lang="ts">
    import { onMount } from "svelte";
    import { VIEW_BY_PROJECT } from "../constants";
    import { DEFAULT_FILTER_STATE } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import GanttView from "./GanttView.svelte";
    import ProjectOverviewMode from "./project/ProjectOverviewMode.svelte";
    import ProjectHierarchyMode from "./project/ProjectHierarchyMode.svelte";
    import ProjectBoardMode from "./project/ProjectBoardMode.svelte";
    import ProjectPlanMode from "./project/ProjectPlanMode.svelte";
    import ProjectCompletionPanel from "./project/ProjectCompletionPanel.svelte";
    import ProjectDefinitionEditor from "./project/ProjectDefinitionEditor.svelte";
    import ProjectStagePlan from "./project/ProjectStagePlan.svelte";
    import NaBadge from "../ui/NaBadge.svelte";
    import NaButton from "../ui/NaButton.svelte";
    import NaMetricStrip from "../ui/NaMetricStrip.svelte";
    import NaProgressBar from "../ui/NaProgressBar.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";
    import NaTaskFilterBar from "../ui/NaTaskFilterBar.svelte";
    import NaToggle from "../ui/NaToggle.svelte";
    import NaToolbar from "../ui/NaToolbar.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";
    import type {
        ProjectControlRisk,
        ProjectRisk,
        ProjectSummary,
        ProjectSupportData,
        TaskCacheEntry,
    } from "../../shared/types";
    import type { I18nStrings } from "../../shared/i18n";
    import { jumpToBlock } from "../utils";
    import { projectRiskI18nKey, statusI18nKey, translateKey } from "../i18n";
    import { taskStore } from "../stores/task-store";
    import { runAiDecomposeTask, runAiExtractTasks } from "../ai/ai-feature-service";
    import type { ProjectDefinitionControllerRegistry } from "../controllers/project-definition-controller";
    import type { ProjectTreeSortMode } from "../utils/project-tree";
    import {
        createDefaultProjectBoardPreferences,
        getProjectBoardPreference,
        normalizeProjectBoardPreferences,
        withProjectBoardPreference,
        type ProjectBoardPreference,
        type ProjectBoardPreferences,
    } from "../../shared/project-board-preferences";
    import {
        buildProjectViewModel,
        buildProjectViewControl,
        confirmProjectCompletion,
        executeProjectBoardMove,
        shouldShowProjectCompletionPanel,
        type ProjectActionFilter,
        type ProjectBoardMoveIntent,
        type ProjectDateFilter,
        type ProjectRiskFilter,
        type ProjectViewMode,
    } from "../utils/project-view-state";
    import type { ProjectBoardMoveResult } from "../../shared/project-board-move";

    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: I18nStrings;
    export let selectedTaskId: string = "";
    export let selectedTaskOverride: TaskCacheEntry | null = null;
    export let requestedProjectId: string = "";
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onTaskUpdate:
        ((task: TaskCacheEntry, attrs: Record<string, string>) => Promise<TaskCacheEntry>) | undefined = undefined;
    export let onTaskRename: ((task: TaskCacheEntry, title: string) => Promise<TaskCacheEntry>) | undefined = undefined;
    export let onTaskReorder: ((blockId: string, parentId: string, afterId?: string) => Promise<void>) | undefined =
        undefined;
    export let onProjectBoardMove:
        ((intent: ProjectBoardMoveIntent, projectId: string) => Promise<ProjectBoardMoveResult>) | undefined =
        undefined;
    export let onCreateChild: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onCreateStage: ((project: TaskCacheEntry) => void) | undefined = undefined;
    export let onMoveAction: ((task: TaskCacheEntry, project: TaskCacheEntry) => void) | undefined = undefined;
    export let loadProjectSupport: (projectId: string) => Promise<ProjectSupportData>;
    export let onExtractAction: (sourceBlockId: string, sourceTitle: string, projectId: string) => void;
    export let projectDefinitionControllerRegistry: ProjectDefinitionControllerRegistry;
    export let bridge:
        | {
              getProjectBoardPreferences: () => Promise<ProjectBoardPreferences>;
              updateProjectBoardPreference: (
                  projectId: string,
                  preference: ProjectBoardPreference,
              ) => Promise<ProjectBoardPreferences>;
          }
        | undefined = undefined;

    type RiskItem = { summary: ProjectSummary; risk: ProjectControlRisk };

    let mode: ProjectViewMode = "overview";
    let activeProjectId = "";
    let appliedRequestedProjectId = "";
    let appliedSelectedTaskId = selectedTaskId;
    let requestedProjectFilterBypassId = "";
    let preferActiveProject = false;
    let collapsedByProject: Record<string, string[]> = {};
    let collapsedIds: Set<string> = new Set();
    let showCompleted = false;
    let riskFilter: ProjectRiskFilter = "all";
    let dateFilter: ProjectDateFilter = "all";
    let actionFilter: ProjectActionFilter = "all";
    let ganttSortMode: ProjectTreeSortMode = "timeline";
    let riskItems: RiskItem[] = [];
    let boardPreferences: ProjectBoardPreferences = createDefaultProjectBoardPreferences();
    let boardPreferenceSaveQueue: Promise<unknown> = Promise.resolve();
    const dirtyBoardPreferenceProjects = new Set<string>();

    onMount(() => {
        if (!bridge) return;
        void bridge
            .getProjectBoardPreferences()
            .then((value) => {
                const loaded = normalizeProjectBoardPreferences(value);
                for (const projectId of dirtyBoardPreferenceProjects) {
                    const local = boardPreferences.projects[projectId];
                    if (local) loaded.projects[projectId] = local;
                }
                boardPreferences = loaded;
            })
            .catch((error) => console.warn("[NextAction] board preferences load failed:", error));
    });

    $: if (requestedProjectId && requestedProjectId !== appliedRequestedProjectId) {
        activeProjectId = requestedProjectId;
        preferActiveProject = true;
        requestedProjectFilterBypassId = requestedProjectId;
        appliedRequestedProjectId = requestedProjectId;
    }

    $: if (selectedTaskId !== appliedSelectedTaskId) {
        appliedSelectedTaskId = selectedTaskId;
        preferActiveProject = false;
    }

    $: filterState = $taskStore.filterByView[VIEW_BY_PROJECT] || DEFAULT_FILTER_STATE;
    $: viewState = {
        mode,
        activeProjectId,
        filterBypassProjectId: requestedProjectFilterBypassId,
        selectedTaskId,
        selectedTaskOverride,
        preferActiveProject,
        showCompleted,
        riskFilter,
        dateFilter,
        actionFilter,
        filterState,
        collapsedByProject,
        ganttSortMode,
        startPreviewDays: $taskStore.settings.priorityEngine.startPreviewDays,
    };
    $: projectControl = buildProjectViewControl($taskStore.allTasks, viewState);
    $: viewModel = buildProjectViewModel(projectControl, $taskStore.settings.customFields, viewState);
    $: resolvedActiveProjectId = viewModel.activeProjectId;
    $: summaries = viewModel.summaries;
    $: visibleSummaries = viewModel.visibleSummaries;
    $: selectedSummary = viewModel.selectedSummary;
    $: selectedProject = viewModel.selectedProject;
    $: riskItems = viewModel.riskItems;
    $: projectTreeModel = viewModel.projectTreeModel;
    $: collapsedIds = new Set(collapsedByProject[resolvedActiveProjectId] || []);
    $: boardTasks = viewModel.boardTasks;
    $: planGroups = viewModel.planGroups;
    $: activeProjectsCount = viewModel.metrics.activeProjects;
    $: attentionCount = viewModel.metrics.attention;
    $: overdueCount = viewModel.metrics.overdue;
    $: dueSoonCount = viewModel.metrics.dueSoon;
    $: noActionCount = viewModel.metrics.noAction;

    function statusLabel(status: string): string {
        return translateKey(i18n, statusI18nKey(status), status);
    }

    function statusTone(status: string): "neutral" | "primary" | "info" | "success" | "warning" | "danger" {
        if (status === "done") return "success";
        if (status === "doing") return "primary";
        if (status === "waiting") return "warning";
        if (status === "someday") return "neutral";
        return "info";
    }

    function riskLabel(kind: ProjectRisk["kind"]): string {
        return translateKey(i18n, projectRiskI18nKey(kind), kind);
    }

    function handleFilterChange(state: FilterState) {
        requestedProjectFilterBypassId = "";
        taskStore.setFilterState(VIEW_BY_PROJECT, state);
    }

    function handleModeChange(event: CustomEvent<string>) {
        mode = event.detail as ProjectViewMode;
    }

    function selectProject(summary: ProjectSummary) {
        requestedProjectFilterBypassId = "";
        activeProjectId = summary.project.blockId;
        preferActiveProject = true;
    }

    function workItemCount(summary: ProjectSummary): number {
        return summary.doneCount + summary.openCount;
    }

    function toggleCollapse(blockId: string) {
        const next = new Set(collapsedIds);
        if (next.has(blockId)) next.delete(blockId);
        else next.add(blockId);
        collapsedIds = next;
        const projectId = resolvedActiveProjectId;
        if (projectId) collapsedByProject = { ...collapsedByProject, [projectId]: [...next] };
    }

    async function handleBoardMove(intent: ProjectBoardMoveIntent) {
        if (!selectedSummary) return;
        await executeProjectBoardMove(intent, selectedSummary.project.blockId, {
            updateTask: onTaskUpdate,
            reorderTask: onTaskReorder,
            moveProjectBoardTask: onProjectBoardMove
                ? (moveInput) =>
                      onProjectBoardMove!(
                          {
                              ...intent,
                              status: String(moveInput.value),
                              groupBy: moveInput.groupBy,
                              value: moveInput.value,
                              afterId: moveInput.afterId || undefined,
                              afterParentId: moveInput.afterParentId || undefined,
                              visibleTaskIds: moveInput.visibleTaskIds,
                          },
                          selectedSummary.project.blockId,
                      )
                : undefined,
        });
    }

    function handleBoardPreferenceChange(preference: ProjectBoardPreference) {
        const projectId = resolvedActiveProjectId;
        if (!projectId) return;
        dirtyBoardPreferenceProjects.add(projectId);
        boardPreferences = withProjectBoardPreference(boardPreferences, projectId, preference);
        if (!bridge) return;
        // Keep persistence off the interaction path while preserving write order.
        boardPreferenceSaveQueue = boardPreferenceSaveQueue
            .catch(() => undefined)
            .then(() => bridge!.updateProjectBoardPreference(projectId, preference))
            .catch((error) => console.warn("[NextAction] board preference save failed:", error));
    }
</script>

<NaViewShell
    loading={$taskStore.loading && summaries.length === 0}
    empty={visibleSummaries.length === 0}
    emptyText={$taskStore.error || i18n?.noResults || i18n?.noProjects || "No projects yet"}
    hint={i18n?.viewHintProject}
>
    <svelte:fragment slot="toolbar">
        <NaToolbar compact>
            <NaMetricStrip
                items={[
                    { value: activeProjectsCount, label: i18n?.projectMetricActive || "Active", tone: "info" },
                    {
                        value: attentionCount,
                        label: i18n?.projectMetricAttention || "Attention",
                        tone: attentionCount > 0 ? "warning" : "success",
                    },
                    {
                        value: overdueCount,
                        label: i18n?.projectMetricOverdue || "Overdue",
                        tone: overdueCount > 0 ? "danger" : "success",
                    },
                    { value: dueSoonCount, label: i18n?.projectMetricDueSoon || "7 days", tone: "primary" },
                    {
                        value: noActionCount,
                        label: i18n?.projectMetricNoAction || "No next action",
                        tone: noActionCount > 0 ? "warning" : "success",
                    },
                ]}
            />
            <div class="na-toolbar__actions-content">
                <NaButton
                    size="sm"
                    icon="iconAdd"
                    disabled={!selectedSummary}
                    on:click={() => selectedSummary && onCreateChild?.(selectedSummary.project)}
                    >{i18n?.createChildTask || "Create child task"}</NaButton
                >
                <NaButton
                    size="sm"
                    icon="iconSparkles"
                    disabled={!selectedSummary}
                    on:click={() => selectedSummary && runAiDecomposeTask(selectedSummary.project)}
                    >{i18n?.aiDecomposeProject || "Break down project with AI"}</NaButton
                >
            </div>
        </NaToolbar>
        <div class="na-project-toolbar">
            <div class="na-project-toolbar__view-switcher">
                <NaSegmentControl
                    size="sm"
                    value={mode}
                    options={[
                        { value: "overview", label: i18n?.projectViewOverview || "Overview" },
                        { value: "hierarchy", label: i18n?.projectViewHierarchy || "Hierarchy" },
                        { value: "board", label: i18n?.projectViewBoard || "Board" },
                        { value: "plan", label: i18n?.projectViewPlan || "Plan" },
                        { value: "gantt", label: i18n?.projectViewGantt || "Gantt" },
                    ]}
                    on:change={handleModeChange}
                />
            </div>
            <div class="na-project-toolbar__completed">
                <NaToggle
                    checked={showCompleted}
                    label={i18n?.projectShowCompleted || "Show completed"}
                    on:change={(event) => (showCompleted = event.detail.checked)}
                />
                <span>{i18n?.projectShowCompleted || "Show completed"}</span>
            </div>
            <select
                class="na-select na-select--sm na-project-toolbar__select"
                bind:value={riskFilter}
                aria-label={i18n?.projectFilterRisk || "Risk filter"}
            >
                <option value="all">{i18n?.projectFilterAllRisks || "All risks"}</option>
                <option value="attention">{i18n?.projectHealthAttention || "Attention"}</option>
                <option value="blocked">{i18n?.projectHealthBlocked || "Blocked"}</option>
            </select>
            <select
                class="na-select na-select--sm na-project-toolbar__select"
                bind:value={dateFilter}
                aria-label={i18n?.projectFilterDate || "Date filter"}
            >
                <option value="all">{i18n?.projectFilterAllDates || "All dates"}</option>
                <option value="overdue">{i18n?.projectRiskOverdue || "Overdue"}</option>
                <option value="week">{i18n?.projectMetricDueSoon || "Due in 7 days"}</option>
            </select>
            <select
                class="na-select na-select--sm na-project-toolbar__select"
                bind:value={actionFilter}
                aria-label={i18n?.projectFilterAction || "Next action filter"}
            >
                <option value="all">{i18n?.projectFilterAllActions || "All actions"}</option>
                <option value="missing">{i18n?.projectRiskNoNextAction || "No next action"}</option>
                <option value="available">{i18n?.projectNextActions || "Next actions"}</option>
            </select>
            <span class="na-project-toolbar__hint"
                >{i18n?.projectControlHint || "Select a project to inspect its momentum and risks"}</span
            >
        </div>
        <NaTaskFilterBar
            contexts={$taskStore.contexts}
            tags={$taskStore.tags}
            customFields={$taskStore.settings.customFields}
            {filterState}
            showStatus={true}
            searchPlaceholder={i18n?.searchProjectsAndTasks || "Search projects and tasks..."}
            {i18n}
            on:change={(event) => handleFilterChange(event.detail)}
        />
    </svelte:fragment>

    <div class="na-project-workspace" class:na-project-workspace--focus={mode !== "overview"}>
        <aside class="na-project-index" aria-label={i18n?.projectList || "Project list"}>
            <div class="na-project-index__header">
                <span>{i18n?.projectList || "Projects"}</span>
                <span class="na-project-index__count">{visibleSummaries.length}</span>
            </div>
            <div class="na-project-index__scroll">
                {#each visibleSummaries as summary (summary.project.blockId)}
                    <button
                        type="button"
                        class="na-project-index__item"
                        class:active={summary.project.blockId === resolvedActiveProjectId}
                        on:click={() => selectProject(summary)}
                    >
                        <span class="na-project-index__item-accent na-project-index__item-accent--{summary.health}"
                        ></span>
                        <span class="na-project-index__item-copy">
                            <strong>{summary.project.title || i18n?.untitled || "(untitled)"}</strong>
                            <span
                                >{summary.doneCount}/{workItemCount(summary)} · {summary.nextActions.length}
                                {i18n?.projectNextShort || "next"}</span
                            >
                        </span>
                        <NaBadge text={statusLabel(summary.project.status)} tone={statusTone(summary.project.status)} />
                    </button>
                {/each}
            </div>
        </aside>

        <section class="na-project-canvas" class:na-project-canvas--gantt={mode === "gantt"}>
            {#if selectedSummary}
                <div class="na-project-canvas__header">
                    <div class="na-project-canvas__title">
                        <span class="na-project-canvas__kicker">{i18n?.project || "Project"}</span>
                        <h2>{selectedSummary.project.title || i18n?.untitled || "(untitled)"}</h2>
                        <span
                            >{selectedSummary.openCount}
                            {i18n?.projectOpenTasks || "open tasks"} · {selectedSummary.risks.length}
                            {i18n?.projectRisks || "risks"}</span
                        >
                    </div>
                    <div class="na-project-canvas__actions">
                        <NaBadge
                            text={statusLabel(selectedSummary.project.status)}
                            tone={statusTone(selectedSummary.project.status)}
                        />
                        <NaButton size="sm" on:click={() => onEdit(selectedSummary.project)}
                            >{i18n?.editProject || "Edit project"}</NaButton
                        >
                    </div>
                </div>
                <div class="na-project-canvas__progress">
                    <NaProgressBar
                        percent={selectedSummary.progress}
                        label={`${selectedSummary.doneCount}/${workItemCount(selectedSummary)} ${i18n?.completedTasks || "completed"}`}
                    />
                </div>
                {#if shouldShowProjectCompletionPanel(selectedSummary)}
                    <ProjectCompletionPanel
                        summary={selectedSummary}
                        {i18n}
                        {onSelectTask}
                        onConfirm={onTaskUpdate
                            ? () => confirmProjectCompletion(selectedSummary, onTaskUpdate)
                            : undefined}
                    />
                {/if}

                <div hidden={mode !== "overview"}>
                    <ProjectDefinitionEditor
                        project={selectedSummary.project}
                        {i18n}
                        onSave={onTaskUpdate}
                        controllerRegistry={projectDefinitionControllerRegistry}
                    />
                </div>

                {#if mode === "overview"}
                    {#if projectTreeModel}
                        <ProjectStagePlan
                            project={selectedSummary.project}
                            model={projectTreeModel}
                            {selectedTaskId}
                            {i18n}
                            {onSelectTask}
                            onCreateStage={onCreateStage ? () => onCreateStage?.(selectedSummary.project) : undefined}
                            onRenameTask={onTaskRename}
                            {onTaskUpdate}
                            {onTaskReorder}
                            {onMoveAction}
                        />
                    {/if}
                    <ProjectOverviewMode
                        summary={selectedSummary}
                        risks={selectedProject?.risks || []}
                        {selectedTaskId}
                        {i18n}
                        {onSelectTask}
                        {onEdit}
                        {onStatusClick}
                        {onContextMenu}
                        {loadProjectSupport}
                        onOpenProjectSupport={jumpToBlock}
                        {onExtractAction}
                        onCreateAction={onCreateChild}
                        onAiExtractAction={(sourceBlockId, projectId) =>
                            runAiExtractTasks([sourceBlockId], { projectId })}
                    />
                {:else if mode === "hierarchy" && projectTreeModel}
                    <ProjectHierarchyMode
                        project={selectedSummary.project}
                        model={projectTreeModel}
                        {selectedTaskId}
                        {i18n}
                        {onSelectTask}
                        {onEdit}
                        {onStatusClick}
                        {onContextMenu}
                        onToggleCollapse={toggleCollapse}
                        {onTaskRename}
                        {onTaskReorder}
                    />
                {:else if mode === "board"}
                    <ProjectBoardMode
                        tasks={boardTasks}
                        projectTasks={[selectedSummary.project, ...selectedSummary.descendants]}
                        {selectedTaskId}
                        {i18n}
                        {onSelectTask}
                        {onEdit}
                        {onStatusClick}
                        {onContextMenu}
                        onMoveTask={handleBoardMove}
                        customFields={$taskStore.settings.customFields}
                        preference={getProjectBoardPreference(boardPreferences, resolvedActiveProjectId)}
                        onPreferenceChange={handleBoardPreferenceChange}
                    />
                {:else if mode === "plan"}
                    <ProjectPlanMode
                        groups={planGroups}
                        {selectedTaskId}
                        {i18n}
                        {onSelectTask}
                        {onEdit}
                        {onStatusClick}
                        {onContextMenu}
                    />
                {:else if mode === "gantt" && projectTreeModel}
                    <GanttView
                        model={projectTreeModel}
                        projectTasks={[selectedSummary.project, ...selectedSummary.descendants]}
                        {selectedTaskId}
                        {i18n}
                        sortMode={ganttSortMode}
                        onSortModeChange={(value) => (ganttSortMode = value)}
                        onToggleCollapse={toggleCollapse}
                        {onSelectTask}
                        {onEdit}
                        {onContextMenu}
                    />
                {/if}
            {:else}
                <div class="na-project-empty">
                    <strong>{i18n?.projectSelectTitle || "Select a project"}</strong><span
                        >{i18n?.projectSelectHint || "Choose a project to inspect its progress and risks."}</span
                    >
                </div>
            {/if}
        </section>

        {#if mode === "overview"}
            <aside class="na-project-risk-rail">
                <div class="na-project-risk-rail__header">
                    <span>{i18n?.projectRiskQueue || "Risk queue"}</span><span>{riskItems.length}</span>
                </div>
                {#each riskItems.slice(0, 10) as item (item.risk.kind + item.risk.taskId)}
                    <button
                        type="button"
                        class="na-project-risk-rail__item"
                        on:click={() => {
                            activeProjectId = item.summary.project.blockId;
                            onSelectTask?.(item.risk.target);
                        }}
                    >
                        <span class="na-project-risk__marker na-project-risk__marker--{item.risk.severity}"></span>
                        <span
                            ><strong>{riskLabel(item.risk.kind)}</strong><small
                                >{item.risk.target.title || i18n?.untitled || "(untitled)"}</small
                            ><em>{item.summary.project.title || i18n?.untitled || "(untitled)"}</em></span
                        >
                    </button>
                {/each}
                {#if riskItems.length === 0}<p class="na-project-muted">
                        {i18n?.projectNoRisks || "No obvious risks"}
                    </p>{/if}
            </aside>
        {/if}
    </div>
</NaViewShell>

<style lang="scss">
    .na-project-toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px 10px;
        padding: 8px 12px;
    }
    .na-project-toolbar__view-switcher {
        max-width: 100%;
        overflow-x: auto;
        scrollbar-width: thin;
    }
    .na-project-toolbar__view-switcher :global(.na-segment-control) {
        width: max-content;
    }
    .na-project-toolbar__completed {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        cursor: pointer;
        white-space: nowrap;
    }
    .na-project-toolbar__select {
        width: auto;
        min-width: 86px;
    }
    .na-project-toolbar__hint {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .na-project-workspace {
        display: grid;
        grid-template-columns: minmax(185px, 24%) minmax(0, 1fr) minmax(180px, 22%);
        min-height: 0;
        height: 100%;
        overflow: hidden;
        background: var(--b3-theme-background);
    }
    :global(.na-toolbar__main):has(> .na-toolbar__actions-content) {
        flex-wrap: wrap;
    }
    .na-toolbar__actions-content {
        flex-shrink: 0;
    }
    .na-project-workspace--focus {
        grid-template-columns: minmax(185px, 24%) minmax(0, 1fr);
    }
    .na-project-index,
    .na-project-risk-rail {
        min-width: 0;
        border-right: 1px solid var(--na-color-divider);
        background: color-mix(in srgb, var(--b3-theme-surface) 82%, var(--b3-theme-background));
    }
    .na-project-risk-rail {
        border-right: 0;
        border-left: 1px solid var(--na-color-divider);
    }
    .na-project-index__header,
    .na-project-risk-rail__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 11px 12px 8px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
    }
    .na-project-index__count,
    .na-project-risk-rail__header > span:last-child {
        color: var(--na-accent);
        font-variant-numeric: tabular-nums;
    }
    .na-project-index__scroll,
    .na-project-risk-rail {
        overflow: auto;
    }
    .na-project-index__item,
    .na-project-risk-rail__item {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        padding: 9px 10px;
        border: 0;
        border-top: 1px solid color-mix(in srgb, var(--na-color-divider) 65%, transparent);
        color: var(--na-text-primary);
        background: transparent;
        text-align: left;
        cursor: pointer;
    }
    .na-project-index__item:hover,
    .na-project-index__item.active,
    .na-project-risk-rail__item:hover {
        background: var(--na-color-hover-bg);
    }
    .na-project-index__item.active {
        box-shadow: inset 3px 0 var(--na-accent);
    }
    .na-project-index__item-accent {
        flex: 0 0 5px;
        height: 30px;
        border-radius: 2px;
        background: var(--na-color-info);
    }
    .na-project-index__item-accent--attention {
        background: var(--na-color-warning);
    }
    .na-project-index__item-accent--blocked {
        background: var(--na-color-error);
    }
    .na-project-index__item-accent--complete {
        background: var(--na-color-success);
    }
    .na-project-index__item-copy {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        gap: 2px;
    }
    .na-project-index__item-copy strong,
    .na-project-risk-rail__item strong,
    .na-project-risk-rail__item small,
    .na-project-risk-rail__item em {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .na-project-index__item-copy strong {
        font-size: var(--na-font-size-md);
        font-weight: 600;
        letter-spacing: 0;
    }
    .na-project-index__item-copy span {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
    }
    .na-project-canvas {
        display: flex;
        min-width: 0;
        min-height: 0;
        flex-direction: column;
        overflow: auto;
        padding: 14px;
    }
    .na-project-canvas--gantt {
        overflow: hidden;
    }
    .na-project-canvas__header {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        margin-bottom: 8px;
    }
    .na-project-canvas__title {
        min-width: 0;
    }
    .na-project-canvas__kicker {
        color: var(--na-accent);
        font-size: var(--na-font-size-xs);
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
    }
    .na-project-canvas h2 {
        margin: 2px 0;
        font-size: 18px;
        line-height: 24px;
        font-weight: 650;
        letter-spacing: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .na-project-canvas__title > span:last-child {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
    }
    .na-project-canvas__actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
    }
    .na-project-canvas__progress {
        margin-bottom: 14px;
    }
    .na-project-risk-rail__item {
        border: 0;
        background: transparent;
    }
    .na-project-risk-rail__item > span:last-child {
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 2px;
    }
    .na-project-risk-rail__item strong {
        font-size: var(--na-font-size-sm);
        font-weight: 650;
    }
    .na-project-risk-rail__item small {
        color: var(--na-text-primary);
        font-size: var(--na-font-size-sm);
    }
    .na-project-risk-rail__item em {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        font-style: normal;
    }
    .na-project-risk__marker {
        display: inline-block;
        flex: 0 0 7px;
        width: 7px;
        height: 7px;
        margin-top: 4px;
        border-radius: 50%;
        background: var(--na-color-info);
    }
    .na-project-risk__marker--high {
        background: var(--na-color-error);
    }
    .na-project-risk__marker--medium {
        background: var(--na-color-warning);
    }
    .na-project-risk__marker--low {
        background: var(--na-color-info);
    }
    .na-project-muted {
        margin: 4px 0;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
    }
    .na-project-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 280px;
        gap: 6px;
        color: var(--na-text-secondary);
        text-align: center;
    }
    .na-project-empty strong {
        color: var(--na-text-primary);
        font-size: var(--na-font-size-lg);
    }
    @container nextaction-app (max-width: 880px) {
        .na-project-workspace {
            grid-template-columns: 190px minmax(0, 1fr);
        }
        .na-project-risk-rail {
            display: none;
        }
        .na-project-toolbar__hint {
            display: none;
        }
    }
    @container nextaction-app (max-width: 780px) {
        .na-project-workspace {
            display: flex;
            flex-direction: column;
            overflow: auto;
        }
        .na-project-index {
            max-height: 190px;
            border-right: 0;
            border-bottom: 1px solid var(--na-color-divider);
        }
        .na-project-canvas {
            overflow: visible;
            padding: 10px;
        }
        .na-project-canvas--gantt {
            min-height: 420px;
            overflow: hidden;
        }
    }
</style>
