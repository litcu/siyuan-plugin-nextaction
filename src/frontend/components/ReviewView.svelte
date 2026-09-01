<script lang="ts">
    import { onDestroy, onMount, tick, untrack } from "svelte";
    import { runAiReview } from "../ai/ai-feature-service";
    import type { KernelBridge } from "../kernel-bridge";
    import type { ProjectSummary, TaskCacheEntry, ReviewData } from "../../shared/types";
    import ReviewGuide from "./ReviewGuide.svelte";
    import ReviewDueList from "./ReviewDueList.svelte";
    import ProjectReviewQueue from "./ProjectReviewQueue.svelte";
    import NaButton from "../ui/NaButton.svelte";
    import NaToolbar from "../ui/NaToolbar.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";
    import { taskStore } from "../stores/task-store";
    import { notifyOperationError } from "../notify";
    import { excludeManualProjectReviewTasks } from "../../shared/review";
    import { confirmProjectCompletion } from "../utils/project-view-state";

    interface Props {
        bridge: KernelBridge;
        selectedTaskId: string;
        onSelectTask: (task: TaskCacheEntry) => void;
        onEdit: (task: TaskCacheEntry) => void;
        onOpenProject: (project: TaskCacheEntry) => void;
        onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
        onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
        onCreateAction?: ((project: TaskCacheEntry) => void) | undefined;
        i18n: any;
        manualProjectIds?: string[];
        expandedProjectId?: string;
        reviewScrollTop?: number;
    }

    let {
        bridge,
        selectedTaskId,
        onSelectTask,
        onEdit,
        onOpenProject,
        onStatusClick,
        onContextMenu,
        onCreateAction = undefined,
        i18n,
        manualProjectIds = $bindable([]),
        expandedProjectId = $bindable(""),
        reviewScrollTop = $bindable(0),
    }: Props = $props();

    let reviewData: ReviewData | null = $state(null);
    let loading = $state(false);
    let completing = $state(false);
    let refreshTimer: ReturnType<typeof setTimeout> | null = $state(null);
    let reviewScrollElement: HTMLDivElement | null = $state(null);

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
            await tick();
            if (reviewScrollElement) reviewScrollElement.scrollTop = reviewScrollTop;
        } catch (e: any) {
            console.error("[NextAction] loadReviewData failed:", e);
            reviewData = null;
        } finally {
            loading = false;
        }
    }

    async function handleMarkReviewed(blockIds: string[]) {
        try {
            const updatedTasks = await bridge.markTaskReviewed(blockIds);
            for (const task of updatedTasks) taskStore.applyUpdate(task);
            if (refreshTimer) {
                clearTimeout(refreshTimer);
                refreshTimer = null;
            }
            await loadReviewData();
            return true;
        } catch (e: any) {
            console.error("[NextAction] markTaskReviewed failed:", e);
            notifyOperationError(e, i18n);
            return false;
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

    async function handleConfirmProject(summary: ProjectSummary): Promise<boolean> {
        try {
            await confirmProjectCompletion(summary, async (task, attrs) => {
                const updated = await bridge.updateTask(task.blockId, attrs);
                taskStore.applyUpdate(updated);
                return updated;
            });
            await loadReviewData();
            return true;
        } catch (error: any) {
            console.error("[NextAction] confirm project completion failed:", error);
            notifyOperationError(error, i18n);
            return false;
        }
    }

    onMount(() => {
        if (refreshTimer) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
        }
        void loadReviewData();
    });

    onDestroy(() => {
        if (refreshTimer) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
        }
    });
    let visibleReviewData = $derived(reviewData ? excludeManualProjectReviewTasks(reviewData, manualProjectIds) : null);
    $effect(() => {
        $taskStore.allTasks;
        untrack(() => {
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                refreshTimer = null;
                void loadReviewData();
            }, 300);
        });
    });
</script>

<NaViewShell
    loading={loading && !reviewData}
    empty={!reviewData && !loading}
    emptyText={i18n?.noData || "No data"}
    hint={i18n?.viewHintReview}
    scrollMode="none"
>
    {#snippet toolbar()}<NaToolbar compact>
            <div class="na-review__last-review" aria-live="polite">
                <span class="na-review__last-review-label">{i18n?.reviewChecklistStatus || "Checklist status"}</span>
                <span class="na-review__last-review-time">{formatLastReview(reviewData?.lastReviewAt || "")}</span>
            </div>
            <div class="na-toolbar__actions-content">
                <NaButton size="sm" icon="iconSparkles" onclick={runAiReview}>{i18n?.aiReview || "智能回顾"}</NaButton
                ><NaButton
                    size="sm"
                    variant="primary"
                    icon="iconSelect"
                    loading={completing}
                    disabled={completing}
                    onclick={handleCompleteReview}>{i18n?.reviewCompleteChecklist || "Complete review"}</NaButton
                >
            </div>
        </NaToolbar>{/snippet}
    {#if visibleReviewData}
        <div
            class="na-review__scroll"
            bind:this={reviewScrollElement}
            onscroll={() => (reviewScrollTop = reviewScrollElement?.scrollTop || 0)}
        >
            <section class="na-review__section">
                <h3 class="na-review__section-title">{i18n?.reviewProjectTitle || "Project Reviews"}</h3>
                <ProjectReviewQueue
                    reviewData={visibleReviewData}
                    bind:manualProjectIds
                    bind:expandedProjectId
                    {i18n}
                    {selectedTaskId}
                    {onSelectTask}
                    {onEdit}
                    {onOpenProject}
                    {onStatusClick}
                    {onContextMenu}
                    onMarkReviewed={handleMarkReviewed}
                    {onCreateAction}
                    onConfirmCompletion={handleConfirmProject}
                />
            </section>
            <section class="na-review__section">
                <h3 class="na-review__section-title">{i18n?.reviewGuideTitle || "Review Checklist"}</h3>
                <ReviewGuide
                    reviewData={visibleReviewData}
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
                    reviewData={visibleReviewData}
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
    {/if}
</NaViewShell>

<style lang="scss">
    .na-review__last-review {
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 1px;
    }

    .na-review__last-review-label {
        color: var(--na-text-secondary);
        font-size: 10px;
        font-weight: 600;
    }

    .na-review__last-review-time {
        color: var(--b3-theme-on-background);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
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
        color: var(--na-text-secondary);
        margin: 0 0 var(--na-space-sm, 8px);
    }
</style>
