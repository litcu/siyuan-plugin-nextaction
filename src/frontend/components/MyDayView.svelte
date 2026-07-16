<script lang="ts">
    import { onMount } from "svelte";
    import { taskStore } from "../stores/task-store";
    import { VIEW_MY_DAY } from "../constants";
    import { DEFAULT_MY_DAY_RESET_HOUR, DEFAULT_MY_DAY_VIEW_MODE, DEFAULT_MY_DAY_DURATION } from "../../shared/constants";
    import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import NaViewHint from "../ui/NaViewHint.svelte";
    import SearchFilterBar from "./SearchFilterBar.svelte";
    import TimelineView from "./timeline/TimelineView.svelte";
    import type { TaskCacheEntry } from "../../shared/types";
    import type { KernelBridge } from "../kernel-bridge";
    import { isMyDayEntryDone } from "../../shared/my-day";

    export let bridge: KernelBridge;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;
    export let selectedTaskId: string = "";
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;

    type ViewMode = "timeline" | "list";
    let viewMode: ViewMode = $taskStore.settings?.myDayDefaultViewMode ?? DEFAULT_MY_DAY_VIEW_MODE;

    $: filterState = $taskStore.filterByView[VIEW_MY_DAY] || DEFAULT_FILTER_STATE;
    $: resetHour = $taskStore.settings?.myDayResetHour ?? DEFAULT_MY_DAY_RESET_HOUR;
    $: defaultDuration = $taskStore.settings?.myDayDefaultDuration ?? DEFAULT_MY_DAY_DURATION;
    $: myDayEntries = $taskStore.myDayState?.tasks ?? [];
    $: myDayEntryMap = new Map(myDayEntries.map((entry) => [entry.blockId, entry]));
    $: scheduledCount = myDayEntries.filter((entry) => entry.scheduleStart !== null && entry.scheduleEnd !== null).length;
    $: unscheduledCount = myDayEntries.length - scheduledCount;
    $: plannedMinutes = myDayEntries.reduce((sum, entry) => {
        if (entry.scheduleStart === null || entry.scheduleEnd === null) return sum;
        return sum + Math.max(0, entry.scheduleEnd - entry.scheduleStart);
    }, 0);

    $: myDayTasks = (() => {
        const state = $taskStore.myDayState;
        if (!state) return [];
        const taskMap = new Map<string, TaskCacheEntry>();
        for (const t of $taskStore.allTasks) {
            taskMap.set(t.blockId, t);
        }
        const result: TaskCacheEntry[] = [];
        for (const entry of state.tasks) {
            const task = taskMap.get(entry.blockId);
            if (task) result.push(task);
        }
        return result;
    })();

    $: filteredTasks = applyFilters(myDayTasks, filterState);

    const myDaySortOptions = [
        { value: "order", label: i18n?.sortByOrder || "Comprehensive" },
        { value: "due", label: i18n?.sortByDue || "Due date" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
    ];

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_MY_DAY, state);
    }

    function formatMinutes(minutes: number): string {
        if (minutes <= 0) return "0m";
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours === 0) return `${mins}m`;
        if (mins === 0) return `${hours}h`;
        return `${hours}h ${mins}m`;
    }

    onMount(() => {
        taskStore.loadMyDay();
    });
</script>

