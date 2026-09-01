<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import type { TaskCacheEntry } from "../../shared/types";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import NaIconButton from "../ui/NaIconButton.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";
    import type { ProjectTreeModel, ProjectTreeSortMode } from "../utils/project-tree";
    import {
        GANTT_ROW_HEIGHT,
        buildGanttAxis,
        calculateGanttEdges,
        calculateGanttGeometries,
        calculateGanttRange,
        calendarDayNumber,
        dateToPixel,
        fitGanttRange,
        localCalendarDate,
    } from "../utils/gantt";
    import GanttBar from "./GanttBar.svelte";

    export let model: ProjectTreeModel;
    export let projectTasks: TaskCacheEntry[];
    export let selectedTaskId = "";
    export let i18n: any;
    export let sortMode: ProjectTreeSortMode = "timeline";
    export let onSortModeChange: (value: ProjectTreeSortMode) => void;
    export let onToggleCollapse: (blockId: string) => void;
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;

    let viewportElement: HTMLDivElement;
    let outlineElement: HTMLDivElement;
    let availableTimelineWidth = 0;
    let resizeObserver: ResizeObserver | null = null;
    let lastScrollKey = "";

    $: baseRange = calculateGanttRange(model.includedTasks);
    $: range = baseRange ? fitGanttRange(baseRange, availableTimelineWidth) : null;
    $: axis = range ? buildGanttAxis(range) : { primary: [], secondary: [] };
    $: geometries = range ? calculateGanttGeometries(projectTasks, model, range) : new Map();
    $: edges = range ? calculateGanttEdges(model.rows, projectTasks, geometries) : [];
    $: timelineWidth = range ? range.totalDays * range.pixelsPerDay : Math.max(availableTimelineWidth, 360);
    $: rowsHeight = range
        ? Math.max(model.rows.length * GANTT_ROW_HEIGHT, GANTT_ROW_HEIGHT)
        : Math.max(model.rows.length * GANTT_ROW_HEIGHT, 200);
    $: contentHeight = rowsHeight + 56;
    $: todayX = range ? dateToPixel(localCalendarDate(), range) : null;
    $: markerPrefix = `na-gantt-${model.rows[0]?.task.blockId || "project"}`;
    $: explicitlyScheduledTaskIds = new Set(
        model.rows.filter((row) => hasScheduledDate(row.task)).map((row) => row.task.blockId),
    );
    $: scheduledTaskIds = range ? new Set(geometries.keys()) : explicitlyScheduledTaskIds;
    $: scheduledCount = scheduledTaskIds.size;
    $: unscheduledRows = model.rows.filter((row) => !scheduledTaskIds.has(row.task.blockId));
    $: firstUnscheduledTask =
        unscheduledRows.find((row) => row.task.blockId !== model.rows[0]?.task.blockId)?.task ||
        unscheduledRows[0]?.task;
    $: scaleLabel =
        range?.scale === "day"
            ? i18n?.ganttScaleDay || "Day"
            : range?.scale === "week"
              ? i18n?.ganttScaleWeek || "Week"
              : i18n?.ganttScaleMonth || "Month";
    $: if (range && viewportElement) scheduleInitialScroll();

    function hasScheduledDate(task: TaskCacheEntry): boolean {
        return calendarDayNumber(task.start || "") !== null || calendarDayNumber(task.due || "") !== null;
    }

    function getStatusColor(task: TaskCacheEntry): string {
        if (task.status === "inbox") return "var(--na-color-inbox)";
        if (task.status === "doing") return "var(--na-color-doing)";
        if (task.status === "waiting") return "var(--na-color-waiting)";
        if (task.status === "someday") return "var(--na-color-someday)";
        if (task.status === "done") return "var(--na-color-done)";
        return "var(--na-color-info)";
    }

    function measure(): void {
        if (!viewportElement || !outlineElement) return;
        availableTimelineWidth = Math.max(280, viewportElement.clientWidth - outlineElement.offsetWidth);
    }

    async function scheduleInitialScroll(): Promise<void> {
        if (!range || !viewportElement) return;
        const key = `${model.rows[0]?.task.blockId || ""}:${range.startDate}:${range.endDate}:${range.scale}:${range.pixelsPerDay.toFixed(3)}`;
        if (key === lastScrollKey) return;
        lastScrollKey = key;
        await tick();
        if (todayX !== null && todayX >= 0 && todayX <= timelineWidth) {
            viewportElement.scrollLeft = Math.max(
                0,
                outlineElement.offsetWidth + todayX - viewportElement.clientWidth * 0.25,
            );
        } else {
            viewportElement.scrollLeft = 0;
        }
    }

    function handleToggle(blockId: string, event: MouseEvent): void {
        event.stopPropagation();
        onToggleCollapse(blockId);
    }

    function handleRowSelect(task: TaskCacheEntry): void {
        onSelectTask?.(task);
    }

    function handleSortModeChange(value: string): void {
        onSortModeChange(value as ProjectTreeSortMode);
    }

    onMount(() => {
        measure();
        if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(measure);
            resizeObserver.observe(viewportElement);
            resizeObserver.observe(outlineElement);
        }
    });

    onDestroy(() => resizeObserver?.disconnect());
