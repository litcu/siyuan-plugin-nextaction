<script lang="ts">
    import NaIcon from "./NaIcon.svelte";
    import NaTooltip from "./NaTooltip.svelte";

    export let symbol: string;
    export let label: string;
    export let size = 16;
    export let disabled = false;
    export let active = false;
    export let tone: "default" | "danger" = "default";
    export let type: "button" | "submit" = "button";
    export let compact = false;
    export let draggable = false;
    export let tabIndex: number | undefined = undefined;
    export let tooltipPosition: "top" | "bottom" | "left" | "right" = "bottom";
    export let onclick: (event: MouseEvent) => void = () => {};
    export let ondragstart: (event: DragEvent) => void = () => {};
    export let ondragend: (event: DragEvent) => void = () => {};
</script>

<NaTooltip text={label} position={tooltipPosition} followCursor={false}>
    <button
        {type}
        class="na-icon-button"
        class:na-icon-button--compact={compact}
        class:na-icon-button--active={active}
        class:na-icon-button--danger={tone === "danger"}
        aria-label={label}
        aria-pressed={active || undefined}
        {disabled}
        {draggable}
        tabindex={tabIndex}
        {onclick}
        {ondragstart}
        {ondragend}
    >
        <NaIcon {symbol} {size} />
    </button>
</NaTooltip>

<style lang="scss">
    .na-icon-button {
        display: inline-grid;
        place-items: center;
        width: 30px;
        height: 30px;
        flex: 0 0 30px;
        padding: 0;
        border: 0;
        border-radius: var(--b3-border-radius);
        color: var(--na-text-secondary);
        background: transparent;
        cursor: pointer;

        &:hover:not(:disabled) {
            color: var(--na-text-primary);
            background: var(--b3-list-hover);
        }

        &:focus-visible {
            outline: 2px solid var(--b3-theme-primary);
            outline-offset: 2px;
        }

        &:disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }
    }

    .na-icon-button--active {
        color: var(--na-text-interactive);
        background: var(--b3-theme-primary-lightest);
    }

    .na-icon-button--compact {
        width: 24px;
        height: 24px;
        flex-basis: 24px;
    }

    .na-icon-button--danger:hover:not(:disabled) {
        color: var(--b3-card-error-color);
        background: var(--na-color-error-bg);
    }
</style>