<div class="na-view na-view--myday">
    <div class="na-view__header na-myday-header">
        <div class="na-myday-title-group">
            <div class="na-myday-title">{i18n?.myDay || "My Day"}</div>
            <div class="na-myday-subtitle">{i18n?.myDaySubtitle || "Today plan and unscheduled tasks"}</div>
        </div>
        <div class="na-myday-summary">
            <span class="na-myday-summary__item">
                <strong>{myDayEntries.length}</strong>
                <span>{i18n?.myDayTotalShort || "Total"}</span>
            </span>
            <span class="na-myday-summary__item">
                <strong>{scheduledCount}</strong>
                <span>{i18n?.myDayScheduledShort || "Scheduled"}</span>
            </span>
            <span class="na-myday-summary__item">
                <strong>{unscheduledCount}</strong>
                <span>{i18n?.myDayUnscheduledShort || "Unscheduled"}</span>
            </span>
            <span class="na-myday-summary__item na-myday-summary__item--time">
                <strong>{formatMinutes(plannedMinutes)}</strong>
                <span>{i18n?.myDayPlannedTime || "Planned"}</span>
            </span>
        </div>
        <div class="na-myday-mode-toggle">
            <button
                class="na-myday-mode-btn"
                class:na-myday-mode-btn--active={viewMode === "timeline"}
                on:click={() => viewMode = "timeline"}
            >
                {i18n?.timelineMode || "Timeline"}
            </button>
            <button
                class="na-myday-mode-btn"
                class:na-myday-mode-btn--active={viewMode === "list"}
                on:click={() => viewMode = "list"}
            >
                {i18n?.listMode || "List"}
            </button>
        </div>
    </div>

    {#if viewMode === "timeline"}
        <TimelineView {bridge} {i18n} {resetHour} {defaultDuration} {onContextMenu} />
    {:else}
        <SearchFilterBar
            contexts={$taskStore.contexts}
            tags={$taskStore.tags}
            filterState={filterState}
            showStatus={true}
            showPriority={true}
            sortOptions={myDaySortOptions}
            {i18n}
            onFilterChange={handleFilterChange}
        />
        {#if $taskStore.loading}
            <NaEmpty loading={true} />
        {:else if filteredTasks.length === 0}
            <NaEmpty text={i18n?.noMyDayTasks || "No tasks planned for today."} />
        {:else}
            <div class="na-view__list">
                {#each filteredTasks as task (task.blockId)}
                    <TaskCard
                        {task}
                        completedOverride={isMyDayEntryDone(myDayEntryMap.get(task.blockId), task.status)}
                        selected={task.blockId === selectedTaskId}
                        onSelect={onSelectTask}
                        {onEdit}
                        {onStatusClick}
                        {onContextMenu}
                        {i18n}
                    />
                {/each}
            </div>
        {/if}
    {/if}
    <NaViewHint text={i18n?.viewHintMyDay} />
</div>

<style lang="scss">
    .na-view--myday {
        --na-myday-panel-bg: var(--b3-theme-surface);
        --na-myday-panel-border: var(--na-task-card-border, var(--b3-border-color));
        --na-myday-panel-soft-bg: var(--na-task-card-child-bg, var(--b3-theme-surface-light));
        background:
            linear-gradient(180deg, rgba(93, 173, 226, 0.035), transparent 160px),
            var(--b3-theme-background);
    }

    .na-myday-header {
        display: flex;
        align-items: center;
        gap: var(--na-space-lg, 12px);
        padding: 10px 12px;
        border-bottom: 1px solid var(--na-color-divider);
        background: var(--b3-theme-surface);
    }

    .na-myday-title-group {
        min-width: 0;
        margin-right: auto;
    }

    .na-myday-title {
        color: var(--b3-theme-on-background);
        font-size: 13px;
        font-weight: 700;
        line-height: 1.25;
    }

    .na-myday-subtitle {
        margin-top: 2px;
        color: var(--b3-theme-on-surface-secondary);
        font-size: var(--na-font-size-xs, 10px);
        line-height: 1.3;
        white-space: nowrap;
    }

    .na-myday-summary {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
    }

    .na-myday-summary__item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 24px;
        padding: 2px 8px;
        border-radius: var(--na-radius-pill);
        border: 1px solid var(--na-task-card-meta-border);
        background: var(--na-task-card-meta-bg);
        color: var(--b3-theme-on-surface-secondary);
        font-size: var(--na-font-size-xs, 10px);
        line-height: 1;
        white-space: nowrap;

        strong {
            color: var(--b3-theme-on-background);
            font-size: 12px;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            line-height: 1;
        }

        span {
            line-height: 1;
        }

        &--time {
            border-color: rgba(93, 173, 226, 0.18);
            background: rgba(93, 173, 226, 0.08);
        }
    }

    .na-myday-mode-toggle {
        display: flex;
        gap: 2px;
        padding: 2px;
        margin-left: 0;
        border: 1px solid var(--na-task-card-meta-border);
        border-radius: var(--na-radius-pill);
        background: var(--b3-theme-background);
        flex-shrink: 0;
    }

    .na-myday-mode-btn {
        min-width: 46px;
        padding: 3px 10px;
        font-size: 11px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--b3-theme-on-surface-secondary, #888);
        cursor: pointer;
        border-radius: var(--na-radius-pill);
        transition: all 0.15s;

        &--active {
            background: var(--b3-theme-primary);
            color: var(--b3-theme-on-primary, #fff);
            border-color: var(--b3-theme-primary);
        }
    }

    @media (max-width: 760px) {
        .na-myday-header {
            align-items: flex-start;
            flex-wrap: wrap;
        }

        .na-myday-summary {
            order: 3;
            width: 100%;
            justify-content: flex-start;
        }
    }
</style>
