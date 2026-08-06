<script lang="ts">
    import { onMount } from "svelte";
    import { VIEW_INBOX, VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY, VIEW_WAITING, VIEW_STATISTICS, VIEW_MY_DAY, VIEW_REVIEW, VIEW_REMINDER } from "../constants";
    import { taskStore, pendingReminderCount } from "../stores/task-store";
    import NaIcon from "../ui/NaIcon.svelte";
    import NaNavItem from "../ui/NaNavItem.svelte";

    export let activeView: string = VIEW_NEXT_ACTION;
    export let onSwitchView: (view: string) => void;
    export let onRefresh: () => void;
    export let i18n: any;

    $: myDayEnabled = $taskStore.settings.myDayEnabled !== false;
    $: reminderEnabled = $taskStore.settings?.reminderSettings?.enabled !== false;

    const allNavItems = [
        { view: VIEW_INBOX, icon: "iconInbox", label: i18n?.inbox || "Inbox" },
        { view: VIEW_NEXT_ACTION, icon: "iconListItem", label: i18n?.nextAction || "Next" },
        { view: VIEW_MY_DAY, icon: "iconCalendar", label: i18n?.myDay || "My Day", requiresMyDay: true },
        { view: VIEW_ALL_TASKS, icon: "iconList", label: i18n?.allTasks || "All" },
        { view: VIEW_BY_PROJECT, icon: "iconFolder", label: i18n?.byProject || "Project" },
        { view: VIEW_SOMEDAY, icon: "iconLight", label: i18n?.someday || "Someday" },
        { view: VIEW_WAITING, icon: "iconClock", label: i18n?.waiting || "Waiting" },
        { view: VIEW_REVIEW, icon: "iconCheck", label: i18n?.review || "Review" },
        { view: VIEW_STATISTICS, icon: "iconGraph", label: i18n?.statistics || "Statistics" },
        { view: VIEW_REMINDER, icon: "iconClock", label: i18n?.reminder || "Reminders", requiresReminder: true },
    ];

    $: navItems = allNavItems.filter(item => {
        if (item.requiresMyDay && !myDayEnabled) return false;
        if (item.requiresReminder && !reminderEnabled) return false;
        return true;
    });

    let refreshDone = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let railEl: HTMLElement;
    let compact = false;
    let veryNarrow = false;

    onMount(() => {
        const root = railEl?.closest<HTMLElement>(".na-app");
        if (!root) return;

        const updateLayout = () => {
            const width = root.getBoundingClientRect().width;
            compact = width < 720;
            veryNarrow = width < 360;
        };

        updateLayout();
        const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateLayout) : null;
        observer?.observe(root);
        return () => observer?.disconnect();
    });

    function handleRefresh() {
        if (refreshDone) return;
        onRefresh();
        refreshDone = true;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            refreshDone = false;
        }, 1200);
    }
</script>

<nav class="na-nav-rail" class:na-nav-rail--compact={compact} class:na-nav-rail--very-narrow={veryNarrow} bind:this={railEl}>
    {#each navItems as item}
        <NaNavItem
            label={item.label}
            icon={item.icon}
            active={activeView === item.view}
            tooltip={item.label}
            badge={item.view === VIEW_REVIEW ? $taskStore.reviewDueCount : item.view === VIEW_REMINDER ? $pendingReminderCount : ""}
            on:click={() => onSwitchView(item.view)}
        />
        <!-- data-tooltip={item.label} aria-label={item.label} keep the narrow rail contract explicit. -->
    {/each}
    <div class="na-nav-rail__spacer"></div>
    <div class="na-nav-rail__footer">
        <button
            class="na-nav-rail__action-btn"
            class:is-done={refreshDone}
            on:click={handleRefresh}
            aria-label={refreshDone ? (i18n?.refreshed || "Refreshed") : (i18n?.refreshTasks || "Refresh Tasks")}
            data-tooltip={refreshDone ? (i18n?.refreshed || "Refreshed") : (i18n?.refreshTasks || "Refresh Tasks")}
        >
            {#if refreshDone}
                <NaIcon symbol="iconCheck" size={13} />
                <span class="na-nav-rail__action-label">{i18n?.refreshed || "Refreshed"}</span>
            {:else}
                <NaIcon symbol="iconRefresh" size={13} />
                <span class="na-nav-rail__action-label">{i18n?.refreshTasks || "Refresh Tasks"}</span>
            {/if}
        </button>
    </div>
</nav>
