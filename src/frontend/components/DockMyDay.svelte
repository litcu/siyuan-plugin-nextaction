<script lang="ts">
    import { onMount } from "svelte";
    import { taskStore } from "../stores/task-store";
    import { KernelBridge } from "../kernel-bridge";
    import { DEFAULT_MY_DAY_RESET_HOUR, DEFAULT_MY_DAY_DURATION, MY_DAY_DRAG_TYPE } from "../../shared/constants";
    import TaskCard from "./TaskCard.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import NaSearchSelect from "../ui/NaSearchSelect.svelte";
    import TimelineColumn from "./timeline/TimelineColumn.svelte";
    import { PRIORITY_HEX_COLORS } from "../constants";
    import type { TaskCacheEntry, MyDayTaskEntry, MyDayState } from "../../shared/types";

    export let bridge: KernelBridge;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;

    type ViewMode = "timeline" | "list";
    let viewMode: ViewMode = $taskStore.settings?.myDayDefaultViewMode === "list" ? "list" : "timeline";
    let selectedTaskId = "";

    $: resetHour = $taskStore.settings?.myDayResetHour ?? DEFAULT_MY_DAY_RESET_HOUR;
    $: defaultDuration = $taskStore.settings?.myDayDefaultDuration ?? DEFAULT_MY_DAY_DURATION;

    $: myDayState = $taskStore.myDayState;
    $: allTasks = $taskStore.allTasks;
    $: taskMap = new Map<string, TaskCacheEntry>(allTasks.map(t => [t.blockId, t] as [string, TaskCacheEntry]));

    $: myDayTasks = (() => {
        const state = myDayState;
        if (!state) return [];
        const result: TaskCacheEntry[] = [];
        for (const entry of state.tasks) {
            const task = taskMap.get(entry.blockId);
            if (task) result.push(task);
        }
        return result;
    })();

    $: myDayBlockIds = new Set((myDayState?.tasks || []).map(t => t.blockId));

    $: unscheduledEntries = (myDayState?.tasks ?? []).filter(
        (e) => e.scheduleStart === null || e.scheduleEnd === null,
    );
    $: scheduledEntries = (myDayState?.tasks ?? []).filter(
        (e) => e.scheduleStart !== null && e.scheduleEnd !== null,
    );

    async function searchTasksForAdd(query: string): Promise<{ id: string; label: string }[]> {
        if (!query.trim()) return [];
        const q = query.toLowerCase();
        return $taskStore.allTasks
            .filter(t =>
                t.status !== "done" &&
                t.status !== "someday" &&
                !myDayBlockIds.has(t.blockId) &&
                (t.title.toLowerCase().includes(q) || (t.tags && t.tags.replace(/\|/g, ', ').toLowerCase().includes(q)))
            )
            .slice(0, 10)
            .map(t => ({ id: t.blockId, label: t.title || (i18n?.untitled || "(untitled)") }));
    }

    async function handleSearchChange() {
        if (!selectedTaskId) return;
        const blockId = selectedTaskId;
        selectedTaskId = "";
        try {
            const myDayState = await bridge.addTaskToMyDay(blockId);
            taskStore.applyMyDayUpdate(myDayState);
        } catch (e: any) {
            console.error("[NextAction] addTaskToMyDay failed:", e);
        }
    }

    function handleDragStart(e: DragEvent, blockId: string) {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData(MY_DAY_DRAG_TYPE, blockId);
        e.dataTransfer.effectAllowed = "move";
    }

    async function handleRemoveFromMyDay(blockId: string) {
        try {
            const newState = await bridge.removeTaskFromMyDay(blockId);
            taskStore.applyMyDayUpdate(newState);
        } catch (e: any) {
            console.error("[NextAction] removeFromMyDay failed:", e);
        }
    }

    onMount(() => {
        taskStore.loadMyDay();
    });
</script>

