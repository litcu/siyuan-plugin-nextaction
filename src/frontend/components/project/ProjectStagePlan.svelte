<script lang="ts">
    import { tick } from "svelte";
    import type { I18nStrings } from "../../../shared/i18n";
    import type { TaskCacheEntry } from "../../../shared/types";
    import type { ProjectTreeModel } from "../../utils/project-tree";
    import {
        buildProjectPlanParentOptions,
        buildProjectPlanReorderIntent,
        buildProjectPlanRows,
        executeProjectPlanCommand,
    } from "../../utils/project-stage-plan";
    import { formatOperationError } from "../../error-format";
    import NaButton from "../../ui/NaButton.svelte";
    import NaEmpty from "../../ui/NaEmpty.svelte";
    import NaInlineNotice from "../../ui/NaInlineNotice.svelte";
    import NaSection from "../../ui/NaSection.svelte";

    export let project: TaskCacheEntry;
    export let model: ProjectTreeModel;
    export let i18n: I18nStrings;
    export let selectedTaskId = "";
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onCreateStage: (() => void) | undefined = undefined;
    export let onRenameTask: ((task: TaskCacheEntry, title: string) => Promise<TaskCacheEntry>) | undefined = undefined;
    export let onTaskUpdate:
        ((task: TaskCacheEntry, attrs: Record<string, string>) => Promise<TaskCacheEntry>) | undefined = undefined;
    export let onTaskReorder: ((blockId: string, parentId: string, afterId?: string) => Promise<void>) | undefined =
        undefined;
    export let onMoveAction: ((task: TaskCacheEntry, project: TaskCacheEntry) => void) | undefined = undefined;

    let busyTaskId = "";
    let editingTaskId = "";
    let renameDraft = "";
    let error = "";
    let retryOperation: (() => Promise<void>) | null = null;
    let renameInput: HTMLInputElement | null = null;
    let activeProjectId = project.blockId;
    const taskButtons = new Map<string, HTMLButtonElement>();

    $: rows = buildProjectPlanRows(model, project.blockId);
    $: projectTasks = [...model.taskById.values()].filter((task) => task.blockId !== project.blockId);
    $: if (project.blockId !== activeProjectId) {
        activeProjectId = project.blockId;
        busyTaskId = "";
        editingTaskId = "";
        renameDraft = "";
        error = "";
        retryOperation = null;
    }

    function formatPlanError(cause: unknown): string {
        const detail = formatOperationError(cause, i18n);
        return (i18n?.projectPlanWriteFailed || "Plan update failed: {error}").replace("{error}", detail);
    }

    async function restoreOperationFocus(taskId: string, focusTarget?: HTMLElement | null): Promise<void> {
        await tick();
        if (focusTarget?.isConnected && !focusTarget.matches(":disabled")) {
            focusTarget.focus();
            return;
        }
        if (editingTaskId === taskId && renameInput?.isConnected) {
            renameInput.focus();
            return;
        }
        taskButtons.get(taskId)?.focus();
    }

    async function performPlanWrite(
        task: TaskCacheEntry,
        operation: () => Promise<unknown>,
        focusTarget?: HTMLElement | null,
        onSuccess?: () => Promise<void> | void,
    ): Promise<boolean> {
        if (busyTaskId) return false;
        busyTaskId = task.blockId;
        error = "";
        try {
            await operation();
            retryOperation = null;
            await onSuccess?.();
            return true;
        } catch (cause: unknown) {
            error = formatPlanError(cause);
            retryOperation = async () => {
                await performPlanWrite(task, operation, focusTarget, onSuccess);
            };
            return false;
        } finally {
            busyTaskId = "";
            await restoreOperationFocus(task.blockId, focusTarget);
        }
    }

    function rememberTaskButton(node: HTMLButtonElement, taskId: string) {
        taskButtons.set(taskId, node);
        return {
            destroy() {
                if (taskButtons.get(taskId) === node) taskButtons.delete(taskId);
            },
        };
    }

    async function startRename(task: TaskCacheEntry) {
        editingTaskId = task.blockId;
        renameDraft = task.title;
        error = "";
        await tick();
        renameInput?.focus();
    }

    async function cancelRename(taskId: string) {
        editingTaskId = "";
        renameDraft = "";
        await tick();
        taskButtons.get(taskId)?.focus();
    }

    async function submitRename(task: TaskCacheEntry) {
        const title = renameDraft.replace(/[\r\n]+/g, " ").trim();
        if (!title) {
            error = i18n?.createTitleRequired || "Enter a task title";
            return;
        }
        await performPlanWrite(
            task,
            () => executeProjectPlanCommand({ type: "rename", task, title }, { renameTask: onRenameTask }),
            renameInput,
            () => cancelRename(task.blockId),
        );
    }

    async function changeKind(task: TaskCacheEntry, event: Event) {
        const control = event.currentTarget as HTMLSelectElement;
        const actionKind = control.value === "stage" ? "stage" : "action";
        const succeeded = await performPlanWrite(
            task,
            () => executeProjectPlanCommand({ type: "setKind", task, actionKind }, { updateTask: onTaskUpdate }),
            control,
        );
        if (!succeeded) control.value = task.actionKind === "stage" ? "stage" : "action";
    }

    function sortedSiblings(parentId: string, taskId = ""): TaskCacheEntry[] {
        return (model.childrenByParent.get(parentId) || [])
            .filter((task) => task.blockId !== taskId)
            .sort((left, right) => left.sort - right.sort || left.blockId.localeCompare(right.blockId));
    }

    async function changeParent(task: TaskCacheEntry, event: Event) {
        const control = event.currentTarget as HTMLSelectElement;
        const parentId = control.value;
        const siblings = sortedSiblings(parentId, task.blockId);
        const afterId = siblings[siblings.length - 1]?.blockId;
        const succeeded = await performPlanWrite(
            task,
            () =>
                executeProjectPlanCommand({ type: "reorder", task, parentId, afterId }, { reorderTask: onTaskReorder }),
            control,
        );
        if (!succeeded) control.value = task.parentId;
    }

    function moveIntent(task: TaskCacheEntry, direction: "up" | "down") {
        return buildProjectPlanReorderIntent(task, model.childrenByParent.get(task.parentId) || [], direction);
    }

    async function moveTask(task: TaskCacheEntry, direction: "up" | "down", event: MouseEvent) {
        const intent = moveIntent(task, direction);
        if (!intent) return;
        const focusTarget = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
        await performPlanWrite(
            task,
            () =>
                executeProjectPlanCommand(
                    { type: "reorder", task, parentId: intent.parentId, afterId: intent.afterId },
                    { reorderTask: onTaskReorder },
                ),
            focusTarget,
        );
    }

    function handleRenameKeydown(task: TaskCacheEntry, event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.preventDefault();
            void cancelRename(task.blockId);
        }
    }
