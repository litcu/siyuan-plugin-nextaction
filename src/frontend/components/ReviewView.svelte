<script lang="ts">
    import { onMount } from "svelte";
    import { runAiReview } from "../ai/ai-feature-service";
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
    let completing = false;

    function formatLastReview(value: string): string {
        if (!value) return i18n?.reviewNeverCompleted || "No checklist review recorded";
        const timestamp = new Date(value);
        if (Number.isNaN(timestamp.getTime())) return i18n?.reviewNeverCompleted || "No checklist review recorded";
        const template = i18n?.reviewLastCompleted || "Last review: {time}";
        return template.replace("{time}", timestamp.toLocaleString());
    }

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

    async function handleCompleteReview() {
        if (completing) return;
        completing = true;
        try {
            reviewData = await bridge.completeReview();
        } catch (e: any) {
            console.error("[NextAction] completeReview failed:", e);
        } finally {
            completing = false;
        }
    }

    onMount(() => {
        loadReviewData();
    });
</script>

<div class="na-view na-review">
    <div class="na-review__toolbar">
        <div class="na-review__last-review" aria-live="polite">
            <span class="na-review__last-review-label">{i18n?.reviewChecklistStatus || "Checklist status"}</span>
            <span class="na-review__last-review-time">{formatLastReview(reviewData?.lastReviewAt || "")}</span>
        </div>
        <div class="na-review__actions">
            <button class="na-button na-button--sm na-ai-trigger na-review__ai-btn" on:click={runAiReview}>
                <svg><use xlink:href="#iconSparkles"></use></svg>
                {i18n?.aiReview || "智能回顾"}
            </button>
            <button class="na-button na-button--sm na-review__complete-btn" on:click={handleCompleteReview} disabled={completing}>
                <svg aria-hidden="true"><use xlink:href="#iconSelect"></use></svg>
                {completing ? (i18n?.reviewCompleting || "Recording...") : (i18n?.reviewCompleteChecklist || "Complete review")}
            </button>
        </div>
    </div>
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

    .na-review__toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px 12px;
        flex-wrap: wrap;
        min-height: 38px;
        padding: 7px 12px;
        border-bottom: 1px solid var(--na-color-divider);
        background: var(--b3-theme-surface);
    }

    .na-review__last-review {
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 1px;
    }

    .na-review__last-review-label {
        color: var(--b3-theme-on-surface-light);
        font-size: 10px;
        font-weight: 600;
    }

    .na-review__last-review-time {
        color: var(--b3-theme-on-background);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
    }

    .na-review__actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
    }

    .na-review__complete-btn {
        color: var(--na-color-success, #3d8b5f);
        border-color: color-mix(in srgb, var(--na-color-success, #3d8b5f) 38%, var(--na-color-divider));
    }

    .na-review__complete-btn svg {
        width: 13px;
        height: 13px;
        flex: 0 0 13px;
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
        letter-spacing: 0;
        color: var(--b3-theme-on-surface-light);
        margin: 0 0 var(--na-space-sm, 8px);
    }
</style>
