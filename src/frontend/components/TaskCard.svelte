<script lang="ts">
    import type { TaskCacheEntry } from "../../shared/types";
    import StatusCheckbox from "./StatusCheckbox.svelte";
    import { normalizePriority, PRIORITY_COLORS } from "../constants";
    import { jumpToBlock, toI18nKey } from "../utils";
    import NaTooltip from "../ui/NaTooltip.svelte";
    import { taskStore } from "../stores/task-store";
    import DueDateLabel from "./DueDateLabel.svelte";
    import { getDuePresentation } from "../utils/time-boundary";
    import { parseRepeatState } from "../../shared/repeat";
    import { formatCustomFieldValue, isCustomFieldApplicable } from "../../shared/custom-fields";
    import NaIconButton from "../ui/NaIconButton.svelte";

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

    $: isInbox = task.status === "inbox";
    $: isBlocked = task.blocked;
    $: blockedText = task.blockedReason === "inbox"
        ? (i18n?.blockedByInbox || "Inbox - needs clarification")
        : task.blockedReason === "someday"
        ? (i18n?.blockedBySomeday || "Someday/Maybe")
        : task.blockedReason === "children"
        ? (i18n?.blockedByChildren || "Blocked - subtasks incomplete")
        : task.blockedReason === "sequential"
        ? (i18n?.blockedBySequence || "Blocked - waiting in sequence")
        : (i18n?.blockedByDependency || "Blocked - dependency incomplete");
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
    $: displayPriority = normalizePriority(task.priority);
    $: parentTitle = task.parentId
        ? ($taskStore.allTasks.find(t => t.blockId === task.parentId)?.title || i18n?.untitled || "(untitled)")
        : "";
    $: taskTitle = task.title || (i18n?.untitled || "(untitled)");
    $: compositeTitle = parentTitle && isRoot ? `${taskTitle} — ${parentTitle}` : taskTitle;

    $: priorityBorderColor = task.taskType !== "2" && displayPriority
        ? PRIORITY_COLORS[displayPriority] || ""
        : "";
    $: cardAccentColor = selected ? "var(--b3-theme-primary)" : (priorityBorderColor || "transparent");
    $: priorityTextColor = PRIORITY_COLORS[displayPriority] || "currentColor";
    $: priorityLabel = i18n?.[toI18nKey("priority", displayPriority)] || displayPriority;
    $: repeatState = parseRepeatState(task.repeatState);
    $: repeatStatus = repeatState?.status || (task.repeat ? "active" : "");
    $: repeatTooltip = repeatStatus === "paused"
        ? (i18n?.repeatPaused || "Repeat paused")
        : repeatStatus === "ended"
            ? (i18n?.repeatEnded || "Repeat ended")
            : `${i18n?.repeatNextOccurrence || "Next"}: ${repeatState?.currentDue || repeatState?.currentStart || task.due || task.start || "—"}`;
    $: customFieldMap = new Map($taskStore.allTasks.map(entry => [entry.blockId, entry]));
    $: cardCustomFields = ($taskStore.settings.customFields || [])
        .filter(def => def.showOnCard && isCustomFieldApplicable(def, task, customFieldMap) && !!task.customFields?.[def.key])
        .slice(0, 3);
    $: hiddenCustomFieldCount = Math.max(0, ($taskStore.settings.customFields || [])
        .filter(def => def.showOnCard && isCustomFieldApplicable(def, task, customFieldMap) && !!task.customFields?.[def.key]).length - cardCustomFields.length);

    function handleOverdueChange(event: CustomEvent<{ isOverdue: boolean }>): void {
        isOverdue = !isDone && event.detail.isOverdue;
    }

    function handleToggleCollapse(event: MouseEvent): void {
        event.stopPropagation();
        onToggleCollapse?.();
    }

    function handleJump(event: MouseEvent): void {
        event.stopPropagation();
        jumpToBlock(task.blockId);
    }
</script>

<div
    class="na-task-card"
    class:na-task-card--root={isRoot}
    class:na-task-card--child={!isRoot}
    class:na-task-card--project={task.taskType === "2"}
    class:na-task-card--blocked={isBlocked && task.taskType !== "2"}
    class:overdue={isOverdue}
    class:na-task-card--done={isDone}
    class:na-task-card--waiting={isWaiting}
    class:na-task-card--someday={isSomeday}
    class:selected={selected}
    style="--na-task-card-accent: {cardAccentColor}"
    on:click={() => { if (onSelect) onSelect(task); }}
    on:contextmenu|preventDefault={(e) => onContextMenu(task, e)}
