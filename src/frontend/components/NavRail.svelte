<script lang="ts">
    import { VIEW_INBOX, VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY, VIEW_WAITING, VIEW_STATISTICS, VIEW_MY_DAY, VIEW_REVIEW, VIEW_REMINDER } from "../constants";
    import { taskStore, pendingReminderCount } from "../stores/task-store";

    export let activeView: string = VIEW_NEXT_ACTION;
    export let onSwitchView: (view: string) => void;
    export let onRefresh: () => void;
    export let i18n: any;

    $: myDayEnabled = $taskStore.settings.myDayEnabled !== false;
    $: reminderEnabled = $taskStore.settings?.reminderSettings?.enabled !== false;

    const allNavItems = [
        { view: VIEW_INBOX, icon: "inbox", label: i18n?.inbox || "Inbox" },
        { view: VIEW_NEXT_ACTION, icon: "next", label: i18n?.nextAction || "Next" },
        { view: VIEW_MY_DAY, icon: "myDay", label: i18n?.myDay || "My Day", requiresMyDay: true },
        { view: VIEW_ALL_TASKS, icon: "list", label: i18n?.allTasks || "All" },
        { view: VIEW_BY_PROJECT, icon: "project", label: i18n?.byProject || "Project" },
        { view: VIEW_SOMEDAY, icon: "someday", label: i18n?.someday || "Someday" },
        { view: VIEW_WAITING, icon: "waiting", label: i18n?.waiting || "Waiting" },
        { view: VIEW_REVIEW, icon: "review", label: i18n?.review || "Review" },
        { view: VIEW_STATISTICS, icon: "chart", label: i18n?.statistics || "Statistics" },
        { view: VIEW_REMINDER, icon: "reminder", label: i18n?.reminder || "Reminders", requiresReminder: true },
    ];

    $: navItems = allNavItems.filter(item => {
        if (item.requiresMyDay && !myDayEnabled) return false;
        if (item.requiresReminder && !reminderEnabled) return false;
        return true;
    });

    let refreshDone = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

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

<nav class="na-nav-rail">
    {#each navItems as item}
        <button
            class="na-nav-rail__item"
            class:active={activeView === item.view}
            on:click={() => onSwitchView(item.view)}
        >
            <span class="na-nav-rail__icon">
                {#if item.icon === "inbox"}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 4h14l-2.5 5.5H5.5z"/><line x1="7" y1="9.5" x2="7" y2="12"/><line x1="13" y1="9.5" x2="13" y2="12"/><path d="M5.5 9.5L3 16h14l-2.5-6.5"/>
                    </svg>
                {:else if item.icon === "next"}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10 3L10 10L4 10"/><path d="M10 10L17 10"/><path d="M10 10L10 17"/>
                    </svg>
                {:else if item.icon === "myDay"}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="10" cy="10" r="4"/>
                        <line x1="10" y1="2" x2="10" y2="3.5"/>
                        <line x1="10" y1="16.5" x2="10" y2="18"/>
                        <line x1="2" y1="10" x2="3.5" y2="10"/>
                        <line x1="16.5" y1="10" x2="18" y2="10"/>
                        <line x1="4.4" y1="4.4" x2="5.5" y2="5.5"/>
                        <line x1="14.5" y1="14.5" x2="15.6" y2="15.6"/>
                        <line x1="4.4" y1="15.6" x2="5.5" y2="14.5"/>
                        <line x1="14.5" y1="5.5" x2="15.6" y2="4.4"/>
                    </svg>
                {:else if item.icon === "list"}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                        <line x1="5" y1="5" x2="15" y2="5"/><line x1="5" y1="10" x2="15" y2="10"/><line x1="5" y1="15" x2="15" y2="15"/>
                    </svg>
                {:else if item.icon === "someday"}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10 2a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9z"/>
                        <line x1="7" y1="15.5" x2="13" y2="15.5"/>
                        <line x1="8" y1="17.5" x2="12" y2="17.5"/>
                    </svg>
                {:else if item.icon === "waiting"}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="10" cy="10" r="7.5"/>
                        <polyline points="10 5.5 10 10 13.5 12"/>
                    </svg>
                {:else if item.icon === "chart"}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="10" width="3" height="7" rx="0.5"/>
                        <rect x="8.5" y="5" width="3" height="12" rx="0.5"/>
                        <rect x="14" y="8" width="3" height="9" rx="0.5"/>
                    </svg>
                {:else if item.icon === "review"}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="10" cy="10" r="7"/>
                        <polyline points="7 10 9 12 13 8"/>
                    </svg>
                {:else if item.icon === "reminder"}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10 2C7.24 2 5 4.24 5 7v4l-2 2h14l-2-2V7c0-2.76-2.24-5-5-5z"/>
                        <path d="M8 15a2 2 0 0 0 4 0"/>
                    </svg>
                {:else}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 5h6l2 2h6v9H3z"/>
                    </svg>
                {/if}
            </span>
            <span class="na-nav-rail__label">{item.label}</span>
            {#if item.icon === "review" && $taskStore.reviewDueCount > 0}
                <span class="na-nav-rail__badge">{$taskStore.reviewDueCount}</span>
            {/if}
            {#if item.icon === "reminder" && $pendingReminderCount > 0}
                <span class="na-nav-rail__badge na-nav-rail__badge--reminder">{$pendingReminderCount}</span>
            {/if}
        </button>
    {/each}
    <div class="na-nav-rail__spacer"></div>
    <div class="na-nav-rail__footer">
        <button class="na-nav-rail__action-btn" class:is-done={refreshDone} on:click={handleRefresh}>
            {#if refreshDone}
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3.5 8.5 6.5 11.5 12.5 5"/></svg>
                {i18n?.refreshed || "Refreshed"}
            {:else}
                {i18n?.refreshTasks || "Refresh Tasks"}
            {/if}
        </button>
    </div>
</nav>
