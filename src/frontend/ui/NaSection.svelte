<script lang="ts">
    import type { Snippet } from "svelte";
    import NaIcon from "./NaIcon.svelte";
    import NaSpinner from "./NaSpinner.svelte";

    export let title: string;
    export let description = "";
    export let icon = "";
    export let actionLabel = "";
    export let onAction: (() => void) | undefined = undefined;
    export let actionLoading = false;
    export let actionDisabled = false;
    export let tone: "default" | "warning" = "default";
    export let children: Snippet;
</script>

<section class="na-section" class:na-section--warning={tone === "warning"}>
    <header class="na-section__header">
        <div class="na-section__heading">
            {#if icon}
                <span class="na-section__icon"><NaIcon symbol={icon} size={16} /></span>
            {/if}
            <div>
                <h2>{title}</h2>
                {#if description}<p>{description}</p>{/if}
            </div>
        </div>
        {#if actionLabel && onAction}
            <button
                type="button"
                class="b3-button b3-button--text na-section__action"
                disabled={actionDisabled || actionLoading}
                aria-busy={actionLoading || undefined}
                onclick={onAction}
            >
                {#if actionLoading}<NaSpinner />{:else}<NaIcon symbol="iconRefresh" size={13} />{/if}
                <span>{actionLabel}</span>
            </button>
        {/if}
    </header>
    <div class="na-section__body">{@render children()}</div>
</section>

<style lang="scss">
    .na-section {
        overflow: hidden;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius-b, 8px);
        background: var(--b3-theme-surface);
    }

    .na-section--warning {
        border-color: color-mix(in srgb, var(--b3-card-warning-color) 34%, var(--b3-border-color));
    }

    .na-section__header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 15px 18px 13px;
        border-bottom: 1px solid var(--b3-border-color);
        background: color-mix(in srgb, var(--b3-theme-surface) 88%, var(--b3-theme-background));
    }

    .na-section__heading {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        min-width: 0;

        h2 {
            margin: 0;
            color: var(--na-text-primary);
            font-family: var(--b3-font-family);
            font-size: 14px;
            font-weight: 600;
            line-height: 20px;
        }

        p {
            margin: 2px 0 0;
            color: var(--na-text-secondary);
            font-size: 12px;
            line-height: 18px;
        }
    }

    .na-section__icon {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        margin-top: -3px;
        border-radius: var(--b3-border-radius);
        color: var(--na-text-interactive);
        background: var(--b3-theme-primary-lightest);
    }

    :global(.na-section__action) {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        flex: 0 0 auto;
        padding: 4px 7px;
        color: var(--na-text-secondary);
        font-size: 11px;
    }

    .na-section__body {
        padding: 0 18px;
    }

    @media (max-width: 520px) {
        .na-section__header {
            padding: 13px 14px 11px;
        }
        .na-section__body {
            padding: 0 14px;
        }
    }
</style>
