<script lang="ts">
    import { VIEW_BY_PROJECT } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE, hasActiveTaskFilters, sortTasksBy } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import { buildProjectSummaries, getProjectDateBucket, type ProjectDateBucket } from "../utils/project";
    import TaskCard from "./TaskCard.svelte";
    import GanttView from "./GanttView.svelte";
    import NaBadge from "../ui/NaBadge.svelte";
    import NaButton from "../ui/NaButton.svelte";
    import NaMetricStrip from "../ui/NaMetricStrip.svelte";
    import NaProgressBar from "../ui/NaProgressBar.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";
    import NaTaskFilterBar from "../ui/NaTaskFilterBar.svelte";
    import NaTaskList from "../ui/NaTaskList.svelte";
    import NaToggle from "../ui/NaToggle.svelte";
    import NaToolbar from "../ui/NaToolbar.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";
    import type { ProjectRisk, ProjectSummary, TaskCacheEntry } from "../../shared/types";
    import { taskStore } from "../stores/task-store";
    import { runAiDecomposeTask } from "../ai/ai-feature-service";
    import { buildProjectTreeModel, type ProjectTreeSortMode } from "../utils/project-tree";

    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;
    export let selectedTaskId: string = "";
    export let selectedTaskOverride: TaskCacheEntry | null = null;
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onTaskUpdate: ((task: TaskCacheEntry, attrs: Record<string, string>) => Promise<void>) | undefined = undefined;
    export let onTaskReorder: ((blockId: string, parentId: string, afterId?: string) => Promise<void>) | undefined = undefined;
    export let onCreateChild: ((task: TaskCacheEntry) => void) | undefined = undefined;

    type ProjectViewMode = "overview" | "hierarchy" | "board" | "plan" | "gantt";
    type RiskItem = { summary: ProjectSummary; risk: ProjectRisk; target: TaskCacheEntry };

    const statuses = ["inbox", "todo", "doing", "waiting", "someday", "done"];
    const dateBuckets: ProjectDateBucket[] = ["overdue", "today", "thisWeek", "later", "unscheduled"];
    let mode: ProjectViewMode = "overview";
    let activeProjectId = "";
    let collapsedIds: Set<string> = new Set();
    let draggingId = "";
    let dropStatus = "";
    let dropBusy = false;
    let showCompleted = false;
    let riskFilter = "all";
    let dateFilter = "all";
    let actionFilter = "all";
    let ganttSortMode: ProjectTreeSortMode = "timeline";

    $: filterState = $taskStore.filterByView[VIEW_BY_PROJECT] || DEFAULT_FILTER_STATE;
    $: projectSourceTasks = reconcileProjectTasks($taskStore.allTasks, selectedTaskOverride);
    $: summaries = buildProjectSummaries(projectSourceTasks);
    $: taskFiltersActive = hasActiveTaskFilters(filterState);
    $: filterCandidates = projectSourceTasks.filter(task => showCompleted || task.status !== "done" || task.taskType === "2");
    $: matchedTaskIds = new Set((taskFiltersActive ? applyFilters(filterCandidates, filterState, $taskStore.settings.customFields) : filterCandidates).map(task => task.blockId));
    $: matchingSummaries = summaries.filter(summary => (
        (!taskFiltersActive || matchedTaskIds.has(summary.project.blockId) || summary.descendants.some(task => matchedTaskIds.has(task.blockId)))
        && (showCompleted || summary.health !== "complete")
        && matchesProjectFilters(summary)
    ));
    $: orderedProjectIds = sortTasksBy(matchingSummaries.map(summary => summary.project), filterState.sortBy, filterState.sortAsc, $taskStore.settings.customFields).map(task => task.blockId);
    $: summaryByProjectId = new Map(matchingSummaries.map(summary => [summary.project.blockId, summary]));
    $: visibleSummaries = orderedProjectIds.map(blockId => summaryByProjectId.get(blockId)).filter((summary): summary is ProjectSummary => Boolean(summary));
    $: if (selectedTaskId) {
        const containing = summaries.find(summary => summary.project.blockId === selectedTaskId || summary.descendants.some(task => task.blockId === selectedTaskId));
        if (containing) activeProjectId = containing.project.blockId;
    }
    $: if (!visibleSummaries.some(summary => summary.project.blockId === activeProjectId)) activeProjectId = visibleSummaries[0]?.project.blockId || "";
    $: selectedSummary = visibleSummaries.find(summary => summary.project.blockId === activeProjectId) || null;
    $: riskItems = visibleSummaries.flatMap(summary => summary.risks.map(risk => ({
        summary,
        risk,
        target: summary.descendants.find(task => task.blockId === risk.taskId) || summary.project,
    }))).sort((a, b) => riskWeight(b.risk.severity) - riskWeight(a.risk.severity));
    $: activeProjectsCount = summaries.filter(summary => summary.health !== "complete").length;
    $: attentionCount = summaries.filter(summary => summary.health === "attention" || summary.health === "blocked").length;
    $: overdueCount = summaries.reduce((count, summary) => count + summary.overdueTasks.length, 0);
    $: dueSoonCount = summaries.reduce((count, summary) => count + summary.descendants.filter(task => task.status !== "done" && (getProjectDateBucket(task) === "today" || getProjectDateBucket(task) === "thisWeek")).length, 0);
    $: noActionCount = summaries.filter(summary => summary.risks.some(risk => risk.kind === "noNextAction")).length;
    $: selectedMatchedTaskIds = !selectedSummary || !taskFiltersActive
        ? null
        : new Set(selectedSummary.descendants.filter(task => matchedTaskIds.has(task.blockId)).map(task => task.blockId));
    $: projectTreeModel = selectedSummary ? buildProjectTreeModel(selectedSummary, collapsedIds, {
        showCompleted,
        matchedTaskIds: selectedMatchedTaskIds,
        sortMode: mode === "gantt" ? ganttSortMode : "manual",
    }) : null;
    $: detailTasks = (selectedSummary?.descendants || []).filter(task => (
        (showCompleted || task.status !== "done")
        && (!taskFiltersActive || matchedTaskIds.has(task.blockId))
    ));
    $: sortedDetailTasks = sortTasksBy(detailTasks, filterState.sortBy, filterState.sortAsc, $taskStore.settings.customFields);
    $: planGroups = dateBuckets.map(bucket => ({ bucket, tasks: sortedDetailTasks.filter(task => task.taskType !== "2" && getProjectDateBucket(task) === bucket) })).filter(group => group.tasks.length > 0);
    $: boardTasks = sortedDetailTasks;

    function reconcileProjectTasks(tasks: TaskCacheEntry[], override: TaskCacheEntry | null): TaskCacheEntry[] {
        if (!override) return tasks;
        return tasks.map(task => task.blockId === override.blockId ? override : task);
    }

    function riskWeight(severity: ProjectRisk["severity"]): number {
        return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
    }

    function matchesProjectFilters(summary: ProjectSummary): boolean {
        if (riskFilter === "attention" && summary.health !== "attention") return false;
        if (riskFilter === "blocked" && summary.health !== "blocked") return false;
        if (dateFilter === "overdue" && summary.overdueTasks.length === 0) return false;
        if (dateFilter === "week" && !summary.descendants.some(task => task.status !== "done" && (getProjectDateBucket(task) === "today" || getProjectDateBucket(task) === "thisWeek"))) return false;
        if (actionFilter === "missing" && !summary.risks.some(risk => risk.kind === "noNextAction")) return false;
        if (actionFilter === "available" && summary.nextActions.length === 0) return false;
        return true;
    }

    function statusLabel(status: string): string {
        return i18n?.[`status${status.charAt(0).toUpperCase()}${status.slice(1)}`] || status;
    }

    function statusTone(status: string): "neutral" | "primary" | "info" | "success" | "warning" | "danger" {
        if (status === "done") return "success";
        if (status === "doing") return "primary";
        if (status === "waiting") return "warning";
        if (status === "someday") return "neutral";
        return "info";
    }

    function riskLabel(kind: ProjectRisk["kind"]): string {
        return i18n?.[`projectRisk${kind.charAt(0).toUpperCase()}${kind.slice(1)}`] || kind;
    }

    function bucketLabel(bucket: ProjectDateBucket): string {
        return i18n?.[`projectPlan${bucket.charAt(0).toUpperCase()}${bucket.slice(1)}`] || bucket;
    }

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_BY_PROJECT, state);
    }

    function handleModeChange(event: CustomEvent<string>) {
        mode = event.detail as ProjectViewMode;
    }

    function selectProject(summary: ProjectSummary) {
        activeProjectId = summary.project.blockId;
    }

    function workItemCount(summary: ProjectSummary): number {
        return summary.doneCount + summary.openCount;
    }

    function toggleCollapse(blockId: string) {
        const next = new Set(collapsedIds);
        if (next.has(blockId)) next.delete(blockId);
        else next.add(blockId);
        collapsedIds = next;
    }

    function handleDragStart(task: TaskCacheEntry, event: DragEvent) {
        draggingId = task.blockId;
        event.dataTransfer?.setData("text/plain", task.blockId);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    }

    function handleDragEnd() {
        draggingId = "";
        dropStatus = "";
    }

    async function handleDrop(status: string, afterId = "") {
        if (!draggingId || !selectedSummary || dropBusy) return;
        const task = selectedSummary.descendants.find(entry => entry.blockId === draggingId);
        if (!task) return;
        dropBusy = true;
        try {
            if (task.status !== status && onTaskUpdate) await onTaskUpdate(task, { "na-status": status });
            if (onTaskReorder) await onTaskReorder(task.blockId, task.parentId || selectedSummary.project.blockId, afterId || undefined);
        } catch (error) {
            console.error("[NextAction] project board drop failed:", error);
        } finally {
            dropBusy = false;
            handleDragEnd();
        }
    }
