<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import { registerDueTime, timeBoundaryStore } from "../stores/time-boundary-store";
    import { formatDueDate, getDuePresentation } from "../utils/time-boundary";

    export let due: string;
    export let i18n: any;

    const dispatch = createEventDispatcher<{ overduechange: { isOverdue: boolean } }>();
    let mounted = false;
    let registeredDue = "";
    let unregisterDue: (() => void) | null = null;
    let lastOverdue: boolean | null = null;

    $: presentation = getDuePresentation(due, $timeBoundaryStore);
    $: label = formatDueDate(due, $timeBoundaryStore, i18n);

    $: if (presentation.isOverdue !== lastOverdue) {
        lastOverdue = presentation.isOverdue;
        dispatch("overduechange", { isOverdue: presentation.isOverdue });
    }

    $: if (mounted && due !== registeredDue) {
        unregisterDue?.();
        registeredDue = due;
        unregisterDue = registerDueTime(due);
    }

    onMount(() => {
        mounted = true;
        registeredDue = due;
        unregisterDue = registerDueTime(due);
    });

    onDestroy(() => {
        unregisterDue?.();
        unregisterDue = null;
    });
</script>

<span
    class="na-task-card__due"
    class:overdue={presentation.isOverdue}
    class:due-soon={presentation.isDueSoon}
>
    {label}
</span>
