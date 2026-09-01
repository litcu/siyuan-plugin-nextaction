<script lang="ts">
    import type { Snippet } from "svelte";
    import NaDialogHeader from "./NaDialogHeader.svelte";
    import NaDialogFooter from "./NaDialogFooter.svelte";

    export let title: string;
    export let subtitle = "";
    export let closeLabel: string;
    export let status = "";
    export let statusTone: "default" | "warning" | "error" = "default";
    export let variant: "drawer" | "dialog" = "drawer";
    export let showFooter = true;
    export let element: HTMLDivElement | undefined = undefined;
    export let onClose: () => void = () => {};
    export let headerActions: Snippet | undefined = undefined;
    export let notice: Snippet | undefined = undefined;
    export let footerStart: Snippet | undefined = undefined;
    export let footerEnd: Snippet | undefined = undefined;
    export let children: Snippet;
</script>

{#snippet wrappedHeaderActions()}
    <div>
        {#if headerActions}{@render headerActions()}{/if}
    </div>
{/snippet}

{#snippet wrappedFooterStart()}
    <div>
        {#if footerStart}{@render footerStart()}{/if}
    </div>
{/snippet}

{#snippet wrappedFooterEnd()}
    <div>
        {#if footerEnd}{@render footerEnd()}{/if}
    </div>
{/snippet}

<div
    bind:this={element}
    class="na-dialog-shell na-dialog-shell--{variant}"
    class:na-dialog-shell--with-footer={showFooter}
>
    <NaDialogHeader
        {title}
        {subtitle}
        {closeLabel}
        {status}
        {statusTone}
        {onClose}
        actions={headerActions ? wrappedHeaderActions : undefined}
    />
    {#if notice}<div class="na-dialog-shell__notice" aria-live="polite">{@render notice()}</div>{/if}
    <main class="na-dialog-shell__body">{@render children()}</main>
    {#if showFooter && (footerStart || footerEnd)}
        <NaDialogFooter
            start={footerStart ? wrappedFooterStart : undefined}
            end={footerEnd ? wrappedFooterEnd : undefined}
        />
    {/if}
</div>

<style lang="scss">
    .na-dialog-shell {
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr) auto;
        width: 100%;
        height: 100%;
        max-height: 100%;
        min-width: 0;
        min-height: 0;
        position: relative;
        box-sizing: border-box;
        overflow: hidden;
        color: var(--na-text-primary);
        background: var(--b3-theme-surface);
    }
    .na-dialog-shell__notice:empty {
        display: none;
    }
    .na-dialog-shell__notice {
        padding: 8px 16px 0;
        background: var(--b3-theme-surface);
    }
    .na-dialog-shell__body {
        position: relative;
        min-width: 0;
        min-height: 0;
        box-sizing: border-box;
        padding-bottom: 0;
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
    }
    .na-dialog-shell--with-footer .na-dialog-shell__body {
        padding-bottom: 72px;
    }
    :global(.na-dialog-shell .na-dialog-footer) {
        position: absolute;
        right: 0;
        bottom: 0;
        left: 0;
    }
</style>
