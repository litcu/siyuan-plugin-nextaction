<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { TaskCacheEntry } from "../../../shared/types";
    import type { I18nStrings } from "../../../shared/i18n";
    import type { CustomFieldDef } from "../../../shared/settings";
    import {
        DEFAULT_PROJECT_BOARD_PREFERENCE,
        type ProjectBoardPreference,
        type ProjectBoardSortBy,
    } from "../../../shared/project-board-preferences";
    import {
        buildProjectBoardColumns,
        PROJECT_BOARD_UNASSIGNED_STAGE,
        type ProjectBoardColumn,
        type ProjectBoardGroupBy,
    } from "../../../shared/project-board";
    import type { ProjectBoardMoveIntent } from "../../utils/project-view-state";
    import { sortProjectBoardTasks } from "../../utils/project-board-sort";
    import { priorityI18nKey, statusI18nKey, translateKey } from "../../i18n";
    import TaskCard from "../TaskCard.svelte";
    import NaButton from "../../ui/NaButton.svelte";
    import NaIconButton from "../../ui/NaIconButton.svelte";

    export let tasks: TaskCacheEntry[];
    export let projectTasks: TaskCacheEntry[] = tasks;
    export let selectedTaskId = "";
    export let i18n: I18nStrings;
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onMoveTask: (intent: ProjectBoardMoveIntent) => Promise<void>;
    export let customFields: CustomFieldDef[] = [];
    export let preference: ProjectBoardPreference = { ...DEFAULT_PROJECT_BOARD_PREFERENCE };
    export let onPreferenceChange: ((preference: ProjectBoardPreference) => void) | undefined = undefined;

    let draggingTask: TaskCacheEntry | null = null;
    let dropColumnKey = "";
    let busy = false;
    let boardElement: HTMLDivElement;
    let resizeObserver: ResizeObserver | null = null;
    let boardWidth = 1024;
    let narrowColumnIndex = preference.narrowColumnIndex;
    let groupBy: ProjectBoardGroupBy = preference.groupBy;
    let sortBy: ProjectBoardSortBy = preference.sortBy;
    let sortAsc = preference.sortAsc;

    $: if (preference.groupBy !== groupBy) groupBy = preference.groupBy;
    $: if (preference.sortBy !== sortBy) sortBy = preference.sortBy;
    $: if (preference.sortAsc !== sortAsc) sortAsc = preference.sortAsc;
    $: if (preference.narrowColumnIndex !== narrowColumnIndex) narrowColumnIndex = preference.narrowColumnIndex;
    $: orderedTasks = sortProjectBoardTasks(tasks, sortBy, sortAsc, customFields);
    $: columns = buildProjectBoardColumns(orderedTasks, groupBy, projectTasks);
    $: narrow = boardWidth <= 780;
    $: {
        const clamped = Math.max(0, Math.min(narrowColumnIndex, Math.max(0, columns.length - 1)));
        if (clamped !== narrowColumnIndex) {
            narrowColumnIndex = clamped;
            persistPreference();
        }
    }
    $: visibleColumns = narrow ? [columns[narrowColumnIndex]] : columns;

    function persistPreference() {
        onPreferenceChange?.({ groupBy, sortBy, sortAsc, narrowColumnIndex });
    }

    function handleGroupByChange(event: Event) {
        groupBy = (event.currentTarget as HTMLSelectElement).value as ProjectBoardGroupBy;
        narrowColumnIndex = 0;
        persistPreference();
    }

    function handleSortChange(event: Event) {
        sortBy = (event.currentTarget as HTMLSelectElement).value as ProjectBoardSortBy;
        persistPreference();
    }

    function handleSortDirectionChange() {
        sortAsc = !sortAsc;
        persistPreference();
    }

    function groupLabel(group: ProjectBoardGroupBy): string {
        if (group === "status") return i18n?.status || "Status";
        if (group === "priority") return i18n?.priority || "Priority";
        if (group === "importance") return i18n?.importance || "Importance";
        return i18n?.projectBoardStage || "Stage";
    }

    function columnLabel(column: ProjectBoardColumn): string {
        if (column.groupBy === "status") return translateKey(i18n, statusI18nKey(column.label), column.label);
        if (column.groupBy === "priority") return translateKey(i18n, priorityI18nKey(column.label), column.label);
        if (column.groupBy === "importance") return `${i18n?.importance || "Importance"} ${column.label}`;
        if (column.key === PROJECT_BOARD_UNASSIGNED_STAGE) {
            return i18n?.projectBoardUnassignedStage || "Unassigned stage";
        }
        return column.label || i18n?.untitled || "Untitled";
    }

    function handleDragStart(task: TaskCacheEntry, event: DragEvent) {
        draggingTask = task;
        event.dataTransfer?.setData("text/plain", task.blockId);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    }

    function resetDrag() {
        draggingTask = null;
        dropColumnKey = "";
    }

    async function handleDrop(column: ProjectBoardColumn, afterId = "", afterParentId = "") {
        if (!draggingTask || busy) return;
        busy = true;
        try {
            await onMoveTask({
                task: draggingTask,
                status: column.status || "",
                groupBy,
                value: column.value,
                sortBy,
                visibleTaskIds: tasks.map((item) => item.blockId),
                ...(sortBy === "order"
                    ? {
                          afterId: afterId || undefined,
                          afterParentId: afterParentId || undefined,
                      }
                    : {}),
            });
        } catch (error) {
            console.error("[NextAction] project board drop failed:", error);
        } finally {
            busy = false;
            resetDrag();
        }
    }

    onMount(() => {
        const measure = () => {
            if (boardElement) boardWidth = boardElement.clientWidth;
        };
        measure();
        if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(measure);
            resizeObserver.observe(boardElement);
        }
    });

    onDestroy(() => resizeObserver?.disconnect());
