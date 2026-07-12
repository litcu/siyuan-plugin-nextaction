<script lang="ts">
    import { onMount } from "svelte";
    import type { KernelBridge } from "../kernel-bridge";
    import type { TaskCacheEntry, ReviewData } from "../../shared/types";
    import ReviewGuide from "./ReviewGuide.svelte";
    import ReviewDueList from "./ReviewDueList.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import NaViewHint from "../ui/NaViewHint.svelte";

    export let bridge: KernelBridge;
    export let selectedTaskId: string;
    export let onSelectTask: (task: TaskCacheEntry) => void;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;

    let reviewData: ReviewData | null = null;
    let loading = false;

    async function loadReviewData() {
        loading = true;
        try {
            reviewData = await bridge.getReviewData();
        } catch (e: any) {
            console.error("[NextAction] loadReviewData failed:", e);
            reviewData = null;
        } finally {
            loading = false;
        }
    }

    async function handleMarkReviewed(blockIds: string[]) {
        try {
            await bridge.markTaskReviewed(blockIds);
            await loadReviewData();
        } catch (e: any) {
            console.error("[NextAction] markTaskReviewed failed:", e);
        }
    }

    onMount(() => {
        loadReviewData();
    });
</script>

<div class="na-view na-review">
    {#if loading && !reviewData}
        <NaEmpty loading={true} />
    {:else if reviewData}
        <div class="na-review__scroll">
            <section class="na-review__section">
                <h3 class="na-review__section-title">{i18n?.reviewGuideTitle || "Review Checklist"}</h3>
                <ReviewGuide
                    {reviewData}
                    {i18n}
                    {selectedTaskId}
                    {onSelectTask}
                    {onEdit}
                    {onStatusClick}
                    {onContextMenu}
                />
            </section>
            <section class="na-review__section">
                <h3 class="na-review__section-title">{i18n?.reviewDueTitle || "Tasks to Review"}</h3>
                <ReviewDueList
                    {reviewData}
                    {i18n}
                    {selectedTaskId}
                    {onSelectTask}
                    {onEdit}
                    {onStatusClick}
                    {onContextMenu}
                    onMarkReviewed={handleMarkReviewed}
                />
            </section>
        </div>
    {:else}
        <NaEmpty text={i18n?.noData || "No data"} />
    {/if}
    <NaViewHint text={i18n?.viewHintReview} />
</div>

<style lang="scss">
    .na-review {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .na-review__scroll {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
    }

    .na-review__section {
        padding: var(--na-space-md) var(--na-space-lg);
    }

    .na-review__section + .na-review__section {
        border-top: 1px solid var(--na-color-divider);
    }

    .na-review__section-title {
        font-size: var(--na-font-size-xs, 11px);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--b3-theme-on-surface-light);
        margin: 0 0 var(--na-space-sm, 8px);
    }
</style>
