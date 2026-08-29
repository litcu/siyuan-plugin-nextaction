<script lang="ts">
    import { onMount } from "svelte";
    import type { StatisticsResult } from "../../shared/types";
    import type { KernelBridge } from "../kernel-bridge";
    import NaMetricStrip from "../ui/NaMetricStrip.svelte";
    import NaProgressBar from "../ui/NaProgressBar.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";
    import NaToolbar from "../ui/NaToolbar.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";

    export let bridge: KernelBridge;
    export let i18n: any;

    let period: "week" | "month" = "week";
    let stats: StatisticsResult | null = null;
    let loading = false;
    let error = "";

    const STATUS_TONES: Record<string, "primary" | "info" | "success" | "warning" | "danger"> = {
        inbox: "info",
        todo: "info",
        doing: "primary",
        waiting: "warning",
        someday: "info",
        done: "success",
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
        veryLow: "priorityVeryLow",
        none: "priorityVeryLow",
    };
    const PRIORITY_TONES: Record<string, "info" | "warning" | "danger"> = {
        critical: "danger",
        high: "warning",
        medium: "info",
        low: "info",
        veryLow: "info",
        none: "info",
    };

    async function loadStats(nextPeriod: "week" | "month" = period) {
        loading = true;
        error = "";
        try {
            stats = await bridge.getStatistics(nextPeriod);
        } catch (exception: any) {
            console.error("[NextAction] loadStatistics failed:", exception);
            error = exception.message;
        } finally {
            loading = false;
        }
    }
    function handlePeriodChange(event: CustomEvent<string>) {
        period = event.detail as "week" | "month";
        loadStats(period);
    }

    $: periodLabelText = period === "week" ? i18n?.thisWeek || "Week" : i18n?.thisMonth || "Month";
    $: completedLabel = (i18n?.completedInPeriod || "Completed This {period}").replace("{period}", periodLabelText);
    $: completionRate = stats?.summary.completionRate ?? 0;
    $: metricItems = stats
        ? [
              { value: stats.summary.open, label: i18n?.openTasks || "Open", tone: "info" as const },
              { value: stats.summary.nextAction, label: i18n?.nextAction || "Next Actions", tone: "primary" as const },
              { value: stats.summary.someday, label: i18n?.someday || "Someday" },
              { value: stats.summary.overdue, label: i18n?.overdueTasks || "Overdue", tone: "danger" as const },
              { value: stats.summary.completedInPeriod, label: completedLabel, tone: "success" as const },
          ]
        : [];

    onMount(() => {
        loadStats();
    });
</script>

<NaViewShell
    loading={loading && !stats}
    loadingText={i18n?.loading || "Loading..."}
    {error}
    retryAction={{ label: i18n?.retry || "Retry", onClick: () => loadStats() }}
    hint={i18n?.viewHintStatistics}
