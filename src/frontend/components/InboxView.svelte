<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { VIEW_INBOX } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE, hasActiveTaskFilters } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaTaskFilterBar from "../ui/NaTaskFilterBar.svelte";
    import NaTaskList from "../ui/NaTaskList.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";
    import type { TaskCacheEntry } from "../../shared/types";
    import type { KernelBridge } from "../kernel-bridge";

    export let bridge: KernelBridge;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;
    export let selectedTaskId: string = "";
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onCreate: () => void;

    $: filterState = $taskStore.filterByView[VIEW_INBOX] || DEFAULT_FILTER_STATE;
    $: inboxTasks = $taskStore.allTasks.filter((t) => t.status === "inbox");
    $: filteredTasks = applyFilters(inboxTasks, filterState, $taskStore.settings.customFields);
    $: emptyAction = hasActiveTaskFilters(filterState)
        ? {
              label: i18n?.clearFilter || "Clear filters",
              onClick: () => taskStore.setFilterState(VIEW_INBOX, DEFAULT_FILTER_STATE),
          }
        : { label: i18n?.createTask || "Create task", onClick: onCreate };

    const inboxSortOptions = [
        { value: "order", label: i18n?.sortByOrder || "Comprehensive" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
    ];

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_INBOX, state);
    }

    async function handleClarify(task: TaskCacheEntry) {
        try {
            const updated = await bridge.updateTask(task.blockId, { "na-status": "todo" });
            taskStore.applyUpdate(updated);
        } catch (e: any) {
            console.error("[NextAction] clarify task failed:", e);
        }
    }
</script>

<NaViewShell
    loading={$taskStore.loading}
    error={$taskStore.error}
    retryAction={{ label: i18n?.retry || "Retry", onClick: () => taskStore.loadTasks() }}
    loadingText={i18n?.loading || "Loading..."}
    empty={filteredTasks.length === 0}
    emptyText={i18n?.noInboxTasks || "No inbox tasks"}
    {emptyAction}
    hint={i18n?.viewHintInbox}
>
    <svelte:fragment slot="toolbar"
        ><NaTaskFilterBar
            contexts={$taskStore.contexts}
            tags={$taskStore.tags}
            customFields={$taskStore.settings.customFields}
            {filterState}
            showStatus={false}
            showPriority={false}
            sortOptions={inboxSortOptions}
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
                onActivate={handleClarify}
                {i18n}
            />
        {/each}
    </NaTaskList>
</NaViewShell>
