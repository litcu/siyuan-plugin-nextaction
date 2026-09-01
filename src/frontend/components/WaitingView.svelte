<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { VIEW_WAITING } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaTaskFilterBar from "../ui/NaTaskFilterBar.svelte";
    import NaTaskList from "../ui/NaTaskList.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";
    import type { TaskCacheEntry } from "../../shared/types";

    interface Props {
        onEdit: (task: TaskCacheEntry) => void;
        onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
        onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
        i18n: any;
        selectedTaskId?: string;
        onSelectTask?: ((task: TaskCacheEntry) => void) | undefined;
    }

    let { onEdit, onStatusClick, onContextMenu, i18n, selectedTaskId = "", onSelectTask = undefined }: Props = $props();

    let filterState = $derived($taskStore.filterByView[VIEW_WAITING] || DEFAULT_FILTER_STATE);
    let waitingTasks = $derived($taskStore.allTasks.filter((t) => t.status === "waiting"));
    let filteredTasks = $derived(applyFilters(waitingTasks, filterState, $taskStore.settings.customFields));

    let waitingSortOptions = $derived([
        { value: "order", label: i18n?.sortByOrder || "Comprehensive" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
    ]);

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_WAITING, state);
    }
</script>

<NaViewShell
    loading={$taskStore.loading}
    empty={filteredTasks.length === 0}
    emptyText={$taskStore.error || i18n?.noWaitingTasks || "No waiting tasks"}
    hint={i18n?.viewHintWaiting}
>
    {#snippet toolbar()}<NaTaskFilterBar
            contexts={$taskStore.contexts}
            tags={$taskStore.tags}
            customFields={$taskStore.settings.customFields}
            {filterState}
            showStatus={false}
            showPriority={false}
            sortOptions={waitingSortOptions}
            {i18n}
            onChange={handleFilterChange}
        />{/snippet}
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
