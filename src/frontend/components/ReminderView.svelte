<script lang="ts">
    import { notificationQueue, dismissReminder, dismissAllReminders, buildDedupKey } from "../stores/reminder-store";
    import { jumpToBlock } from "../utils";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import NaViewHint from "../ui/NaViewHint.svelte";

    export let i18n: any;

    $: pending = $notificationQueue
        .filter(r => !r.dismissed)
        .sort((a, b) => a.triggerTime - b.triggerTime);

    function getTypeLabel(type: "due" | "review" | "absolute" | "summary"): string {
        if (type === "due") return i18n?.reminderDue || "截止提醒";
        if (type === "absolute") return i18n?.reminderTypeAbsolute || "固定提醒";
        if (type === "summary") return i18n?.reminderSummaryTitle || "任务概览";
        return i18n?.reminderReview || "回顾提醒";
    }

    function getDescription(entry: typeof $notificationQueue[0]): string {
        if (entry.type === "summary" && entry.summary) {
            const parts: string[] = [];
            if (entry.summary.overdue > 0) parts.push((i18n?.reminderSummaryOverdue || "{n} overdue").replace("{n}", String(entry.summary.overdue)));
            if (entry.summary.dueToday > 0) parts.push((i18n?.reminderSummaryDueToday || "{n} due today").replace("{n}", String(entry.summary.dueToday)));
            if (entry.summary.nextAction > 0) parts.push((i18n?.reminderSummaryNextAction || "{n} next actions").replace("{n}", String(entry.summary.nextAction)));
            if (entry.summary.waiting > 0) parts.push((i18n?.reminderSummaryWaiting || "{n} waiting").replace("{n}", String(entry.summary.waiting)));
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
            if (overdueMin < 60) return `逾期${overdueMin}分钟`;
            const h = Math.round(overdueMin / 60);
            if (h < 24) return `逾期${h}小时`;
            return `逾期${Math.round(h / 24)}天`;
        }
        const remainMin = Math.round(diffMs / 60000);
        if (remainMin < 60) return `${remainMin}分钟后到期`;
        const h = Math.round(remainMin / 60);
        if (h < 24) return `${h}小时后到期`;
        return `${Math.round(h / 24)}天后到期`;
    }

    function formatTriggerTime(ts: number): string {
        const d = new Date(ts);
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function handleDismiss(entry: typeof $notificationQueue[0]) {
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

<div class="na-reminder">
    <div class="na-reminder__header">
        <h2 class="na-reminder__title">{i18n?.reminder || "Reminders"}</h2>
        {#if pending.length > 0}
            <button class="na-reminder__dismiss-all" on:click={handleDismissAll}>
                {i18n?.reminderDismissAll || "一键已读"}
            </button>
        {/if}
    </div>

    {#if pending.length === 0}
        <NaEmpty text={i18n?.reminderNoPending || "暂无待处理提醒"} />
    {:else}
        <div class="na-reminder__list">
            {#each pending as entry (buildDedupKey(entry.blockId, entry.baseDateStr, entry.minutesBefore, entry.type))}
                <div class="na-reminder__item na-reminder__item--{entry.type}">
                    <div class="na-reminder__item-main">
                        <span class="na-reminder__type-badge na-reminder__type-badge--{entry.type}">
                            {getTypeLabel(entry.type)}
                        </span>
                        <button class="na-reminder__title" on:click={() => handleJump(entry.blockId)}>
                            {entry.title}
                        </button>
                        <span class="na-reminder__desc">{getDescription(entry)}</span>
                        <span class="na-reminder__time">{formatTriggerTime(entry.triggerTime)}</span>
                    </div>
                    <button class="na-reminder__dismiss" on:click={() => handleDismiss(entry)} title={i18n?.dismiss || "Dismiss"}>
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                            <line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>
                        </svg>
                    </button>
                </div>
            {/each}
        </div>
    {/if}
    <NaViewHint text={i18n?.viewHintReminder} />
</div>

<style lang="scss">
    .na-reminder {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .na-reminder__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--na-space-md) var(--na-space-lg);
        border-bottom: 1px solid var(--b3-theme-surface-lighter);
    }

    .na-reminder__title {
        font-size: var(--na-font-size-xl);
        font-weight: 600;
        color: var(--b3-theme-on-surface);
        margin: 0;
    }

    .na-reminder__dismiss-all {
        font-size: var(--na-font-size-sm);
        color: var(--na-color-error, #e74c3c);
        background: none;
        border: none;
        cursor: pointer;
        padding: var(--na-space-xs) var(--na-space-sm);
        border-radius: var(--na-radius-sm, 4px);
        transition: background 0.15s;

        &:hover {
            background: var(--b3-theme-surface-lighter);
        }
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
        border-left: 3px solid var(--na-color-error, #e74c3c);
    }

    .na-reminder__item--review {
        border-left: 3px solid var(--na-color-info, #5dade2);
    }

    .na-reminder__item--absolute {
        border-left: 3px solid var(--na-color-warning, #f0ad4e);
    }

    .na-reminder__item--summary {
        border-left: 3px solid var(--na-accent, #4fc3f7);
    }

    .na-reminder__item-main {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm);
        flex: 1;
        min-width: 0;
    }

    .na-reminder__type-badge {
        flex-shrink: 0;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 2px 6px;
        border-radius: var(--na-radius-sm, 4px);
        color: var(--b3-theme-on-primary);
    }

    .na-reminder__type-badge--due {
        background: var(--na-color-error, #e74c3c);
        opacity: 0.85;
    }

    .na-reminder__type-badge--review {
        background: var(--na-color-info, #5dade2);
        opacity: 0.85;
    }

    .na-reminder__type-badge--absolute {
        background: var(--na-color-warning, #f0ad4e);
        opacity: 0.85;
    }

    .na-reminder__type-badge--summary {
        background: var(--na-accent, #4fc3f7);
        opacity: 0.85;
    }

    .na-reminder__title {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--b3-theme-on-surface);
        font-size: var(--na-font-size-md);
        font-weight: 500;
        padding: 0;
        text-align: left;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;

        &:hover {
            color: var(--b3-theme-primary);
        }
    }

    .na-reminder__desc {
        flex-shrink: 0;
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface-secondary);
    }

    .na-reminder__time {
        flex-shrink: 0;
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface-light);
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
        color: var(--b3-theme-on-surface-light);
        border-radius: var(--na-radius-sm, 4px);
        padding: 0;
        transition: background 0.15s, color 0.15s;

        &:hover {
            background: var(--b3-theme-surface-lighter);
            color: var(--b3-theme-on-surface);
        }
    }
</style>
