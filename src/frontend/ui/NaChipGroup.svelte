<script lang="ts">
    import type { Snippet } from "svelte";

    export let children: Snippet;
</script>

<div class="na-chip-group">
    {@render children()}
</div>

<style lang="scss">
    .na-chip-group {
        display: flex;
        flex-wrap: wrap;
        gap: var(--na-space-xs);
        align-items: center;
    }
</style>
