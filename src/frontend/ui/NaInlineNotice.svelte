<script lang="ts">
    import NaIcon from "./NaIcon.svelte";

    export let message: string;
    export let tone: "info" | "warning" | "error" | "success" = "info";
    export let live: "off" | "polite" | "assertive" = tone === "error" ? "assertive" : "polite";

    $: symbol = tone === "error"
        ? "iconCloseRound"
        : tone === "warning"
            ? "iconWarning"
            : tone === "success"
                ? "iconSelect"
                : "iconInfo";
</script>

{#if message}
    <div class="na-inline-notice na-inline-notice--{tone}" role={tone === "error" ? "alert" : "status"} aria-live={live}>
        <NaIcon {symbol} size={14} />
        <span>{message}</span>
    </div>
{/if}

<style lang="scss">
    .na-inline-notice {
        display: flex;
        align-items: flex-start;
        gap: var(--na-space-sm);
        padding: 7px 10px;
        border: 1px solid var(--na-color-info-border);
        border-radius: var(--b3-border-radius);
        color: var(--b3-card-info-color);
        background: var(--na-color-info-bg);
        font-size: var(--na-font-size-sm);
        line-height: 1.45;

        :global(.na-icon) { margin-top: 1px; }
        span { min-width: 0; }
    }

    .na-inline-notice--warning {
        color: var(--b3-card-warning-color);
        border-color: var(--na-color-warning-border);
        background: var(--na-color-warning-bg);
    }

    .na-inline-notice--error {
        color: var(--b3-card-error-color);
        border-color: var(--na-color-error-border);
        background: var(--na-color-error-bg);
    }

    .na-inline-notice--success {
        color: var(--b3-card-success-color);
        border-color: color-mix(in srgb, var(--b3-card-success-color) 30%, var(--b3-border-color));
        background: var(--na-color-success-bg);
    }
</style>
