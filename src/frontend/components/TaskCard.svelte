<script lang="ts">
    import type { TaskCacheEntry } from "../../shared/types";
    import StatusCheckbox from "./StatusCheckbox.svelte";
    import { normalizePriority, PRIORITY_COLORS } from "../constants";
    import { jumpToBlock, toI18nKey } from "../utils";
    import NaTooltip from "../ui/NaTooltip.svelte";
    import { taskById, taskStore } from "../stores/task-store";
    import DueDateLabel from "./DueDateLabel.svelte";
    import { getDuePresentation } from "../utils/time-boundary";
    import { parseRepeatState } from "../../shared/repeat";
    import { formatCustomFieldValue, isCustomFieldApplicable } from "../../shared/custom-fields";
    import NaIconButton from "../ui/NaIconButton.svelte";
    import { isProjectTask } from "../../shared/project-domain";

    export let task: TaskCacheEntry;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;
    export let selected: boolean = false;
    export let onSelect: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let hasChildren = false;
    export let isCollapsed = false;
    export let childCount = 0;
    export let onToggleCollapse: (() => void) | undefined = undefined;
    export let onActivate: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let isRoot = true;
    export let completedOverride: boolean | undefined = undefined;
    export let managedFocus = false;

    $: isInbox = task.status === "inbox";
    $: isBlocked = task.blocked;
    $: blockedText =
        task.blockedReason === "inbox"
            ? i18n?.blockedByInbox || "Inbox - needs clarification"
            : task.blockedReason === "someday"
              ? i18n?.blockedBySomeday || "Someday/Maybe"
              : task.blockedReason === "children"
                ? i18n?.blockedByChildren || "Blocked - subtasks incomplete"
                : task.blockedReason === "sequential"
                  ? i18n?.blockedBySequence || "Blocked - waiting in sequence"
                  : i18n?.blockedByDependency || "Blocked - dependency incomplete";
    $: isDone = completedOverride ?? task.status === "done";
    let isOverdue = false;
    let overdueSourceKey = "";
    $: {
        const nextOverdueSourceKey = `${task.due}|${isDone}`;
        if (nextOverdueSourceKey !== overdueSourceKey) {
            overdueSourceKey = nextOverdueSourceKey;
            isOverdue = !isDone && !!task.due && getDuePresentation(task.due, Date.now()).isOverdue;
        }
    }
    $: isWaiting = task.status === "waiting";
    $: isSomeday = task.status === "someday";
    $: isProject = isProjectTask(task);
    $: isStage = !isProject && task.actionKind === "stage";
    $: displayPriority = normalizePriority(task.priority);
    $: parentTitle = task.parentId ? $taskById.get(task.parentId)?.title || i18n?.untitled || "(untitled)" : "";
    $: taskTitle = task.title || i18n?.untitled || "(untitled)";
    $: compositeTitle = parentTitle && isRoot ? `${taskTitle} — ${parentTitle}` : taskTitle;

    $: priorityBorderColor = !isProject && displayPriority ? PRIORITY_COLORS[displayPriority] || "" : "";
    $: cardAccentColor = selected ? "var(--b3-theme-primary)" : priorityBorderColor || "transparent";
    $: priorityTextColor = PRIORITY_COLORS[displayPriority] || "currentColor";
    $: priorityLabel = i18n?.[toI18nKey("priority", displayPriority)] || displayPriority;
    $: repeatState = parseRepeatState(task.repeatState);
    $: repeatStatus = repeatState?.status || (task.repeat ? "active" : "");
    $: repeatTooltip =
        repeatStatus === "paused"
            ? i18n?.repeatPaused || "Repeat paused"
            : repeatStatus === "ended"
              ? i18n?.repeatEnded || "Repeat ended"
              : `${i18n?.repeatNextOccurrence || "Next"}: ${repeatState?.currentDue || repeatState?.currentStart || task.due || task.start || "—"}`;
    $: applicableCardCustomFields = ($taskStore.settings.customFields || []).filter(
        (def) => def.showOnCard && isCustomFieldApplicable(def, task, $taskById) && !!task.customFields?.[def.key],
    );
    $: cardCustomFields = applicableCardCustomFields.slice(0, 3);
    $: hiddenCustomFieldCount = Math.max(0, applicableCardCustomFields.length - cardCustomFields.length);
    $: hasCardMetadata = Boolean(
        (task.due && !isDone) ||
        (isBlocked && !isProject) ||
        task.repeat ||
        task.reviewInterval > 0 ||
        task.context ||
        task.tags ||
        cardCustomFields.length > 0 ||
        (isCollapsed && childCount > 0),
    );

    function handleOverdueChange(event: CustomEvent<{ isOverdue: boolean }>): void {
        isOverdue = !isDone && event.detail.isOverdue;
    }

    function handleToggleCollapse(event: MouseEvent): void {
        event.stopPropagation();
        onToggleCollapse?.();
    }

    function handleJump(event: MouseEvent): void {
        event.stopPropagation();
        jumpToBlock(task.contentBlockId || task.blockId);
    }
