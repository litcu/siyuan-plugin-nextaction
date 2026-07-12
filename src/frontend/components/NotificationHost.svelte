<script lang="ts">
    import {
        notificationQueue,
        visibleNotifications,
        dismissReminder,
        dismissAllReminders
    } from "../stores/reminder-store";
    import NotificationCard from "./NotificationCard.svelte";
    import { REMINDER_MAX_VISIBLE } from "../../shared/constants";

    export let i18n: any;

    $: hasNotifications = $visibleNotifications.length > 0;
    $: overflowCount = Math.max(0, $notificationQueue.filter(r => !r.dismissed).length - REMINDER_MAX_VISIBLE);

    $: dismissAllLabel = i18n?.reminderDismissAll || "一键已读";

    function handleDismiss(item: { blockId: string; baseDateStr: string; minutesBefore: number; type: "due" | "review" | "absolute" | "summary" }) {
        const dedupKey = `${item.blockId}|${item.baseDateStr}|${item.minutesBefore}|${item.type}`;
        dismissReminder(dedupKey);
    }

    function handleDismissAll() {
        dismissAllReminders();
    }

    function getMessage(item: { type: "due" | "review" | "absolute" | "summary"; dueTime: number; triggerTime?: number }): string {
        if (item.type === "review") {
            return i18n?.reminderReviewToday || "今天需回顾";
        }
        if (item.type === "absolute") {
            // Show the fixed time for absolute reminders
            const d = new Date(item.dueTime);
            const month = d.getMonth() + 1;
            const day = d.getDate();
            const h = String(d.getHours()).padStart(2, "0");
            const m = String(d.getMinutes()).padStart(2, "0");
            const diffMs = item.dueTime - Date.now();
            if (diffMs <= 0) {
                return `${month}${i18n?.reminderMonth || "月"}${day}${i18n?.reminderDay || "日"} ${h}:${m}`;
            }
            return `${month}${i18n?.reminderMonth || "月"}${day}${i18n?.reminderDay || "日"} ${h}:${m}`;
        }
        if (item.type === "summary") {
            // Summary type doesn't use getMessage — rendered directly in NotificationCard
            return "";
        }
        // Calculate actual time remaining until due (or overdue)
        const diffMs = item.dueTime - Date.now();
        if (diffMs <= 0) {
            // Overdue
            const overdueMin = Math.round(Math.abs(diffMs) / 60000);
            if (overdueMin < 60) {
                const template = i18n?.reminderOverdueMinutes || "已逾期{n}分钟";
                return template.replace("{n}", String(overdueMin));
            }
            const overdueH = Math.round(overdueMin / 60);
            if (overdueH < 24) {
                const template = i18n?.reminderOverdueHours || "已逾期{n}小时";
                return template.replace("{n}", String(overdueH));
            }
            const overdueD = Math.round(overdueH / 24);
            const template = i18n?.reminderOverdueDays || "已逾期{n}天";
            return template.replace("{n}", String(overdueD));
        }
        // Still before due
        const remainMin = Math.round(diffMs / 60000);
        if (remainMin < 60) {
            const template = i18n?.reminderDueInMinutes || "{n}分钟后到期";
            return template.replace("{n}", String(remainMin));
        }
        const remainH = Math.round(remainMin / 60);
        if (remainH < 24) {
            const template = i18n?.reminderDueIn || "{n}小时后到期";
            return template.replace("{n}", String(remainH));
        }
        const remainD = Math.round(remainH / 24);
        const template = i18n?.reminderDueInDays || "{n}天后到期";
        return template.replace("{n}", String(remainD));
    }
</script>

{#if hasNotifications}
    <div class="na-notification-host">
        {#each $visibleNotifications as item (item.blockId + "|" + item.baseDateStr + "|" + item.minutesBefore + "|" + item.type)}
            <NotificationCard
                title={item.title}
                type={item.type}
                message={getMessage(item)}
                blockId={item.blockId}
                onDismiss={() => handleDismiss(item)}
                summary={item.summary}
                {i18n}
            />
        {/each}
        {#if overflowCount > 0}
            <div class="na-notification-host__overflow">
                {i18n?.reminderNoPending
                    ? `${overflowCount}+`
                    : `还有 ${overflowCount} 条提醒`}
            </div>
        {/if}
        <button class="na-notification-host__dismiss-all" on:click={handleDismissAll}>
            {dismissAllLabel}
        </button>
    </div>
{/if}
