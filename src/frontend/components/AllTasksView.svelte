<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { STATUS_LIST, VIEW_ALL_TASKS } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import NaViewHint from "../ui/NaViewHint.svelte";
    import SearchFilterBar from "./SearchFilterBar.svelte";
    import { createDragHandler } from "./drag-handler";
    import type { TaskCacheEntry } from "../../shared/types";

    export let bridge: any;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;
    export let selectedTaskId: string = "";
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;

    const ALL_TASK_STATUS_FILTERS = STATUS_LIST.filter((status) => status !== "done");

    let dragHandler: ReturnType<typeof createDragHandler> | null = null;
    let listEl: HTMLElement | null = null;

    function initDragHandler() {
        if (dragHandler || !listEl || !bridge) return;
        dragHandler = createDragHandler({
            container: listEl,
            getCardElement: (blockId: string) => listEl!.querySelector(`[data-task-block-id="${blockId}"]`),
            onReorder: async (blockId, parentId, afterId) => {
                try {
                    const updated = await bridge.reorderTask(blockId, parentId === null ? "" : parentId, afterId ?? undefined);
                    taskStore.applyUpdate(updated);
                } catch (e: any) {
                    console.error("[NextAction] reorderTask failed:", e);
                }
            },
        });
    }

    $: if (listEl && bridge) initDragHandler();

    let collapsed: Record<string, boolean> = {};

    $: filterState = $taskStore.filterByView[VIEW_ALL_TASKS] || DEFAULT_FILTER_STATE;
    $: activeTasks = $taskStore.allTasks.filter((task: TaskCacheEntry) => task.status !== "done");
    $: allTaskFilterState = filterState.statuses.includes("done")
        ? { ...filterState, statuses: filterState.statuses.filter((status) => status !== "done") }
        : filterState;
    $: filteredTasks = applyFilters(activeTasks, allTaskFilterState);

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_ALL_TASKS, state);
    }

    function toggleCollapse(blockId: string) {
        collapsed = Object.assign({}, collapsed, { [blockId]: !collapsed[blockId] });
    }

    function handleToggleCompleted() {
        taskStore.toggleCompleted();
    }

    function getIndentLevel(task: TaskCacheEntry, visibleIds: Set<string>, taskMap: Map<string, TaskCacheEntry>): number {
        let level = 0;
        let currentId = task.parentId;
        const visited = new Set<string>();
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            if (!visibleIds.has(currentId)) break;
            level++;
            const parent = taskMap.get(currentId);
            if (!parent) break;
            currentId = parent.parentId;
        }
        return level;
    }

    function groupByParent(tasks: TaskCacheEntry[], preserveOrder: boolean): TaskCacheEntry[] {
        const childrenMap = new Map<string, TaskCacheEntry[]>();
        const taskSet = new Set(tasks.map((t) => t.blockId));
        const roots: TaskCacheEntry[] = [];

        for (const t of tasks) {
            if (t.parentId && taskSet.has(t.parentId)) {
                const children = childrenMap.get(t.parentId) || [];
                children.push(t);
                childrenMap.set(t.parentId, children);
            } else {
                roots.push(t);
            }
        }

        if (!preserveOrder) {
            roots.sort((a, b) => {
                if (b.order !== a.order) return b.order - a.order;
                if (a.due && b.due) {
                    if (a.due !== b.due) return a.due.localeCompare(b.due);
                } else if (a.due) {
                    return -1;
                } else if (b.due) {
                    return 1;
                }
                return a.blockId.localeCompare(b.blockId);
            });

            for (const children of childrenMap.values()) {
                children.sort((a, b) => {
                    if (a.sort !== b.sort) return a.sort - b.sort;
                    return a.blockId.localeCompare(b.blockId);
                });
            }
        }

        const result: TaskCacheEntry[] = [];
        const addSubtree = (parent: TaskCacheEntry) => {
            result.push(parent);
            const children = childrenMap.get(parent.blockId);
            if (!children) return;
            for (const child of children) {
                addSubtree(child);
            }
        };
        for (const root of roots) {
            addSubtree(root);
        }

        return result;
    }

    $: collapsedDep = collapsed;
    $: taskMap = new Map(filteredTasks.map((t: TaskCacheEntry) => [t.blockId, t]));
    $: groupedTasks = groupByParent(filteredTasks, filterState.sortBy !== "order");

    $: viewData = (() => {
        const tasks = filteredTasks;
        const _c = collapsedDep;
        const hasChildrenSet = new Set<string>();
        const childCountMap: Record<string, number> = {};
        for (const t of tasks) {
            if (t.parentId) {
                hasChildrenSet.add(t.parentId);
                childCountMap[t.parentId] = (childCountMap[t.parentId] || 0) + 1;
            }
        }

        const hiddenSet = new Set<string>();
        for (const t of tasks) {
            let currentId = t.parentId;
            const visited = new Set<string>();
            while (currentId && !visited.has(currentId)) {
                visited.add(currentId);
                if (_c[currentId]) {
                    hiddenSet.add(t.blockId);
                    break;
                }
                const parent = taskMap.get(currentId);
                if (!parent) break;
                currentId = parent.parentId;
            }
        }

        return { hasChildrenSet, hiddenSet, childCountMap };
    })();

    $: activeIds = new Set(filteredTasks.map((t) => t.blockId));
    $: doneCount = $taskStore.doneCount;
