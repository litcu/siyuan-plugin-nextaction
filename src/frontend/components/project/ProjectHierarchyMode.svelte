<script lang="ts">
    import type { TaskCacheEntry } from "../../../shared/types";
    import type { I18nStrings } from "../../../shared/i18n";
    import { shouldShowSubtreeProgress, type ProjectTreeModel } from "../../utils/project-tree";
    import TaskCard from "../TaskCard.svelte";
    import NaProgressBar from "../../ui/NaProgressBar.svelte";

    export let model: ProjectTreeModel;
    export let collapsedIds: ReadonlySet<string>;
    export let selectedTaskId = "";
    export let i18n: I18nStrings;
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onToggleCollapse: (blockId: string) => void;
</script>

<div class="na-project-tree" role="list">
    {#each model.rows as row (row.task.blockId)}
        <div class="na-project-tree__row" style="padding-left: {row.depth * 18}px" role="listitem">
            <div class="na-project-tree__item">
                <TaskCard
                    task={row.task}
                    selected={row.task.blockId === selectedTaskId}
                    onSelect={onSelectTask}
                    {onEdit}
                    {onStatusClick}
                    {onContextMenu}
                    {i18n}
                    hasChildren={row.hasChildren}
                    isCollapsed={collapsedIds.has(row.task.blockId)}
                    childCount={row.childCount}
                    onToggleCollapse={() => onToggleCollapse(row.task.blockId)}
                    isRoot={row.depth === 0}
                />
                {#if shouldShowSubtreeProgress(row) && row.subtreeProgress}
                    <div class="na-project-tree__stage-progress">
                        <NaProgressBar
                            percent={row.subtreeProgress.percent}
                            label={`${row.task.actionKind === "stage" ? i18n?.actionKindStage || "Stage" : i18n?.actionKindAction || "Action"} · ${row.subtreeProgress.done}/${row.subtreeProgress.total}`}
                        />
                    </div>
                {/if}
            </div>
        </div>
    {/each}
</div>

<style lang="scss">
    .na-project-tree {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .na-project-tree__row {
        display: flex;
        align-items: center;
    }
    .na-project-tree__row :global(.na-task-card) {
        flex: 1;
        min-width: 0;
    }
    .na-project-tree__item {
        min-width: 0;
        flex: 1;
    }
    .na-project-tree__stage-progress {
        padding: 3px 8px 1px 34px;
    }
</style>
