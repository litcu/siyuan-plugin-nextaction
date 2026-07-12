<script lang="ts">
    import { PRIORITY_HEX_COLORS } from "../../constants";
    import { MY_DAY_DRAG_TYPE } from "../../../shared/constants";
    import type { MyDayTaskEntry, TaskCacheEntry, MyDayState } from "../../../shared/types";
    import type { KernelBridge } from "../../kernel-bridge";
    import { showTaskQuickMenu } from "./TaskQuickMenu";
    import { taskStore } from "../../stores/task-store";

    export let unscheduledEntries: MyDayTaskEntry[] = [];
    export let taskMap: Map<string, TaskCacheEntry>;
    export let bridge: KernelBridge;
    export let i18n: any;
    export let isDropTarget: boolean = false;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;

    function handleDragStart(e: DragEvent, blockId: string) {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData(MY_DAY_DRAG_TYPE, blockId);
        e.dataTransfer.effectAllowed = "move";
    }

    function handleDragOver(e: DragEvent) {
        e.preventDefault();
        if (e.dataTransfer) {
            if (e.dataTransfer.types.includes(MY_DAY_DRAG_TYPE)) {
                e.dataTransfer.dropEffect = "move";
            }
        }
    }

    function handleDrop(e: DragEvent) {
        e.preventDefault();
    }

    function handleClick(e: MouseEvent, task: TaskCacheEntry) {
        showTaskQuickMenu(task, e.clientX, e.clientY, bridge, i18n, {
            onScheduleRemoved: (newState: MyDayState) => {
                taskStore.applyMyDayUpdate(newState);
            },
            onTaskUpdated: (updated: TaskCacheEntry) => {
                taskStore.applyUpdate(updated);
            },
            onRemovedFromMyDay: (newState: MyDayState) => {
                taskStore.applyMyDayUpdate(newState);
            },
        });
    }

    function formatDue(due: string | null | undefined): string {
        if (!due) return "";
        const hasTime = due.includes("T");
        const d = new Date(due);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const diff = Math.round((d.getTime() - today.getTime()) / (86400000));
        const timeStr = hasTime ? due.split("T")[1] : "";
        if (diff < 0) return i18n?.overdue || "Overdue";
        if (diff === 0) return timeStr ? `${i18n?.dueToday || "Today"} ${timeStr}` : (i18n?.dueToday || "Today");
        if (diff === 1) return timeStr ? `${i18n?.dueTomorrow || "Tomorrow"} ${timeStr}` : (i18n?.dueTomorrow || "Tomorrow");
        const datePart = due.split("T")[0].slice(5);
        return timeStr ? `${datePart} ${timeStr}` : datePart;
    }

    function isOverdue(due: string | null | undefined): boolean {
        if (!due) return false;
        if (due.includes("T")) {
            return new Date(due) < new Date();
        }
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return new Date(due) < today;
    }
</script>

<div
    class="na-unscheduled"
    class:na-unscheduled--drop-target={isDropTarget}
    on:dragover={handleDragOver}
    on:drop={handleDrop}
