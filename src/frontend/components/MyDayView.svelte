<script lang="ts">
    import { onMount } from "svelte";
    import { taskStore } from "../stores/task-store";
    import { VIEW_MY_DAY } from "../constants";
    import { DEFAULT_MY_DAY_RESET_HOUR, DEFAULT_MY_DAY_VIEW_MODE, DEFAULT_MY_DAY_DURATION } from "../../shared/constants";
    import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaButton from "../ui/NaButton.svelte";
    import NaMetricStrip from "../ui/NaMetricStrip.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";
    import NaTaskFilterBar from "../ui/NaTaskFilterBar.svelte";
    import NaTaskList from "../ui/NaTaskList.svelte";
    import NaToolbar from "../ui/NaToolbar.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";
    import TimelineView from "./timeline/TimelineView.svelte";
    import type { TaskCacheEntry } from "../../shared/types";
    import type { KernelBridge } from "../kernel-bridge";
    import { isMyDayEntryDone } from "../../shared/my-day";
    import { runAiPlanMyDay } from "../ai/ai-feature-service";

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

    $: filteredTasks = applyFilters(myDayTasks, filterState, $taskStore.settings.customFields);

    const myDaySortOptions = [
        { value: "order", label: i18n?.sortByOrder || "Comprehensive" },
        { value: "due", label: i18n?.sortByDue || "Due date" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
    ];

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_MY_DAY, state);
    }

    function handleViewModeChange(event: CustomEvent<string>) {
        viewMode = event.detail as ViewMode;
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

    $: summaryItems = [
        { value: myDayEntries.length, label: i18n?.myDayTotalShort || "Total" },
        { value: scheduledCount, label: i18n?.myDayScheduledShort || "Scheduled", tone: "success" as const },
        { value: unscheduledCount, label: i18n?.myDayUnscheduledShort || "Unscheduled", tone: "warning" as const },
        { value: formatMinutes(plannedMinutes), label: i18n?.myDayPlannedTime || "Planned", tone: "primary" as const },
    ];
</script>

<div class="na-view na-view--myday">
    <NaViewShell loading={viewMode === "list" && $taskStore.loading} empty={viewMode === "list" && filteredTasks.length === 0} emptyText={i18n?.noMyDayTasks || "No tasks planned for today."} emptyAction={{ label: i18n?.aiPlanMyDay || "自动规划", onClick: runAiPlanMyDay }} hint={i18n?.viewHintMyDay} scrollMode="none">
        <svelte:fragment slot="toolbar">
            <NaToolbar>
                <NaMetricStrip items={summaryItems} />
                <div class="na-toolbar__actions-content">
                    <NaButton size="sm" icon="iconSparkles" on:click={runAiPlanMyDay}>{i18n?.aiPlanMyDay || "自动规划"}</NaButton>
                    <NaSegmentControl size="sm" options={[{ value: "timeline", label: i18n?.timelineMode || "Timeline" }, { value: "list", label: i18n?.listMode || "List" }]} value={viewMode} label={i18n?.myDayDefaultViewMode || "View mode"} on:change={handleViewModeChange} />
                </div>
            </NaToolbar>
            {#if viewMode === "list"}<NaTaskFilterBar
            contexts={$taskStore.contexts}
            tags={$taskStore.tags}
            customFields={$taskStore.settings.customFields}
            filterState={filterState}
            showStatus={true}
            showPriority={true}
            sortOptions={myDaySortOptions}
            {i18n}
            on:change={(event) => handleFilterChange(event.detail)}
            />{/if}
        </svelte:fragment>
        {#if viewMode === "timeline"}
            <TimelineView {bridge} {i18n} {resetHour} {defaultDuration} {onContextMenu} />
        {:else}
            <NaTaskList>
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
            </NaTaskList>
        {/if}
    </NaViewShell>
</div>

<style lang="scss">
    .na-view--myday {
        --na-myday-panel-bg: var(--b3-theme-surface);
        --na-myday-panel-border: var(--na-task-card-border, var(--b3-border-color));
        --na-myday-panel-soft-bg: var(--na-task-card-child-bg, var(--b3-theme-surface-light));
        container-name: myday-view;
        container-type: inline-size;
        background: var(--b3-theme-surface);
    }
</style>
