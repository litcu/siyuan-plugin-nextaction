<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { VIEW_BY_PROJECT } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaProgressBar from "../ui/NaProgressBar.svelte";
    import NaButton from "../ui/NaButton.svelte";
    import NaMetricStrip from "../ui/NaMetricStrip.svelte";
    import NaTaskFilterBar from "../ui/NaTaskFilterBar.svelte";
    import NaTaskList from "../ui/NaTaskList.svelte";
    import NaToolbar from "../ui/NaToolbar.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";
    import type { TaskCacheEntry } from "../../shared/types";
    import { runAiDecomposeTask } from "../ai/ai-feature-service";

    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;
    export let selectedTaskId: string = "";
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;

    let collapsedIds: Set<string> = new Set();

    $: filterState = $taskStore.filterByView[VIEW_BY_PROJECT] || DEFAULT_FILTER_STATE;
    $: filteredTasks = applyFilters($taskStore.allTasks.filter(t => t.status !== "done"), filterState, $taskStore.settings.customFields);
    $: projects = filteredTasks.filter(t => t.taskType === "2");
    $: childrenByParent = buildChildrenMap(filteredTasks);
    $: selectedProject = projects.find(project => project.blockId === selectedTaskId);

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_BY_PROJECT, state);
    }

    function buildChildrenMap(tasks: TaskCacheEntry[]): Map<string, TaskCacheEntry[]> {
        const map = new Map<string, TaskCacheEntry[]>();
        for (const t of tasks) {
            if (!t.parentId) continue;
            const children = map.get(t.parentId) || [];
            children.push(t);
            map.set(t.parentId, children);
        }
        return map;
    }

    function toggleCollapse(blockId: string) {
        const next = new Set(collapsedIds);
        if (next.has(blockId)) {
            next.delete(blockId);
        } else {
            next.add(blockId);
        }
        collapsedIds = next;
    }

    function getProjectProgress(project: TaskCacheEntry): { done: number; total: number; percent: number } {
        const allTaskMap = new Map($taskStore.allTasks.map(task => [task.blockId, task]));
        const children = project.childIds
            .map(id => allTaskMap.get(id))
            .filter(Boolean) as TaskCacheEntry[];
        const done = children.filter(c => c.status === "done").length;
        const total = children.length;
        return { done, total, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
    }
</script>

<NaViewShell loading={$taskStore.loading && projects.length === 0} empty={projects.length === 0} emptyText={$taskStore.error || i18n?.noResults || i18n?.noProjects || "No projects yet"} hint={i18n?.viewHintProject}>
    <svelte:fragment slot="toolbar">
        <NaToolbar compact>
            <NaMetricStrip items={[{ value: projects.length, label: i18n?.projects || i18n?.byProject || "Projects", tone: "info" }]} />
            <div class="na-toolbar__actions-content"><NaButton size="sm" icon="iconSparkles" disabled={!selectedProject} on:click={() => selectedProject && runAiDecomposeTask(selectedProject)}>{i18n?.aiDecomposeTask || "AI 拆解任务"}</NaButton></div>
        </NaToolbar>
        <NaTaskFilterBar
        contexts={$taskStore.contexts}
        tags={$taskStore.tags}
        customFields={$taskStore.settings.customFields}
        filterState={filterState}
        showStatus={true}
        {i18n}
        on:change={(event) => handleFilterChange(event.detail)}
        />
    </svelte:fragment>
        <NaTaskList>
            {#each projects as project (project.blockId)}
                {@const children = (childrenByParent.get(project.blockId) || []).sort((a, b) => a.sort - b.sort)}
                {@const progress = getProjectProgress(project)}
                <div class="na-project-item">
                    <div class="na-project-item__header" on:click={() => toggleCollapse(project.blockId)}>
                        <TaskCard
                            task={project}
                            selected={project.blockId === selectedTaskId}
                            onSelect={onSelectTask}
                            {onEdit}
                            {onStatusClick}
                            {onContextMenu}
                            {i18n}
                        />
                        <NaProgressBar
                            percent={progress.percent}
                            label="{progress.done}/{progress.total} {i18n?.completedTasks || 'completed'}"
                        />
                    </div>
                    {#if !collapsedIds.has(project.blockId) && children.length > 0}
                        <div class="na-project-item__children">
                            {#each children as child (child.blockId)}
                                <TaskCard
                                    task={child}
                                    selected={child.blockId === selectedTaskId}
                                    onSelect={onSelectTask}
                                    {onEdit}
                                    {onStatusClick}
                                    {onContextMenu}
                                    {i18n}
                                />
                            {/each}
                        </div>
                    {/if}
                </div>
            {/each}
        </NaTaskList>
</NaViewShell>
