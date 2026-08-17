<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import NaIcon from "./NaIcon.svelte";

    export let title: string;
    export let description = "";
    export let icon = "";
    export let count: string | number | undefined = undefined;
    export let tone: "default" | "primary" | "info" | "success" | "warning" | "danger" = "default";
    export let variant: "framed" | "plain" = "framed";
    export let open = false;
    export let modified = false;
    export let modifiedLabel = "";
    export let i18n: any = null;
    const dispatch = createEventDispatcher<{ openChange: boolean }>();

    function toggle() {
        open = !open;
        dispatch("openChange", open);
    }
</script>

<section
    class="na-accordion"
    class:na-accordion--open={open}
    class:na-accordion--plain={variant === "plain"}
    class:na-accordion--primary={tone === "primary"}
    class:na-accordion--info={tone === "info"}
    class:na-accordion--success={tone === "success"}
    class:na-accordion--danger={tone === "danger"}
    class:na-accordion--warning={tone === "warning"}
>
    <div class="na-accordion__header">
        <button type="button" class="na-accordion__trigger" aria-expanded={open} on:click={toggle}>
            <span class="na-accordion__chevron"><NaIcon symbol="iconRight" size={14} /></span>
            {#if icon}<span class="na-accordion__icon"><NaIcon symbol={icon} size={14} /></span>{/if}
            <span class="na-accordion__copy">
                <strong>{title}</strong>
                {#if description}<span>{description}</span>{/if}
            </span>
            {#if modified}<span class="na-accordion__modified"
                    >{i18n?.modifiedLabel || modifiedLabel || "Modified"}</span
                >{/if}
            {#if count !== undefined}<span class="na-accordion__count">{count}</span>{/if}
        </button>
        {#if $$slots.action}<div class="na-accordion__action"><slot name="action" /></div>{/if}
    </div>
    {#if open}
        <div class="na-accordion__content"><slot /></div>
    {/if}
</section>

<style lang="scss">
    .na-accordion {
        overflow: hidden;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius-b, 8px);
        background: var(--b3-theme-surface);
    }

    .na-accordion--open {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 26%, var(--b3-border-color));
    }
    .na-accordion--plain {
        border-width: 0 0 1px;
        border-radius: 0;
        background: transparent;
    }
    .na-accordion--primary {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 34%, var(--b3-border-color));
    }
    .na-accordion--info {
        border-color: color-mix(in srgb, var(--na-color-info) 34%, var(--b3-border-color));
    }
    .na-accordion--success {
        border-color: color-mix(in srgb, var(--na-color-success) 34%, var(--b3-border-color));
    }
    .na-accordion--danger {
        border-color: color-mix(in srgb, var(--na-color-error) 34%, var(--b3-border-color));
    }
    .na-accordion--warning {
        border-color: color-mix(in srgb, var(--na-color-warning) 34%, var(--b3-border-color));
    }

    .na-accordion__header {
        display: flex;
        align-items: center;
        min-width: 0;
    }

    .na-accordion__trigger {
        display: flex;
        flex: 1;
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
        &:focus-visible {
            outline: 2px solid var(--b3-theme-primary);
            outline-offset: -2px;
        }
    }

    .na-accordion__chevron,
    .na-accordion__icon {
        display: inline-flex;
        color: var(--b3-theme-on-surface-light);
    }
    .na-accordion__chevron {
        transition: transform 150ms ease;
    }
    .na-accordion--open .na-accordion__chevron {
        transform: rotate(90deg);
    }

    .na-accordion__copy {
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

    .na-accordion__modified {
        flex: 0 0 auto;
        padding: 2px 7px;
        border-radius: 999px;
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
        font-size: 10px;
        font-weight: 600;
    }

    .na-accordion__count {
        min-width: 20px;
        padding: 1px 6px;
        border-radius: var(--na-radius-pill);
        color: var(--b3-theme-on-surface-light);
        background: var(--b3-theme-surface-light);
        font-size: var(--na-font-size-sm);
        text-align: center;
        font-variant-numeric: tabular-nums;
    }
    .na-accordion--primary .na-accordion__count {
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
    }
    .na-accordion--info .na-accordion__count {
        color: var(--na-color-info);
        background: var(--na-color-info-bg);
    }
    .na-accordion--success .na-accordion__count {
        color: var(--na-color-success);
        background: var(--na-color-success-bg);
    }
    .na-accordion--warning .na-accordion__count {
        color: var(--na-color-warning);
        background: var(--na-color-warning-bg);
    }
    .na-accordion--danger .na-accordion__count {
        color: var(--na-color-error);
        background: var(--na-color-error-bg);
    }
    .na-accordion__action {
        flex: 0 0 auto;
        padding-right: var(--na-space-md);
    }

    .na-accordion__content {
        padding: 0 15px 15px 39px;
        border-top: 1px solid var(--b3-border-color);
    }
    .na-accordion--plain .na-accordion__content {
        padding: var(--na-space-xs) var(--na-space-md) var(--na-space-md);
    }

    @media (prefers-reduced-motion: reduce) {
        .na-accordion__chevron {
            transition: none;
        }
    }
</style>
