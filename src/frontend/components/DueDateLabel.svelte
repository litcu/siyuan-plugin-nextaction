<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { registerDueTime, timeBoundaryStore } from "../stores/time-boundary-store";
    import { formatDueDate, getDuePresentation } from "../utils/time-boundary";

    interface Props {
        due: string;
        i18n: any;
        onOverdueChange?: (isOverdue: boolean) => void;
    }

    let { due, i18n, onOverdueChange }: Props = $props();

    let mounted = $state(false);
    let registeredDue = $state("");
    let unregisterDue: (() => void) | null = $state(null);
    let lastOverdue: boolean | null = $state(null);

    let presentation = $derived(getDuePresentation(due, $timeBoundaryStore));
    let label = $derived(formatDueDate(due, $timeBoundaryStore, i18n));

    $effect(() => {
        if (presentation.isOverdue !== lastOverdue) {
            lastOverdue = presentation.isOverdue;
            onOverdueChange?.(presentation.isOverdue);
        }
    });

    $effect(() => {
        if (mounted && due !== registeredDue) {
            unregisterDue?.();
            registeredDue = due;
            unregisterDue = registerDueTime(due);
        }
    });

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

<span class="na-task-card__due" class:overdue={presentation.isOverdue} class:due-soon={presentation.isDueSoon}>
    {label}
</span>