</script>

<div class="na-project-board" aria-busy={busy} bind:this={boardElement}>
    <div class="na-project-board__toolbar">
        <label for="na-project-board-group-by">{i18n?.projectBoardGroupBy || "Group by"}</label>
        <select
            id="na-project-board-group-by"
            class="na-select na-select--sm"
            on:change={handleGroupByChange}
            value={groupBy}
        >
            <option value="status">{groupLabel("status")}</option>
            <option value="stage">{groupLabel("stage")}</option>
            <option value="priority">{groupLabel("priority")}</option>
            <option value="importance">{groupLabel("importance")}</option>
        </select>
        <label for="na-project-board-sort">{i18n?.sortBy || "Sort by"}</label>
        <select id="na-project-board-sort" class="na-select na-select--sm" on:change={handleSortChange} value={sortBy}>
            <option value="order">{i18n?.sortByOrder || "Manual order"}</option>
            <option value="due">{i18n?.sortByDue || "Due date"}</option>
            <option value="importance">{i18n?.sortByImportance || "Importance"}</option>
            <option value="priority">{i18n?.sortByPriority || "Priority"}</option>
            {#each customFields.filter((field) => field.status === "active") as field (field.key)}
                <option value={`custom:${field.key}`}>{field.label}</option>
            {/each}
        </select>
        <NaButton
            size="sm"
            variant="text"
            ariaLabel={i18n?.projectBoardSortDirection || "Sort direction"}
            ariaPressed={sortAsc}
            on:click={handleSortDirectionChange}
        >
            {sortAsc ? i18n?.sortAsc || "Ascending" : i18n?.sortDesc || "Descending"}
        </NaButton>
    </div>
    {#if narrow}
        <div class="na-project-board__pager">
            <NaIconButton
                symbol="iconLeft"
                label={i18n?.previousPage || "Previous"}
                disabled={narrowColumnIndex === 0}
                on:click={() => {
                    narrowColumnIndex -= 1;
                    persistPreference();
                }}
            />
            <span aria-live="polite">{columnLabel(columns[narrowColumnIndex])}</span>
            <NaIconButton
                symbol="iconRight"
                label={i18n?.nextPage || "Next"}
                disabled={narrowColumnIndex === columns.length - 1}
                on:click={() => {
                    narrowColumnIndex += 1;
                    persistPreference();
                }}
            />
        </div>
    {/if}
    <div
        class="na-project-board__columns"
        class:na-project-board__columns--narrow={narrow}
        style={`--na-project-board-column-count: ${columns.length}`}
    >
        {#each visibleColumns as column (column.key)}
            <section
                class="na-project-board__column"
                role="list"
                class:drop-active={dropColumnKey === column.key}
                on:dragover|preventDefault={() => (dropColumnKey = column.key)}
                on:dragleave={() => (dropColumnKey = "")}
                on:drop|preventDefault={() => handleDrop(column)}
            >
                <header><span>{columnLabel(column)}</span><span>{column.tasks.length}</span></header>
                <div class="na-project-board__cards">
                    {#each column.tasks as task (task.blockId)}
                        <div
                            class="na-project-board__card"
                            role="listitem"
                            draggable={!busy}
                            on:dragstart={(event) => handleDragStart(task, event)}
                            on:dragend={resetDrag}
                            on:dragover|preventDefault={() => (dropColumnKey = column.key)}
                            on:drop|preventDefault|stopPropagation={() =>
                                handleDrop(column, task.blockId, task.parentId)}
                        >
                            <TaskCard
                                {task}
                                selected={task.blockId === selectedTaskId}
                                onSelect={onSelectTask}
                                {onEdit}
                                {onStatusClick}
                                {onContextMenu}
                                {i18n}
                                isRoot={false}
                            />
                        </div>
                    {/each}
                    {#if column.tasks.length === 0}<p class="na-project-board__empty">
                            {i18n?.projectDropHere || "Drop tasks here"}
                        </p>{/if}
                </div>
            </section>
        {/each}
    </div>
</div>

<style lang="scss">
    .na-project-board {
        flex: 1 1 auto;
        min-height: 0;
        min-width: 900px;
    }
    .na-project-board__toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 8px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
    }
    .na-project-board__toolbar label {
        white-space: nowrap;
    }
    .na-project-board__columns {
        display: grid;
        grid-template-columns: repeat(var(--na-project-board-column-count, 6), minmax(150px, 1fr));
        gap: 8px;
        align-items: stretch;
        min-width: max-content;
        overflow-x: auto;
    }
    .na-project-board__pager {
        display: none;
    }
    .na-project-board__column {
        min-height: 260px;
        height: 100%;
        border: 1px solid var(--na-color-divider);
        background: color-mix(in srgb, var(--b3-theme-surface) 78%, var(--b3-theme-background));
        transition:
            border-color 0.15s,
            background-color 0.15s;
    }
    .na-project-board__column.drop-active {
        border-color: var(--na-accent);
        background: var(--na-color-selected-bg);
    }
    .na-project-board__column > header {
        display: flex;
        justify-content: space-between;
        padding: 9px 10px;
        border-bottom: 1px solid var(--na-color-divider);
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        font-weight: 700;
        text-transform: uppercase;
    }
    .na-project-board__cards {
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding: 6px;
        min-height: 220px;
    }
    .na-project-board__card {
        cursor: grab;
    }
    .na-project-board__card:active {
        cursor: grabbing;
    }
    .na-project-board__empty {
        margin: 14px 6px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        text-align: center;
    }
    @container nextaction-app (max-width: 780px) {
        .na-project-board {
            min-width: 0;
        }
        .na-project-board__columns,
        .na-project-board__columns--narrow {
            grid-template-columns: minmax(0, 1fr);
            min-width: 0;
            overflow-x: hidden;
        }
        .na-project-board__pager {
            display: grid;
            grid-template-columns: 30px minmax(0, 1fr) 30px;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            color: var(--na-text-secondary);
            font-size: var(--na-font-size-sm);
            font-weight: 600;
            text-align: center;
        }
        .na-project-board__pager > span {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    }
</style>