>
    <div class="na-unscheduled__header">
        <span>{i18n?.unscheduled || "Unscheduled"}</span>
        <span class="na-unscheduled__count">{unscheduledEntries.length}</span>
    </div>
    {#if unscheduledEntries.length === 0}
        <div class="na-unscheduled__empty">
            {i18n?.noUnscheduled || "All tasks scheduled"}
        </div>
    {:else}
        <div class="na-unscheduled__list">
            {#each unscheduledEntries as entry (entry.blockId)}
                {@const task = taskMap.get(entry.blockId)}
                {#if task}
                    {@const hexColor = PRIORITY_HEX_COLORS[task.priority] || "#5dade2"}
                    {@const priorityClass = `na-unscheduled-card--priority-${task.priority || 'none'}`}
                    <div
                        class="na-unscheduled-card {priorityClass}"
                        style="--na-unscheduled-card-accent: {hexColor};"
                        draggable="true"
                        on:dragstart={(e) => handleDragStart(e, entry.blockId)}
                        on:click={(e) => handleClick(e, task)}
                        on:contextmenu|preventDefault={(e) => onContextMenu(task, e)}
                    >
                        <span class="na-unscheduled-card__accent"></span>
                        <div class="na-unscheduled-card__name">{task.title}</div>
                        <div class="na-unscheduled-card__meta">
                            {#if task.context}
                                <span class="na-unscheduled-card__context">@{task.context.split('|')[0].trim()}</span>
                            {/if}
                            {#if task.due}
                                <span class="na-unscheduled-card__due" class:na-unscheduled-card__due--overdue={isOverdue(task.due)}>
                                    {formatDue(task.due)}
                                </span>
                            {/if}
                        </div>
                    </div>
                {/if}
            {/each}
        </div>
    {/if}
</div>

<style lang="scss">
    .na-unscheduled {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--na-myday-panel-bg, var(--b3-theme-surface));
        transition: background 0.2s, border-color 0.2s;
    }

    .na-unscheduled--drop-target {
        background: rgba(93, 173, 226, 0.08);
    }

    .na-unscheduled__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 700;
        color: var(--b3-theme-on-surface);
        border-bottom: 1px solid var(--na-myday-panel-border, var(--b3-border-color));
    }

    .na-unscheduled__count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 18px;
        padding: 0 6px;
        border-radius: var(--na-radius-pill);
        color: var(--b3-theme-on-surface-secondary);
        background: var(--na-task-card-meta-bg, var(--b3-theme-surface-light));
        border: 1px solid var(--na-task-card-meta-border, var(--b3-border-color));
        font-size: 10px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }

    .na-unscheduled__empty {
        padding: 12px 10px;
        font-size: 11px;
        color: var(--b3-theme-on-surface-dim, #888);
        text-align: center;
    }

    .na-unscheduled__list {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
    }

    .na-unscheduled-card {
        display: grid;
        grid-template-columns: 3px minmax(0, 1fr);
        gap: 2px 8px;
        padding: 8px 9px 8px 0;
        margin-bottom: 7px;
        border: 1px solid var(--na-task-card-border, var(--b3-border-color));
        border-radius: 8px;
        background-color: var(--b3-theme-surface);
        box-shadow: var(--na-shadow-sm);
        cursor: grab;
        transition: background 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.15s;

        &:hover {
            background: var(--b3-theme-surface-light);
            border-color: var(--b3-theme-primary-light);
            box-shadow: var(--na-shadow-hover);
            transform: translateY(-1px);
        }

        &[draggable="true"] {
            cursor: grab;
        }

        &[draggable="true"]:active {
            cursor: grabbing;
        }
    }

    .na-unscheduled-card--priority-critical {
        background-color: rgba(231, 76, 60, 0.08);
    }
    .na-unscheduled-card--priority-high {
        background-color: rgba(243, 156, 18, 0.08);
    }
    .na-unscheduled-card--priority-medium {
        background-color: rgba(93, 173, 226, 0.08);
    }
    .na-unscheduled-card--priority-low {
        background-color: var(--na-myday-panel-soft-bg, var(--b3-theme-surface-light));
    }
    .na-unscheduled-card--priority-none {
        background-color: var(--b3-theme-surface);
    }

    .na-unscheduled-card__accent {
        grid-row: 1 / span 2;
        width: 3px;
        min-height: 100%;
        border-radius: var(--na-radius-pill);
        background: var(--na-unscheduled-card-accent, var(--b3-theme-primary));
    }

    .na-unscheduled-card__name {
        min-width: 0;
        font-size: 12px;
        font-weight: 650;
        color: var(--b3-theme-on-background);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .na-unscheduled-card__meta {
        display: flex;
        gap: 5px;
        align-items: center;
        flex-wrap: wrap;
        min-width: 0;
    }

    .na-unscheduled-card__context,
    .na-unscheduled-card__due {
        display: inline-flex;
        align-items: center;
        min-height: 16px;
        padding: 1px 6px;
        border-radius: var(--na-radius-pill);
        background: var(--na-task-card-meta-bg, var(--b3-theme-surface-light));
        border: 1px solid var(--na-task-card-meta-border, var(--b3-border-color));
        font-size: 10px;
        line-height: 1.25;
    }

    .na-unscheduled-card__context {
        color: var(--b3-theme-on-surface);
    }

    .na-unscheduled-card__due {
        color: var(--b3-theme-on-surface-secondary);

        &--overdue {
            color: var(--na-danger, #e74c3c);
            background: rgba(231, 76, 60, 0.1);
            border-color: rgba(231, 76, 60, 0.16);
        }
    }
</style>
