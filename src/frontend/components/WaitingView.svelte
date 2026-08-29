<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { VIEW_WAITING } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE, hasActiveTaskFilters } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaTaskFilterBar from "../ui/NaTaskFilterBar.svelte";
    import NaTaskList from "../ui/NaTaskList.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";
    import type { TaskCacheEntry } from "../../shared/types";

    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;
    export let selectedTaskId: string = "";
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onCreate: () => void;

    $: filterState = $taskStore.filterByView[VIEW_WAITING] || DEFAULT_FILTER_STATE;
    $: waitingTasks = $taskStore.allTasks.filter((t) => t.status === "waiting");
    $: filteredTasks = applyFilters(waitingTasks, filterState, $taskStore.settings.customFields);
    $: emptyAction = hasActiveTaskFilters(filterState)
        ? {
              label: i18n?.clearFilter || "Clear filters",
              onClick: () => taskStore.setFilterState(VIEW_WAITING, DEFAULT_FILTER_STATE),
          }
        : { label: i18n?.createTask || "Create task", onClick: onCreate };

    const waitingSortOptions = [
        { value: "order", label: i18n?.sortByOrder || "Comprehensive" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
    ];

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_WAITING, state);
    }
</script>

<NaViewShell
    loading={$taskStore.loading}
    error={$taskStore.error}
    retryAction={{ label: i18n?.retry || "Retry", onClick: () => taskStore.loadTasks() }}
    loadingText={i18n?.loading || "Loading..."}
    empty={filteredTasks.length === 0}
    emptyText={i18n?.noWaitingTasks || "No waiting tasks"}
    {emptyAction}
    hint={i18n?.viewHintWaiting}
>
    <svelte:fragment slot="toolbar"
        ><NaTaskFilterBar
            contexts={$taskStore.contexts}
            tags={$taskStore.tags}
            customFields={$taskStore.settings.customFields}
            {filterState}
            showStatus={false}
            showPriority={false}
            sortOptions={waitingSortOptions}
            {i18n}
            on:change={(event) => handleFilterChange(event.detail)}
        /></svelte:fragment
    >
    <NaTaskList>
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
    </NaTaskList>
</NaViewShell>
