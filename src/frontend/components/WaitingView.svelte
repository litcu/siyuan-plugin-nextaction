<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { VIEW_WAITING } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
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

    $: filterState = $taskStore.filterByView[VIEW_WAITING] || DEFAULT_FILTER_STATE;
    $: waitingTasks = $taskStore.allTasks.filter(t => t.status === "waiting");
    $: filteredTasks = applyFilters(waitingTasks, filterState);

    const waitingSortOptions = [
        { value: "order", label: i18n?.sortByOrder || "Comprehensive" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
    ];

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_WAITING, state);
    }
</script>

<div class="na-view na-view--waiting">
    <SearchFilterBar
        contexts={$taskStore.contexts}
        tags={$taskStore.tags}
        filterState={filterState}
        showStatus={false}
        showPriority={false}
        sortOptions={waitingSortOptions}
        {i18n}
        onFilterChange={handleFilterChange}
    />
    {#if $taskStore.loading}
        <NaEmpty loading={true} />
    {:else if filteredTasks.length === 0}
        <NaEmpty text={$taskStore.error || i18n?.noWaitingTasks || "No waiting tasks"} />
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
        </div>
    {/if}
    <NaViewHint text={i18n?.viewHintWaiting} />
</div>
