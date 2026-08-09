<script lang="ts">
    import NaIcon from "./NaIcon.svelte";
    import NaTooltip from "./NaTooltip.svelte";

    export let label = "";
    export let icon = "";
    export let active = false;
    export let collapsed = false;
    export let badge: string | number = "";
    export let tooltip = "";
    export let disabled = false;
</script>

<NaTooltip text={tooltip || label} position="right" followCursor={false} block>
    <button
        type="button"
        class="na-nav-item"
        class:na-nav-item--active={active}
        class:na-nav-item--collapsed={collapsed}
        {disabled}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        on:click
    >
        {#if icon}<span class="na-nav-item__icon"><NaIcon symbol={icon} size={collapsed ? 17 : 16} /></span>{/if}
        <span class="na-nav-item__label">{label}</span>
        {#if badge !== "" && badge !== 0}<span class="na-nav-item__badge">{badge}</span>{/if}
    </button>
</NaTooltip>

<style lang="scss">
    .na-nav-item {
        position: relative;
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        min-height: 36px;
        padding: 7px 12px;
        border: 0;
        border-radius: var(--na-radius-sm);
        color: var(--b3-theme-on-surface);
        background: transparent;
        cursor: pointer;
        font: inherit;
        text-align: left;
        transition: color 120ms ease, background 120ms ease;
    }

    .na-nav-item:hover:not(:disabled) { color: var(--b3-theme-primary); background: var(--b3-theme-surface-light); }
    .na-nav-item:focus-visible { outline: 2px solid color-mix(in srgb, var(--b3-theme-primary) 42%, transparent); outline-offset: -2px; }
    .na-nav-item:disabled { opacity: .45; cursor: not-allowed; }

    .na-nav-item--active { color: var(--b3-theme-primary); background: var(--b3-theme-primary-lightest); }
    .na-nav-item--active::before {
        position: absolute;
        top: 7px;
        bottom: 7px;
        left: 0;
        width: 2px;
        border-radius: 0 2px 2px 0;
        background: var(--b3-theme-primary);
        content: "";
    }

    .na-nav-item__icon { display: grid; place-items: center; flex: 0 0 18px; color: currentColor; }
    .na-nav-item__label { min-width: 0; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .na-nav-item__badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 16px;
        height: 16px;
        margin-left: auto;
        padding: 0 4px;
        border-radius: var(--na-radius-pill);
        color: var(--b3-theme-on-primary);
        background: var(--b3-theme-primary);
        font-size: 9px;
        font-weight: 700;
        line-height: 1;
    }

    .na-nav-item--collapsed { justify-content: center; width: 38px; padding: 7px 0; }
    .na-nav-item--collapsed .na-nav-item__label { display: none; }
    .na-nav-item--collapsed .na-nav-item__badge { position: absolute; top: 1px; right: 0; min-width: 13px; height: 13px; padding: 0 3px; }

    @media (prefers-reduced-motion: reduce) { .na-nav-item { transition: none; } }
</style>