<div class="na-dock-myday">
    <div class="na-dock-myday__toolbar">
        <div class="na-dock-myday__add">
            <NaSearchSelect
                placeholder={i18n?.dockSearchAddTask || "搜索添加任务…"}
                emptyText={i18n?.dockSearchHint || "输入关键词搜索任务"}
                noMatchText={i18n?.noMatches || "无匹配结果"}
                loadingText={i18n?.loadingMore || "加载中…"}
                searchFn={searchTasksForAdd}
                bind:selected={selectedTaskId}
                on:change={handleSearchChange}
            />
        </div>
        <div class="na-dock-myday__mode-toggle">
            <button
                class="na-dock-myday__mode-btn"
                class:na-dock-myday__mode-btn--active={viewMode === "timeline"}
                on:click={() => viewMode = "timeline"}
            >
                {i18n?.timelineMode || "时间线"}
            </button>
            <button
                class="na-dock-myday__mode-btn"
                class:na-dock-myday__mode-btn--active={viewMode === "list"}
                on:click={() => viewMode = "list"}
            >
                {i18n?.listMode || "列表"}
            </button>
        </div>
    </div>

    {#if viewMode === "timeline"}
        <div class="na-dock-myday__timeline">
            {#if unscheduledEntries.length > 0}
                <div class="na-dock-myday__unscheduled">
                    <div class="na-dock-myday__unscheduled-header">
                        <span>{i18n?.unscheduled || "Unscheduled"}</span>
                        <span class="na-dock-myday__unscheduled-count">{unscheduledEntries.length}</span>
                    </div>
                    {#each unscheduledEntries as entry (entry.blockId)}
                        {@const task = taskMap.get(entry.blockId)}
                        {#if task}
                            {@const hexColor = PRIORITY_HEX_COLORS[task.priority] || "#5dade2"}
                            <div
                                class="na-dock-myday__unscheduled-item"
                                class:na-dock-myday__unscheduled-item--done={task.status === "done"}
                                style="--na-dock-myday-unscheduled-accent: {hexColor};"
                                draggable="true"
                                on:dragstart={(e) => handleDragStart(e, entry.blockId)}
                                on:click={() => onEdit(task)}
                                on:contextmenu|preventDefault={(e) => onContextMenu(task, e)}
                            >
                                <span class="na-dock-myday__unscheduled-accent"></span>
                                <span class="na-dock-myday__unscheduled-name">{task.title || (i18n?.untitled || "(untitled)")}</span>
                                <button
                                    class="na-dock-myday__unscheduled-remove"
                                    on:click|stopPropagation={() => handleRemoveFromMyDay(entry.blockId)}
                                    title={i18n?.removeFromMyDay || "Remove from My Day"}
                                >
                                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                                        <line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>
                                    </svg>
                                </button>
                            </div>
                        {/if}
                    {/each}
                </div>
            {/if}
            <div class="na-dock-myday__timeline-col">
                <TimelineColumn
                    {scheduledEntries}
                    {taskMap}
                    {resetHour}
                    {defaultDuration}
                    {bridge}
                    {i18n}
                    {onContextMenu}
                />
            </div>
        </div>
    {:else}
        {#if $taskStore.loading}
            <NaEmpty loading={true} />
        {:else if myDayTasks.length === 0}
            <NaEmpty text={i18n?.noMyDayTasks || "No tasks planned for today."} />
        {:else}
            <div class="na-dock-myday__list">
                {#each myDayTasks as task (task.blockId)}
                    <TaskCard
                        {task}
                        {onEdit}
                        {onStatusClick}
                        {onContextMenu}
                        {i18n}
                    />
                {/each}
            </div>
        {/if}
    {/if}
</div>

<style lang="scss">
    .na-dock-myday {
        --na-dock-myday-panel-bg: var(--b3-theme-surface);
        --na-dock-myday-panel-border: var(--na-task-card-border, var(--b3-border-color));
        --na-dock-myday-panel-soft-bg: var(--na-task-card-child-bg, var(--b3-theme-surface-light));
        --na-myday-panel-bg: var(--na-dock-myday-panel-bg);
        --na-myday-panel-border: var(--na-dock-myday-panel-border);
        --na-myday-panel-soft-bg: var(--na-dock-myday-panel-soft-bg);
        display: flex;
        flex-direction: column;
        height: 100%;
        background:
            linear-gradient(180deg, rgba(93, 173, 226, 0.035), transparent 140px),
            var(--b3-theme-background);
    }

    .na-dock-myday__toolbar {
        position: relative;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--na-color-divider);
        background: var(--b3-theme-surface);
        flex-shrink: 0;
    }

    .na-dock-myday__add {
        position: relative;
        flex: 1;
        min-width: 0;
    }

    .na-dock-myday__mode-toggle {
        display: flex;
        gap: 2px;
        padding: 2px;
        border: 1px solid var(--na-task-card-meta-border);
        border-radius: var(--na-radius-pill);
        background: var(--b3-theme-background);
        flex-shrink: 0;
    }

    .na-dock-myday__mode-btn {
        min-width: 42px;
        padding: 3px 8px;
        font-size: 11px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--b3-theme-on-surface-secondary, #888);
        cursor: pointer;
        border-radius: var(--na-radius-pill);
        transition: all 0.15s;
        white-space: nowrap;

        &--active {
            background: var(--b3-theme-primary);
            color: var(--b3-theme-on-primary, #fff);
            border-color: var(--b3-theme-primary);
        }

        &:hover:not(.na-dock-myday__mode-btn--active) {
            color: var(--b3-theme-on-background);
            background: var(--na-task-card-meta-bg);
        }
    }

    .na-dock-myday__timeline {
        position: relative;
        z-index: 1;
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        gap: 8px;
        padding: 8px;
    }

    .na-dock-myday__unscheduled {
        flex-shrink: 0;
        padding: 8px;
        border: 1px solid var(--na-dock-myday-panel-border);
        border-radius: 8px;
        background: var(--na-dock-myday-panel-bg);
        max-height: 120px;
        overflow-y: auto;
    }

    .na-dock-myday__unscheduled-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 7px;
        color: var(--b3-theme-on-surface);
        font-size: 11px;
        font-weight: 700;
    }

    .na-dock-myday__unscheduled-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 18px;
        padding: 0 6px;
        border-radius: var(--na-radius-pill);
        color: var(--b3-theme-on-surface-secondary);
        background: var(--na-task-card-meta-bg);
        border: 1px solid var(--na-task-card-meta-border);
        font-size: 10px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }

    .na-dock-myday__unscheduled-item {
        display: grid;
        grid-template-columns: 3px minmax(0, 1fr) 20px;
        align-items: center;
        gap: 7px;
        padding: 6px 7px 6px 0;
        margin-bottom: 6px;
        border: 1px solid var(--na-task-card-border, var(--b3-border-color));
        border-radius: 8px;
        background: var(--b3-theme-surface);
        box-shadow: var(--na-shadow-sm);
        cursor: grab;
        transition: background 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.15s;

        &:hover {
            background: var(--b3-theme-surface-light);
            border-color: var(--b3-theme-primary-light);
            box-shadow: var(--na-shadow-hover);
            transform: translateY(-1px);
        }

        &[draggable="true"]:active {
            cursor: grabbing;
        }
    }

    .na-dock-myday__unscheduled-item--done {
        opacity: 0.56;
        background: var(--na-dock-myday-panel-soft-bg);

        .na-dock-myday__unscheduled-name {
            text-decoration: line-through;
        }
    }

    .na-dock-myday__unscheduled-accent {
        width: 3px;
        height: 100%;
        min-height: 20px;
        border-radius: var(--na-radius-pill);
        background: var(--na-dock-myday-unscheduled-accent, var(--b3-theme-primary));
    }

    .na-dock-myday__unscheduled-name {
        font-size: 12px;
        font-weight: 650;
        color: var(--b3-theme-on-background);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }

    .na-dock-myday__unscheduled-remove {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        padding: 0;
        border: 1px solid transparent;
        background: transparent;
        color: var(--b3-theme-on-surface-light, #999);
        border-radius: var(--na-radius-pill);
        cursor: pointer;
        opacity: 0.42;
        transition: opacity 0.15s, color 0.15s, background 0.15s;

        .na-dock-myday__unscheduled-item:hover & {
            opacity: 1;
        }

        &:hover {
            color: var(--na-color-error, #e74c3c);
            background: rgba(231, 76, 60, 0.1);
            border-color: rgba(231, 76, 60, 0.16);
        }
    }

    .na-dock-myday__timeline-col {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--na-dock-myday-panel-border);
        border-radius: 8px;
        overflow: hidden;
        background: var(--na-dock-myday-panel-bg);
    }

    .na-dock-myday__list {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;

        :global(.na-task-card) {
            border-radius: 6px;
            padding: 8px 10px;
        }

        :global(.na-task-card__meta) {
            flex-wrap: nowrap;
            overflow: hidden;
        }

        :global(.na-task-card__actions) {
            opacity: 1;
        }
    }
</style>
