<script lang="ts">
    import { notificationQueue, dismissReminder, dismissAllReminders, buildDedupKey } from "../stores/reminder-store";
    import { jumpToBlock } from "../utils";
    import NaBadge from "../ui/NaBadge.svelte";
    import NaButton from "../ui/NaButton.svelte";
    import NaIconButton from "../ui/NaIconButton.svelte";
    import NaToolbar from "../ui/NaToolbar.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";

    export let i18n: any;

    $: pending = $notificationQueue.filter((r) => !r.dismissed).sort((a, b) => a.triggerTime - b.triggerTime);

    function getTypeLabel(type: "due" | "review" | "absolute" | "summary"): string {
        if (type === "due") return i18n?.reminderDue || "截止提醒";
        if (type === "absolute") return i18n?.reminderTypeAbsolute || "Fixed Time";
        if (type === "summary") return i18n?.reminderSummaryTitle || "任务概览";
        return i18n?.reminderReview || "回顾提醒";
    }

    function getDescription(entry: (typeof $notificationQueue)[0]): string {
        if (entry.type === "summary" && entry.summary) {
            const parts: string[] = [];
            if (entry.summary.overdue > 0)
                parts.push(
                    (i18n?.reminderSummaryOverdue || "{n} overdue").replace("{n}", String(entry.summary.overdue)),
                );
            if (entry.summary.dueToday > 0)
                parts.push(
                    (i18n?.reminderSummaryDueToday || "{n} due today").replace("{n}", String(entry.summary.dueToday)),
                );
            if (entry.summary.nextAction > 0)
                parts.push(
                    (i18n?.reminderSummaryNextAction || "{n} next actions").replace(
                        "{n}",
                        String(entry.summary.nextAction),
                    ),
                );
            if (entry.summary.waiting > 0)
                parts.push(
                    (i18n?.reminderSummaryWaiting || "{n} waiting").replace("{n}", String(entry.summary.waiting)),
                );
            return parts.join(" · ");
        }
        if (entry.type === "review") {
            return i18n?.reminderReviewToday || "今天需回顾";
        }
        if (entry.type === "absolute") {
            const d = new Date(entry.triggerTime);
            const month = d.getMonth() + 1;
            const day = d.getDate();
            const h = String(d.getHours()).padStart(2, "0");
            const m = String(d.getMinutes()).padStart(2, "0");
            return `${month}${i18n?.reminderMonth || "月"}${day}${i18n?.reminderDay || "日"} ${h}:${m}`;
        }
        // Due type — time remaining
        const diffMs = entry.dueTime - Date.now();
        if (diffMs <= 0) {
            const overdueMin = Math.round(Math.abs(diffMs) / 60000);
            if (overdueMin < 60)
                return (i18n?.reminderOverdueMinutes || "{n}min overdue").replace("{n}", String(overdueMin));
            const h = Math.round(overdueMin / 60);
            if (h < 24) return (i18n?.reminderOverdueHours || "{n}h overdue").replace("{n}", String(h));
            return (i18n?.reminderOverdueDays || "{n}d overdue").replace("{n}", String(Math.round(h / 24)));
        }
        const remainMin = Math.round(diffMs / 60000);
        if (remainMin < 60) return (i18n?.reminderDueInMinutes || "Due in {n}min").replace("{n}", String(remainMin));
        const h = Math.round(remainMin / 60);
        if (h < 24) return (i18n?.reminderDueIn || "Due in {n}h").replace("{n}", String(h));
        return (i18n?.reminderDueInDays || "Due in {n}d").replace("{n}", String(Math.round(h / 24)));
    }

    function formatTriggerTime(ts: number): string {
        const d = new Date(ts);
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function handleDismiss(entry: (typeof $notificationQueue)[0]) {
        const key = buildDedupKey(entry.blockId, entry.baseDateStr, entry.minutesBefore, entry.type);
        dismissReminder(key);
    }

    function handleDismissAll() {
        dismissAllReminders();
    }

    function handleJump(blockId: string) {
        if (blockId.startsWith("__")) return;
        jumpToBlock(blockId);
    }
</script>

<NaViewShell
    empty={pending.length === 0}
    emptyText={i18n?.reminderNoPending || "暂无待处理提醒"}
    hint={i18n?.viewHintReminder}
>
    {#snippet toolbar()}<NaToolbar compact
            ><span class="na-reminder__summary">{pending.length} {i18n?.reminder || "Reminders"}</span
            >{#if pending.length > 0}<div class="na-toolbar__actions-content">
                    <NaButton size="sm" variant="text" onclick={handleDismissAll}
                        >{i18n?.reminderDismissAll || "一键已读"}</NaButton
                    >
                </div>{/if}</NaToolbar
        >{/snippet}
    <div class="na-reminder__list">
        {#each pending as entry (buildDedupKey(entry.blockId, entry.baseDateStr, entry.minutesBefore, entry.type))}
            <div class="na-reminder__item na-reminder__item--{entry.type}">
                <div class="na-reminder__item-main">
                    <NaBadge
                        text={getTypeLabel(entry.type)}
                        tone={entry.type === "due"
                            ? "danger"
                            : entry.type === "review"
                              ? "info"
                              : entry.type === "absolute"
                                ? "warning"
                                : "primary"}
                    />
                    <NaButton variant="text" size="sm" onclick={() => handleJump(entry.blockId)}>{entry.title}</NaButton
                    >
                    <span class="na-reminder__desc">{getDescription(entry)}</span>
                    <span class="na-reminder__time">{formatTriggerTime(entry.triggerTime)}</span>
                </div>
                <NaIconButton
                    symbol="iconClose"
                    label={i18n?.reminderDismiss || "Dismiss"}
                    compact
                    onclick={() => handleDismiss(entry)}
                />
            </div>
        {/each}
    </div>
</NaViewShell>

<style lang="scss">
    .na-reminder__summary {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
        font-weight: 600;
    }

    .na-reminder__list {
        flex: 1;
        overflow-y: auto;
        padding: var(--na-space-sm) 0;
    }

    .na-reminder__item {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm);
        padding: var(--na-space-sm) var(--na-space-lg);
        border-bottom: 1px solid var(--b3-theme-surface-lighter);
        transition: background 0.15s;

        &:hover {
            background: var(--b3-theme-surface-lighter);
        }

        &:last-child {
            border-bottom: none;
        }
    }

    .na-reminder__item--due {
        border-left: 3px solid var(--na-color-error);
    }

    .na-reminder__item--review {
        border-left: 3px solid var(--na-color-info);
    }

    .na-reminder__item--absolute {
        border-left: 3px solid var(--na-color-warning);
    }

    .na-reminder__item--summary {
        border-left: 3px solid var(--na-accent);
    }

    .na-reminder__item-main {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm);
        flex: 1;
        min-width: 0;
    }

    .na-reminder__title,
    :global(.na-reminder__item-main > .na-button) {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--na-text-primary);
        font-size: var(--na-font-size-md);
        font-weight: 500;
        padding: 0;
        text-align: left;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;

        &:hover {
            color: var(--na-text-interactive);
        }
    }

    .na-reminder__desc {
        flex-shrink: 0;
        font-size: var(--na-font-size-xs);
        color: var(--na-text-secondary);
    }

    .na-reminder__time {
        flex-shrink: 0;
        font-size: var(--na-font-size-xs);
        color: var(--na-text-secondary);
        font-variant-numeric: tabular-nums;
    }

    .na-reminder__dismiss {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--na-text-secondary);
        border-radius: var(--na-radius-sm, 4px);
        padding: 0;
        transition:
            background 0.15s,
            color 0.15s;

        &:hover {
            background: var(--b3-theme-surface-lighter);
            color: var(--na-text-primary);
        }
    }
</style>
