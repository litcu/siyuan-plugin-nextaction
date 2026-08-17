<script lang="ts">
    export let compact = false;
    export let wrap = true;
</script>

<div class="na-toolbar" class:na-toolbar--compact={compact} class:na-toolbar--nowrap={!wrap}>
    <div class="na-toolbar__main">
        <slot />
        {#if $$slots.actions}<div class="na-toolbar__actions-content"><slot name="actions" /></div>{/if}
    </div>
</div>

<style lang="scss">
    .na-toolbar {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm);
        min-width: 0;
        padding: var(--na-space-md) var(--na-space-lg);
        border-bottom: 1px solid var(--na-color-divider);
        background: var(--b3-theme-surface);
        flex-wrap: wrap;
    }
    .na-toolbar--compact {
        padding-block: var(--na-space-sm);
    }
    .na-toolbar--nowrap {
        flex-wrap: nowrap;
    }
    .na-toolbar__main {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm);
        min-width: 0;
        width: 100%;
        flex: 1 1 auto;
    }
    .na-toolbar__actions-content,
    .na-toolbar__main :global(.na-toolbar__actions-content) {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm);
        min-width: 0;
        margin-left: auto;
    }
    @container nextaction-app (max-width: 520px) {
        .na-toolbar {
            padding-inline: var(--na-space-md);
        }
        .na-toolbar__main {
            flex-basis: 100%;
        }
        .na-toolbar__actions-content,
        .na-toolbar__main :global(.na-toolbar__actions-content) {
            margin-left: 0;
        }
    }
</style>
