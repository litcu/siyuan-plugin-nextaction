<script lang="ts">
    import type { TaskCacheEntry, ReviewData } from "../../shared/types";
    import TaskCard from "./TaskCard.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";

    export let reviewData: ReviewData;
    export let i18n: any;
    export let selectedTaskId: string;
    export let onSelectTask: (task: TaskCacheEntry) => void;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onMarkReviewed: (blockIds: string[]) => void;

    let reviewDueExpanded = true;
    let overdueExpanded = true;

    $: reviewDueTasks = reviewData.reviewDueTasks;
    $: overdueTasks = reviewData.overdueTasks;
    $: totalDue = reviewDueTasks.length + overdueTasks.length;
</script>

<div class="na-review-due">
    {#if totalDue === 0}
        <NaEmpty text={i18n?.reviewAllDone || "All caught up!"} />
    {:else}
        <!-- Review Due Tasks -->
        {#if reviewDueTasks.length > 0}
            <div class="na-review-due__group">
                <button class="na-review-due__header" on:click={() => reviewDueExpanded = !reviewDueExpanded}>
                    <span class="na-review-due__icon">
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="8" cy="8" r="6.5"/>
                            <polyline points="5.5 8 7.5 10 10.5 7"/>
                        </svg>
                    </span>
                    <span class="na-review-due__label">{i18n?.reviewDue || "Due for Review"}</span>
                    <span class="na-review-due__count">{reviewDueTasks.length}</span>
                    <span class="na-review-due__arrow" class:expanded={reviewDueExpanded}>
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="4 6 8 10 12 6"/>
                        </svg>
                    </span>
                    {#if reviewDueTasks.length > 0}
                        <button
                            class="na-review-due__mark-all"
                            on:click|stopPropagation={() => onMarkReviewed(reviewDueTasks.map(t => t.blockId))}
                            title={i18n?.markAllReviewed || "Mark all as reviewed"}
                        >
                            {i18n?.markAllReviewed || "Mark all reviewed"}
                        </button>
                    {/if}
                </button>
                {#if reviewDueExpanded}
                    <div class="na-review-due__body">
                        {#each reviewDueTasks as task (task.blockId)}
                            <div class="na-review-due__task-row">
                                <TaskCard
                                    {task}
                                    selected={task.blockId === selectedTaskId}
                                    onSelect={onSelectTask}
                                    {onEdit}
                                    {onStatusClick}
                                    {onContextMenu}
                                    {i18n}
                                />
                                <button
                                    class="na-review-due__mark-btn"
                                    on:click|stopPropagation={() => onMarkReviewed([task.blockId])}
                                    title={i18n?.markReviewed || "Mark as reviewed"}
                                >
                                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="4 8 7 11 12 5"/>
                                    </svg>
                                    <span class="na-review-due__mark-text">{i18n?.markReviewed || "Reviewed"}</span>
                                </button>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}

        <!-- Overdue Tasks -->
        {#if overdueTasks.length > 0}
            <div class="na-review-due__group">
                <button class="na-review-due__header" on:click={() => overdueExpanded = !overdueExpanded}>
                    <span class="na-review-due__icon">
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="8" cy="8" r="6.5"/>
                            <polyline points="8 4.5 8 8 10.5 9.5"/>
                        </svg>
                    </span>
                    <span class="na-review-due__label">{i18n?.overdueTasks || "Overdue Tasks"}</span>
                    <span class="na-review-due__count na-review-due__count--overdue">{overdueTasks.length}</span>
                    <span class="na-review-due__arrow" class:expanded={overdueExpanded}>
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="4 6 8 10 12 6"/>
                        </svg>
                    </span>
                </button>
                {#if overdueExpanded}
                    <div class="na-review-due__body">
                        {#each overdueTasks as task (task.blockId)}
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
            </div>
        {/if}
    {/if}
</div>

<style lang="scss">
    .na-review-due {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-sm);
    }

    .na-review-due__group {
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        overflow: hidden;
    }

    .na-review-due__header {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm);
        width: 100%;
        padding: var(--na-space-md) var(--na-space-lg);
        border: none;
        background: none;
        color: var(--b3-theme-on-background);
        cursor: pointer;
        font-size: var(--na-font-size-md);
        font-weight: 500;
        text-align: left;
        transition: background 0.15s;

        &:hover {
            background: var(--b3-theme-surface-light);
        }
    }

    .na-review-due__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--b3-theme-on-surface-secondary);
    }

    .na-review-due__label {
        flex: 1;
        min-width: 0;
    }

    .na-review-due__count {
        font-variant-numeric: tabular-nums;
        color: var(--b3-theme-on-surface-secondary);
        font-size: var(--na-font-size-sm);
        background: var(--b3-theme-surface-light);
        padding: 1px 6px;
        border-radius: var(--na-radius-pill);
        min-width: 20px;
        text-align: center;

        &--overdue {
            color: var(--na-color-error);
            background: rgba(231, 76, 60, 0.1);
        }
    }

    .na-review-due__arrow {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--b3-theme-on-surface-tertiary);
        transition: transform 0.2s;

        &.expanded {
            transform: rotate(180deg);
        }
    }

    .na-review-due__mark-all {
        display: inline-flex;
        align-items: center;
        gap: var(--na-space-xxs);
        padding: 2px 8px;
        font-size: var(--na-font-size-xs);
        font-weight: 600;
        color: var(--b3-theme-primary);
        background: none;
        border: 1px solid var(--b3-theme-primary);
        border-radius: var(--na-radius-sm);
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.15s, color 0.15s;

        &:hover {
            background: var(--b3-theme-primary);
            color: var(--b3-theme-on-primary);
        }

        &:active {
            transform: scale(0.95);
        }
    }

    .na-review-due__body {
        padding: var(--na-space-xs) var(--na-space-md) var(--na-space-md);
        display: flex;
        flex-direction: column;
        gap: var(--na-space-xs);
    }

    .na-review-due__task-row {
        display: flex;
        align-items: center;
        gap: var(--na-space-xs);

        :global(.na-task-card) {
            flex: 1;
            min-width: 0;
        }
    }

    .na-review-due__mark-btn {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px 8px;
        font-size: var(--na-font-size-xs);
        font-weight: 500;
        color: var(--na-color-success);
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-success);
        border-radius: var(--na-radius-sm);
        cursor: pointer;
        white-space: nowrap;
        opacity: 0;
        transition: opacity 0.15s, background 0.15s, color 0.15s;
        flex-shrink: 0;

        .na-review-due__task-row:hover & {
            opacity: 1;
        }

        &:hover {
            background: var(--na-color-success);
            color: var(--b3-theme-on-primary);
        }

        &:active {
            transform: scale(0.95);
        }
    }

    .na-review-due__mark-text {
        font-variant-numeric: tabular-nums;
    }
</style>