</script>

<NaViewShell loading={$taskStore.loading && summaries.length === 0} empty={visibleSummaries.length === 0} emptyText={$taskStore.error || i18n?.noResults || i18n?.noProjects || "No projects yet"} hint={i18n?.viewHintProject}>
    <svelte:fragment slot="toolbar">
        <NaToolbar compact>
            <NaMetricStrip items={[
                { value: activeProjectsCount, label: i18n?.projectMetricActive || "Active", tone: "info" },
                { value: attentionCount, label: i18n?.projectMetricAttention || "Attention", tone: attentionCount > 0 ? "warning" : "success" },
                { value: overdueCount, label: i18n?.projectMetricOverdue || "Overdue", tone: overdueCount > 0 ? "danger" : "success" },
                { value: dueSoonCount, label: i18n?.projectMetricDueSoon || "7 days", tone: "primary" },
                { value: noActionCount, label: i18n?.projectMetricNoAction || "No next action", tone: noActionCount > 0 ? "warning" : "success" },
            ]} />
            <div class="na-toolbar__actions-content">
                <NaButton size="sm" icon="iconAdd" disabled={!selectedSummary} on:click={() => selectedSummary && onCreateChild?.(selectedSummary.project)}>{i18n?.createChildTask || "Create child task"}</NaButton>
                <NaButton size="sm" icon="iconSparkles" disabled={!selectedSummary} on:click={() => selectedSummary && runAiDecomposeTask(selectedSummary.project)}>{i18n?.aiDecomposeProject || "Break down project with AI"}</NaButton>
            </div>
        </NaToolbar>
        <div class="na-project-toolbar">
            <div class="na-project-toolbar__view-switcher">
                <NaSegmentControl size="sm" value={mode} options={[
                    { value: "overview", label: i18n?.projectViewOverview || "Overview" },
                    { value: "hierarchy", label: i18n?.projectViewHierarchy || "Hierarchy" },
                    { value: "board", label: i18n?.projectViewBoard || "Board" },
                    { value: "plan", label: i18n?.projectViewPlan || "Plan" },
                    { value: "gantt", label: i18n?.projectViewGantt || "Gantt" },
                ]} on:change={handleModeChange} />
            </div>
            <div class="na-project-toolbar__completed">
                <NaToggle checked={showCompleted} label={i18n?.projectShowCompleted || "Show completed"} on:change={(event) => showCompleted = event.detail.checked} />
                <span>{i18n?.projectShowCompleted || "Show completed"}</span>
            </div>
            <select class="na-select na-select--sm na-project-toolbar__select" bind:value={riskFilter} aria-label={i18n?.projectFilterRisk || "Risk filter"}>
                <option value="all">{i18n?.projectFilterAllRisks || "All risks"}</option>
                <option value="attention">{i18n?.projectHealthAttention || "Attention"}</option>
                <option value="blocked">{i18n?.projectHealthBlocked || "Blocked"}</option>
            </select>
            <select class="na-select na-select--sm na-project-toolbar__select" bind:value={dateFilter} aria-label={i18n?.projectFilterDate || "Date filter"}>
                <option value="all">{i18n?.projectFilterAllDates || "All dates"}</option>
                <option value="overdue">{i18n?.projectRiskOverdue || "Overdue"}</option>
                <option value="week">{i18n?.projectMetricDueSoon || "Due in 7 days"}</option>
            </select>
            <select class="na-select na-select--sm na-project-toolbar__select" bind:value={actionFilter} aria-label={i18n?.projectFilterAction || "Next action filter"}>
                <option value="all">{i18n?.projectFilterAllActions || "All actions"}</option>
                <option value="missing">{i18n?.projectRiskNoNextAction || "No next action"}</option>
                <option value="available">{i18n?.projectNextActions || "Next actions"}</option>
            </select>
            <span class="na-project-toolbar__hint">{i18n?.projectControlHint || "Select a project to inspect its momentum and risks"}</span>
        </div>
        <NaTaskFilterBar contexts={$taskStore.contexts} tags={$taskStore.tags} customFields={$taskStore.settings.customFields} filterState={filterState} showStatus={true} searchPlaceholder={i18n?.searchProjectsAndTasks || "Search projects and tasks..."} {i18n} on:change={(event) => handleFilterChange(event.detail)} />
    </svelte:fragment>

    <div class="na-project-workspace" class:na-project-workspace--focus={mode !== "overview"}>
        <aside class="na-project-index" aria-label={i18n?.projectList || "Project list"}>
            <div class="na-project-index__header">
                <span>{i18n?.projectList || "Projects"}</span>
                <span class="na-project-index__count">{visibleSummaries.length}</span>
            </div>
            <div class="na-project-index__scroll">
                {#each visibleSummaries as summary (summary.project.blockId)}
                    <button type="button" class="na-project-index__item" class:active={summary.project.blockId === activeProjectId} on:click={() => selectProject(summary)}>
                        <span class="na-project-index__item-accent na-project-index__item-accent--{summary.health}"></span>
                        <span class="na-project-index__item-copy">
                            <strong>{summary.project.title || i18n?.untitled || "(untitled)"}</strong>
                            <span>{summary.doneCount}/{workItemCount(summary)} · {summary.nextActions.length} {i18n?.projectNextShort || "next"}</span>
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
                        <span>{selectedSummary.openCount} {i18n?.projectOpenTasks || "open tasks"} · {selectedSummary.risks.length} {i18n?.projectRisks || "risks"}</span>
                    </div>
                    <div class="na-project-canvas__actions">
                        <NaBadge text={statusLabel(selectedSummary.project.status)} tone={statusTone(selectedSummary.project.status)} />
                        <NaButton size="sm" on:click={() => onEdit(selectedSummary.project)}>{i18n?.editProject || "Edit project"}</NaButton>
                    </div>
                </div>
                <div class="na-project-canvas__progress">
                    <NaProgressBar percent={selectedSummary.progress} label={`${selectedSummary.doneCount}/${workItemCount(selectedSummary)} ${i18n?.completedTasks || "completed"}`} />
                </div>

                {#if mode === "overview"}
                    <div class="na-project-overview">
                        <section class="na-project-section na-project-section--risks">
                            <div class="na-project-section__heading"><h3>{i18n?.projectRisks || "Risks"}</h3><span>{selectedSummary.risks.length}</span></div>
                            {#if selectedSummary.risks.length === 0}
                                <p class="na-project-muted">{i18n?.projectNoRisks || "No obvious risks"}</p>
                            {:else}
                                {#each selectedSummary.risks as item (item.kind + item.taskId)}
                                    {@const target = selectedSummary.descendants.find(task => task.blockId === item.taskId) || selectedSummary.project}
                                    <button type="button" class="na-project-risk" on:click={() => onSelectTask?.(target)}>
                                        <span class="na-project-risk__marker na-project-risk__marker--{item.severity}"></span>
                                        <span><strong>{riskLabel(item.kind)}</strong><small>{target.title || i18n?.untitled || "(untitled)"}</small></span>
                                    </button>
                                {/each}
                            {/if}
                        </section>
                        <section class="na-project-section">
                            <div class="na-project-section__heading"><h3>{i18n?.projectNextActions || "Next actions"}</h3><span>{selectedSummary.nextActions.length}</span></div>
                            {#if selectedSummary.nextActions.length === 0}
                                <p class="na-project-muted">{i18n?.projectNoNextActions || "No available next action"}</p>
                            {:else}
                                <NaTaskList>
                                <div class="na-project-task-stack">
                                    {#each selectedSummary.nextActions.slice(0, 5) as task (task.blockId)}
                                        <TaskCard task={task} selected={task.blockId === selectedTaskId} onSelect={onSelectTask} {onEdit} {onStatusClick} {onContextMenu} {i18n} isRoot={false} />
                                    {/each}
                                </div>
                                </NaTaskList>
                            {/if}
                        </section>
                        <section class="na-project-section">
                            <div class="na-project-section__heading"><h3>{i18n?.projectSnapshot || "Snapshot"}</h3></div>
                            <dl class="na-project-facts">
                                <div><dt>{i18n?.status || "Status"}</dt><dd>{statusLabel(selectedSummary.project.status)}</dd></div>
                                <div><dt>{i18n?.dueDate || "Due"}</dt><dd>{selectedSummary.project.due || i18n?.projectNoDue || "No date"}</dd></div>
                                <div><dt>{i18n?.projectWaiting || "Waiting"}</dt><dd>{selectedSummary.waitingTasks.length}</dd></div>
                                <div><dt>{i18n?.blocked || "Blocked"}</dt><dd>{selectedSummary.blockedTasks.length}</dd></div>
                            </dl>
                        </section>
                    </div>
                {:else if mode === "hierarchy"}
                    <div class="na-project-tree">
                        {#each projectTreeModel?.rows || [] as row (row.task.blockId)}
                            <div class="na-project-tree__row" style="padding-left: {row.depth * 18}px" draggable="true" on:dragstart={(event) => handleDragStart(row.task, event)} on:dragend={handleDragEnd}>
                                <TaskCard
                                    task={row.task}
                                    selected={row.task.blockId === selectedTaskId}
                                    onSelect={onSelectTask}
                                    {onEdit}
                                    {onStatusClick}
                                    {onContextMenu}
                                    {i18n}
                                    hasChildren={row.hasChildren}
                                    isCollapsed={collapsedIds.has(row.task.blockId)}
                                    childCount={row.childCount}
                                    onToggleCollapse={() => toggleCollapse(row.task.blockId)}
                                    isRoot={row.depth === 0}
                                />
                            </div>
                        {/each}
                    </div>
                {:else if mode === "board"}
                    <div class="na-project-board">
                        {#each statuses as status}
                            <section class="na-project-board__column" class:drop-active={dropStatus === status} on:dragover|preventDefault={() => dropStatus = status} on:dragleave={() => dropStatus = ""} on:drop|preventDefault={() => handleDrop(status)}>
                                <header><span>{statusLabel(status)}</span><span>{boardTasks.filter(task => task.status === status).length}</span></header>
                                <div class="na-project-board__cards">
                                    {#each boardTasks.filter(task => task.status === status).sort((a, b) => a.sort - b.sort) as task (task.blockId)}
                                        <div class="na-project-board__card" draggable="true" on:dragstart={(event) => handleDragStart(task, event)} on:dragend={handleDragEnd} on:dragover|preventDefault={() => dropStatus = status} on:drop|preventDefault|stopPropagation={() => handleDrop(status, task.blockId)}>
                                            <TaskCard {task} selected={task.blockId === selectedTaskId} onSelect={onSelectTask} {onEdit} {onStatusClick} {onContextMenu} {i18n} isRoot={false} />
                                        </div>
                                    {/each}
                                    {#if boardTasks.filter(task => task.status === status).length === 0}<p class="na-project-board__empty">{i18n?.projectDropHere || "Drop tasks here"}</p>{/if}
                                </div>
                            </section>
                        {/each}
                    </div>
                {:else if mode === "plan"}
                    <div class="na-project-plan">
                        {#each planGroups as group (group.bucket)}
                            <section class="na-project-plan__group">
                                <header><h3>{bucketLabel(group.bucket)}</h3><span>{group.tasks.length}</span></header>
                                {#each group.tasks as task (task.blockId)}
                                    <div class="na-project-plan__row"><TaskCard {task} selected={task.blockId === selectedTaskId} onSelect={onSelectTask} {onEdit} {onStatusClick} {onContextMenu} {i18n} isRoot={false} />{#if group.bucket !== "unscheduled"}<span class="na-project-plan__date">{task.due || task.start}</span>{/if}</div>
                                {/each}
                            </section>
                        {/each}
                        {#if planGroups.length === 0}<p class="na-project-muted">{i18n?.projectNoPlan || "No dated tasks in this project"}</p>{/if}
                    </div>
                {:else if mode === "gantt" && projectTreeModel}
                    <GanttView
                        model={projectTreeModel}
                        projectTasks={[selectedSummary.project, ...selectedSummary.descendants]}
                        {collapsedIds}
                        {selectedTaskId}
                        {i18n}
                        sortMode={ganttSortMode}
                        onSortModeChange={(value) => ganttSortMode = value}
                        onToggleCollapse={toggleCollapse}
                        {onSelectTask}
                        {onEdit}
                        {onContextMenu}
                    />
                {/if}
            {:else}
                <div class="na-project-empty"><strong>{i18n?.projectSelectTitle || "Select a project"}</strong><span>{i18n?.projectSelectHint || "Choose a project to inspect its progress and risks."}</span></div>
            {/if}
        </section>

        {#if mode === "overview"}
            <aside class="na-project-risk-rail">
                <div class="na-project-risk-rail__header"><span>{i18n?.projectRiskQueue || "Risk queue"}</span><span>{riskItems.length}</span></div>
                {#each riskItems.slice(0, 10) as item (item.risk.kind + item.risk.taskId)}
                    <button type="button" class="na-project-risk-rail__item" on:click={() => { activeProjectId = item.summary.project.blockId; onSelectTask?.(item.target); }}>
                        <span class="na-project-risk__marker na-project-risk__marker--{item.risk.severity}"></span>
                        <span><strong>{riskLabel(item.risk.kind)}</strong><small>{item.target.title || i18n?.untitled || "(untitled)"}</small><em>{item.summary.project.title || i18n?.untitled || "(untitled)"}</em></span>
                    </button>
                {/each}
                {#if riskItems.length === 0}<p class="na-project-muted">{i18n?.projectNoRisks || "No obvious risks"}</p>{/if}
            </aside>
        {/if}
    </div>
</NaViewShell>

<style lang="scss">
    .na-project-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; padding: 8px 12px; }
    .na-project-toolbar__view-switcher { max-width: 100%; overflow-x: auto; scrollbar-width: thin; }
    .na-project-toolbar__view-switcher :global(.na-segment-control) { width: max-content; }
    .na-project-toolbar__completed { display: inline-flex; align-items: center; gap: 6px; color: var(--na-text-secondary); font-size: var(--na-font-size-xs); cursor: pointer; white-space: nowrap; }
    .na-project-toolbar__select { width: auto; min-width: 86px; }
    .na-project-toolbar__hint { color: var(--na-text-secondary); font-size: var(--na-font-size-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .na-project-workspace { display: grid; grid-template-columns: minmax(185px, 24%) minmax(0, 1fr) minmax(180px, 22%); min-height: 0; height: 100%; overflow: hidden; background: var(--b3-theme-background); }
    :global(.na-toolbar__main):has(> .na-toolbar__actions-content) { flex-wrap: wrap; }
    .na-toolbar__actions-content { flex-shrink: 0; }
    .na-project-workspace--focus { grid-template-columns: minmax(185px, 24%) minmax(0, 1fr); }
    .na-project-index, .na-project-risk-rail { min-width: 0; border-right: 1px solid var(--na-color-divider); background: color-mix(in srgb, var(--b3-theme-surface) 82%, var(--b3-theme-background)); }
    .na-project-risk-rail { border-right: 0; border-left: 1px solid var(--na-color-divider); }
    .na-project-index__header, .na-project-risk-rail__header { display: flex; align-items: center; justify-content: space-between; padding: 11px 12px 8px; color: var(--na-text-secondary); font-size: var(--na-font-size-xs); font-weight: 700; letter-spacing: 0; text-transform: uppercase; }
    .na-project-index__count, .na-project-risk-rail__header > span:last-child { color: var(--na-accent); font-variant-numeric: tabular-nums; }
    .na-project-index__scroll, .na-project-risk-rail { overflow: auto; }
    .na-project-index__item, .na-project-risk-rail__item { width: 100%; display: flex; align-items: center; gap: 8px; min-width: 0; padding: 9px 10px; border: 0; border-top: 1px solid color-mix(in srgb, var(--na-color-divider) 65%, transparent); color: var(--na-text-primary); background: transparent; text-align: left; cursor: pointer; }
    .na-project-index__item:hover, .na-project-index__item.active, .na-project-risk-rail__item:hover { background: var(--na-color-hover-bg); }
    .na-project-index__item.active { box-shadow: inset 3px 0 var(--na-accent); }
    .na-project-index__item-accent { flex: 0 0 5px; height: 30px; border-radius: 2px; background: var(--na-color-info); }
    .na-project-index__item-accent--attention { background: var(--na-color-warning); } .na-project-index__item-accent--blocked { background: var(--na-color-error); } .na-project-index__item-accent--complete { background: var(--na-color-success); }
    .na-project-index__item-copy { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: 2px; }
    .na-project-index__item-copy strong, .na-project-risk-rail__item strong, .na-project-risk-rail__item small, .na-project-risk-rail__item em { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .na-project-index__item-copy strong { font-size: var(--na-font-size-md); font-weight: 600; letter-spacing: 0; }
    .na-project-index__item-copy span { color: var(--na-text-secondary); font-size: var(--na-font-size-xs); }
    .na-project-canvas { display: flex; min-width: 0; min-height: 0; flex-direction: column; overflow: auto; padding: 14px; }
    .na-project-canvas--gantt { overflow: hidden; }
    .na-project-canvas__header { display: flex; justify-content: space-between; gap: 14px; margin-bottom: 8px; }
    .na-project-canvas__title { min-width: 0; } .na-project-canvas__kicker { color: var(--na-accent); font-size: var(--na-font-size-xs); font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
    .na-project-canvas h2 { margin: 2px 0; font-size: 18px; line-height: 24px; font-weight: 650; letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .na-project-canvas__title > span:last-child { color: var(--na-text-secondary); font-size: var(--na-font-size-sm); }
    .na-project-canvas__actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
    .na-project-canvas__progress { margin-bottom: 14px; }
    .na-project-overview { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .na-project-section { min-width: 0; padding: 12px; border-top: 2px solid var(--na-color-divider); background: var(--b3-theme-surface); }
    .na-project-section--risks { border-top-color: var(--na-color-warning); }
    .na-project-section__heading { display: flex; justify-content: space-between; margin-bottom: 8px; color: var(--na-text-secondary); }
    .na-project-section__heading h3 { margin: 0; color: var(--na-text-primary); font-size: var(--na-font-size-md); font-weight: 700; }
    .na-project-section__heading > span { font-size: var(--na-font-size-xs); font-variant-numeric: tabular-nums; }
    .na-project-risk, .na-project-risk-rail__item { border: 0; background: transparent; }
    .na-project-risk { display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 7px 0; text-align: left; color: var(--na-text-primary); cursor: pointer; }
    .na-project-risk:hover { color: var(--na-accent); }
    .na-project-risk > span:last-child, .na-project-risk-rail__item > span:last-child { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
    .na-project-risk strong, .na-project-risk-rail__item strong { font-size: var(--na-font-size-sm); font-weight: 650; }
    .na-project-risk small, .na-project-risk-rail__item small { color: var(--na-text-primary); font-size: var(--na-font-size-sm); }
    .na-project-risk-rail__item em { color: var(--na-text-secondary); font-size: var(--na-font-size-xs); font-style: normal; }
    .na-project-risk__marker { display: inline-block; flex: 0 0 7px; width: 7px; height: 7px; margin-top: 4px; border-radius: 50%; background: var(--na-color-info); }
    .na-project-risk__marker--high { background: var(--na-color-error); } .na-project-risk__marker--medium { background: var(--na-color-warning); } .na-project-risk__marker--low { background: var(--na-color-info); }
    .na-project-muted { margin: 4px 0; color: var(--na-text-secondary); font-size: var(--na-font-size-sm); }
    .na-project-task-stack { display: flex; flex-direction: column; gap: 4px; }
    .na-project-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0; }
    .na-project-facts div { min-width: 0; padding: 7px 8px; background: var(--na-task-card-meta-bg); }
    .na-project-facts dt { color: var(--na-text-secondary); font-size: var(--na-font-size-xs); } .na-project-facts dd { margin: 2px 0 0; color: var(--na-text-primary); font-size: var(--na-font-size-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .na-project-tree { display: flex; flex-direction: column; gap: 4px; }
    .na-project-tree__row { display: flex; align-items: center; }
    .na-project-tree__row :global(.na-task-card) { flex: 1; min-width: 0; }
    .na-project-board { display: grid; flex: 1 1 auto; grid-template-columns: repeat(6, minmax(150px, 1fr)); gap: 8px; min-width: 900px; min-height: 0; align-items: stretch; }
    .na-project-board__column { min-height: 260px; height: 100%; border: 1px solid var(--na-color-divider); background: color-mix(in srgb, var(--b3-theme-surface) 78%, var(--b3-theme-background)); transition: border-color .15s, background-color .15s; }
    .na-project-board__column.drop-active { border-color: var(--na-accent); background: var(--na-color-selected-bg); }
    .na-project-board__column > header, .na-project-plan__group > header { display: flex; justify-content: space-between; padding: 9px 10px; border-bottom: 1px solid var(--na-color-divider); color: var(--na-text-secondary); font-size: var(--na-font-size-xs); font-weight: 700; text-transform: uppercase; }
    .na-project-board__cards { display: flex; flex-direction: column; gap: 5px; padding: 6px; min-height: 220px; }
    .na-project-board__card { cursor: grab; } .na-project-board__card:active { cursor: grabbing; }
    .na-project-board__empty { margin: 14px 6px; color: var(--na-text-secondary); font-size: var(--na-font-size-xs); text-align: center; }
    .na-project-plan { display: flex; flex-direction: column; gap: 10px; }
    .na-project-plan__group { border-top: 2px solid var(--na-color-divider); background: var(--b3-theme-surface); }
    .na-project-plan__row { display: flex; align-items: center; gap: 8px; padding: 4px; border-bottom: 1px solid color-mix(in srgb, var(--na-color-divider) 60%, transparent); }
    .na-project-plan__row :global(.na-task-card) { flex: 1; min-width: 0; } .na-project-plan__date { flex: 0 0 82px; color: var(--na-text-secondary); font-size: var(--na-font-size-xs); text-align: right; }
    .na-project-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 280px; gap: 6px; color: var(--na-text-secondary); text-align: center; } .na-project-empty strong { color: var(--na-text-primary); font-size: var(--na-font-size-lg); }
    @container nextaction-app (max-width: 880px) { .na-project-workspace { grid-template-columns: 190px minmax(0, 1fr); } .na-project-risk-rail { display: none; } .na-project-overview { grid-template-columns: 1fr; } .na-project-toolbar__hint { display: none; } }
    @container nextaction-app (max-width: 780px) { .na-project-workspace { display: flex; flex-direction: column; overflow: auto; } .na-project-index { max-height: 190px; border-right: 0; border-bottom: 1px solid var(--na-color-divider); } .na-project-canvas { overflow: visible; padding: 10px; } .na-project-canvas--gantt { min-height: 420px; overflow: hidden; } .na-project-board { min-width: 760px; } }
</style>
