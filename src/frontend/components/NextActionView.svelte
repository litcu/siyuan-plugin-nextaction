<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { VIEW_NEXT_ACTION } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE, isNextActionCandidate } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import NaViewHint from "../ui/NaViewHint.svelte";
    import SearchFilterBar from "./SearchFilterBar.svelte";
    import type { TaskCacheEntry } from "../../shared/types";

    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;
    export let selectedTaskId: string = "";
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;

    $: filterState = $taskStore.filterByView[VIEW_NEXT_ACTION] || DEFAULT_FILTER_STATE;
    $: nextActionTasks = $taskStore.allTasks.filter(t => isNextActionCandidate(t, $taskStore.settings.priorityEngine.startPreviewDays));
    $: filteredTasks = applyFilters(nextActionTasks, filterState);

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_NEXT_ACTION, state);
    }
</script>

<div class="na-view na-view--next-action">
    <SearchFilterBar
        contexts={$taskStore.contexts}
        tags={$taskStore.tags}
        filterState={filterState}
        showStatus={false}
        {i18n}
        onFilterChange={handleFilterChange}
    />
    {#if $taskStore.loading}
        <NaEmpty loading={true} />
    {:else if filteredTasks.length === 0}
        <NaEmpty text={$taskStore.error || i18n?.noResults || i18n?.noTasks || "No tasks yet"} />
    {:else}
        <div class="na-view__list">
            {#each filteredTasks as task (task.blockId)}
                <TaskCard
                    {task}
                    selected={task.blockId === selectedTaskId}
                    onSelect={onSelectTask}
                    {onEdit}
                    {onStatusClick}
                    {onContextMenu}
                    {i18n}
                />
            {/each}

            {#if $taskStore.projectReminders && $taskStore.projectReminders.length > 0}
                <div class="na-project-reminders">
                    <div class="na-project-reminders__header">{i18n?.projectReminders || "Projects to Close"}</div>
                    {#each $taskStore.projectReminders as project (project.blockId)}
                        <TaskCard
                            task={project}
                            {onEdit}
                            {onStatusClick}
                            {onContextMenu}
                            {i18n}
                        />
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
    <NaViewHint text={i18n?.viewHintNextAction} />
</div>
