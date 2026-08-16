<script lang="ts">
    import type { TaskCacheEntry } from "../../../shared/types";
    import type { I18nStrings } from "../../../shared/i18n";
    import type { ProjectDateBucket } from "../../utils/project";
    import { projectPlanI18nKey, translateKey } from "../../i18n";
    import TaskCard from "../TaskCard.svelte";

    export let groups: Array<{ bucket: ProjectDateBucket; tasks: TaskCacheEntry[] }>;
    export let selectedTaskId = "";
    export let i18n: I18nStrings;
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;

    function bucketLabel(bucket: ProjectDateBucket): string {
        return translateKey(i18n, projectPlanI18nKey(bucket), bucket);
    }
</script>

<div class="na-project-plan">
    {#each groups as group (group.bucket)}
        <section class="na-project-plan__group">
            <header><h3>{bucketLabel(group.bucket)}</h3><span>{group.tasks.length}</span></header>
            {#each group.tasks as task (task.blockId)}
                <div class="na-project-plan__row"><TaskCard {task} selected={task.blockId === selectedTaskId} onSelect={onSelectTask} {onEdit} {onStatusClick} {onContextMenu} {i18n} isRoot={false} />{#if group.bucket !== "unscheduled"}<span class="na-project-plan__date">{task.due || task.start}</span>{/if}</div>
            {/each}
        </section>
    {/each}
    {#if groups.length === 0}<p class="na-project-muted">{i18n?.projectNoPlan || "No dated tasks in this project"}</p>{/if}
</div>

<style lang="scss">
    .na-project-plan { display: flex; flex-direction: column; gap: 10px; }
    .na-project-plan__group { border-top: 2px solid var(--na-color-divider); background: var(--b3-theme-surface); }
    .na-project-plan__group > header { display: flex; justify-content: space-between; padding: 9px 10px; border-bottom: 1px solid var(--na-color-divider); color: var(--na-text-secondary); font-size: var(--na-font-size-xs); font-weight: 700; text-transform: uppercase; }
    .na-project-plan__row { display: flex; align-items: center; gap: 8px; padding: 4px; border-bottom: 1px solid color-mix(in srgb, var(--na-color-divider) 60%, transparent); }
    .na-project-plan__row :global(.na-task-card) { flex: 1; min-width: 0; }
    .na-project-plan__date { flex: 0 0 82px; color: var(--na-text-secondary); font-size: var(--na-font-size-xs); text-align: right; }
    .na-project-muted { margin: 4px 0; color: var(--na-text-secondary); font-size: var(--na-font-size-sm); }
</style>
