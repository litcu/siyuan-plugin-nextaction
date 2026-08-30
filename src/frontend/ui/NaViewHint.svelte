<script lang="ts">
    export let text: string = "";
</script>

{#if text}
    <div class="na-view-hint">{text}</div>
{/if}

<style lang="scss">
    .na-view-hint {
        flex-shrink: 0;
        padding: var(--na-space-sm, 8px) var(--na-space-lg, 12px);
        font-size: var(--na-font-size-xs, 11px);
        line-height: 1.5;
        color: var(--na-text-secondary);
        text-align: center;
    }
</style>
