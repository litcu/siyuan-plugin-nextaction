<script lang="ts">
    import type { StatisticsResult } from "../../shared/types";
    import { KernelBridge } from "../kernel-bridge";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import NaViewHint from "../ui/NaViewHint.svelte";
    import { PRIORITY_HEX_COLORS } from "../constants";
    import { onMount } from "svelte";

    export let bridge: KernelBridge;
    export let i18n: any;

    let period: string = "week";
    let stats: StatisticsResult | null = null;
    let loading: boolean = false;
    let error: string | null = null;

    const STATUS_COLORS: Record<string, string> = {
        inbox: "var(--na-color-inbox)",
        todo: "var(--na-color-info)",
        doing: "var(--na-color-doing)",
        waiting: "var(--na-color-waiting)",
        someday: "var(--na-color-someday)",
        done: "var(--na-color-done)",
    };

    const STATUS_LABELS: Record<string, string> = {
        inbox: "statusInbox",
        todo: "statusTodo",
        doing: "statusDoing",
        waiting: "statusWaiting",
        someday: "statusSomeday",
        done: "statusDone",
    };

    const PRIORITY_LABELS: Record<string, string> = {
        critical: "priorityCritical",
        high: "priorityHigh",
        medium: "priorityMedium",
        low: "priorityLow",
        none: "priorityNone",
    };

    async function loadStats(p?: "week" | "month") {
        const currentPeriod = p || period;
        loading = true;
        error = null;
        try {
            stats = await bridge.getStatistics(currentPeriod);
        } catch (e: any) {
            console.error("[NextAction] loadStatistics failed:", e);
            error = e.message;
        } finally {
            loading = false;
        }
    }

    function handlePeriodChange(e: CustomEvent<string>) {
        const newPeriod = e.detail;
        period = newPeriod;
        loadStats(newPeriod as "week" | "month");
    }

    $: periodLabelText = period === "week"
        ? (i18n?.thisWeek || "Week")
        : (i18n?.thisMonth || "Month");
    $: completedLabel = (i18n?.completedInPeriod || "Completed This {period}").replace("{period}", periodLabelText);

    // Ring progress parameters
    const RING_RADIUS = 28;
    const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

    $: completionRate = stats?.summary.completionRate ?? 0;
    $: ringDash = (completionRate / 100) * RING_CIRCUMFERENCE;
    $: ringGap = RING_CIRCUMFERENCE - ringDash;

    onMount(() => {
        loadStats();
    });
</script>

