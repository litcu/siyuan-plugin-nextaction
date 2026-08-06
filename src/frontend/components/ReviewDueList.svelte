<script lang="ts">
    import type { TaskCacheEntry, ReviewData } from "../../shared/types";
    import NaAccordion from "../ui/NaAccordion.svelte";
    import NaButton from "../ui/NaButton.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import TaskCard from "./TaskCard.svelte";

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
    {#if totalDue === 0}<NaEmpty text={i18n?.reviewAllDone || "All caught up!"} />{:else}
        {#if reviewDueTasks.length > 0}
            <NaAccordion title={i18n?.reviewDue || "Due for Review"} icon="iconCheck" count={reviewDueTasks.length} open={reviewDueExpanded} on:openChange={(event) => reviewDueExpanded = event.detail}>
                <svelte:fragment slot="action"><NaButton size="sm" variant="text" on:click={() => onMarkReviewed(reviewDueTasks.map(task => task.blockId))}>{i18n?.markAllReviewed || "Mark all reviewed"}</NaButton></svelte:fragment>
                <div class="na-review-due__body">{#each reviewDueTasks as task (task.blockId)}<div class="na-review-due__task-row"><TaskCard {task} selected={task.blockId === selectedTaskId} onSelect={onSelectTask} {onEdit} {onStatusClick} {onContextMenu} {i18n} /><NaButton size="sm" variant="text" icon="iconSelect" on:click={() => onMarkReviewed([task.blockId])}>{i18n?.markReviewed || "Reviewed"}</NaButton></div>{/each}</div>
            </NaAccordion>
        {/if}
        {#if overdueTasks.length > 0}
            <NaAccordion title={i18n?.overdueTasks || "Overdue Tasks"} icon="iconClock" count={overdueTasks.length} tone="danger" open={overdueExpanded} on:openChange={(event) => overdueExpanded = event.detail}>
                <div class="na-review-due__body">{#each overdueTasks as task (task.blockId)}<TaskCard {task} selected={task.blockId === selectedTaskId} onSelect={onSelectTask} {onEdit} {onStatusClick} {onContextMenu} {i18n} />{/each}</div>
            </NaAccordion>
        {/if}
    {/if}
</div>

<style lang="scss">
    .na-review-due { display: flex; flex-direction: column; }
    .na-review-due__body { display: flex; flex-direction: column; gap: var(--na-space-xs); }
    .na-review-due__task-row { display: flex; align-items: center; gap: var(--na-space-xs); }
    .na-review-due__task-row :global(.na-task-card) { flex: 1; min-width: 0; }
    .na-review-due__task-row :global(.na-button) { flex: 0 0 auto; }
</style>
