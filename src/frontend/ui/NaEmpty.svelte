<script lang="ts">
    import NaButton from "./NaButton.svelte";
    import NaSpinner from "./NaSpinner.svelte";

    export let text: string | undefined = undefined;
    export let loading: boolean = false;
    export let action: { label: string; onClick: () => void } | undefined = undefined;
</script>

<div class="na-empty">
    {#if loading}
        <NaSpinner size="lg" />
    {:else}
        <div class="na-empty__illustration">
            <svg
                viewBox="0 0 80 80"
                width="80"
                height="80"
                fill="none"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
                opacity="0.25"
            >
                <rect x="16" y="10" width="48" height="60" rx="4" />
                <line x1="26" y1="26" x2="54" y2="26" />
                <line x1="26" y1="36" x2="48" y2="36" />
                <line x1="26" y1="46" x2="44" y2="46" />
                <circle cx="26" cy="56" r="2" fill="currentColor" stroke="none" opacity="0.4" />
                <line x1="32" y1="56" x2="50" y2="56" />
            </svg>
        </div>
    {/if}
    {#if text}
        <span class="na-empty__text">{text}</span>
    {/if}
    {#if !loading && action}
        <NaButton size="sm" onclick={action.onClick}>{action.label}</NaButton>
    {/if}
</div>

<style lang="scss">
    .na-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        min-height: 200px;
        padding: var(--na-space-xxl) var(--na-space-xl);
        gap: var(--na-space-lg);
        color: var(--na-text-secondary);
        text-align: center;
    }

    .na-empty__illustration {
        line-height: 1;
        color: var(--na-text-secondary);
    }

    .na-empty__text {
        max-width: 240px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-lg);
        font-weight: 500;
        letter-spacing: 0;
        line-height: 1.5;
    }
</style>
