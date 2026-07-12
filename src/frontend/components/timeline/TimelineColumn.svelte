<script lang="ts">
    import { onMount } from "svelte";
    import {
        PIXELS_PER_MINUTE,
        TIMELINE_SLOT_MINUTES,
        DAY_MINUTES,
        MY_DAY_DRAG_TYPE,
    } from "../../../shared/constants";
    import type { MyDayTaskEntry, TaskCacheEntry, MyDayState } from "../../../shared/types";
    import type { KernelBridge } from "../../kernel-bridge";
    import { taskStore } from "../../stores/task-store";
    import { notifyError, formatRpcError } from "../../notify";
    import {
        minuteToPixel,
        pixelToSnappedMinute,
        computeLaneLayouts,
        generateTimelineSlots,
        minuteToTimeLabel,
        getCurrentMinuteOffset,
    } from "./timeline-utils";
    import TimelineCard from "./TimelineCard.svelte";
    import TimelineNeedle from "./TimelineNeedle.svelte";

    export let scheduledEntries: MyDayTaskEntry[] = [];
    export let taskMap: Map<string, TaskCacheEntry>;
    export let resetHour: number = 5;
    export let defaultDuration: number = 60;
    export let bridge: KernelBridge;
    export let i18n: any;

    let containerEl: HTMLElement | null = null;
    let containerWidth: number = 300;
    const LABEL_AREA_WIDTH = 48;
    let isDragOver: boolean = false;
    let dragPreviewStart: number | null = null;
    let dragPreviewEnd: number | null = null;

    $: totalHeight = DAY_MINUTES * PIXELS_PER_MINUTE;
    $: laneLayouts = computeLaneLayouts(scheduledEntries);
    $: slots = generateTimelineSlots(resetHour, TIMELINE_SLOT_MINUTES);

    function handleDragOver(e: DragEvent) {
        e.preventDefault();
        if (!e.dataTransfer?.types.includes(MY_DAY_DRAG_TYPE)) return;
        e.dataTransfer.dropEffect = "move";
        isDragOver = true;

        if (containerEl && e.clientY !== 0) {
            const rect = containerEl.getBoundingClientRect();
            const offsetY = e.clientY - rect.top + containerEl.scrollTop;
            const snapped = pixelToSnappedMinute(offsetY);
            dragPreviewStart = Math.max(0, Math.min(DAY_MINUTES - defaultDuration, snapped));
            dragPreviewEnd = dragPreviewStart + defaultDuration;
        }

        if (containerEl) {
            const rect = containerEl.getBoundingClientRect();
            const edgeZone = 40;
            if (e.clientY - rect.top < edgeZone) {
                containerEl.scrollTop -= 10;
            } else if (rect.bottom - e.clientY < edgeZone) {
                containerEl.scrollTop += 10;
            }
        }
    }

    function handleDragLeave() {
        isDragOver = false;
        dragPreviewStart = null;
        dragPreviewEnd = null;
    }

    async function handleDrop(e: DragEvent) {
        e.preventDefault();
        isDragOver = false;
        if (!e.dataTransfer?.types.includes(MY_DAY_DRAG_TYPE)) return;

        const blockId = e.dataTransfer.getData(MY_DAY_DRAG_TYPE);
        if (!blockId || dragPreviewStart === null) return;

        try {
            const newState = await bridge.setMyDaySchedule(
                blockId,
                dragPreviewStart,
                dragPreviewEnd!,
            );
            taskStore.applyMyDayUpdate(newState);
        } catch (err: any) {
            console.error("[NextAction] setMyDaySchedule failed:", err);
            notifyError(formatRpcError(err, i18n));
        }
        dragPreviewStart = null;
        dragPreviewEnd = null;
    }

    function scrollToCurrentTime() {
        if (!containerEl) return;
        const currentOffset = getCurrentMinuteOffset(resetHour);
        const targetTop = minuteToPixel(currentOffset) - containerEl.clientHeight / 2;
        containerEl.scrollTop = Math.max(0, targetTop);
    }

    onMount(() => {
        setTimeout(scrollToCurrentTime, 100);
        setTimeout(scrollToCurrentTime, 500);
        if (containerEl) {
            const resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    containerWidth = entry.contentRect.width - LABEL_AREA_WIDTH;
                }
            });
            resizeObserver.observe(containerEl);
            return () => resizeObserver.disconnect();
        }
    });
</script>

<div class="na-timeline-column" bind:this={containerEl}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
>
    <div class="na-timeline-column__body" style="height: {totalHeight}px; position: relative;">
        {#each slots as slot (slot.minute)}
            <div
                class="na-timeline-slot"
                class:na-timeline-slot--major={slot.isMajor}
                style="top: {minuteToPixel(slot.minute)}px"
            >
                {#if slot.isMajor}
                    <span class="na-timeline-slot__label">{slot.label}</span>
                {/if}
            </div>
        {/each}

        {#if isDragOver && dragPreviewStart !== null && dragPreviewEnd !== null}
            <div
                class="na-timeline-preview"
                style="top: {minuteToPixel(dragPreviewStart)}px; height: {minuteToPixel(dragPreviewEnd - dragPreviewStart)}px;"
            >
                <span class="na-timeline-preview__time">
                    {minuteToTimeLabel(dragPreviewStart, resetHour)} - {minuteToTimeLabel(dragPreviewEnd, resetHour)}
                </span>
            </div>
        {/if}

        {#each scheduledEntries as entry (entry.blockId)}
            {@const task = taskMap.get(entry.blockId)}
            {@const layout = laneLayouts.get(entry.blockId)}
            {#if task && layout}
                <TimelineCard
                    {entry}
                    {task}
                    {resetHour}
                    laneIndex={layout.laneIndex}
                    laneCount={layout.laneCount}
                    {containerWidth}
                    leftOffset={LABEL_AREA_WIDTH}
                    {bridge}
                    {i18n}
                    {taskMap}
                />
            {/if}
        {/each}

        <TimelineNeedle {resetHour} containerHeight={totalHeight} />
    </div>
</div>

<style lang="scss">
    .na-timeline-column {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        position: relative;
        background:
            linear-gradient(90deg, var(--b3-theme-surface) 0 48px, transparent 48px),
            linear-gradient(180deg, rgba(93, 173, 226, 0.035), transparent 180px),
            var(--b3-theme-background);
    }

    .na-timeline-column__body {
        position: relative;
    }

    .na-timeline-slot {
        position: absolute;
        left: 48px;
        right: 0;
        height: 1px;
        background: var(--na-task-card-meta-border, var(--b3-border-color));

        &--major {
            background: var(--na-myday-panel-border, var(--b3-border-color));
        }
    }

    .na-timeline-slot__label {
        position: absolute;
        right: calc(100% + 6px);
        top: -7px;
        width: 40px;
        text-align: right;
        font-size: 11px;
        color: var(--b3-theme-on-surface-secondary, #888);
        pointer-events: none;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }

    .na-timeline-preview {
        position: absolute;
        left: 52px;
        right: 4px;
        background: rgba(93, 173, 226, 0.11);
        border: 1px dashed var(--b3-theme-primary);
        border-radius: 8px;
        z-index: 15;
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: inset 3px 0 0 var(--b3-theme-primary);
    }

    .na-timeline-preview__time {
        font-size: 11px;
        color: var(--b3-theme-primary);
        font-weight: 650;
        padding: 2px 8px;
        border-radius: var(--na-radius-pill);
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-task-card-meta-border, var(--b3-border-color));
    }
</style>
