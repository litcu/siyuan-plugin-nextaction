<script lang="ts">
    import NaEmpty from "./NaEmpty.svelte";
    import NaViewHint from "./NaViewHint.svelte";

    export let loading = false;
    export let empty = false;
    export let emptyText = "";
    export let emptyAction: { label: string; onClick: () => void } | undefined = undefined;
    export let error: string | null = "";
    export let retryAction: { label: string; onClick: () => void } | undefined = undefined;
    export let loadingText = "Loading...";
    export let hint = "";
    export let scrollMode: "content" | "none" = "content";
</script>

<div class="na-view-shell" class:na-view-shell--content={scrollMode === "content"}>
    {#if $$slots.toolbar}<slot name="toolbar" />{/if}
    <div class="na-view-shell__body">
        {#if loading}
            <NaEmpty loading={true} text={loadingText} />
        {:else if error}
            <NaEmpty error={true} text={error} action={retryAction} />
        {:else if empty}
            <NaEmpty text={emptyText} action={emptyAction} />
        {:else}
            <slot />
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
