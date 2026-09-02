<script lang="ts">
    import { tick } from "svelte";
    import type { I18nStrings } from "../../../shared/i18n";
    import type { TaskCacheEntry } from "../../../shared/types";
    import { shouldShowSubtreeProgress, type ProjectTreeModel } from "../../utils/project-tree";
    import {
        buildProjectTreeDropIntent,
        executeProjectTreeCommand,
        type ProjectTreeDropPosition,
    } from "../../utils/project-tree-operations";
    import { formatOperationError } from "../../error-format";
    import TaskCard from "../TaskCard.svelte";
    import NaButton from "../../ui/NaButton.svelte";
    import NaInlineNotice from "../../ui/NaInlineNotice.svelte";
    import NaProgressBar from "../../ui/NaProgressBar.svelte";

    interface Props {
        project: TaskCacheEntry;
        model: ProjectTreeModel;
        selectedTaskId?: string;
        i18n: I18nStrings;
        onSelectTask?: ((task: TaskCacheEntry) => void) | undefined;
        onEdit: (task: TaskCacheEntry) => void;
        onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
        onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
        onToggleCollapse: (blockId: string) => void;
        onTaskRename?: ((task: TaskCacheEntry, title: string) => Promise<TaskCacheEntry>) | undefined;
        onTaskReorder?: ((blockId: string, parentId: string, afterId?: string) => Promise<void>) | undefined;
    }

    let {
        project,
        model,
        selectedTaskId = "",
        i18n,
        onSelectTask = undefined,
        onEdit,
        onStatusClick,
        onContextMenu,
        onToggleCollapse,
        onTaskRename = undefined,
        onTaskReorder = undefined,
    }: Props = $props();

    let focusedTaskId = $state("");
    let editingTaskId = $state("");
    let renameDraft = $state("");
    let renameInput: HTMLInputElement | null = $state(null);
    let busyTaskId = $state("");
    let error = $state("");
    let retryOperation: (() => Promise<void>) | null = $state(null);
    let dragTaskId = $state("");
    let dropTargetId = $state("");
    let dropPosition: ProjectTreeDropPosition | null = $state(null);
    const rowElements = new Map<string, HTMLElement>();

    let visibleTaskIds = $derived(new Set(model.rows.map((row) => row.task.blockId)));
    let operationTasks = $derived(
        [...model.taskById.values()].map((task) => ({
            ...task,
            parentId: model.parentByChild.get(task.blockId) || (task.blockId === project.blockId ? "" : task.parentId),
        })),
    );
    $effect(() => {
        if (!focusedTaskId || !visibleTaskIds.has(focusedTaskId)) focusedTaskId = model.rows[0]?.task.blockId || "";
    });
    function rowElement(node: HTMLElement, taskId: string) {
        rowElements.set(taskId, node);
        return { destroy: () => rowElements.delete(taskId) };
    }
    async function focusTask(taskId: string) {
        focusedTaskId = taskId;
        await tick();
        rowElements.get(taskId)?.focus();
    }
    function moveFocus(taskId: string, delta: number) {
        const i = model.rows.findIndex((r) => r.task.blockId === taskId);
        const target = model.rows[Math.max(0, Math.min(model.rows.length - 1, i + delta))];
        if (target) void focusTask(target.task.blockId);
    }
    function handleTreeKeydown(row: (typeof model.rows)[number], event: KeyboardEvent) {
        if (event.target !== event.currentTarget) return;
        const i = model.rows.findIndex((r) => r.task.blockId === row.task.blockId);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            moveFocus(row.task.blockId, event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "ArrowRight") {
            event.preventDefault();
            if (row.hasChildren && row.isCollapsed) onToggleCollapse(row.task.blockId);
            else if (row.hasChildren) void focusTask(model.rows[i + 1]?.task.blockId || row.task.blockId);
        } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            if (row.hasChildren && !row.isCollapsed) onToggleCollapse(row.task.blockId);
            else if (row.visibleParentId) void focusTask(row.visibleParentId);
        } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectTask?.(row.task);
        } else if (event.key === "F2" && onTaskRename) {
            event.preventDefault();
            void startRename(row.task);
        }
    }
    function formatError(cause: unknown) {
        return (i18n?.projectHierarchyWriteFailed || "Hierarchy update failed: {error}").replace(
            "{error}",
            formatOperationError(cause, i18n),
        );
    }
    async function perform(
        task: TaskCacheEntry,
        operation: () => Promise<unknown>,
        after?: () => Promise<void> | void,
    ) {
        if (busyTaskId) return false;
        busyTaskId = task.blockId;
        error = "";
        try {
            await operation();
            retryOperation = null;
            await after?.();
            return true;
        } catch (cause: unknown) {
            error = formatError(cause);
            retryOperation = async () => {
                await perform(task, operation, after);
            };
            return false;
        } finally {
            busyTaskId = "";
            await focusTask(task.blockId);
        }
    }
    async function startRename(task: TaskCacheEntry) {
        if (!onTaskRename) return;
        editingTaskId = task.blockId;
        renameDraft = task.title;
        error = "";
        await tick();
        renameInput?.focus();
    }
    async function submitRename(task: TaskCacheEntry) {
        const title = renameDraft.replace(/[\r\n]+/g, " ").trim();
        if (!title) {
            error = i18n?.createTitleRequired || "Enter a task title";
            return;
        }
        await perform(
            task,
            () => executeProjectTreeCommand({ type: "rename", task, title }, { renameTask: onTaskRename }),
            () => {
                editingTaskId = "";
                renameDraft = "";
            },
        );
    }

    function handleRenameSubmit(task: TaskCacheEntry, event: SubmitEvent): void {
        event.preventDefault();
        void submitRename(task);
    }

    async function cancelRename(taskId: string) {
        editingTaskId = "";
        renameDraft = "";
        await focusTask(taskId);
    }
    function handleRenameKeydown(taskId: string, event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.preventDefault();
            void cancelRename(taskId);
        }
    }
    function handleDragStart(task: TaskCacheEntry, event: DragEvent) {
        if (task.taskType === "2" || !event.dataTransfer) return;
        dragTaskId = task.blockId;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.blockId);
    }
    function handleDragOver(target: TaskCacheEntry, event: DragEvent) {
        if (!dragTaskId || dragTaskId === target.blockId) return;
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
        const position: ProjectTreeDropPosition = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
        const moving = model.taskById.get(dragTaskId);
        const intent = moving ? buildProjectTreeDropIntent(moving, target, position, project, operationTasks) : null;
        if (!intent) {
            dropTargetId = "";
            dropPosition = null;
            return;
        }
        event.preventDefault();
        dropPosition = position;
        dropTargetId = target.blockId;
    }
    async function handleDrop(target: TaskCacheEntry, event: DragEvent) {
        event.preventDefault();
        const moving = model.taskById.get(dragTaskId);
        const intent =
            moving && dropPosition
                ? buildProjectTreeDropIntent(moving, target, dropPosition, project, operationTasks)
                : null;
        handleDragEnd();
        if (moving && intent)
            await perform(moving, () =>
                executeProjectTreeCommand(
                    { type: "reorder", task: moving, parentId: intent.parentId, afterId: intent.afterId },
                    { reorderTask: onTaskReorder },
                ),
            );
    }
    function handleDragEnd() {
        dragTaskId = "";
        dropTargetId = "";
        dropPosition = null;
    }
