<script lang="ts">
    import type { Snippet } from "svelte";

    export let start: Snippet | undefined = undefined;
    export let end: Snippet | undefined = undefined;
</script>

<footer class="na-dialog-footer">
    {#if start}<div class="na-dialog-footer__start">{@render start()}</div>{/if}
    {#if end}<div class="na-dialog-footer__end">{@render end()}</div>{/if}
</footer>

<style lang="scss">
    .na-dialog-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-width: 0;
        min-height: 52px;
        padding: 10px 16px max(10px, env(safe-area-inset-bottom));
        box-sizing: border-box;
        border-top: 1px solid var(--b3-border-color);
        background: var(--na-color-panel-header);
        position: relative;
        z-index: 2;
    }
    .na-dialog-footer__start,
    .na-dialog-footer__end {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }
    .na-dialog-footer__end {
        justify-content: flex-end;
        margin-left: auto;
    }
    @media (max-width: 360px) {
        .na-dialog-footer {
            gap: 8px;
            padding: 8px 10px;
        }
        .na-dialog-footer__start,
        .na-dialog-footer__end {
            gap: 5px;
        }
    }
</style>
