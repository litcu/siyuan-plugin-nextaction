<script lang="ts">
    import type { TaskCacheEntry } from "../../../shared/types";
    import type { I18nStrings } from "../../../shared/i18n";
    import type { ProjectBoardMoveIntent } from "../../utils/project-view-state";
    import { statusI18nKey, translateKey } from "../../i18n";
    import TaskCard from "../TaskCard.svelte";

    export let tasks: TaskCacheEntry[];
    export let selectedTaskId = "";
    export let i18n: I18nStrings;
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onMoveTask: (intent: ProjectBoardMoveIntent) => Promise<void>;

    const statuses = ["inbox", "todo", "doing", "waiting", "someday", "done"];
    let draggingTask: TaskCacheEntry | null = null;
    let dropStatus = "";
    let busy = false;

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

    async function handleDrop(status: string, afterId = "") {
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
</script>

<div class="na-project-board" aria-busy={busy}>
    {#each statuses as status}
        {@const statusTasks = tasks.filter((task) => task.status === status).sort((a, b) => a.sort - b.sort)}
        <section
            class="na-project-board__column"
            role="list"
            class:drop-active={dropStatus === status}
            on:dragover|preventDefault={() => (dropStatus = status)}
            on:dragleave={() => (dropStatus = "")}
            on:drop|preventDefault={() => handleDrop(status)}
        >
            <header><span>{statusLabel(status)}</span><span>{statusTasks.length}</span></header>
            <div class="na-project-board__cards">
                {#each statusTasks as task (task.blockId)}
                    <div
                        class="na-project-board__card"
                        role="listitem"
                        draggable={!busy}
                        on:dragstart={(event) => handleDragStart(task, event)}
                        on:dragend={resetDrag}
                        on:dragover|preventDefault={() => (dropStatus = status)}
                        on:drop|preventDefault|stopPropagation={() => handleDrop(status, task.blockId)}
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
                {#if statusTasks.length === 0}<p class="na-project-board__empty">
                        {i18n?.projectDropHere || "Drop tasks here"}
                    </p>{/if}
            </div>
        </section>
    {/each}
</div>

<style lang="scss">
    .na-project-board {
        display: grid;
        flex: 1 1 auto;
        grid-template-columns: repeat(6, minmax(150px, 1fr));
        gap: 8px;
        min-width: 900px;
        min-height: 0;
        align-items: stretch;
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
            min-width: 760px;
        }
    }
</style>
