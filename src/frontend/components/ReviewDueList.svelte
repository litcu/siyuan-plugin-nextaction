<script lang="ts">
    import type { TaskCacheEntry, ReviewData } from "../../shared/types";
    import NaAccordion from "../ui/NaAccordion.svelte";
    import NaButton from "../ui/NaButton.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import TaskCard from "./TaskCard.svelte";

    interface Props {
        reviewData: ReviewData;
        i18n: any;
        selectedTaskId: string;
        onSelectTask: (task: TaskCacheEntry) => void;
        onEdit: (task: TaskCacheEntry) => void;
        onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
        onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
        onMarkReviewed: (blockIds: string[]) => void;
    }

    let {
        reviewData,
        i18n,
        selectedTaskId,
        onSelectTask,
        onEdit,
        onStatusClick,
        onContextMenu,
        onMarkReviewed,
    }: Props = $props();

    let reviewDueExpanded = $state(true);
    let reviewDueTasks = $derived(reviewData.reviewDueTasks);
    let totalDue = $derived(reviewDueTasks.length);
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
