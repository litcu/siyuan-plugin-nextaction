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

    interface Props {
        bridge: KernelBridge;
        onEdit: (task: TaskCacheEntry) => void;
        onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
        onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
        i18n: any;
        selectedTaskId?: string;
        onSelectTask?: ((task: TaskCacheEntry) => void) | undefined;
    }

    let {
        bridge,
        onEdit,
        onStatusClick,
        onContextMenu,
        i18n,
        selectedTaskId = "",
        onSelectTask = undefined,
    }: Props = $props();

    let filterState = $derived($taskStore.filterByView[VIEW_INBOX] || DEFAULT_FILTER_STATE);
    let inboxTasks = $derived($taskStore.allTasks.filter((t) => t.status === "inbox"));
    let filteredTasks = $derived(applyFilters(inboxTasks, filterState, $taskStore.settings.customFields));

    let inboxSortOptions = $derived([
        { value: "order", label: i18n?.sortByOrder || "Comprehensive" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
    ]);

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
