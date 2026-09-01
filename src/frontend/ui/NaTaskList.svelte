<script lang="ts">
    import type { Snippet } from "svelte";

    export let density: "regular" | "compact" = "regular";
    export let nested = false;
    export let element: HTMLElement | null = null;
    export let children: Snippet;
</script>

<div
    bind:this={element}
    class="na-task-list"
    class:na-task-list--compact={density === "compact"}
    class:na-task-list--nested={nested}
>
    {@render children()}
</div>

<style lang="scss">
    .na-task-list {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: var(--na-space-xs);
        min-width: 0;
        min-height: 0;
        padding: var(--na-space-md);
        overflow-y: auto;
    }
    .na-task-list--compact {
        gap: var(--na-space-xs);
        padding: var(--na-space-md);
    }
    .na-task-list--compact :global(.na-task-card) {
        border-radius: var(--na-radius-sm);
    }
    .na-task-list--nested {
        padding-top: 0;
    }
</style>
