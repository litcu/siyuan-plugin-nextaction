<script lang="ts">
    import type { TaskCacheEntry } from "../../../shared/types";
    import type { I18nStrings } from "../../../shared/i18n";
    import type { ProjectTreeModel } from "../../utils/project-tree";
    import TaskCard from "../TaskCard.svelte";

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
</style>
