<script lang="ts">
    import { createEventDispatcher } from "svelte";

    export let open = false;
    export let label: string;

    const dispatch = createEventDispatcher<{ requestClose: "backdrop" | "escape" }>();

    function handleKeydown(event: KeyboardEvent) {
        if (!open || event.key !== "Escape" || event.defaultPrevented) return;
        const dialogs = (window as any).siyuan?.dialogs;
        if (Array.isArray(dialogs) && dialogs.length > 0) return;
        event.preventDefault();
        dispatch("requestClose", "escape");
    }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
    <button class="na-drawer-host__backdrop" aria-label={label} on:click={() => dispatch("requestClose", "backdrop")}
    ></button>
{/if}
<aside class="na-drawer-host" class:na-drawer-host--open={open} aria-hidden={!open}>
    <slot />
</aside>

<style lang="scss">
    .na-drawer-host {
        position: absolute;
        inset: 0 0 0 auto;
        z-index: 21;
        width: min(440px, 100%);
        height: 100%;
        max-width: 100%;
        min-height: 0;
        box-sizing: border-box;
        overflow: hidden;
        border-left: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        box-shadow: var(--b3-dialog-shadow);
        transform: translateX(100%);
        transition: transform 180ms cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
    }
    .na-drawer-host--open {
        transform: translateX(0);
        pointer-events: auto;
    }
    .na-drawer-host__backdrop {
        position: absolute;
        inset: 0;
        z-index: 20;
        padding: 0;
        border: 0;
        background: var(--na-color-overlay-bg);
    }
    @media (max-width: 520px) {
        .na-drawer-host {
            width: 100%;
            border-left: 0;
        }
    }
</style>
