<script context="module" lang="ts">
    export type MetricTone = "default" | "primary" | "info" | "success" | "warning" | "danger";
</script>

<script lang="ts">
    export let items: { value: string | number; label: string; tone?: MetricTone }[] = [];
    export let variant: "chip" | "card" = "chip";
</script>

<div class="na-metric-strip" class:na-metric-strip--cards={variant === "card"}>
    {#each items as item}
        <div
            class="na-metric"
            class:na-metric--primary={item.tone === "primary"}
            class:na-metric--info={item.tone === "info"}
            class:na-metric--success={item.tone === "success"}
            class:na-metric--warning={item.tone === "warning"}
            class:na-metric--danger={item.tone === "danger"}
        >
            <strong>{item.value}</strong><span>{item.label}</span>
        </div>
    {/each}
</div>

<style lang="scss">
    .na-metric-strip {
        display: flex;
        align-items: center;
        gap: var(--na-space-xs);
        min-width: 0;
        overflow-x: auto;
    }
    .na-metric {
        display: inline-flex;
        align-items: center;
        gap: var(--na-space-xs);
        min-height: 24px;
        padding: 2px var(--na-space-md);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-pill);
        color: var(--na-text-secondary);
        background: var(--b3-theme-surface-light);
        font-size: var(--na-font-size-xs);
        white-space: nowrap;
    }
    .na-metric strong {
        color: var(--na-text-primary);
        font-size: var(--na-font-size-md);
        font-variant-numeric: tabular-nums;
    }
    .na-metric--primary strong {
        color: var(--na-text-interactive);
    }
    .na-metric--info strong {
        color: var(--na-color-info);
    }
    .na-metric--success strong {
        color: var(--na-color-success);
    }
    .na-metric--warning strong {
        color: var(--na-color-warning);
    }
    .na-metric--danger strong {
        color: var(--na-color-error);
    }
    .na-metric-strip--cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
        overflow: visible;
    }
    .na-metric-strip--cards .na-metric {
        min-height: 52px;
        flex-direction: column;
        justify-content: center;
        border-radius: var(--na-radius-md);
        background: var(--b3-theme-surface);
    }
    .na-metric-strip--cards .na-metric strong {
        font-size: 20px;
    }
</style>
