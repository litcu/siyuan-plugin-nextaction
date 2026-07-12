<script lang="ts">
    import { notificationQueue, dismissReminder, dismissAllReminders, buildDedupKey } from "../stores/reminder-store";
    import { jumpToBlock } from "../utils";
    import NaEmpty from "../ui/NaEmpty.svelte";

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

<div class="na-dock-reminder">
    {#if pending.length > 0}
        <div class="na-dock-reminder__header">
            <button class="na-dock-reminder__dismiss-all" on:click={handleDismissAll}>
                {i18n?.reminderDismissAll || "一键已读"}
            </button>
        </div>
    {/if}

    {#if pending.length === 0}
        <NaEmpty text={i18n?.reminderNoPending || "暂无待处理提醒"} />
    {:else}
        <div class="na-dock-reminder__list">
            {#each pending as entry (buildDedupKey(entry.blockId, entry.baseDateStr, entry.minutesBefore, entry.type))}
                <div class="na-dock-reminder__item na-dock-reminder__item--{entry.type}">
                    <div class="na-dock-reminder__item-main" on:click={() => handleJump(entry.blockId)}>
                        <span class="na-dock-reminder__type-badge na-dock-reminder__type-badge--{entry.type}">
                            {getTypeLabel(entry.type)}
                        </span>
                        <span class="na-dock-reminder__title">{entry.title}</span>
                        <span class="na-dock-reminder__desc">{getDescription(entry)}</span>
                    </div>
                    <button class="na-dock-reminder__dismiss" on:click={() => handleDismiss(entry)} title={i18n?.dismiss || "Dismiss"}>
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                            <line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>
                        </svg>
                    </button>
                </div>
            {/each}
        </div>
    {/if}
</div>

<style lang="scss">
    .na-dock-reminder {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .na-dock-reminder__header {
        display: flex;
        justify-content: flex-end;
        padding: 6px 12px;
        border-bottom: 1px solid var(--b3-theme-surface-lighter, rgba(0, 0, 0, 0.06));
        flex-shrink: 0;
    }

    .na-dock-reminder__dismiss-all {
        font-size: 12px;
        color: var(--na-color-error, #e74c3c);
        background: none;
        border: none;
        cursor: pointer;
        padding: 2px 8px;
        border-radius: var(--na-radius-sm, 4px);
        transition: background 0.15s;

        &:hover {
            background: var(--b3-theme-surface-lighter);
        }
    }

    .na-dock-reminder__list {
        flex: 1;
        overflow-y: auto;
    }

    .na-dock-reminder__item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--b3-theme-surface-lighter, rgba(0, 0, 0, 0.06));
        transition: background 0.15s;

        &:hover {
            background: var(--b3-theme-surface-lighter);
        }

        &:last-child {
            border-bottom: none;
        }
    }

    .na-dock-reminder__item--due {
        border-left: 3px solid var(--na-color-error, #e74c3c);
    }

    .na-dock-reminder__item--review {
        border-left: 3px solid var(--na-color-info, #5dade2);
    }

    .na-dock-reminder__item--absolute {
        border-left: 3px solid var(--na-color-warning, #f0ad4e);
    }

    .na-dock-reminder__item--summary {
        border-left: 3px solid var(--na-accent, #4fc3f7);
    }

    .na-dock-reminder__item-main {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        min-width: 0;
        cursor: pointer;
    }

    .na-dock-reminder__type-badge {
        flex-shrink: 0;
        font-size: 10px;
        font-weight: 600;
        padding: 2px 5px;
        border-radius: var(--na-radius-sm, 4px);
        color: var(--b3-theme-on-primary);
    }

    .na-dock-reminder__type-badge--due {
        background: var(--na-color-error, #e74c3c);
        opacity: 0.85;
    }

    .na-dock-reminder__type-badge--review {
        background: var(--na-color-info, #5dade2);
        opacity: 0.85;
    }

    .na-dock-reminder__type-badge--absolute {
        background: var(--na-color-warning, #f0ad4e);
        opacity: 0.85;
    }

    .na-dock-reminder__type-badge--summary {
        background: var(--na-accent, #4fc3f7);
        opacity: 0.85;
    }

    .na-dock-reminder__title {
        font-size: 13px;
        font-weight: 500;
        color: var(--b3-theme-on-surface);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .na-dock-reminder__desc {
        flex-shrink: 0;
        font-size: 11px;
        color: var(--b3-theme-on-surface-secondary);
    }

    .na-dock-reminder__dismiss {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
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
