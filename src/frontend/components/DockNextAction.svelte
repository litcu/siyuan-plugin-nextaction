<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { isNextActionCandidate } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
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
        <svg class="na-dock-next__search-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <circle cx="7" cy="7" r="4.5"/><line x1="10.2" y1="10.2" x2="14" y2="14"/>
        </svg>
        <input
            type="text"
            class="na-dock-next__search-input"
            placeholder={i18n?.searchPlaceholder || "Search tasks..."}
            bind:value={searchText}
        />
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
        gap: 6px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--b3-theme-surface-lighter, rgba(0, 0, 0, 0.06));
        flex-shrink: 0;
    }

    .na-dock-next__search-icon {
        flex-shrink: 0;
        color: var(--b3-theme-on-surface-dim, #888);
    }

    .na-dock-next__search-input {
        flex: 1;
        border: none;
        outline: none;
        background: transparent;
        color: var(--b3-theme-on-surface);
        font-size: 13px;
        padding: 2px 0;

        &::placeholder {
            color: var(--b3-theme-on-surface-dim, #888);
        }
    }

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
</style>
