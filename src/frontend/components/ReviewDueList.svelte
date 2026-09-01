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
    $: reviewDueTasks = reviewData.reviewDueTasks;
    $: totalDue = reviewDueTasks.length;
</script>

<div class="na-review-due">
    {#if totalDue === 0}<NaEmpty text={i18n?.reviewAllDone || "All caught up!"} />{:else if reviewDueTasks.length > 0}
        <NaAccordion
            title={i18n?.reviewDue || "Due for Review"}
            icon="iconCheck"
            count={reviewDueTasks.length}
            open={reviewDueExpanded}
            onOpenChange={(open) => (reviewDueExpanded = open)}
        >
            {#snippet action()}<NaButton
                    size="sm"
                    variant="text"
                    onclick={() => onMarkReviewed(reviewDueTasks.map((task) => task.blockId))}
                    >{i18n?.markAllReviewed || "Mark all reviewed"}</NaButton
                >{/snippet}
            <div class="na-review-due__body">
                {#each reviewDueTasks as task (task.blockId)}<div class="na-review-due__task-row">
                        <TaskCard
                            {task}
                            selected={task.blockId === selectedTaskId}
                            onSelect={onSelectTask}
                            {onEdit}
                            {onStatusClick}
                            {onContextMenu}
                            {i18n}
                        /><NaButton
                            size="sm"
                            variant="text"
                            icon="iconSelect"
                            onclick={() => onMarkReviewed([task.blockId])}>{i18n?.markReviewed || "Reviewed"}</NaButton
                        >
                    </div>{/each}
            </div>
        </NaAccordion>
    {/if}
</div>

<style lang="scss">
    .na-review-due {
        display: flex;
        flex-direction: column;
    }
    .na-review-due__body {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-xs);
    }
    .na-review-due__task-row {
        display: flex;
        align-items: center;
        gap: var(--na-space-xs);
    }
    .na-review-due__task-row :global(.na-task-card) {
        flex: 1;
        min-width: 0;
    }
    .na-review-due__task-row :global(.na-button) {
        flex: 0 0 auto;
    }
</style>
