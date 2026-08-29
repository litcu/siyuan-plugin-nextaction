<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import { taskStore } from "../stores/task-store";
    import { STATUS_LIST, VIEW_ALL_TASKS } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE, hasActiveTaskFilters } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaAccordion from "../ui/NaAccordion.svelte";
    import NaTaskFilterBar from "../ui/NaTaskFilterBar.svelte";
    import NaTaskList from "../ui/NaTaskList.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";
    import NaSortSelect from "../ui/NaSortSelect.svelte";
    import NaButton from "../ui/NaButton.svelte";
    import NaDragHandle from "../ui/NaDragHandle.svelte";
    import NaIconButton from "../ui/NaIconButton.svelte";
    import { createDragHandler } from "./drag-handler";
    import type { TaskCacheEntry } from "../../shared/types";
    import { buildTaskListRows } from "../utils/task-rows";
    import {
        buildTaskMoveIntent,
        describeTaskMove,
        type TaskMoveDirection,
        type TaskReorderIntent,
    } from "../utils/task-reorder";

    export let bridge: any;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;
    export let selectedTaskId: string = "";
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onCreate: () => void;

    const ALL_TASK_STATUS_FILTERS = STATUS_LIST.filter((status) => status !== "done");

    let dragHandler: ReturnType<typeof createDragHandler> | null = null;
    let listEl: HTMLElement | null = null;
    let busyTaskId = "";
    let announcement = "";

    function formatMessage(template: string, values: Record<string, string | number>): string {
        return Object.entries(values).reduce(
            (message, [key, value]) => message.split(`{${key}}`).join(String(value)),
            template,
        );
    }

    async function focusTask(blockId: string) {
        await tick();
        const escapedId = CSS.escape(blockId);
        const taskBody = listEl?.querySelector<HTMLElement>(`[data-task-block-id="${escapedId}"] .na-task-card__body`);
        taskBody?.focus();
    }

    function announceTaskMove(blockId: string, intent: TaskReorderIntent, tasks: TaskCacheEntry[]) {
        const description = describeTaskMove(blockId, intent, tasks);
        announcement = description.parentTitle
            ? formatMessage(i18n?.taskMovedUnder || "{task} moved to position {position} of {total} under {parent}.", {
                  task: description.taskTitle,
                  position: description.position,
                  total: description.setSize,
                  parent: description.parentTitle,
              })
            : formatMessage(
                  i18n?.taskMovedTopLevel || "{task} moved to position {position} of {total} at the top level.",
                  {
                      task: description.taskTitle,
                      position: description.position,
                      total: description.setSize,
                  },
              );
    }

    async function performReorder(blockId: string, parentId: string, afterId?: string) {
        if (busyTaskId) return;
        const tasks = activeTasks;
        const intent = { blockId, parentId, afterId };
        const taskTitle = tasks.find((task) => task.blockId === blockId)?.title || blockId;
        busyTaskId = blockId;
        announcement = "";
        if (parentId && collapsed[parentId]) {
            collapsed = { ...collapsed, [parentId]: false };
        }
        try {
            const updated = await bridge.reorderTask(blockId, parentId, afterId);
            taskStore.applyUpdate(updated);
            if (filterState.sortBy !== "manual" || !filterState.sortAsc) {
                taskStore.setFilterState(VIEW_ALL_TASKS, { ...filterState, sortBy: "manual", sortAsc: true });
            }
            announceTaskMove(blockId, intent, tasks);
        } catch (cause: unknown) {
            const error = cause instanceof Error ? cause.message : String(cause);
            announcement = formatMessage(i18n?.taskMoveFailed || "Could not move {task}: {error}", {
                task: taskTitle,
                error,
            });
            console.error("[NextAction] reorderTask failed:", cause);
        } finally {
            busyTaskId = "";
            await focusTask(blockId);
        }
    }

    function initDragHandler() {
        if (dragHandler || !listEl || !bridge) return;
        dragHandler = createDragHandler({
            container: listEl,
            getCardElement: (blockId: string) => listEl!.querySelector(`[data-task-block-id="${blockId}"]`),
            onReorder: async (blockId, parentId, afterId) => {
                await performReorder(blockId, parentId === null ? "" : parentId, afterId ?? undefined);
            },
        });
    }

    $: if (listEl && bridge) initDragHandler();

    onDestroy(() => dragHandler?.destroy());

    let collapsed: Record<string, boolean> = {};

    $: filterState = $taskStore.filterByView[VIEW_ALL_TASKS] || DEFAULT_FILTER_STATE;
    $: activeTasks = $taskStore.allTasks.filter((task: TaskCacheEntry) => task.status !== "done");
    $: allTaskFilterState = filterState.statuses.includes("done")
        ? { ...filterState, statuses: filterState.statuses.filter((status) => status !== "done") }
        : filterState;
    $: filteredTasks = applyFilters(activeTasks, allTaskFilterState, $taskStore.settings.customFields);
    $: emptyAction = hasActiveTaskFilters(filterState)
        ? {
              label: i18n?.clearFilter || "Clear filters",
              onClick: () => taskStore.setFilterState(VIEW_ALL_TASKS, DEFAULT_FILTER_STATE),
          }
        : { label: i18n?.createTask || "Create task", onClick: onCreate };

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_ALL_TASKS, state);
    }

    function moveIntent(task: TaskCacheEntry, direction: TaskMoveDirection) {
        return buildTaskMoveIntent(task.blockId, activeTasks, direction);
    }

    async function moveTask(task: TaskCacheEntry, direction: TaskMoveDirection) {
        const intent = moveIntent(task, direction);
        if (!intent) return;
        await performReorder(intent.blockId, intent.parentId, intent.afterId);
    }

    function handleTaskKeydown(task: TaskCacheEntry, event: KeyboardEvent) {
        if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
        const directionByKey: Partial<Record<string, TaskMoveDirection>> = {
            ArrowUp: "up",
            ArrowDown: "down",
            ArrowRight: "in",
            ArrowLeft: "out",
        };
        const direction = directionByKey[event.key];
        if (!direction || !moveIntent(task, direction)) return;
        event.preventDefault();
        event.stopPropagation();
        void moveTask(task, direction);
    }

    function handleWindowTaskKeydown(event: KeyboardEvent) {
        const target = event.target instanceof Element ? event.target : null;
        const row = target?.closest<HTMLElement>("[data-task-block-id]");
        if (!row || !listEl?.contains(row)) return;
        const task = activeTasks.find((entry) => entry.blockId === row.dataset.taskBlockId);
        if (task) handleTaskKeydown(task, event);
    }

    function handleDragPointerDown(task: TaskCacheEntry, event: PointerEvent) {
        if (busyTaskId) return;
        dragHandler?.onPointerDown(event, task.blockId);
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
    $: allTaskSortOptions = [
        { value: "order", label: i18n?.sortByOrder || "Priority score" },
        { value: "manual", label: i18n?.manualSort || "Manual order" },
        { value: "due", label: i18n?.sortByDue || "Due date" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
        { value: "priority", label: i18n?.sortByPriority || "Manual priority" },
        ...$taskStore.settings.customFields
            .filter((field) => field.status === "active")
            .map((field) => ({ value: `custom:${field.key}`, label: `${field.label} ↕` })),
    ];
    $: doneCount = $taskStore.doneCount;
    $: totalCompletedPages = Math.max(1, Math.ceil($taskStore.completedTotal / $taskStore.completedPageSize));
    $: completedPageNumbers = getPageNumbers($taskStore.completedPage, totalCompletedPages);
</script>

<svelte:window on:keydown={handleWindowTaskKeydown} />

<NaViewShell
    loading={$taskStore.loading && filteredTasks.length === 0}
    error={$taskStore.error}
    retryAction={{ label: i18n?.retry || "Retry", onClick: () => taskStore.loadTasks() }}
    loadingText={i18n?.loading || "Loading..."}
    empty={filteredTasks.length === 0 && doneCount === 0}
    emptyText={i18n?.noResults || i18n?.noTasks || "No tasks yet"}
    {emptyAction}
    hint={i18n?.viewHintAllTasks}
>
    <svelte:fragment slot="toolbar"
        ><NaTaskFilterBar
            contexts={$taskStore.contexts}
            tags={$taskStore.tags}
            customFields={$taskStore.settings.customFields}
            filterState={allTaskFilterState}
            sortOptions={allTaskSortOptions}
            showStatus={true}
            statusValues={ALL_TASK_STATUS_FILTERS}
            {i18n}
            on:change={(event) => handleFilterChange(event.detail)}
        /></svelte:fragment
    >
    <NaTaskList bind:element={listEl}>
        {#each taskRows as row (row.task.blockId)}
            <div
                class="na-all-tasks__item"
                data-task-block-id={row.task.blockId}
                class:na-all-tasks__item--root={row.indent === 0}
                style="--indent: {row.indent}"
            >
                <div class="na-all-tasks__row-content">
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
                    <div class="na-all-tasks__reorder-controls" on:pointerdown|stopPropagation>
                        <NaDragHandle
                            label={`${i18n?.dragToReorder || "Drag to reorder"}: ${row.task.title}`}
                            disabled={Boolean(busyTaskId)}
                            on:pointerdown={(event) => handleDragPointerDown(row.task, event)}
                        />
                        <NaIconButton
                            compact
                            symbol="iconUp"
                            label={`${i18n?.moveUp || "Move up"}: ${row.task.title}`}
                            ariaKeyshortcuts="Alt+Shift+ArrowUp"
                            disabled={Boolean(busyTaskId) || !moveIntent(row.task, "up")}
                            on:click={() => moveTask(row.task, "up")}
                        />
                        <NaIconButton
                            compact
                            symbol="iconDown"
                            label={`${i18n?.moveDown || "Move down"}: ${row.task.title}`}
                            ariaKeyshortcuts="Alt+Shift+ArrowDown"
                            disabled={Boolean(busyTaskId) || !moveIntent(row.task, "down")}
                            on:click={() => moveTask(row.task, "down")}
                        />
                        <NaIconButton
                            compact
                            symbol="iconRight"
                            label={`${i18n?.moveIn || "Indent"}: ${row.task.title}`}
                            ariaKeyshortcuts="Alt+Shift+ArrowRight"
                            disabled={Boolean(busyTaskId) || !moveIntent(row.task, "in")}
                            on:click={() => moveTask(row.task, "in")}
                        />
                        <NaIconButton
                            compact
                            symbol="iconLeft"
                            label={`${i18n?.moveOut || "Outdent"}: ${row.task.title}`}
                            ariaKeyshortcuts="Alt+Shift+ArrowLeft"
                            disabled={Boolean(busyTaskId) || !moveIntent(row.task, "out")}
                            on:click={() => moveTask(row.task, "out")}
                        />
                    </div>
                </div>
            </div>
        {/each}

        <div class="na-all-tasks__announcement" role="status" aria-live="polite" aria-atomic="true">
            {announcement}
        </div>

        <!-- Completed section -->
        {#if doneCount > 0}
            <div class="na-completed-tasks">
                <NaAccordion
                    title={i18n?.completedTasks || "Completed tasks"}
                    count={doneCount}
                    open={$taskStore.showCompleted}
                    variant="plain"
                    on:openChange={handleToggleCompleted}
                >
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
                        <div
                            class="na-completed-tasks__pagination"
                            aria-label={i18n?.completedPagination || "Completed task pages"}
                        >
                            <NaButton
                                size="sm"
                                variant="text"
                                disabled={$taskStore.completedPage <= 1 || $taskStore.completedLoading}
                                on:click={() => changeCompletedPage($taskStore.completedPage - 1)}
                                >{i18n?.previousPage || "Previous"}</NaButton
                            >
                            {#each completedPageNumbers as page (page)}
                                <NaButton
                                    size="sm"
                                    variant={page === $taskStore.completedPage ? "primary" : "text"}
                                    disabled={$taskStore.completedLoading}
                                    on:click={() => changeCompletedPage(page)}>{page}</NaButton
                                >
                            {/each}
                            <NaButton
                                size="sm"
                                variant="text"
                                disabled={!$taskStore.completedHasMore || $taskStore.completedLoading}
                                on:click={() => changeCompletedPage($taskStore.completedPage + 1)}
                                >{i18n?.nextPage || "Next"}</NaButton
                            >
                        </div>
                    {/if}
                </NaAccordion>
            </div>
        {/if}
    </NaTaskList>
</NaViewShell>

<style lang="scss">
    .na-all-tasks__row-content {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        min-width: 0;
    }

    .na-all-tasks__row-content :global(.na-task-card) {
        min-width: 0;
    }

    .na-all-tasks__reorder-controls {
        display: flex;
        align-items: center;
        gap: 2px;
        padding-left: var(--na-space-xs);
    }

    .na-all-tasks__announcement {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }

    .na-completed-tasks {
        flex: 0 0 auto;
        min-width: 0;
    }

    .na-completed-tasks__loading,
    .na-completed-tasks__error {
        padding: var(--na-space-md);
        color: var(--b3-theme-on-surface-light);
        font-size: var(--na-font-size-sm);
    }

    .na-completed-tasks__error {
        color: var(--na-color-error);
    }

    .na-completed-tasks__pagination {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--na-space-xs);
        padding: var(--na-space-md) 0 var(--na-space-xs);
        border-top: 1px solid var(--na-color-divider);
    }

    @media (pointer: coarse), (max-width: 520px) {
        .na-all-tasks__row-content {
            grid-template-columns: minmax(0, 1fr);
        }

        .na-all-tasks__reorder-controls {
            justify-content: flex-end;
            padding: var(--na-space-xs) 0 0;
        }
    }
</style>