>
    <div class="na-task-card__content">
        <StatusCheckbox status={task.status} onclick={(e) => onStatusClick(task, e)} />
        <div class="na-task-card__body" on:click|stopPropagation={() => onEdit(task)}>
            <div class="na-task-card__title-row">
                {#if task.taskType === "2"}
                    <span class="na-task-card__project-icon" title={i18n?.project || "Project"}>
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h5l1 1h5v9H2z"/></svg>
                    </span>
                {/if}
                <span
                    class="na-task-card__title-composite"
                    class:na-task-card__title-composite--has-parent={Boolean(parentTitle && isRoot)}
                    title={compositeTitle}
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
                {#if priorityLabel}
                    <span
                        class="na-task-card__priority"
                        style="--na-task-priority-color: {priorityTextColor}"
                        title={priorityLabel}
                    >
                        <span class="na-task-card__priority-dot" aria-hidden="true"></span>
                        <span>{priorityLabel}</span>
                    </span>
                {/if}
            </div>
            <div class="na-task-card__meta">
                <div class="na-task-card__meta-cluster">
                    {#if task.due && !isDone}
                        <DueDateLabel due={task.due} {i18n} on:overduechange={handleOverdueChange} />
                    {/if}
                    {#if isBlocked && task.taskType !== "2"}
                        <span class="na-task-card__blocked-badge" title={blockedText}>
                            {blockedText}
                        </span>
                    {/if}
                    {#if task.repeat}
                        <span class="na-task-card__icon na-task-card__icon--repeat na-task-card__icon--repeat-{repeatStatus}" title={repeatTooltip}>
                            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="miter">
                                <path d="M2.5 8a5.5 5.5 0 0 1 9.3-3.9"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="5" x2="9" y2="5"/>
                                <path d="M13.5 8a5.5 5.5 0 0 1-9.3 3.9"/><line x1="4" y1="14" x2="4" y2="11"/><line x1="4" y1="11" x2="7" y2="11"/>
                            </svg>
                        </span>
                    {/if}
                    {#if task.reviewInterval > 0}
                        <span class="na-task-card__icon na-task-card__icon--review" title="{i18n?.reviewIntervalTooltip || 'Review every'} {task.reviewInterval} {i18n?.days || 'days'}">
                            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="2" y="3" width="12" height="11" rx="1.5"/>
                                <line x1="2" y1="6.5" x2="14" y2="6.5"/>
                                <line x1="5.5" y1="1.5" x2="5.5" y2="4"/>
                                <line x1="10.5" y1="1.5" x2="10.5" y2="4"/>
                            </svg>
                        </span>
                    {/if}
                    {#if task.context}
                        <span class="na-task-card__context">@{task.context.replace(/\|/g, ', ')}</span>
                    {/if}
                    {#if task.tags}
                        <span class="na-task-card__tags">{task.tags.replace(/\|/g, ', ')}</span>
                    {/if}
                    {#if cardCustomFields.length > 0}
                        {#each cardCustomFields as def}
                            <span class="na-task-card__custom-field">{def.label}: {formatCustomFieldValue(def, task.customFields?.[def.key])}</span>
                        {/each}
                        {#if hiddenCustomFieldCount > 0}<span class="na-task-card__custom-field na-task-card__custom-field--more">+{hiddenCustomFieldCount}</span>{/if}
                    {/if}
                    {#if isCollapsed && childCount > 0}
                        <span class="na-task-card__child-count">▸ {(i18n?.childCount || "{n} subtasks").replace("{n}", String(childCount))}</span>
                    {/if}
                </div>
                <span class="na-task-card__stats">
                    <span class="na-task-card__stat-item na-task-card__stat-item--importance" title={i18n?.importance || "Importance"}>
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" stroke="none"><path d="M8 1l2.2 4.5 5 .7-3.6 3.5.8 5L8 12.4 3.6 14.7l.8-5L.8 6.2l5-.7z"/></svg>{task.importance ?? 4}
                    </span>
                    <span class="na-task-card__stat-item na-task-card__stat-item--effort" title={i18n?.effort || "Effort"}>
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" stroke="none"><circle cx="8" cy="8" r="3.5"/><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>{task.effort ?? 4}
                    </span>
                </span>
            </div>
        </div>
        <div class="na-task-card__actions" on:pointerdown|stopPropagation>
            {#if isInbox && onActivate}
                <button
                    class="na-task-card__activate-btn"
                    on:click|stopPropagation={() => {
                        if (onActivate) onActivate(task);
                    }}
                    title={i18n?.clarify || "Clarify"}
                >
                    {i18n?.clarify || "Clarify"}
                </button>
            {/if}
            {#if isSomeday && onActivate}
                <button
                    class="na-task-card__activate-btn"
                    on:click|stopPropagation={() => {
                        if (onActivate) onActivate(task);
                    }}
                    title={i18n?.activate || "Activate"}
                >
                    {i18n?.activate || "Activate"}
                </button>
            {/if}
            {#if task.note}
                <span class="na-task-card__note-icon" title="">
                    <NaTooltip text={task.note}>
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 1.5h7l3.5 3.5v9.5a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z"/>
                            <polyline points="10 1.5 10 5 13.5 5"/>
                            <line x1="5" y1="8" x2="11" y2="8"/>
                            <line x1="5" y1="10.5" x2="9" y2="10.5"/>
                        </svg>
                    </NaTooltip>
                </span>
            {/if}
            {#if hasChildren}
                <NaIconButton
                    compact
                    symbol={isCollapsed ? "iconExpand" : "iconContract"}
                    label={isCollapsed ? (i18n?.expandChildren || "Expand") : (i18n?.collapseChildren || "Collapse")}
                    on:click={handleToggleCollapse}
                />
            {/if}
            <NaIconButton
                compact
                symbol="iconOpenWindow"
                label={i18n?.jumpToBlock || "Jump to Block"}
                on:click={handleJump}
            />
        </div>
    </div>
</div>
