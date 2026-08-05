<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import SettingsIcon from "./SettingsIcon.svelte";

    export let title: string;
    export let description = "";
    export let open = false;
    export let modified = false;
    export let modifiedLabel = "Modified";
    const dispatch = createEventDispatcher<{ openChange: boolean }>();

    function toggle() {
        open = !open;
        dispatch("openChange", open);
    }
</script>

<section class="na-setting-accordion" class:na-setting-accordion--open={open}>
    <button type="button" class="na-setting-accordion__trigger" aria-expanded={open} on:click={toggle}>
        <span class="na-setting-accordion__chevron"><SettingsIcon symbol="iconRight" size={14} /></span>
        <span class="na-setting-accordion__copy">
            <strong>{title}</strong>
            {#if description}<span>{description}</span>{/if}
        </span>
        {#if modified}<span class="na-setting-accordion__modified">{modifiedLabel}</span>{/if}
    </button>
    {#if open}
        <div class="na-setting-accordion__content"><slot /></div>
    {/if}
</section>

<style lang="scss">
    .na-setting-accordion {
        overflow: hidden;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius-b, 8px);
        background: var(--b3-theme-surface);
    }

    .na-setting-accordion--open {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 26%, var(--b3-border-color));
    }

    .na-setting-accordion__trigger {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 13px 15px;
        border: 0;
        color: var(--b3-theme-on-surface);
        background: transparent;
        text-align: left;
        cursor: pointer;

        &:hover {
            background: var(--b3-list-hover);
        }
    }

    .na-setting-accordion__chevron {
        color: var(--b3-theme-on-surface-light);
        transition: transform 150ms ease;
    }

    .na-setting-accordion--open .na-setting-accordion__chevron {
        transform: rotate(90deg);
    }

    .na-setting-accordion__copy {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;

        strong {
            font-size: 13px;
            font-weight: 600;
        }

        span {
            margin-top: 2px;
            color: var(--b3-theme-on-surface-light);
            font-size: 11px;
            line-height: 16px;
        }
    }

    .na-setting-accordion__modified {
        flex: 0 0 auto;
        padding: 2px 7px;
        border-radius: 999px;
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
        font-size: 10px;
        font-weight: 600;
    }

    .na-setting-accordion__content {
        padding: 0 15px 15px 39px;
        border-top: 1px solid var(--b3-border-color);
    }

    @media (prefers-reduced-motion: reduce) {
        .na-setting-accordion__chevron {
            transition: none;
        }
    }
</style>