</script>

<div class="na-view na-view--all-tasks">
    <SearchFilterBar
        contexts={$taskStore.contexts}
        tags={$taskStore.tags}
        filterState={allTaskFilterState}
        showStatus={true}
        statusValues={ALL_TASK_STATUS_FILTERS}
        {i18n}
        onFilterChange={handleFilterChange}
    />
    {#if $taskStore.loading && filteredTasks.length === 0}
        <NaEmpty loading={true} />
    {:else if filteredTasks.length === 0 && doneCount === 0}
        <NaEmpty text={$taskStore.error || i18n?.noResults || i18n?.noTasks || "No tasks yet"} />
    {:else}
        <div class="na-view__list" bind:this={listEl}>
            {#each groupedTasks as task (task.blockId)}
                {#if !viewData.hiddenSet.has(task.blockId)}
                    {@const indent = getIndentLevel(task, activeIds, taskMap)}
                    {@const hasChildren = viewData.hasChildrenSet.has(task.blockId)}
                    {@const childCount = viewData.childCountMap[task.blockId] || 0}
                    <div class="na-all-tasks__item" data-task-block-id={task.blockId}
                         class:na-all-tasks__item--root={indent === 0} style="--indent: {indent}"
                         on:pointerdown={(e) => dragHandler?.onPointerDown(e, task.blockId)}>
                        <TaskCard
                            {task}
                            selected={task.blockId === selectedTaskId}
                            onSelect={onSelectTask}
                            {hasChildren}
                            isCollapsed={!!collapsed[task.blockId]}
                            {childCount}
                            onToggleCollapse={() => toggleCollapse(task.blockId)}
                            isRoot={indent === 0}
                            {onEdit}
                            {onStatusClick}
                            {onContextMenu}
                            {i18n}
                        />
                    </div>
                {/if}
            {/each}

            <!-- Completed section -->
            {#if doneCount > 0}
                <div class="na-all-tasks__divider"></div>
                <span class="na-all-tasks__completed-toggle" on:click={handleToggleCompleted}>
                    {$taskStore.showCompleted ? "▾" : "▸"} {i18n?.completedTasks || "Completed tasks"}
                    <span class="na-all-tasks__completed-count">({doneCount})</span>
                </span>
                {#if $taskStore.showCompleted}
                    {#each $taskStore.completedTasks as task (task.blockId)}
                        {@const hasChildren = false}
                        {@const childCount = 0}
                        <div class="na-all-tasks__item na-all-tasks__item--root" style="--indent: 0">
                            <TaskCard
                                {task}
                                selected={task.blockId === selectedTaskId}
                                onSelect={onSelectTask}
                                {hasChildren}
                                isCollapsed={false}
                                {childCount}
                                onToggleCollapse={() => {}}
                                isRoot={true}
                                {onEdit}
                                {onStatusClick}
                                {onContextMenu}
                                {i18n}
                            />
                        </div>
                    {/each}
                {/if}
            {/if}
        </div>
    {/if}
    <NaViewHint text={i18n?.viewHintAllTasks} />
</div>
