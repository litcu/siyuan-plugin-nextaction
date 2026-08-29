<script lang="ts">
    import NaIcon from "./NaIcon.svelte";

    export let label: string;
    export let disabled = false;
    export let symbol = "iconList";
    export let size = 16;
</script>

<!-- Pointer-only by design; keyboard and assistive alternatives belong to the adjacent action buttons. -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<span
    class="na-drag-handle"
    class:na-drag-handle--disabled={disabled}
    aria-hidden="true"
    data-na-drag-handle
    title={label}
    on:pointerdown
>
    <NaIcon {symbol} {size} />
</span>

<style lang="scss">
    .na-drag-handle {
        display: inline-grid;
        place-items: center;
        width: 24px;
        height: 24px;
        flex: 0 0 24px;
        border-radius: var(--b3-border-radius);
        color: var(--b3-theme-on-surface-light);
        cursor: grab;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;

        &:hover {
            color: var(--b3-theme-on-surface);
            background: var(--b3-list-hover);
        }

        &:active {
            cursor: grabbing;
        }
    }

    .na-drag-handle--disabled {
        pointer-events: none;
        opacity: 0.45;
        cursor: not-allowed;
    }

    @media (pointer: coarse), (max-width: 520px) {
        .na-drag-handle {
            width: 44px;
            height: 44px;
            flex-basis: 44px;
        }
    }
</style>
