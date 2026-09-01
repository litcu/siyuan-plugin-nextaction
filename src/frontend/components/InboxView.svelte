<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { VIEW_INBOX } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
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

    $: filterState = $taskStore.filterByView[VIEW_INBOX] || DEFAULT_FILTER_STATE;
    $: inboxTasks = $taskStore.allTasks.filter((t) => t.status === "inbox");
    $: filteredTasks = applyFilters(inboxTasks, filterState, $taskStore.settings.customFields);

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
    empty={filteredTasks.length === 0}
    emptyText={$taskStore.error || i18n?.noInboxTasks || "No inbox tasks"}
    hint={i18n?.viewHintInbox}
>
    {#snippet toolbar()}<NaTaskFilterBar
            contexts={$taskStore.contexts}
            tags={$taskStore.tags}
            customFields={$taskStore.settings.customFields}
            {filterState}
            showStatus={false}
            showPriority={false}
            sortOptions={inboxSortOptions}
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
                onActivate={handleClarify}
                {i18n}
            />
        {/each}
    </NaTaskList>
</NaViewShell>