</script>

<div
    class="na-gantt"
    style="--na-gantt-content-height: {contentHeight}px"
    aria-label={i18n?.projectViewGantt || "Gantt"}
>
    <div class="na-gantt__viewport" bind:this={viewportElement}>
        <div
            class="na-gantt__grid"
            style="--na-gantt-timeline-width: {timelineWidth}px; --na-gantt-rows-height: {rowsHeight}px;"
        >
            <header class="na-gantt__corner">
                <div class="na-gantt__corner-title">
                    <strong>{i18n?.projectViewGantt || "Gantt"}</strong>
                    {#if range}<span class="na-gantt__scale">{scaleLabel}</span>{/if}
                </div>
                {#if range}
                    <div class="na-gantt__corner-meta">
                        <span>{scheduledCount} {i18n?.ganttScheduled || "Scheduled"}</span>
                        <NaSegmentControl
                            size="sm"
                            value={sortMode}
                            label={i18n?.ganttSortLabel || "Gantt order"}
                            options={[
                                { value: "timeline", label: i18n?.ganttSortTimeline || "Time" },
                                { value: "manual", label: i18n?.ganttSortManual || "Manual" },
                            ]}
                            onChange={handleSortModeChange}
                        />
                    </div>
                {:else}
                    <div class="na-gantt__schedule-summary">
                        <span class="na-gantt__schedule-summary-item na-gantt__schedule-summary-item--unscheduled">
                            <i></i><span>{unscheduledRows.length} {i18n?.ganttUnscheduled || "Unscheduled"}</span>
                        </span>
                    </div>
                {/if}
            </header>

            <header
                class="na-gantt__axis"
                class:na-gantt__axis--day={range?.scale === "day"}
                class:na-gantt__axis--week={range?.scale === "week"}
                class:na-gantt__axis--month={range?.scale === "month"}
                style="width: {timelineWidth}px"
            >
                {#if range}
                    <div class="na-gantt__axis-row na-gantt__axis-row--primary">
                        {#each axis.primary as segment (segment.key)}
                            <span style="left: {segment.x}px; width: {segment.width}px">{segment.label}</span>
                        {/each}
                    </div>
                    <div class="na-gantt__axis-row na-gantt__axis-row--secondary">
                        {#each axis.secondary as segment (segment.key)}
                            <span
                                class:weekend={segment.weekend}
                                class:alternate={segment.alternate}
                                style="left: {segment.x}px; width: {segment.width}px">{segment.label}</span
                            >
                        {/each}
                    </div>
                {:else}
                    <div class="na-gantt__axis-empty">
                        <span class="na-gantt__axis-stat na-gantt__axis-stat--scheduled"
                            ><i></i>{scheduledCount} {i18n?.ganttScheduled || "Scheduled"}</span
                        >
                        <span class="na-gantt__axis-stat na-gantt__axis-stat--unscheduled"
                            ><i></i>{unscheduledRows.length} {i18n?.ganttUnscheduled || "Unscheduled"}</span
                        >
                    </div>
                {/if}
            </header>

            <div class="na-gantt__outline" bind:this={outlineElement} style="height: {rowsHeight}px">
                {#each model.rows as row (row.task.blockId)}
                    <div
                        class="na-gantt__outline-row"
                        class:selected={row.task.blockId === selectedTaskId}
                        class:na-gantt__outline-row--summary={row.depth === 0 && row.hasChildren}
                        style="height: {GANTT_ROW_HEIGHT}px; padding-left: {row.depth * 18 + 8}px;"
                    >
                        {#if row.hasChildren}
                            <NaIconButton
                                symbol={row.isCollapsed ? "iconRight" : "iconDown"}
                                label={row.isCollapsed
                                    ? i18n?.expandChildren || "Expand subtasks"
                                    : i18n?.collapseChildren || "Collapse subtasks"}
                                size={12}
                                compact
                                onclick={(event) => handleToggle(row.task.blockId, event)}
                            />
                        {:else}
                            <span class="na-gantt__outline-spacer"></span>
                        {/if}
                        <span class="na-gantt__status" style="--na-gantt-status-color: {getStatusColor(row.task)}"
                        ></span>
                        <button
                            type="button"
                            class="na-gantt__task-title"
                            aria-current={row.task.blockId === selectedTaskId ? "true" : undefined}
                            on:click={() => handleRowSelect(row.task)}
                            on:dblclick={() => onEdit(row.task)}
                            on:contextmenu|preventDefault={(event) => onContextMenu(row.task, event)}
                        >
                            <span class="na-gantt__task-name">{row.task.title || i18n?.untitled || "Untitled"}</span>
                            <span class="na-gantt__task-meta">
                                {#if !scheduledTaskIds.has(row.task.blockId)}
                                    <small class="na-gantt__unscheduled-label"
                                        >{i18n?.ganttUnscheduled || "Unscheduled"}</small
                                    >
                                {/if}
                                {#if row.childCount > 0}<small class="na-gantt__child-count">{row.childCount}</small
                                    >{/if}
                            </span>
                        </button>
                    </div>
                {/each}
            </div>

            <div class="na-gantt__timeline" style="width: {timelineWidth}px; height: {rowsHeight}px">
                {#if range}
                    <div class="na-gantt__bands" aria-hidden="true">
                        {#each axis.secondary as segment (segment.key)}
                            <span
                                class:weekend={segment.weekend}
                                class:alternate={segment.alternate}
                                style="left: {segment.x}px; width: {segment.width}px"
                            ></span>
                        {/each}
                    </div>
                    {#if todayX !== null && todayX >= 0 && todayX <= timelineWidth}
                        <div
                            class="na-gantt__today"
                            style="left: {todayX}px"
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={i18n?.ganttToday || "Today"}
                        ></div>
                    {/if}
                    <svg class="na-gantt__edges" width={timelineWidth} height={rowsHeight} aria-hidden="true">
                        <defs>
                            <marker
                                id={`${markerPrefix}-dependency`}
                                markerWidth="6"
                                markerHeight="6"
                                refX="5"
                                refY="3"
                                orient="auto"><path d="M0,0 L6,3 L0,6 Z" /></marker
                            >
                            <marker
                                id={`${markerPrefix}-sequential`}
                                markerWidth="6"
                                markerHeight="6"
                                refX="5"
                                refY="3"
                                orient="auto"><path d="M0,0 L6,3 L0,6 Z" /></marker
                            >
                        </defs>
                        {#each edges as edge (edge.id)}
                            <path
                                class:sequential={edge.type === "sequential"}
                                d={edge.path}
                                marker-end={`url(#${markerPrefix}-${edge.type})`}
                            />
                        {/each}
                    </svg>
                    <div class="na-gantt__bar-rows">
                        {#each model.rows as row, index (row.task.blockId)}
                            {@const geometry = geometries.get(row.task.blockId)}
                            <div
                                class="na-gantt__bar-row"
                                class:selected={row.task.blockId === selectedTaskId}
                                class:na-gantt__bar-row--summary={row.depth === 0 && row.hasChildren}
                                style="top: {index * GANTT_ROW_HEIGHT}px; height: {GANTT_ROW_HEIGHT}px"
                            >
                                {#if geometry}
                                    <GanttBar
                                        task={row.task}
                                        {geometry}
                                        selected={row.task.blockId === selectedTaskId}
                                        {i18n}
                                        onSelect={onSelectTask}
                                        {onEdit}
                                        {onContextMenu}
                                    />
                                {/if}
                            </div>
                        {/each}
                    </div>
                {:else}
                    <div class="na-gantt__empty">
                        <div class="na-gantt__empty-card">
                            <div class="na-gantt__empty-schedule" aria-hidden="true">
                                <span><i></i></span>
                                <span><i></i></span>
                                <span><i></i></span>
                            </div>
                            <div class="na-gantt__empty-content">
                                <NaEmpty
                                    text={i18n?.ganttNoDates || "No scheduled tasks in this project"}
                                    action={firstUnscheduledTask
                                        ? {
                                              label: i18n?.ganttAddDates || "Add dates",
                                              onClick: () => onEdit(firstUnscheduledTask),
                                          }
                                        : undefined}
                                />
                                <div
                                    class="na-gantt__empty-stats"
                                    aria-label={`${scheduledCount} ${i18n?.ganttScheduled || "Scheduled"}, ${unscheduledRows.length} ${i18n?.ganttUnscheduled || "Unscheduled"}`}
                                >
                                    <span class="na-gantt__empty-stat na-gantt__empty-stat--scheduled"
                                        ><strong>{scheduledCount}</strong>{i18n?.ganttScheduled || "Scheduled"}</span
                                    >
                                    <span class="na-gantt__empty-stat na-gantt__empty-stat--unscheduled"
                                        ><strong>{unscheduledRows.length}</strong>{i18n?.ganttUnscheduled ||
                                            "Unscheduled"}</span
                                    >
                                </div>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>

<style lang="scss">
    .na-gantt {
        display: flex;
        flex: 0 1 var(--na-gantt-content-height);
        width: 100%;
        height: var(--na-gantt-content-height);
        max-height: 100%;
        min-width: 0;
        min-height: 96px;
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-sm);
        overflow: hidden;
        background: var(--b3-theme-surface);
        box-shadow: none;
    }

    .na-gantt__viewport {
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
    }

    .na-gantt__grid {
        --na-gantt-outline-width: 248px;
        display: grid;
        grid-template-columns: var(--na-gantt-outline-width) var(--na-gantt-timeline-width);
        grid-template-rows: 56px var(--na-gantt-rows-height);
        width: max-content;
        min-width: 100%;
    }

    .na-gantt__corner {
        position: sticky;
        top: 0;
        left: 0;
        z-index: 6;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 4px;
        min-width: 0;
        padding: 7px 10px;
        border-right: 1px solid var(--na-color-divider);
        border-bottom: 1px solid var(--na-color-divider);
        background: var(--na-color-panel-header);
        box-shadow: 2px 0 0 color-mix(in srgb, var(--b3-theme-on-background) 2%, transparent);
    }

    .na-gantt__corner-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: var(--na-text-primary);
    }

    .na-gantt__corner-title strong {
        font-size: var(--na-font-size-lg);
        font-weight: 700;
    }

    .na-gantt__scale {
        min-width: 28px;
        padding: 2px 8px;
        border-radius: var(--na-radius-pill);
        color: var(--na-text-interactive);
        background: color-mix(in srgb, var(--na-accent) 10%, var(--b3-theme-surface));
        font-size: var(--na-font-size-xs);
        font-weight: 700;
        text-align: center;
        font-variant-numeric: tabular-nums;
    }

    .na-gantt__corner-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
    }

    .na-gantt__corner-meta :global(.na-segment-control) {
        flex: 0 0 auto;
        border-radius: var(--na-radius-sm);
    }
    .na-gantt__corner-meta :global(.na-segment-control__option) {
        padding-inline: 7px;
    }

    .na-gantt__schedule-summary,
    .na-gantt__schedule-summary-item {
        display: flex;
        align-items: center;
        min-width: 0;
    }

    .na-gantt__schedule-summary-item {
        gap: 5px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        white-space: nowrap;
    }

    .na-gantt__schedule-summary-item i,
    .na-gantt__axis-stat i {
        flex: 0 0 6px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--na-color-warning);
    }

    .na-gantt__axis {
        position: sticky;
        top: 0;
        z-index: 5;
        min-width: 0;
        overflow: hidden;
        border-bottom: 1px solid var(--na-color-divider);
        background: var(--na-color-panel-header);
    }

    .na-gantt__axis-row {
        position: relative;
        height: 28px;
        overflow: hidden;
    }

    .na-gantt__axis-row--primary {
        border-bottom: 1px solid var(--na-color-divider);
    }

    .na-gantt__axis-row span {
        position: absolute;
        inset-block: 0;
        display: flex;
        align-items: center;
        min-width: 0;
        padding: 0 8px;
        overflow: hidden;
        border-right: 1px solid color-mix(in srgb, var(--na-color-divider) 72%, transparent);
        color: color-mix(in srgb, var(--na-text-secondary) 88%, var(--na-text-primary));
        font-size: var(--na-font-size-sm);
        font-variant-numeric: tabular-nums;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .na-gantt__axis-row--secondary span {
        justify-content: center;
        padding-inline: 3px;
    }
    .na-gantt__axis--week .na-gantt__axis-row--secondary span,
    .na-gantt__axis--month .na-gantt__axis-row--secondary span {
        font-weight: 650;
    }

    .na-gantt__axis-row--primary span {
        color: var(--na-text-primary);
        background: color-mix(in srgb, var(--b3-theme-surface) 94%, var(--b3-theme-background));
        font-weight: 700;
    }
    .na-gantt__axis-row span.weekend,
    .na-gantt__axis-row span.alternate {
        background: color-mix(in srgb, var(--na-color-info) 5%, transparent);
    }
    .na-gantt__axis-empty {
        display: flex;
        align-items: center;
        gap: 14px;
        height: 56px;
        padding: 0 12px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
    }

    .na-gantt__axis-stat {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
    }
    .na-gantt__axis-stat--scheduled i {
        background: var(--na-color-doing);
    }

    .na-gantt__outline {
        position: sticky;
        left: 0;
        z-index: 4;
        min-width: 0;
        border-right: 1px solid var(--na-color-divider);
        background: var(--b3-theme-surface);
        box-shadow: 2px 0 0 color-mix(in srgb, var(--b3-theme-on-background) 2%, transparent);
    }

    .na-gantt__outline-row {
        display: flex;
        align-items: center;
        min-width: 0;
        padding-right: 8px;
        border-bottom: 1px solid color-mix(in srgb, var(--na-color-divider) 72%, transparent);
    }

    .na-gantt__outline-row:hover,
    .na-gantt__outline-row.selected {
        background: var(--na-color-hover-bg);
    }
    .na-gantt__outline-row.selected {
        box-shadow: inset 3px 0 var(--na-accent);
    }
    .na-gantt__outline-row--summary {
        background: color-mix(in srgb, var(--na-accent) 5%, var(--b3-theme-surface));
    }
    .na-gantt__outline-row--summary.selected {
        background: var(--na-color-selected-bg);
    }
    .na-gantt__outline-row :global(.na-icon-button) {
        width: 24px;
        height: 24px;
        flex-basis: 24px;
    }
    .na-gantt__outline-spacer {
        flex: 0 0 24px;
    }

    .na-gantt__status {
        flex: 0 0 7px;
        width: 7px;
        height: 7px;
        margin: 0 7px 0 2px;
        border-radius: 50%;
        background: var(--na-gantt-status-color);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--na-gantt-status-color) 13%, transparent);
    }

    .na-gantt__task-title {
        display: flex;
        flex: 1;
        align-items: center;
        justify-content: space-between;
        gap: 5px;
        min-width: 0;
        height: 32px;
        padding: 0 4px;
        border: 0;
        border-radius: var(--na-radius-sm);
        color: var(--na-text-primary);
        background: transparent;
        text-align: left;
        cursor: pointer;
    }

    .na-gantt__task-title:focus-visible {
        outline: 2px solid var(--na-accent);
        outline-offset: -1px;
    }
    .na-gantt__task-name {
        min-width: 0;
        overflow: hidden;
        font-size: var(--na-font-size-lg);
        font-weight: 560;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .na-gantt__outline-row--summary .na-gantt__task-name {
        font-weight: 700;
    }
    .na-gantt__task-meta {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 4px;
    }
    .na-gantt__task-title small {
        font-size: var(--na-font-size-xs);
        font-variant-numeric: tabular-nums;
    }
    .na-gantt__unscheduled-label {
        padding: 1px 6px;
        border: 1px solid var(--na-color-warning-border);
        border-radius: var(--na-radius-pill);
        color: var(--na-color-warning);
        background: var(--na-color-warning-bg);
        font-weight: 600;
        line-height: 1.35;
    }
    .na-gantt__child-count {
        color: var(--na-text-secondary);
    }

    .na-gantt__timeline {
        position: relative;
        min-width: 0;
        overflow: hidden;
        background: color-mix(in srgb, var(--b3-theme-background) 96%, var(--b3-theme-surface));
    }

    .na-gantt__bands,
    .na-gantt__bar-rows,
    .na-gantt__edges {
        position: absolute;
        inset: 0;
    }

    .na-gantt__bands {
        z-index: 0;
        pointer-events: none;
    }
    .na-gantt__bands span {
        position: absolute;
        inset-block: 0;
        border-right: 1px solid color-mix(in srgb, var(--na-color-divider) 48%, transparent);
    }
    .na-gantt__bands span.weekend,
    .na-gantt__bands span.alternate {
        background: color-mix(in srgb, var(--na-color-info) 3%, transparent);
    }

    .na-gantt__today {
        position: absolute;
        inset-block: 0;
        z-index: 1;
        width: 2px;
        background: var(--na-accent);
        pointer-events: none;
        opacity: 0.78;
    }

    .na-gantt__today::before {
        position: absolute;
        top: 0;
        left: -3px;
        width: 8px;
        height: 8px;
        border: 2px solid var(--b3-theme-background);
        border-radius: 50%;
        background: var(--na-accent);
        box-shadow: var(--na-shadow-sm);
        content: "";
    }

    .na-gantt__edges {
        z-index: 3;
        overflow: visible;
        pointer-events: none;
    }
    .na-gantt__edges path {
        fill: none;
        stroke: color-mix(in srgb, var(--na-text-secondary) 66%, transparent);
        stroke-width: 1.2;
    }
    .na-gantt__edges path.sequential {
        stroke-dasharray: 4 3;
    }
    .na-gantt__edges marker path {
        fill: color-mix(in srgb, var(--na-text-secondary) 60%, transparent);
        stroke: none;
    }
    .na-gantt__bar-rows {
        z-index: 2;
    }

    .na-gantt__bar-row {
        position: absolute;
        right: 0;
        left: 0;
        border-bottom: 1px solid color-mix(in srgb, var(--na-color-divider) 72%, transparent);
    }

    .na-gantt__bar-row:hover,
    .na-gantt__bar-row.selected {
        background: color-mix(in srgb, var(--na-color-hover-bg) 54%, transparent);
    }
    .na-gantt__bar-row--summary {
        background: color-mix(in srgb, var(--na-accent) 3%, transparent);
    }
    .na-gantt__bar-row--summary.selected {
        background: color-mix(in srgb, var(--na-color-selected-bg) 72%, transparent);
    }
    .na-gantt__empty {
        display: flex;
        align-items: flex-start;
        height: 100%;
        min-height: 240px;
        padding: 22px;
        background: linear-gradient(
            90deg,
            color-mix(in srgb, var(--na-color-info) 3%, transparent) 1px,
            transparent 1px
        );
        background-size: 28px 100%;
    }

    .na-gantt__empty-card {
        display: grid;
        grid-template-columns: 96px minmax(0, 1fr);
        gap: 18px;
        width: min(520px, calc(100% - 12px));
        padding: 18px;
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        background: color-mix(in srgb, var(--b3-theme-surface) 92%, var(--b3-theme-background));
        box-shadow: var(--na-shadow-sm);
    }

    .na-gantt__empty-schedule {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 11px;
        min-height: 72px;
        padding: 12px 10px;
        border: 1px dashed color-mix(in srgb, var(--na-color-info) 34%, transparent);
        border-radius: var(--na-radius-sm);
        background: color-mix(in srgb, var(--na-color-info) 5%, transparent);
    }

    .na-gantt__empty-schedule span {
        position: relative;
        height: 1px;
        background: color-mix(in srgb, var(--na-text-secondary) 22%, transparent);
    }

    .na-gantt__empty-schedule span::before {
        position: absolute;
        top: -3px;
        left: 0;
        width: 7px;
        height: 7px;
        border: 1px solid var(--na-color-warning);
        border-radius: 50%;
        background: var(--b3-theme-surface);
        content: "";
    }

    .na-gantt__empty-schedule i {
        position: absolute;
        top: -2px;
        left: 17px;
        width: 58%;
        height: 5px;
        border: 1px dashed color-mix(in srgb, var(--na-color-warning) 58%, transparent);
        border-radius: var(--na-radius-pill);
    }

    .na-gantt__empty-schedule span:nth-child(2) i {
        width: 36%;
    }
    .na-gantt__empty-schedule span:nth-child(3) i {
        width: 48%;
    }

    .na-gantt__empty-content {
        display: flex;
        min-width: 0;
        flex-direction: column;
        justify-content: center;
        gap: 10px;
    }
    .na-gantt__empty-content :global(.na-empty) {
        display: grid;
        flex: 0 0 auto;
        grid-template-columns: minmax(0, 1fr) auto;
        min-height: 0;
        padding: 0;
        gap: 12px;
        justify-content: stretch;
        text-align: left;
    }
    .na-gantt__empty-content :global(.na-empty__illustration) {
        display: none;
    }
    .na-gantt__empty-content :global(.na-empty__text) {
        max-width: none;
        color: var(--na-text-primary);
        font-size: var(--na-font-size-lg);
        font-weight: 650;
        line-height: 1.4;
    }
    .na-gantt__empty-stats {
        display: flex;
        align-items: center;
        gap: 12px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
    }
    .na-gantt__empty-stat {
        display: inline-flex;
        align-items: baseline;
        gap: 4px;
    }
    .na-gantt__empty-stat strong {
        color: var(--na-text-primary);
        font-size: var(--na-font-size-lg);
        font-variant-numeric: tabular-nums;
    }
    .na-gantt__empty-stat--unscheduled strong {
        color: var(--na-color-warning);
    }

    @container nextaction-app (max-width: 880px) {
        .na-gantt__grid {
            --na-gantt-outline-width: 210px;
        }
    }

    @container nextaction-app (max-width: 520px) {
        .na-gantt__grid {
            --na-gantt-outline-width: 164px;
        }
        .na-gantt__corner {
            padding-inline: 6px;
        }
        .na-gantt__task-name {
            font-size: var(--na-font-size-md);
        }
        .na-gantt__child-count {
            display: none;
        }
        .na-gantt__unscheduled-label {
            padding-inline: 4px;
        }
        .na-gantt__empty {
            padding: 14px;
        }
        .na-gantt__empty-card {
            grid-template-columns: 1fr;
            width: min(320px, calc(100% - 4px));
            gap: 12px;
            padding: 14px;
        }
        .na-gantt__empty-schedule {
            display: none;
        }
        .na-gantt__empty-content :global(.na-empty) {
            grid-template-columns: 1fr;
        }
    }
</style>
