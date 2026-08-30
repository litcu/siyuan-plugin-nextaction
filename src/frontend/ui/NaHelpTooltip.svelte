<script lang="ts">
    import type { TooltipPosition } from "../utils/tooltip-position";
    import NaIcon from "./NaIcon.svelte";
    import NaTooltip from "./NaTooltip.svelte";

    export let label: string;
    export let text: string;
    export let position: TooltipPosition = "top";

    $: ariaLabel = `${label}: ${text}`;
</script>

<span class="na-help-tooltip">
    <NaTooltip {text} {position} {ariaLabel} followCursor={false} multiline={true} openOnClick={true}>
        <span class="na-help-tooltip__icon" aria-hidden="true"><NaIcon symbol="iconInfo" size={12} /></span>
    </NaTooltip>
</span>

<style lang="scss">
    .na-help-tooltip {
        display: inline-flex;
        flex: 0 0 auto;
    }

    .na-help-tooltip :global(.na-tooltip) {
        display: inline-grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border-radius: var(--na-radius-sm);
        color: var(--b3-theme-on-surface-light);
        cursor: help;
    }

    .na-help-tooltip :global(.na-tooltip:hover),
    .na-help-tooltip :global(.na-tooltip:focus-visible) {
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
    }

    .na-help-tooltip :global(.na-tooltip:focus-visible) {
        outline: 2px solid color-mix(in srgb, var(--b3-theme-primary) 42%, transparent);
        outline-offset: 1px;
    }

    .na-help-tooltip__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    @media (max-width: 520px) {
        .na-help-tooltip :global(.na-tooltip) {
            width: 28px;
            height: 28px;
        }
    }
</style>