</script>

<div class="na-project-tree" role="tree" aria-label={i18n?.projectViewHierarchy || "Project hierarchy"}>
    {#if error}<div class="na-project-tree__error">
            <NaInlineNotice message={error} tone="error" />{#if retryOperation}<NaButton
                    size="sm"
                    disabled={Boolean(busyTaskId)}
                    onclick={() => retryOperation?.()}>{i18n?.retry || "Retry"}</NaButton
                >{/if}
        </div>{/if}
    {#each model.rows as row (row.task.blockId)}
        <div
            class="na-project-tree__row"
            class:na-project-tree__row--selected={row.task.blockId === selectedTaskId}
            class:na-project-tree__row--nested={row.depth > 0}
            class:na-project-tree__row--dragging={row.task.blockId === dragTaskId}
            class:na-project-tree__row--drop-before={dropTargetId === row.task.blockId && dropPosition === "before"}
            class:na-project-tree__row--drop-inside={dropTargetId === row.task.blockId && dropPosition === "inside"}
            class:na-project-tree__row--drop-after={dropTargetId === row.task.blockId && dropPosition === "after"}
            style={`--na-project-tree-depth: ${row.depth}`}
            use:rowElement={row.task.blockId}
            role="treeitem"
            tabindex={focusedTaskId === row.task.blockId ? 0 : -1}
            aria-level={row.depth + 1}
            aria-posinset={row.positionInSet}
            aria-setsize={row.setSize}
            aria-expanded={row.hasChildren ? !row.isCollapsed : undefined}
            aria-selected={row.task.blockId === selectedTaskId}
            onfocus={() => (focusedTaskId = row.task.blockId)}
            onkeydown={(event) => handleTreeKeydown(row, event)}
            draggable={row.task.taskType !== "2" && Boolean(onTaskReorder) && !busyTaskId}
            ondragstart={(event) => handleDragStart(row.task, event)}
            ondragend={handleDragEnd}
            ondragover={(event) => handleDragOver(row.task, event)}
            ondrop={(event) => handleDrop(row.task, event)}
        >
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
                    isCollapsed={Boolean(row.isCollapsed)}
                    childCount={row.childCount}
                    onToggleCollapse={() => onToggleCollapse(row.task.blockId)}
                    isRoot={row.depth === 0}
                    managedFocus
                />
                {#if editingTaskId === row.task.blockId}<form
                        class="na-project-tree__rename"
                        onsubmit={(event) => handleRenameSubmit(row.task, event)}
                    >
                        <input
                            bind:this={renameInput}
                            class="na-input"
                            bind:value={renameDraft}
                            maxlength="512"
                            aria-label={`${i18n?.renameStage || "Rename"}: ${row.task.title}`}
                            onkeydown={(event) => handleRenameKeydown(row.task.blockId, event)}
                        /><NaButton size="sm" type="submit" loading={busyTaskId === row.task.blockId}
                            >{i18n?.save || "Save"}</NaButton
                        ><NaButton
                            size="sm"
                            disabled={Boolean(busyTaskId)}
                            onclick={() => cancelRename(row.task.blockId)}>{i18n?.cancel || "Cancel"}</NaButton
                        >
                    </form>{/if}
                {#if shouldShowSubtreeProgress(row) && row.subtreeProgress}<div class="na-project-tree__stage-progress">
                        <NaProgressBar
                            percent={row.subtreeProgress.percent}
                            label={`${row.task.actionKind === "stage" ? i18n?.actionKindStage || "Stage" : i18n?.actionKindAction || "Action"} · ${row.subtreeProgress.done}/${row.subtreeProgress.total}`}
                        />
                    </div>{/if}
            </div>
        </div>
    {/each}
</div>

<style lang="scss">
    .na-project-tree {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-xs);
    }
    .na-project-tree__error {
        display: flex;
        align-items: flex-start;
        gap: var(--na-space-sm);
    }
    .na-project-tree__error :global(.na-inline-notice) {
        flex: 1;
    }
    .na-project-tree__row {
        position: relative;
        padding-left: calc(var(--na-project-tree-depth) * var(--na-project-tree-indent, 18px));
        border-left: 2px solid transparent;
        border-radius: var(--na-radius-sm);
    }
    .na-project-tree__row--nested::before {
        content: "";
        position: absolute;
        left: calc(var(--na-project-tree-depth) * var(--na-project-tree-indent, 18px) - 10px);
        top: 0;
        bottom: 0;
        border-left: 1px solid var(--na-color-divider);
        opacity: 0.55;
    }
    .na-project-tree__row:focus-visible {
        outline: 2px solid var(--b3-theme-primary);
        outline-offset: 2px;
    }
    .na-project-tree__row--selected {
        background: var(--na-color-selected-bg);
        border-left-color: var(--na-text-interactive);
    }
    .na-project-tree__row--dragging {
        opacity: 0.55;
    }
    .na-project-tree__row--drop-before {
        border-top: 2px solid var(--b3-theme-primary);
    }
    .na-project-tree__row--drop-after {
        border-bottom: 2px solid var(--b3-theme-primary);
    }
    .na-project-tree__row--drop-inside {
        background: var(--na-color-selected-bg);
        box-shadow: inset 0 0 0 2px var(--b3-theme-primary);
    }
    .na-project-tree__item {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        align-items: center;
        min-width: 0;
    }
    .na-project-tree__item :global(.na-task-card) {
        min-width: 0;
    }
    .na-project-tree__rename {
        grid-column: 1 / -1;
        display: flex;
        gap: var(--na-space-xs);
        padding: 4px 8px 4px 34px;
    }
    .na-project-tree__rename .na-input {
        min-width: 0;
        flex: 1;
    }
    .na-project-tree__stage-progress {
        grid-column: 1 / -1;
        padding: 3px 8px 1px 34px;
    }
    @container nextaction-app (max-width: 600px) {
        .na-project-tree__item {
            grid-template-columns: minmax(0, 1fr);
        }
    }
</style>