</script>

<div
    class="na-task-card"
    class:na-task-card--root={isRoot}
    class:na-task-card--child={!isRoot}
    class:na-task-card--project={isProject}
    class:na-task-card--blocked={isBlocked && !isProject}
    class:overdue={isOverdue}
    class:na-task-card--done={isDone}
    class:na-task-card--waiting={isWaiting}
    class:na-task-card--someday={isSomeday}
    class:selected
    style="--na-task-card-accent: {cardAccentColor}"
    role="button"
    tabindex={managedFocus ? -1 : 0}
    on:click={() => {
        if (onSelect) onSelect(task);
    }}
    on:keydown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect?.(task);
    }}
    on:contextmenu|preventDefault={(e) => onContextMenu(task, e)}
>
    <div class="na-task-card__content">
        <StatusCheckbox status={task.status} onclick={(e) => onStatusClick(task, e)} focusable={!managedFocus} />
        <div
            class="na-task-card__body"
            class:na-task-card__body--metadata-empty={!hasCardMetadata}
            role="button"
            tabindex={managedFocus ? -1 : 0}
            on:click|stopPropagation={() => onEdit(task)}
            on:keydown|stopPropagation={(event) => {
                if (event.key === "Enter" || event.key === " ") onEdit(task);
            }}
        >
            <div class="na-task-card__title-row">
                {#if isProject}
                    <NaTooltip text={i18n?.project || "Project"}>
                        <span class="na-task-card__project-icon">
                            <svg
                                viewBox="0 0 16 16"
                                width="12"
                                height="12"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.3"
                                stroke-linecap="round"
                                stroke-linejoin="round"><path d="M2 3h5l1 1h5v9H2z" /></svg
                            >
                        </span>
                    </NaTooltip>
                {/if}
                {#if isStage}<span class="na-task-card__kind">{i18n?.actionKindStage || "Stage"}</span>{/if}
                <NaTooltip text={compositeTitle} fill>
                    <span
                        class="na-task-card__title-composite"
                        class:na-task-card__title-composite--has-parent={Boolean(parentTitle && isRoot)}
                    >
                        <span class="na-task-card__title" class:untitled={!task.title}>
                            {taskTitle}
                        </span>
                        {#if parentTitle && isRoot}
                            <span class="na-task-card__parent-context">
                                <span class="na-task-card__parent-separator" aria-hidden="true">—</span>
                                <span class="na-task-card__parent-title">{parentTitle}</span>
                            </span>
                        {/if}
                    </span>
                </NaTooltip>
                {#if priorityLabel}
                    <NaTooltip text={priorityLabel}>
                        <span class="na-task-card__priority" style="--na-task-priority-color: {priorityTextColor}">
                            <span class="na-task-card__priority-dot" aria-hidden="true"></span>
                            <span>{priorityLabel}</span>
                        </span>
                    </NaTooltip>
                {/if}
            </div>
            <div class="na-task-card__meta">
                <div class="na-task-card__meta-cluster">
                    {#if task.due && !isDone}
                        <DueDateLabel due={task.due} {i18n} on:overduechange={handleOverdueChange} />
                    {/if}
                    {#if isBlocked && !isProject}
                        <NaTooltip text={blockedText}
                            ><span class="na-task-card__blocked-badge">{blockedText}</span></NaTooltip
                        >
                    {/if}
                    {#if task.repeat}
                        <NaTooltip text={repeatTooltip}>
                            <span
                                class="na-task-card__icon na-task-card__icon--repeat na-task-card__icon--repeat-{repeatStatus}"
                            >
                                <svg
                                    viewBox="0 0 16 16"
                                    width="12"
                                    height="12"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.3"
                                    stroke-linecap="round"
                                    stroke-linejoin="miter"
                                >
                                    <path d="M2.5 8a5.5 5.5 0 0 1 9.3-3.9" /><line x1="12" y1="2" x2="12" y2="5" /><line
                                        x1="12"
                                        y1="5"
                                        x2="9"
                                        y2="5"
                                    />
                                    <path d="M13.5 8a5.5 5.5 0 0 1-9.3 3.9" /><line
                                        x1="4"
                                        y1="14"
                                        x2="4"
                                        y2="11"
                                    /><line x1="4" y1="11" x2="7" y2="11" />
                                </svg>
                            </span>
                        </NaTooltip>
                    {/if}
                    {#if task.reviewInterval > 0}
                        <NaTooltip
                            text="{i18n?.reviewIntervalTooltip || 'Review every'} {task.reviewInterval} {i18n?.days ||
                                'days'}"
                        >
                            <span class="na-task-card__icon na-task-card__icon--review">
                                <svg
                                    viewBox="0 0 16 16"
                                    width="12"
                                    height="12"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.3"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                >
                                    <rect x="2" y="3" width="12" height="11" rx="1.5" />
                                    <line x1="2" y1="6.5" x2="14" y2="6.5" />
                                    <line x1="5.5" y1="1.5" x2="5.5" y2="4" />
                                    <line x1="10.5" y1="1.5" x2="10.5" y2="4" />
                                </svg>
                            </span>
                        </NaTooltip>
                    {/if}
                    {#if task.context}
                        <span class="na-task-card__context">@{task.context.replace(/\|/g, ", ")}</span>
                    {/if}
                    {#if task.tags}
                        <span class="na-task-card__tags">{task.tags.replace(/\|/g, ", ")}</span>
                    {/if}
                    {#if cardCustomFields.length > 0}
                        {#each cardCustomFields as def}
                            <span class="na-task-card__custom-field"
                                >{def.label}: {formatCustomFieldValue(def, task.customFields?.[def.key])}</span
                            >
                        {/each}
                        {#if hiddenCustomFieldCount > 0}<span
                                class="na-task-card__custom-field na-task-card__custom-field--more"
                                >+{hiddenCustomFieldCount}</span
                            >{/if}
                    {/if}
                    {#if isCollapsed && childCount > 0}
                        <span class="na-task-card__child-count"
                            >▸ {(i18n?.childCount || "{n} subtasks").replace("{n}", String(childCount))}</span
                        >
                    {/if}
                </div>
                <span class="na-task-card__stats">
                    <NaTooltip text={i18n?.importance || "Importance"}>
                        <span class="na-task-card__stat-item na-task-card__stat-item--importance">
                            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" stroke="none"
                                ><path d="M8 1l2.2 4.5 5 .7-3.6 3.5.8 5L8 12.4 3.6 14.7l.8-5L.8 6.2l5-.7z" /></svg
                            >{task.importance ?? 4}
                        </span>
                    </NaTooltip>
                    <NaTooltip text={i18n?.effort || "Effort"}>
                        <span class="na-task-card__stat-item na-task-card__stat-item--effort">
                            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" stroke="none"
                                ><circle cx="8" cy="8" r="3.5" /><circle
                                    cx="8"
                                    cy="8"
                                    r="6.5"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.2"
                                /></svg
                            >{task.effort ?? 4}
                        </span>
                    </NaTooltip>
                </span>
            </div>
        </div>
        <div class="na-task-card__actions" on:pointerdown|stopPropagation>
            {#if isInbox && onActivate}
                <button
                    class="na-task-card__activate-btn"
                    tabindex={managedFocus ? -1 : 0}
                    on:click|stopPropagation={() => {
                        if (onActivate) onActivate(task);
                    }}
                >
                    {i18n?.clarify || "Clarify"}
                </button>
            {/if}
            {#if isSomeday && onActivate}
                <button
                    class="na-task-card__activate-btn"
                    tabindex={managedFocus ? -1 : 0}
                    on:click|stopPropagation={() => {
                        if (onActivate) onActivate(task);
                    }}
                >
                    {i18n?.activate || "Activate"}
                </button>
            {/if}
            {#if task.note}
                <span class="na-task-card__note-icon">
                    <NaTooltip text={task.note}>
                        <svg
                            viewBox="0 0 16 16"
                            width="12"
                            height="12"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.3"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M3 1.5h7l3.5 3.5v9.5a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z" />
                            <polyline points="10 1.5 10 5 13.5 5" />
                            <line x1="5" y1="8" x2="11" y2="8" />
                            <line x1="5" y1="10.5" x2="9" y2="10.5" />
                        </svg>
                    </NaTooltip>
                </span>
            {/if}
            {#if hasChildren}
                <NaIconButton
                    compact
                    tabIndex={managedFocus ? -1 : undefined}
                    symbol={isCollapsed ? "iconExpand" : "iconContract"}
                    label={isCollapsed ? i18n?.expandChildren || "Expand" : i18n?.collapseChildren || "Collapse"}
                    on:click={handleToggleCollapse}
                />
            {/if}
            <NaIconButton
                compact
                tabIndex={managedFocus ? -1 : undefined}
                symbol="iconOpenWindow"
                label={i18n?.jumpToBlock || "Jump to Block"}
                on:click={handleJump}
            />
        </div>
    </div>
</div>
