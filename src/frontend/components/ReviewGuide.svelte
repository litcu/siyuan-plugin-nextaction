<script lang="ts">
    import type { TaskCacheEntry, ReviewData } from "../../shared/types";
    import NaAccordion from "../ui/NaAccordion.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import NaIcon from "../ui/NaIcon.svelte";
    import TaskCard from "./TaskCard.svelte";

    export let reviewData: ReviewData;
    export let i18n: any;
    export let selectedTaskId: string;
    export let onSelectTask: (task: TaskCacheEntry) => void;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;

    $: checklistItems = [
        {
            key: "overdue",
            label: i18n?.reviewOverdue || "Overdue Tasks",
            hint: i18n?.reviewHintOverdue || "Adjust due dates or reflect on why they're overdue",
            icon: "iconClock",
        },
        {
            key: "nextActions",
            label: i18n?.reviewNextActions || "Next Actions",
            hint: i18n?.reviewHintNext || "Are these still the most important actions? Any gaps?",
            icon: "iconListItem",
        },
        {
            key: "inbox",
            label: i18n?.reviewInbox || "Inbox",
            hint: i18n?.reviewHintInbox || "Clarify each item: is it actionable? What's the next step?",
            icon: "iconInbox",
        },
        {
            key: "waiting",
            label: i18n?.reviewWaiting || "Waiting Tasks",
            hint: i18n?.reviewHintWaiting || "Are waiting conditions met? Need to follow up?",
            icon: "iconClock",
        },
        {
            key: "someday",
            label: i18n?.reviewSomeday || "Someday / Maybe",
            hint: i18n?.reviewHintSomeday || "Any task ready to activate or should be removed?",
            icon: "iconLight",
        },
    ];
    let expandedKey: string | null = null;
    function getTasks(key: string, data: ReviewData): TaskCacheEntry[] {
        if (key === "overdue") return data.overdueTasks;
        if (key === "nextActions") return data.nextActions;
        if (key === "inbox") return data.inboxTasks;
        if (key === "waiting") return data.waitingTasks;
        if (key === "someday") return data.somedayTasks;
        return [];
    }
</script>

<div class="na-review-guide">
    {#each checklistItems as item (item.key)}
        {@const tasks = getTasks(item.key, reviewData)}
        <NaAccordion
            title={item.label}
            description={item.hint}
            icon={item.icon}
            count={tasks.length}
            tone={item.key === "overdue" && tasks.length > 0 ? "danger" : "default"}
            open={expandedKey === item.key}
            variant="plain"
            onOpenChange={(open) => (expandedKey = open ? item.key : null)}
        >
            {#if tasks.length === 0}<NaEmpty text={i18n?.noTasks || "No tasks"} />{:else}<div
                    class="na-review-guide__tasks"
                >
                    {#each tasks as task (task.blockId)}<TaskCard
                            {task}
                            selected={task.blockId === selectedTaskId}
                            onSelect={onSelectTask}
                            {onEdit}
                            {onStatusClick}
                            {onContextMenu}
                            {i18n}
                        />{/each}
                </div>{/if}
        </NaAccordion>
    {/each}
</div>

<style lang="scss">
    .na-review-guide {
        display: flex;
        flex-direction: column;
    }
    .na-review-guide__tasks {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-xs);
    }
    :global(.na-review-guide .na-accordion__icon) {
        color: var(--na-text-interactive);
    }
</style>
