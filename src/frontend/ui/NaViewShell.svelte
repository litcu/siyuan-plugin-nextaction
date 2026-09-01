<script lang="ts">
    import type { Snippet } from "svelte";
    import NaEmpty from "./NaEmpty.svelte";
    import NaViewHint from "./NaViewHint.svelte";

    export let loading = false;
    export let empty = false;
    export let emptyText = "";
    export let emptyAction: { label: string; onClick: () => void } | undefined = undefined;
    export let hint = "";
    export let scrollMode: "content" | "none" = "content";
    export let toolbar: Snippet | undefined = undefined;
    export let children: Snippet;
</script>

<div class="na-view-shell" class:na-view-shell--content={scrollMode === "content"}>
    {#if toolbar}{@render toolbar()}{/if}
    <div class="na-view-shell__body">
        {#if loading}
            <NaEmpty loading={true} />
        {:else if empty}
            <NaEmpty text={emptyText} action={emptyAction} />
        {:else}
            {@render children()}
        {/if}
    </div>
    {#if hint}<NaViewHint text={hint} />{/if}
</div>

<style lang="scss">
    .na-view-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-background);
    }
    .na-view-shell__body {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
    }
    .na-view-shell--content .na-view-shell__body {
        overflow-y: auto;
    }
</style>
