<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { isNextActionCandidate } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import NaSearchInput from "../ui/NaSearchInput.svelte";
    import type { TaskCacheEntry } from "../../shared/types";

    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;

    let searchText = "";

    $: nextActionTasks = $taskStore.allTasks.filter(t => isNextActionCandidate(t, $taskStore.settings.priorityEngine.startPreviewDays));

    $: filteredTasks = searchText.trim()
        ? nextActionTasks.filter(t => {
            const q = searchText.toLowerCase();
            if (t.title.toLowerCase().includes(q)) return true;
            if (t.tags && t.tags.replace(/\|/g, ', ').toLowerCase().includes(q)) return true;
            return false;
        })
        : nextActionTasks;
</script>

<div class="na-dock-next">
    <div class="na-dock-next__search">
        <NaSearchInput bind:value={searchText} compact placeholder={i18n?.searchPlaceholder || "Search tasks..."} ariaLabel={i18n?.searchPlaceholder || "Search tasks..."} />
    </div>

    {#if $taskStore.loading}
        <NaEmpty loading={true} />
    {:else if filteredTasks.length === 0}
        <NaEmpty text={searchText ? (i18n?.noResults || "No matching tasks") : (i18n?.noTasks || "No tasks yet")} />
    {:else}
        <div class="na-dock-next__list">
            {#each filteredTasks as task (task.blockId)}
                <TaskCard
                    {task}
                    {onEdit}
                    {onStatusClick}
                    {onContextMenu}
                    {i18n}
                />
            {/each}
        </div>
    {/if}
</div>

<style lang="scss">
    .na-dock-next {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .na-dock-next__search {
        display: flex;
        align-items: center;
        padding: 8px 12px;
        border-bottom: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        flex-shrink: 0;
    }
    :global(.na-dock-next__search .na-search-input) { width: 100%; }

    .na-dock-next__list {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;

        :global(.na-task-card) {
            border-radius: 6px;
            padding: 6px 8px 6px 9px;
        }

        :global(.na-task-card__meta) {
            flex-wrap: nowrap;
            overflow: hidden;
        }

        :global(.na-task-card__actions) {
            opacity: 1;
        }
    }

    @container na-dock (max-width: 260px) {
        .na-dock-next__search { padding: 7px 8px; }
        .na-dock-next__list { padding: 6px; }
        :global(.na-dock-next__list .na-task-card__stats) { display: none; }
    }
</style>