</script>

<NaSection
    title={i18n?.projectStagePlan || "Stage plan"}
    description={i18n?.projectStagePlanHint || "Organize this Project with ordinary Actions and Stages."}
    icon="iconList"
>
    <div class="na-project-stage-plan">
        <div class="na-project-stage-plan__toolbar">
            <NaButton
                size="sm"
                variant="primary"
                icon="iconAdd"
                disabled={!onCreateStage}
                onclick={() => onCreateStage?.()}>{i18n?.createStage || "Create Stage"}</NaButton
            >
        </div>

        {#if error}
            <div class="na-project-stage-plan__error">
                <NaInlineNotice message={error} tone="error" />
                {#if retryOperation}
                    <NaButton size="sm" disabled={Boolean(busyTaskId)} onclick={() => retryOperation?.()}
                        >{i18n?.retry || "Retry"}</NaButton
                    >
                {/if}
            </div>
        {/if}

        {#if rows.length === 0}
            <NaEmpty
                text={i18n?.projectStagePlanEmpty ||
                    "No Actions or Stages yet. Create a Stage to start organizing this Project."}
            />
        {:else}
            <div class="na-project-stage-plan__list" role="list">
                {#each rows as row (row.task.blockId)}
                    <div
                        class="na-project-stage-plan__row"
                        class:na-project-stage-plan__row--selected={row.task.blockId === selectedTaskId}
                        data-task-id={row.task.blockId}
                        aria-current={row.task.blockId === selectedTaskId ? "true" : undefined}
                        style={`--na-project-stage-depth: ${Math.max(0, row.depth - 1)}`}
                        role="listitem"
                    >
                        <div class="na-project-stage-plan__identity">
                            {#if editingTaskId === row.task.blockId}
                                <form on:submit|preventDefault={() => submitRename(row.task)}>
                                    <input
                                        bind:this={renameInput}
                                        class="na-input"
                                        data-role="rename"
                                        bind:value={renameDraft}
                                        maxlength="512"
                                        disabled={busyTaskId === row.task.blockId}
                                        aria-label={`${i18n?.renameStage || "Rename"}: ${row.task.title}`}
                                        on:keydown={(event) => handleRenameKeydown(row.task, event)}
                                    />
                                    <NaButton
                                        size="sm"
                                        type="submit"
                                        loading={busyTaskId === row.task.blockId}
                                        ariaLabel={`${i18n?.save || "Save"}: ${row.task.title}`}
                                        >{i18n?.save || "Save"}</NaButton
                                    >
                                    <NaButton
                                        size="sm"
                                        disabled={busyTaskId === row.task.blockId}
                                        ariaLabel={`${i18n?.cancel || "Cancel"}: ${row.task.title}`}
                                        onclick={() => cancelRename(row.task.blockId)}
                                        >{i18n?.cancel || "Cancel"}</NaButton
                                    >
                                </form>
                            {:else}
                                <button
                                    type="button"
                                    class="na-project-stage-plan__select"
                                    use:rememberTaskButton={row.task.blockId}
                                    on:click={() => onSelectTask?.(row.task)}
                                >
                                    <strong>{row.task.title || i18n?.untitled || "(untitled)"}</strong>
                                    <span
                                        >{row.task.actionKind === "stage"
                                            ? i18n?.actionKindStage || "Stage"
                                            : i18n?.actionKindAction || "Action"}</span
                                    >
                                </button>
                            {/if}
                        </div>

                        <div class="na-project-stage-plan__controls">
                            <NaButton
                                size="sm"
                                disabled={Boolean(busyTaskId) || editingTaskId === row.task.blockId || !onRenameTask}
                                ariaLabel={`${i18n?.renameStage || "Rename"}: ${row.task.title}`}
                                onclick={() => startRename(row.task)}>{i18n?.renameStage || "Rename"}</NaButton
                            >
                            <label>
                                <span>{i18n?.actionKind || "Action kind"}</span>
                                <select
                                    class="na-select na-select--sm"
                                    data-role="kind"
                                    value={row.task.actionKind === "stage" ? "stage" : "action"}
                                    disabled={Boolean(busyTaskId) || !onTaskUpdate}
                                    aria-label={`${i18n?.actionKind || "Action kind"}: ${row.task.title}`}
                                    on:change={(event) => changeKind(row.task, event)}
                                >
                                    <option value="action">{i18n?.actionKindAction || "Action"}</option>
                                    <option value="stage">{i18n?.actionKindStage || "Stage"}</option>
                                </select>
                            </label>
                            <label>
                                <span>{i18n?.parentItem || "Parent"}</span>
                                <select
                                    class="na-select na-select--sm"
                                    data-role="parent"
                                    value={row.task.parentId}
                                    disabled={Boolean(busyTaskId) || !onTaskReorder}
                                    aria-label={`${i18n?.parentItem || "Parent"}: ${row.task.title}`}
                                    on:change={(event) => changeParent(row.task, event)}
                                >
                                    {#each buildProjectPlanParentOptions(row.task, project, projectTasks) as parent}
                                        <option value={parent.blockId}
                                            >{parent.blockId === project.blockId
                                                ? `${i18n?.project || "Project"}: ${parent.title}`
                                                : parent.title || i18n?.untitled || "(untitled)"}</option
                                        >
                                    {/each}
                                </select>
                            </label>
                            <div class="na-project-stage-plan__order" aria-label={i18n?.manualSort || "Manual order"}>
                                <NaButton
                                    size="sm"
                                    disabled={Boolean(busyTaskId) || !onTaskReorder || !moveIntent(row.task, "up")}
                                    ariaLabel={`${i18n?.moveUp || "Move up"}: ${row.task.title}`}
                                    onclick={(event) => moveTask(row.task, "up", event)}
                                    >{i18n?.moveUp || "Move up"}</NaButton
                                >
                                <NaButton
                                    size="sm"
                                    disabled={Boolean(busyTaskId) || !onTaskReorder || !moveIntent(row.task, "down")}
                                    ariaLabel={`${i18n?.moveDown || "Move down"}: ${row.task.title}`}
                                    onclick={(event) => moveTask(row.task, "down", event)}
                                    >{i18n?.moveDown || "Move down"}</NaButton
                                >
                            </div>
                            <NaButton
                                size="sm"
                                disabled={Boolean(busyTaskId) || !onMoveAction}
                                ariaLabel={`${i18n?.moveActionConfirm || "Move to project document"}: ${row.task.title}`}
                                onclick={() => onMoveAction?.(row.task, project)}
                                >{i18n?.moveActionConfirm || "Move to project document"}</NaButton
                            >
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</NaSection>

<style lang="scss">
    .na-project-stage-plan {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-md);
        padding-block: var(--na-space-lg);
    }
    .na-project-stage-plan__toolbar {
        display: flex;
        justify-content: flex-end;
    }
    .na-project-stage-plan__error {
        display: flex;
        align-items: flex-start;
        gap: var(--na-space-sm);
    }
    .na-project-stage-plan__error :global(.na-inline-notice) {
        flex: 1;
    }
    .na-project-stage-plan__list {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-xs);
    }
    .na-project-stage-plan__row {
        display: grid;
        grid-template-columns: minmax(180px, 1fr) minmax(360px, auto);
        align-items: center;
        gap: var(--na-space-md);
        min-width: 0;
        padding: 6px 8px 6px calc(8px + var(--na-project-stage-depth) * 16px);
        border: 1px solid transparent;
        border-radius: var(--na-radius-md);
        background: var(--b3-theme-background);
    }
    .na-project-stage-plan__row--selected {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 42%, var(--na-color-divider));
        background: var(--na-color-selected-bg);
    }
    .na-project-stage-plan__identity,
    .na-project-stage-plan__select {
        min-width: 0;
    }
    .na-project-stage-plan__select {
        display: flex;
        width: 100%;
        flex-direction: column;
        gap: 2px;
        padding: 4px;
        border: 0;
        color: var(--na-text-primary);
        background: transparent;
        text-align: left;
        cursor: pointer;
    }
    .na-project-stage-plan__select strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--na-font-size-md);
    }
    .na-project-stage-plan__select span,
    .na-project-stage-plan__controls label > span {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
    }
    .na-project-stage-plan__identity form {
        display: grid;
        grid-template-columns: minmax(120px, 1fr) auto auto;
        gap: var(--na-space-xs);
    }
    .na-project-stage-plan__controls {
        display: flex;
        align-items: flex-end;
        justify-content: flex-end;
        gap: var(--na-space-xs);
    }
    .na-project-stage-plan__controls label {
        display: flex;
        min-width: 104px;
        flex-direction: column;
        gap: 2px;
    }
    .na-project-stage-plan__controls label:nth-of-type(2) {
        min-width: 150px;
    }
    .na-project-stage-plan__order {
        display: flex;
        gap: 2px;
    }
    @container nextaction-app (max-width: 720px) {
        .na-project-stage-plan__row {
            grid-template-columns: minmax(0, 1fr);
        }
        .na-project-stage-plan__controls {
            justify-content: flex-start;
            flex-wrap: wrap;
        }
    }
</style>
