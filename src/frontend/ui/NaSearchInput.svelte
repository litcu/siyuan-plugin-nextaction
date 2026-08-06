<script lang="ts">
    import NaIcon from "./NaIcon.svelte";

    export let value = "";
    export let placeholder = "";
    export let compact = false;
    export let disabled = false;
    export let ariaLabel = "";
</script>

<label class="na-search-input" class:na-search-input--compact={compact} class:na-search-input--disabled={disabled}>
    <NaIcon symbol="iconSearch" size={compact ? 13 : 14} />
    <input
        type="search"
        bind:value
        {placeholder}
        {disabled}
        aria-label={ariaLabel || placeholder}
    />
</label>

<style lang="scss">
    .na-search-input {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        height: var(--na-control-height);
        padding: 0 9px;
        box-sizing: border-box;
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        color: var(--b3-theme-on-surface-light);
        background: var(--b3-theme-background);
        transition: border-color 120ms ease, background 120ms ease;
    }

    .na-search-input:hover { border-color: var(--b3-theme-primary-light); }
    .na-search-input:focus-within { border-color: var(--b3-theme-primary); background: var(--b3-theme-surface); }
    .na-search-input--compact { height: var(--na-control-height-sm); padding: 0 8px; border-radius: var(--na-radius-sm); }
    .na-search-input--disabled { opacity: .48; }

    input {
        width: 100%;
        min-width: 0;
        height: 100%;
        padding: 0;
        border: 0;
        outline: 0;
        color: var(--b3-theme-on-background);
        background: transparent;
        font: inherit;
        font-size: var(--na-font-size-md);
    }

    input::placeholder { color: var(--b3-theme-on-surface-light); }
    input::-webkit-search-cancel-button { cursor: pointer; opacity: .65; }

    @media (prefers-reduced-motion: reduce) {
        .na-search-input { transition: none; }
    }
</style>
