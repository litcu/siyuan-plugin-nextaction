<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { TaskCacheEntry } from "../../../shared/types";
    import type { I18nStrings } from "../../../shared/i18n";
    import { buildProjectBoardColumns, type ProjectBoardStatus } from "../../../shared/project-board";
    import type { ProjectBoardMoveIntent } from "../../utils/project-view-state";
    import { statusI18nKey, translateKey } from "../../i18n";
    import TaskCard from "../TaskCard.svelte";
    import NaIconButton from "../../ui/NaIconButton.svelte";

    export let tasks: TaskCacheEntry[];
    export let selectedTaskId = "";
    export let i18n: I18nStrings;
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onMoveTask: (intent: ProjectBoardMoveIntent) => Promise<void>;

    let draggingTask: TaskCacheEntry | null = null;
    let dropStatus: ProjectBoardStatus | "" = "";
    let busy = false;
    let boardElement: HTMLDivElement;
    let resizeObserver: ResizeObserver | null = null;
    let boardWidth = 1024;
    let narrowColumnIndex = 0;

    $: columns = buildProjectBoardColumns(tasks);
    $: narrow = boardWidth <= 780;
    $: narrowColumnIndex = Math.max(0, Math.min(narrowColumnIndex, columns.length - 1));
    $: visibleColumns = narrow ? [columns[narrowColumnIndex]] : columns;

    function statusLabel(status: string): string {
        return translateKey(i18n, statusI18nKey(status), status);
    }

    function handleDragStart(task: TaskCacheEntry, event: DragEvent) {
        draggingTask = task;
        event.dataTransfer?.setData("text/plain", task.blockId);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    }

    function resetDrag() {
        draggingTask = null;
        dropStatus = "";
    }

    async function handleDrop(status: ProjectBoardStatus, afterId = "") {
        if (!draggingTask || busy) return;
        busy = true;
        try {
            await onMoveTask({ task: draggingTask, status, afterId: afterId || undefined });
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
    {#if narrow}
        <div class="na-project-board__pager">
            <NaIconButton
                symbol="iconLeft"
                label={i18n?.previousPage || "Previous"}
                disabled={narrowColumnIndex === 0}
                on:click={() => (narrowColumnIndex -= 1)}
            />
            <span aria-live="polite">{statusLabel(columns[narrowColumnIndex].status)}</span>
            <NaIconButton
                symbol="iconRight"
                label={i18n?.nextPage || "Next"}
                disabled={narrowColumnIndex === columns.length - 1}
                on:click={() => (narrowColumnIndex += 1)}
            />
        </div>
    {/if}
    <div class="na-project-board__columns" class:na-project-board__columns--narrow={narrow}>
        {#each visibleColumns as column (column.status)}
            <section
                class="na-project-board__column"
                role="list"
                class:drop-active={dropStatus === column.status}
                on:dragover|preventDefault={() => (dropStatus = column.status)}
                on:dragleave={() => (dropStatus = "")}
                on:drop|preventDefault={() => handleDrop(column.status)}
            >
                <header><span>{statusLabel(column.status)}</span><span>{column.tasks.length}</span></header>
                <div class="na-project-board__cards">
                    {#each column.tasks as task (task.blockId)}
                        <div
                            class="na-project-board__card"
                            role="listitem"
                            draggable={!busy}
                            on:dragstart={(event) => handleDragStart(task, event)}
                            on:dragend={resetDrag}
                            on:dragover|preventDefault={() => (dropStatus = column.status)}
                            on:drop|preventDefault|stopPropagation={() => handleDrop(column.status, task.blockId)}
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
    .na-project-board__columns {
        display: grid;
        grid-template-columns: repeat(6, minmax(150px, 1fr));
        gap: 8px;
        align-items: stretch;
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
