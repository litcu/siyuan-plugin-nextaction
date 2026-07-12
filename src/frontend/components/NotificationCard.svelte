<script lang="ts">
    import { fly } from "svelte/transition";
    import { jumpToBlock } from "../utils";
    import type { ReminderSummaryData } from "../../shared/types";

    export let title: string;
    export let type: "due" | "review" | "absolute" | "summary";
    export let message: string;
    export let blockId: string;
    export let onDismiss: () => void;
    export let i18n: any;
    export let summary: ReminderSummaryData | undefined;

    $: typeLabel =
        type === "due"
            ? (i18n?.reminderDue || "截止提醒")
            : type === "review"
            ? (i18n?.reminderReview || "回顾提醒")
            : type === "absolute"
            ? (i18n?.reminderTypeAbsolute || "固定提醒")
            : (i18n?.reminderSummaryTitle || "任务概览");
    $: dismissTitle = i18n?.reminderDismiss || "已读";

    function handleClick() {
        if (blockId.startsWith("__")) return; // summary card is not clickable
        jumpToBlock(blockId);
    }

    function handleKeydown(e: KeyboardEvent) {
        if (blockId.startsWith("__")) return;
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            jumpToBlock(blockId);
        }
    }

    $: summaryItems = (() => {
        if (type !== "summary" || !summary) return [];
        const items: { label: string; value: number; cls: string }[] = [];
        if (summary.overdue > 0) {
            const tpl = i18n?.reminderSummaryOverdue || "{n} overdue";
            items.push({ label: tpl.replace("{n}", String(summary.overdue)), value: summary.overdue, cls: "overdue" });
        }
        if (summary.dueToday > 0) {
            const tpl = i18n?.reminderSummaryDueToday || "{n} due today";
            items.push({ label: tpl.replace("{n}", String(summary.dueToday)), value: summary.dueToday, cls: "due-today" });
        }
        if (summary.startingToday > 0) {
            const tpl = i18n?.reminderSummaryStartingToday || "{n} starting today";
            items.push({ label: tpl.replace("{n}", String(summary.startingToday)), value: summary.startingToday, cls: "starting-today" });
        }
        if (summary.nextAction > 0) {
            const tpl = i18n?.reminderSummaryNextAction || "{n} next actions";
            items.push({ label: tpl.replace("{n}", String(summary.nextAction)), value: summary.nextAction, cls: "next-action" });
        }
        if (summary.waiting > 0) {
            const tpl = i18n?.reminderSummaryWaiting || "{n} waiting";
            items.push({ label: tpl.replace("{n}", String(summary.waiting)), value: summary.waiting, cls: "waiting" });
        }
        return items;
    })();
</script>

<div class="na-notification-card" transition:fly={{ x: 200, duration: 250 }}>
    <div class="na-notification-card__header">
        <span class="na-notification-card__type na-notification-card__type--{type}">
            {typeLabel}
        </span>
        <button class="na-notification-card__close" on:click={onDismiss} title={dismissTitle}>
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>
            </svg>
        </button>
    </div>
    {#if type === "summary" && summaryItems.length > 0}
        <div class="na-notification-card__summary">
            {#each summaryItems as item}
                <span class="na-notification-card__summary-item na-notification-card__summary-item--{item.cls}">
                    {item.label}
                </span>
            {/each}
        </div>
    {:else}
        <div
            class="na-notification-card__title"
            on:click={handleClick}
            on:keydown={handleKeydown}
            role="button"
            tabindex="0"
        >
            {title}
        </div>
        <div class="na-notification-card__message">{message}</div>
    {/if}
</div>
