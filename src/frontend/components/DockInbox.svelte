<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import TaskCard from "./TaskCard.svelte";
    import NaTaskList from "../ui/NaTaskList.svelte";
    import NaSearchInput from "../ui/NaSearchInput.svelte";
    import NaToolbar from "../ui/NaToolbar.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";
    import type { TaskCacheEntry } from "../../shared/types";

    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;

    let searchText = "";

    $: inboxTasks = $taskStore.allTasks.filter(t => t.status === "inbox");

    $: filteredTasks = searchText.trim()
        ? inboxTasks.filter(t => {
            const q = searchText.toLowerCase();
            if (t.title.toLowerCase().includes(q)) return true;
            if (t.tags && t.tags.replace(/\|/g, ', ').toLowerCase().includes(q)) return true;
            return false;
        })
        : inboxTasks;
</script>

<NaViewShell loading={$taskStore.loading} empty={filteredTasks.length === 0} emptyText={searchText ? (i18n?.noResults || "No matching tasks") : (i18n?.noInboxTasks || "No inbox tasks")} scrollMode="none">
    <svelte:fragment slot="toolbar"><NaToolbar compact><NaSearchInput bind:value={searchText} compact placeholder={i18n?.searchPlaceholder || "Search tasks..."} ariaLabel={i18n?.searchPlaceholder || "Search tasks..."} /></NaToolbar></svelte:fragment>
        <NaTaskList density="compact">
            {#each filteredTasks as task (task.blockId)}
                <TaskCard
                    {task}
                    {onEdit}
                    {onStatusClick}
                    {onContextMenu}
                    {i18n}
                />
            {/each}
        </NaTaskList>
</NaViewShell>

<style lang="scss">
    :global(.na-toolbar .na-search-input) { width: 100%; }
    :global(.na-task-list--compact .na-task-card__stats) { display: none; }
    :global(.na-task-list--compact .na-task-card__actions) { opacity: 1; }

    @container na-dock (max-width: 260px) {
        :global(.na-toolbar) { padding-inline: 8px; }
        :global(.na-task-list) { padding: 6px; }
    }
</style>