<div class="na-statistics">
    <div class="na-statistics__header">
        <span class="na-statistics__title">{i18n?.statistics || "Statistics"}</span>
        <NaSegmentControl
            options={[
                { value: "week", label: i18n?.thisWeek || "Week" },
                { value: "month", label: i18n?.thisMonth || "Month" },
            ]}
            bind:value={period}
            on:change={handlePeriodChange}
        />
    </div>

    {#if loading && !stats}
        <NaEmpty loading={true} />
    {:else if error}
        <NaEmpty text={error} />
    {:else if stats}
        <!-- Hero: Completion Rate Ring -->
        <div class="na-statistics__hero">
            <div class="na-statistics__ring-wrap">
                <svg class="na-statistics__ring" viewBox="0 0 72 72">
                    <circle class="na-statistics__ring-bg" cx="36" cy="36" r={RING_RADIUS} />
                    <circle
                        class="na-statistics__ring-fill"
                        cx="36" cy="36" r={RING_RADIUS}
                        stroke-dasharray="{ringDash} {ringGap}"
                        stroke-dashoffset="{RING_CIRCUMFERENCE / 4}"
                    />
                </svg>
                <div class="na-statistics__ring-label">
                    <span class="na-statistics__ring-value">{completionRate}<span class="na-statistics__ring-unit">%</span></span>
                </div>
            </div>
            <div class="na-statistics__hero-info">
                <span class="na-statistics__hero-title">{i18n?.completionRate || "Completion Rate"}</span>
                <span class="na-statistics__hero-sub">{stats.summary.total} {i18n?.totalTasks || "tasks"}</span>
            </div>
        </div>

        <!-- Metric cards row -->
        <div class="na-statistics__metrics">
            <div class="na-statistics__metric-card na-statistics__metric-card--open">
                <span class="na-statistics__metric-value">{stats.summary.open}</span>
                <span class="na-statistics__metric-label">{i18n?.openTasks || "Open"}</span>
            </div>
            <div class="na-statistics__metric-card na-statistics__metric-card--next">
                <span class="na-statistics__metric-value">{stats.summary.nextAction}</span>
                <span class="na-statistics__metric-label">{i18n?.nextAction || "Next Actions"}</span>
            </div>
            <div class="na-statistics__metric-card na-statistics__metric-card--someday">
                <span class="na-statistics__metric-value">{stats.summary.someday}</span>
                <span class="na-statistics__metric-label">{i18n?.someday || "Someday"}</span>
            </div>
            <div class="na-statistics__metric-card na-statistics__metric-card--overdue">
                <span class="na-statistics__metric-value">{stats.summary.overdue}</span>
                <span class="na-statistics__metric-label">{i18n?.overdueTasks || "Overdue"}</span>
            </div>
            <div class="na-statistics__metric-card na-statistics__metric-card--completed">
                <span class="na-statistics__metric-value">{stats.summary.completedInPeriod}</span>
                <span class="na-statistics__metric-label">{completedLabel}</span>
            </div>
        </div>

        <!-- Distribution sections -->
        <div class="na-statistics__distributions">
            <div class="na-statistics__section">
                <span class="na-statistics__section-title">{i18n?.statusDistribution || "Status Distribution"}</span>
                {#each stats.statusDistribution as item}
                    <div class="na-statistics__bar-row">
                        <span class="na-statistics__bar-label">{i18n?.[STATUS_LABELS[item.key]] || item.key}</span>
                        <div class="na-statistics__bar-track">
                            <div class="na-statistics__bar-fill" style="width: {item.percent * 100}%; background: {STATUS_COLORS[item.key] || 'var(--b3-theme-primary)'}"></div>
                        </div>
                        <span class="na-statistics__bar-count">{item.count}</span>
                    </div>
                {/each}
            </div>

            <div class="na-statistics__section">
                <span class="na-statistics__section-title">{i18n?.priorityDistribution || "Priority Distribution"}</span>
                {#each stats.priorityDistribution as item}
                    <div class="na-statistics__bar-row">
                        <span class="na-statistics__bar-label">{i18n?.[PRIORITY_LABELS[item.key]] || item.key}</span>
                        <div class="na-statistics__bar-track">
                            <div class="na-statistics__bar-fill" style="width: {item.percent * 100}%; background: {PRIORITY_HEX_COLORS[item.key] || 'var(--b3-theme-primary)'}"></div>
                        </div>
                        <span class="na-statistics__bar-count">{item.count}</span>
                    </div>
                {/each}
            </div>

            <div class="na-statistics__section">
                <span class="na-statistics__section-title">{i18n?.contextDistribution || "Context Distribution"}</span>
                {#if stats.contextDistribution.length === 0}
                    <span class="na-statistics__empty-text">{i18n?.noContextTasks || "No contexts"}</span>
                {:else}
                    {@const maxContextCount = Math.max(...stats.contextDistribution.map(c => c.count))}
                    {#each stats.contextDistribution as item}
                        <div class="na-statistics__bar-row">
                            <span class="na-statistics__bar-label">@{item.context}</span>
                            <div class="na-statistics__bar-track">
                                <div class="na-statistics__bar-fill" style="width: {maxContextCount > 0 ? (item.count / maxContextCount) * 100 : 0}%; background: var(--na-priority-medium)"></div>
                            </div>
                            <span class="na-statistics__bar-count">{item.count}</span>
                        </div>
                    {/each}
                {/if}
            </div>

            <div class="na-statistics__section">
                <span class="na-statistics__section-title">{i18n?.projectProgressStats || "Project Progress"}</span>
                {#if stats.projectStatus.every(p => p.count === 0)}
                    <span class="na-statistics__empty-text">{i18n?.noProjectProgress || "No projects yet"}</span>
                {:else}
                    {#each stats.projectStatus as item}
                        <div class="na-statistics__bar-row">
                            <span class="na-statistics__bar-label">{i18n?.[STATUS_LABELS[item.status]] || item.status}</span>
                            <div class="na-statistics__bar-track">
                                <div class="na-statistics__bar-fill" style="width: {item.percent * 100}%; background: {STATUS_COLORS[item.status] || 'var(--b3-theme-primary)'}"></div>
                            </div>
                            <span class="na-statistics__bar-count">{item.count}</span>
                        </div>
                    {/each}
                {/if}
            </div>
        </div>
    {/if}
    <NaViewHint text={i18n?.viewHintStatistics} />
</div>

<style lang="scss">
    .na-statistics {
        padding: var(--na-space-lg);
        display: flex;
        flex-direction: column;
        gap: var(--na-space-lg);
        overflow-y: auto;
    }

    .na-statistics__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-bottom: var(--na-space-md);
        border-bottom: 1px solid var(--na-color-divider);
    }

    .na-statistics__title {
        font-size: var(--na-font-size-lg);
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }

    /* ===== Hero: Completion Ring ===== */
    .na-statistics__hero {
        display: flex;
        align-items: center;
        gap: var(--na-space-xl);
        padding: var(--na-space-xl);
        background: var(--b3-theme-surface);
        border-radius: var(--na-radius-lg);
        border: 1px solid var(--na-color-divider);
    }

    .na-statistics__ring-wrap {
        position: relative;
        width: 72px;
        height: 72px;
        flex-shrink: 0;
    }

    .na-statistics__ring {
        width: 100%;
        height: 100%;
        transform: rotate(0deg);
    }

    .na-statistics__ring-bg {
        fill: none;
        stroke: var(--b3-theme-surface-lighter);
        stroke-width: 5;
    }

    .na-statistics__ring-fill {
        fill: none;
        stroke: var(--na-color-done);
        stroke-width: 5;
        stroke-linecap: round;
        transition: stroke-dasharray 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .na-statistics__ring-label {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .na-statistics__ring-value {
        font-size: 20px;
        font-weight: 700;
        color: var(--b3-theme-on-surface);
        line-height: 1;
        font-variant-numeric: tabular-nums;
    }

    .na-statistics__ring-unit {
        font-size: 11px;
        font-weight: 600;
    }

    .na-statistics__hero-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .na-statistics__hero-title {
        font-size: var(--na-font-size-lg);
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }

    .na-statistics__hero-sub {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-light);
    }

    /* ===== Metric Cards ===== */
    .na-statistics__metrics {
        display: flex;
        flex-wrap: wrap;
        gap: var(--na-space-md);
    }

    .na-statistics__metric-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--na-space-lg) var(--na-space-sm);
        background: var(--b3-theme-surface);
        border-radius: var(--na-radius-lg);
        border: 1px solid var(--na-color-divider);
        gap: var(--na-space-xxs);
        flex: 1 1 60px;
        min-width: 60px;
    }

    .na-statistics__metric-card--open .na-statistics__metric-value {
        color: var(--na-color-info);
    }

    .na-statistics__metric-card--next .na-statistics__metric-value {
        color: var(--na-color-doing);
    }

    .na-statistics__metric-card--someday .na-statistics__metric-value {
        color: var(--na-color-someday);
    }

    .na-statistics__metric-card--overdue .na-statistics__metric-value {
        color: var(--na-color-error);
    }

    .na-statistics__metric-card--completed .na-statistics__metric-value {
        color: var(--na-color-done);
    }

    .na-statistics__metric-value {
        font-size: 24px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        line-height: 1.1;
    }

    .na-statistics__metric-label {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-light);
        text-align: center;
        line-height: 1.3;
    }

    /* ===== Distributions ===== */
    .na-statistics__distributions {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-md);
    }

    .na-statistics__section {
        background: var(--b3-theme-surface);
        border-radius: var(--na-radius-lg);
        border: 1px solid var(--na-color-divider);
        padding: var(--na-space-md);
        display: flex;
        flex-direction: column;
        gap: var(--na-space-xs);
    }

    .na-statistics__section-title {
        font-size: var(--na-font-size-md);
        font-weight: 600;
        color: var(--b3-theme-on-surface);
        margin-bottom: var(--na-space-xxs);
    }

    .na-statistics__bar-row {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm);
        min-height: 20px;
    }

    .na-statistics__bar-label {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-secondary);
        width: 36px;
        flex-shrink: 0;
    }

    .na-statistics__bar-track {
        flex: 1;
        height: 6px;
        background: var(--b3-theme-surface-lighter);
        border-radius: 3px;
        overflow: hidden;
    }

    .na-statistics__bar-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.3s ease;
    }

    .na-statistics__bar-count {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-secondary);
        width: 20px;
        text-align: right;
        font-variant-numeric: tabular-nums;
    }

    .na-statistics__empty-text {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-light);
        padding: var(--na-space-sm) 0;
    }
</style>
