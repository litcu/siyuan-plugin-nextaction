<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { VIEW_NEXT_ACTION } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE, isNextActionCandidate } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaAccordion from "../ui/NaAccordion.svelte";
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

    $: filterState = $taskStore.filterByView[VIEW_NEXT_ACTION] || DEFAULT_FILTER_STATE;
    $: nextActionTasks = $taskStore.allTasks.filter((t) =>
        isNextActionCandidate(t, $taskStore.settings.priorityEngine.startPreviewDays),
    );
    $: filteredTasks = applyFilters(nextActionTasks, filterState, $taskStore.settings.customFields);

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_NEXT_ACTION, state);
    }
</script>

<NaViewShell
    loading={$taskStore.loading}
    empty={filteredTasks.length === 0 && (!$taskStore.projectReminders || $taskStore.projectReminders.length === 0)}
    emptyText={$taskStore.error || i18n?.noResults || i18n?.noTasks || "No tasks yet"}
    hint={i18n?.viewHintNextAction}
>
    <svelte:fragment slot="toolbar"
        ><NaTaskFilterBar
            contexts={$taskStore.contexts}
            tags={$taskStore.tags}
            customFields={$taskStore.settings.customFields}
            {filterState}
            showStatus={false}
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

        {#if $taskStore.projectReminders && $taskStore.projectReminders.length > 0}
            <NaAccordion
                title={i18n?.projectReminders || "Projects to Close"}
                count={$taskStore.projectReminders.length}
                open={true}
                variant="plain"
            >
                {#each $taskStore.projectReminders as project (project.blockId)}
                    <TaskCard task={project} {onEdit} {onStatusClick} {onContextMenu} {i18n} />
                {/each}
            </NaAccordion>
        {/if}
    </NaTaskList>
</NaViewShell>