>
    <svelte:fragment slot="toolbar">
        <NaToolbar compact>
            <span class="na-statistics__period-label">{periodLabelText}</span>
            <div class="na-toolbar__actions-content">
                <NaSegmentControl
                    size="sm"
                    options={[
                        { value: "week", label: i18n?.thisWeek || "Week" },
                        { value: "month", label: i18n?.thisMonth || "Month" },
                    ]}
                    value={period}
                    on:change={handlePeriodChange}
                />
            </div>
        </NaToolbar>
    </svelte:fragment>

    {#if stats}
        <div class="na-statistics__content">
            <section class="na-statistics__summary">
                <div class="na-statistics__completion">
                    <strong>{completionRate}%</strong>
                    <span>{i18n?.completionRate || "Completion Rate"}</span>
                    <small>{stats.summary.total} {i18n?.totalTasks || "tasks"}</small>
                </div>
                <NaProgressBar percent={completionRate} tone="success" valueLabel={`${completionRate}%`} />
            </section>

            <NaMetricStrip items={metricItems} />

            <section class="na-statistics__section">
                <h3>{i18n?.statusDistribution || "Status Distribution"}</h3>
                {#each stats.statusDistribution as item}<NaProgressBar
                        label={i18n?.[STATUS_LABELS[item.key]] || item.key}
                        percent={item.percent * 100}
                        valueLabel={String(item.count)}
                        tone={STATUS_TONES[item.key] || "primary"}
                    />{/each}
            </section>

            <section class="na-statistics__section">
                <h3>{i18n?.priorityDistribution || "Priority Distribution"}</h3>
                {#each stats.priorityDistribution as item}
                    <NaProgressBar
                        label={i18n?.[PRIORITY_LABELS[item.key]] || item.key}
                        percent={item.percent * 100}
                        valueLabel={String(item.count)}
                        tone={PRIORITY_TONES[item.key] || "info"}
                    />
                {/each}
            </section>

            <section class="na-statistics__section">
                <h3>{i18n?.contextDistribution || "Context Distribution"}</h3>
                {#if stats.contextDistribution.length === 0}<span class="na-statistics__empty"
                        >{i18n?.noContextTasks || "No contexts"}</span
                    >{:else}
                    {@const maxContextCount = Math.max(...stats.contextDistribution.map((item) => item.count))}
                    {#each stats.contextDistribution as item}<NaProgressBar
                            label={`@${item.context}`}
                            percent={maxContextCount > 0 ? (item.count / maxContextCount) * 100 : 0}
                            valueLabel={String(item.count)}
                            tone="info"
                        />{/each}
                {/if}
            </section>

            <section class="na-statistics__section">
                <h3>{i18n?.projectProgressStats || "Project Progress"}</h3>
                {#if stats.projectStatus.every((item) => item.count === 0)}<span class="na-statistics__empty"
                        >{i18n?.noProjectProgress || "No projects yet"}</span
                    >{:else}
                    {#each stats.projectStatus as item}<NaProgressBar
                            label={i18n?.[STATUS_LABELS[item.status]] || item.status}
                            percent={item.percent * 100}
                            valueLabel={String(item.count)}
                            tone={STATUS_TONES[item.status] || "primary"}
                        />{/each}
                {/if}
            </section>
        </div>
    {/if}
</NaViewShell>

<style lang="scss">
    .na-statistics__period-label {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
        font-weight: 600;
    }
    .na-statistics__content {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-lg);
        padding: var(--na-space-lg);
    }
    .na-statistics__summary {
        display: grid;
        grid-template-columns: minmax(120px, auto) minmax(160px, 1fr);
        align-items: center;
        gap: var(--na-space-xl);
        padding: var(--na-space-xl);
        border-bottom: 1px solid var(--na-color-divider);
        background: var(--b3-theme-surface);
    }
    .na-statistics__completion {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: baseline;
        gap: 2px var(--na-space-sm);
    }
    .na-statistics__completion strong {
        grid-row: 1 / 3;
        color: var(--b3-theme-primary);
        font-size: 28px;
        line-height: 1;
        font-variant-numeric: tabular-nums;
    }
    .na-statistics__completion span {
        color: var(--b3-theme-on-surface);
        font-size: var(--na-font-size-lg);
        font-weight: 600;
    }
    .na-statistics__completion small {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
    }
    .na-statistics__section {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-md);
        padding-top: var(--na-space-md);
        border-top: 1px solid var(--na-color-divider);
    }
    .na-statistics__section h3 {
        margin: 0;
        color: var(--b3-theme-on-surface);
        font-size: var(--na-font-size-md);
        font-weight: 600;
    }
    .na-statistics__section :global(.na-progress__label) {
        width: 88px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .na-statistics__empty {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
    }
    @container nextaction-app (max-width: 520px) {
        .na-statistics__content {
            padding: var(--na-space-md);
        }
        .na-statistics__summary {
            grid-template-columns: 1fr;
            gap: var(--na-space-lg);
            padding: var(--na-space-lg);
        }
    }
</style>
