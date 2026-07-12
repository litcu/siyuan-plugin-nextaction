<script lang="ts">
    import type { TaskCacheEntry, ReviewData } from "../../shared/types";
    import TaskCard from "./TaskCard.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";

    export let reviewData: ReviewData;
    export let i18n: any;
    export let selectedTaskId: string;
    export let onSelectTask: (task: TaskCacheEntry) => void;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;

    const checklistItems = [
        { key: "overdue", label: i18n?.reviewOverdue || "Overdue Tasks", hint: i18n?.reviewHintOverdue || "Adjust due dates or reflect on why they're overdue", icon: "overdue" },
        { key: "nextActions", label: i18n?.reviewNextActions || "Next Actions", hint: i18n?.reviewHintNext || "Are these still the most important actions? Any gaps?", icon: "next" },
        { key: "inbox", label: i18n?.reviewInbox || "Inbox", hint: i18n?.reviewHintInbox || "Clarify each item: is it actionable? What's the next step?", icon: "inbox" },
        { key: "waiting", label: i18n?.reviewWaiting || "Waiting Tasks", hint: i18n?.reviewHintWaiting || "Are waiting conditions met? Need to follow up?", icon: "waiting" },
        { key: "someday", label: i18n?.reviewSomeday || "Someday / Maybe", hint: i18n?.reviewHintSomeday || "Any task ready to activate or should be removed?", icon: "someday" },
        { key: "projects", label: i18n?.reviewProjects || "Project Progress", hint: i18n?.reviewHintProjects || "Is each project on track with a clear next action?", icon: "project" },
    ];

    let expandedKey: string | null = null;

    function getTasks(key: string): TaskCacheEntry[] {
        switch (key) {
            case "overdue": return reviewData.overdueTasks;
            case "nextActions": return reviewData.nextActions;
            case "inbox": return reviewData.inboxTasks;
            case "waiting": return reviewData.waitingTasks;
            case "someday": return reviewData.somedayTasks;
            case "projects": return reviewData.activeProjects;
            default: return [];
        }
    }

    function toggleExpand(key: string) {
        expandedKey = expandedKey === key ? null : key;
    }
</script>

<div class="na-review-guide">
    {#each checklistItems as item (item.key)}
        {@const tasks = getTasks(item.key)}
        {@const count = tasks.length}
        <div class="na-review-guide__card">
            <button class="na-review-guide__header" on:click={() => toggleExpand(item.key)}>
                <span class="na-review-guide__icon">
                    {#if item.icon === "overdue"}
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="8" cy="8" r="6.5"/>
                            <polyline points="8 4.5 8 8 10.5 9.5"/>
                        </svg>
                    {:else if item.icon === "next"}
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M8 2L8 8L3 8"/><path d="M8 8L13 8"/><path d="M8 8L8 14"/>
                        </svg>
                    {:else if item.icon === "inbox"}
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M2 3h12l-2 4.5H4z"/><line x1="5.5" y1="7.5" x2="5.5" y2="10"/><line x1="10.5" y1="7.5" x2="10.5" y2="10"/><path d="M4 7.5L2 13h12l-2-5.5"/>
                        </svg>
                    {:else if item.icon === "waiting"}
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="8" cy="8" r="6"/>
                            <polyline points="8 4 8 8 11 10"/>
                        </svg>
                    {:else if item.icon === "someday"}
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M8 1a4 4 0 0 0-2.4 7.2V10h4.8V8.2A4 4 0 0 0 8 1z"/>
                            <line x1="5.5" y1="12" x2="10.5" y2="12"/>
                            <line x1="6.5" y1="14" x2="9.5" y2="14"/>
                        </svg>
                    {:else if item.icon === "project"}
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M1.5 2.5h5l1.5 1.5h5.5v9.5h-12z"/>
                        </svg>
                    {/if}
                </span>
                <span class="na-review-guide__label">{item.label}</span>
                <span class="na-review-guide__hint">{item.hint}</span>
                <span class="na-review-guide__count">{count}</span>
                <span class="na-review-guide__arrow" class:expanded={expandedKey === item.key}>
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="4 6 8 10 12 6"/>
                    </svg>
                </span>
            </button>
            {#if expandedKey === item.key}
                <div class="na-review-guide__body">
                    {#if tasks.length === 0}
                        <NaEmpty text={i18n?.noTasks || "No tasks"} />
                    {:else}
                        {#each tasks as task (task.blockId)}
                            <TaskCard
                                {task}
                                selected={task.blockId === selectedTaskId}
                                onSelect={onSelectTask}
                                {onEdit}
                                {onStatusClick}
                                {onContextMenu}
                                {i18n}
                            />
                        {/each}
                    {/if}
                </div>
            {/if}
        </div>
    {/each}
</div>

<style lang="scss">
    .na-review-guide {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-sm);
    }

    .na-review-guide__card {
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        overflow: hidden;
    }

    .na-review-guide__header {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm);
        width: 100%;
        padding: var(--na-space-md) var(--na-space-lg);
        border: none;
        background: none;
        color: var(--b3-theme-on-background);
        cursor: pointer;
        font-size: var(--na-font-size-md);
        font-weight: 500;
        text-align: left;
        transition: background 0.15s;

        &:hover {
            background: var(--b3-theme-surface-light);
        }
    }

    .na-review-guide__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--b3-theme-on-surface-secondary);
    }

    .na-review-guide__label {
        flex-shrink: 0;
    }

    .na-review-guide__hint {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface-tertiary);
        text-align: right;
    }

    .na-review-guide__count {
        font-variant-numeric: tabular-nums;
        color: var(--b3-theme-on-surface-secondary);
        font-size: var(--na-font-size-sm);
        background: var(--b3-theme-surface-light);
        padding: 1px 6px;
        border-radius: var(--na-radius-pill);
        min-width: 20px;
        text-align: center;
    }

    .na-review-guide__arrow {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--b3-theme-on-surface-tertiary);
        transition: transform 0.2s;

        &.expanded {
            transform: rotate(180deg);
        }
    }

    .na-review-guide__body {
        padding: var(--na-space-xs) var(--na-space-md) var(--na-space-md);
        display: flex;
        flex-direction: column;
        gap: var(--na-space-xs);
    }
</style>
