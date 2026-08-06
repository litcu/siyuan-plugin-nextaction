<script lang="ts">
    import NaIcon from "./NaIcon.svelte";

    export let symbol: string;
    export let label: string;
    export let size = 16;
    export let disabled = false;
    export let active = false;
    export let tone: "default" | "danger" = "default";
    export let type: "button" | "submit" = "button";
    export let compact = false;
</script>

<button
    {type}
    class="na-icon-button"
    class:na-icon-button--compact={compact}
    class:na-icon-button--active={active}
    class:na-icon-button--danger={tone === "danger"}
    aria-label={label}
    title={label}
    aria-pressed={active || undefined}
    {disabled}
    on:click
>
    <NaIcon {symbol} {size} />
</button>

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
        color: var(--b3-theme-on-surface-light);
        background: transparent;
        cursor: pointer;

        &:hover:not(:disabled) {
            color: var(--b3-theme-on-surface);
            background: var(--b3-list-hover);
        }

        &:disabled {
            opacity: .45;
            cursor: not-allowed;
        }
    }

    .na-icon-button--active {
        color: var(--b3-theme-primary);
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
