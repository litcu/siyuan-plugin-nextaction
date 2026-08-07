<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { STATUS_LIST, VIEW_ALL_TASKS } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaAccordion from "../ui/NaAccordion.svelte";
    import NaTaskFilterBar from "../ui/NaTaskFilterBar.svelte";
    import NaTaskList from "../ui/NaTaskList.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";
    import NaSortSelect from "../ui/NaSortSelect.svelte";
    import NaButton from "../ui/NaButton.svelte";
    import { createDragHandler } from "./drag-handler";
    import type { TaskCacheEntry } from "../../shared/types";
    import { buildTaskListRows } from "../utils/task-rows";

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
    $: filteredTasks = applyFilters(activeTasks, allTaskFilterState, $taskStore.settings.customFields);

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_ALL_TASKS, state);
    }

    function toggleCollapse(blockId: string) {
        collapsed = Object.assign({}, collapsed, { [blockId]: !collapsed[blockId] });
    }

    function handleToggleCompleted() {
        taskStore.toggleCompleted();
    }

    const completedSortOptions = [
        { value: "completed", label: i18n?.sortByCompleted || "Completed date" },
        { value: "order", label: i18n?.sortByOrder || "Priority score" },
        { value: "due", label: i18n?.sortByDue || "Due date" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
        { value: "priority", label: i18n?.sortByPriority || "Manual priority" },
    ];

    function getPageNumbers(current: number, total: number): number[] {
        const max = Math.min(total, 7);
        if (total <= 7) return Array.from({ length: max }, (_, index) => index + 1);
        const start = Math.max(1, Math.min(current - 3, total - 6));
        return Array.from({ length: 7 }, (_, index) => start + index);
    }

    function changeCompletedSort(sortBy: string, sortAsc: boolean) {
        taskStore.setCompletedSort(sortBy, sortAsc);
    }

    function changeCompletedPage(page: number) {
        if (page < 1 || page > totalCompletedPages || page === $taskStore.completedPage) return;
        taskStore.setCompletedPage(page);
    }

    $: taskRows = buildTaskListRows(filteredTasks, collapsed, filterState.sortBy !== "order");
    $: doneCount = $taskStore.doneCount;
    $: totalCompletedPages = Math.max(1, Math.ceil($taskStore.completedTotal / $taskStore.completedPageSize));
    $: completedPageNumbers = getPageNumbers($taskStore.completedPage, totalCompletedPages);
</script>

<NaViewShell loading={$taskStore.loading && filteredTasks.length === 0} empty={filteredTasks.length === 0 && doneCount === 0} emptyText={$taskStore.error || i18n?.noResults || i18n?.noTasks || "No tasks yet"} hint={i18n?.viewHintAllTasks}>
    <svelte:fragment slot="toolbar"><NaTaskFilterBar
        contexts={$taskStore.contexts}
        tags={$taskStore.tags}
        customFields={$taskStore.settings.customFields}
        filterState={allTaskFilterState}
        showStatus={true}
        statusValues={ALL_TASK_STATUS_FILTERS}
        {i18n}
        on:change={(event) => handleFilterChange(event.detail)}
    /></svelte:fragment>
        <NaTaskList bind:element={listEl}>
            {#each taskRows as row (row.task.blockId)}
                    <div class="na-all-tasks__item" data-task-block-id={row.task.blockId}
                         class:na-all-tasks__item--root={row.indent === 0} style="--indent: {row.indent}"
                         on:pointerdown={(e) => dragHandler?.onPointerDown(e, row.task.blockId)}>
                        <TaskCard
                            task={row.task}
                            selected={row.task.blockId === selectedTaskId}
                            onSelect={onSelectTask}
                            hasChildren={row.hasChildren}
                            isCollapsed={!!collapsed[row.task.blockId]}
                            childCount={row.childCount}
                            onToggleCollapse={() => toggleCollapse(row.task.blockId)}
                            isRoot={row.indent === 0}
                            {onEdit}
                            {onStatusClick}
                            {onContextMenu}
                            {i18n}
                        />
                    </div>
            {/each}

            <!-- Completed section -->
            {#if doneCount > 0}
                <div class="na-completed-tasks">
                    <NaAccordion title={i18n?.completedTasks || "Completed tasks"} count={doneCount} open={$taskStore.showCompleted} variant="plain" on:openChange={handleToggleCompleted}>
                        <svelte:fragment slot="action">
                            <NaSortSelect
                                options={completedSortOptions}
                                selected={$taskStore.completedSortBy}
                                ascending={$taskStore.completedSortAsc}
                                {i18n}
                                onChange={changeCompletedSort}
                            />
                        </svelte:fragment>
                        {#if $taskStore.completedLoading && $taskStore.completedTasks.length === 0}
                            <div class="na-completed-tasks__loading">{i18n?.loading || "Loading…"}</div>
                        {:else if $taskStore.completedError}
                            <div class="na-completed-tasks__error">{$taskStore.completedError}</div>
                        {/if}
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
                        {#if $taskStore.completedTotal > 0}
                            <div class="na-completed-tasks__pagination" aria-label={i18n?.completedPagination || "Completed task pages"}>
                                <NaButton size="sm" variant="text" disabled={$taskStore.completedPage <= 1 || $taskStore.completedLoading} on:click={() => changeCompletedPage($taskStore.completedPage - 1)}>{i18n?.previousPage || "Previous"}</NaButton>
                                {#each completedPageNumbers as page (page)}
                                    <NaButton size="sm" variant={page === $taskStore.completedPage ? "primary" : "text"} disabled={$taskStore.completedLoading} on:click={() => changeCompletedPage(page)}>{page}</NaButton>
                                {/each}
                                <NaButton size="sm" variant="text" disabled={!$taskStore.completedHasMore || $taskStore.completedLoading} on:click={() => changeCompletedPage($taskStore.completedPage + 1)}>{i18n?.nextPage || "Next"}</NaButton>
                            </div>
                        {/if}
                    </NaAccordion>
                </div>
            {/if}
        </NaTaskList>
</NaViewShell>

<style lang="scss">
    .na-completed-tasks { flex: 0 0 auto; min-width: 0; }

    .na-completed-tasks__loading,
    .na-completed-tasks__error {
        padding: var(--na-space-md);
        color: var(--b3-theme-on-surface-light);
        font-size: var(--na-font-size-sm);
    }

    .na-completed-tasks__error { color: var(--na-color-error); }

    .na-completed-tasks__pagination {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--na-space-xs);
        padding: var(--na-space-md) 0 var(--na-space-xs);
        border-top: 1px solid var(--na-color-divider);
    }
</style>
