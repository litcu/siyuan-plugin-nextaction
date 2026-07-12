<script lang="ts">
    import { onMount } from "svelte";
    import { RESPONSIVE_BREAKPOINT, MY_DAY_DRAG_TYPE } from "../../../shared/constants";
    import type { MyDayTaskEntry, TaskCacheEntry, MyDayState } from "../../../shared/types";
    import type { KernelBridge } from "../../kernel-bridge";
    import { taskStore } from "../../stores/task-store";
    import UnscheduledPanel from "./UnscheduledPanel.svelte";
    import TimelineColumn from "./TimelineColumn.svelte";

    export let bridge: KernelBridge;
    export let i18n: any;
    export let resetHour: number = 5;
    export let defaultDuration: number = 60;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;

    let containerWidth: number = 600;
    let containerEl: HTMLElement | null = null;
    let isNarrow: boolean = false;
    let dropTargetActive: boolean = false;

    $: myDayState = $taskStore.myDayState;
    $: allTasks = $taskStore.allTasks;
    $: taskMap = new Map<string, TaskCacheEntry>(allTasks.map((t) => [t.blockId, t] as [string, TaskCacheEntry]));

    $: unscheduledEntries = (myDayState?.tasks ?? []).filter(
        (e) => e.scheduleStart === null || e.scheduleEnd === null,
    );
    $: scheduledEntries = (myDayState?.tasks ?? []).filter(
        (e) => e.scheduleStart !== null && e.scheduleEnd !== null,
    );

    function handleDragOver(e: DragEvent) {
        if (!e.dataTransfer?.types.includes(MY_DAY_DRAG_TYPE)) return;
        e.preventDefault();
        dropTargetActive = true;
    }

    function handleDragLeave() {
        dropTargetActive = false;
    }

    async function handleDropOnUnscheduled(e: DragEvent) {
        e.preventDefault();
        dropTargetActive = false;
        if (!e.dataTransfer?.types.includes(MY_DAY_DRAG_TYPE)) return;
        const blockId = e.dataTransfer.getData(MY_DAY_DRAG_TYPE);
        if (!blockId) return;
        try {
            const newState = await bridge.removeMyDaySchedule(blockId);
            taskStore.applyMyDayUpdate(newState);
        } catch (err: any) {
            console.error("[NextAction] removeMyDaySchedule failed:", err);
        }
    }

    onMount(() => {
        if (containerEl) {
            const observer = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    containerWidth = entry.contentRect.width;
                    isNarrow = containerWidth < RESPONSIVE_BREAKPOINT;
                }
            });
            observer.observe(containerEl);
            return () => observer.disconnect();
        }
    });
</script>

<div class="na-timeline-view" bind:this={containerEl}>
    {#if isNarrow}
        <div class="na-timeline-view__top">
            <UnscheduledPanel
                {unscheduledEntries}
                {taskMap}
                {bridge}
                {i18n}
                {onContextMenu}
                isDropTarget={dropTargetActive}
                on:dragover={handleDragOver}
                on:dragleave={handleDragLeave}
                on:drop={handleDropOnUnscheduled}
            />
        </div>
        <div class="na-timeline-view__bottom">
            <TimelineColumn
                {scheduledEntries}
                {taskMap}
                {resetHour}
                {defaultDuration}
                {bridge}
                {i18n}
            />
        </div>
    {:else}
        <div class="na-timeline-view__left">
            <UnscheduledPanel
                {unscheduledEntries}
                {taskMap}
                {bridge}
                {i18n}
                {onContextMenu}
                isDropTarget={dropTargetActive}
                on:dragover={handleDragOver}
                on:dragleave={handleDragLeave}
                on:drop={handleDropOnUnscheduled}
            />
        </div>
        <div class="na-timeline-view__right">
            <TimelineColumn
                {scheduledEntries}
                {taskMap}
                {resetHour}
                {defaultDuration}
                {bridge}
                {i18n}
            />
        </div>
    {/if}
</div>

<style lang="scss">
    .na-timeline-view {
        display: flex;
        height: 100%;
        overflow: hidden;
        gap: 10px;
        padding: 10px;
        background: transparent;
    }

    .na-timeline-view__left {
        width: 236px;
        flex-shrink: 0;
        height: 100%;
        border: 1px solid var(--na-myday-panel-border, var(--b3-border-color));
        border-radius: 8px;
        overflow: hidden;
        background: var(--na-myday-panel-bg, var(--b3-theme-surface));
    }

    .na-timeline-view__right {
        flex: 1;
        min-width: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--na-myday-panel-border, var(--b3-border-color));
        border-radius: 8px;
        overflow: hidden;
        background: var(--na-myday-panel-bg, var(--b3-theme-surface));
    }

    .na-timeline-view__top {
        height: 120px;
        flex-shrink: 0;
        border: 1px solid var(--na-myday-panel-border, var(--b3-border-color));
        border-radius: 8px;
        overflow: hidden;
        background: var(--na-myday-panel-bg, var(--b3-theme-surface));
    }

    .na-timeline-view__bottom {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        margin-top: 10px;
        border: 1px solid var(--na-myday-panel-border, var(--b3-border-color));
        border-radius: 8px;
        overflow: hidden;
        background: var(--na-myday-panel-bg, var(--b3-theme-surface));
    }
</style>
