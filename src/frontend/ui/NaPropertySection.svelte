<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import NaIcon from "./NaIcon.svelte";

    export let title: string;
    export let description = "";
    export let collapsible = false;
    export let open = true;
    export let summary = "";
    export let tone: "default" | "danger" = "default";

    const dispatch = createEventDispatcher<{ openChange: boolean }>();
    function toggle() {
        if (!collapsible) return;
        open = !open;
        dispatch("openChange", open);
    }
</script>

<section class="na-property-section" class:na-property-section--danger={tone === "danger"}>
    {#if collapsible}
        <button type="button" class="na-property-section__trigger" aria-expanded={open} on:click={toggle}>
            <span class="na-property-section__chevron"><NaIcon symbol="iconRight" size={13} /></span>
            <span class="na-property-section__heading"><strong>{title}</strong>{#if description}<small>{description}</small>{/if}</span>
            {#if summary}<span class="na-property-section__summary">{summary}</span>{/if}
        </button>
    {:else}
        <header class="na-property-section__header">
            <span class="na-property-section__heading"><strong>{title}</strong>{#if description}<small>{description}</small>{/if}</span>
            <slot name="action" />
        </header>
    {/if}
    {#if !collapsible || open}
        <div class="na-property-section__body"><slot /></div>
    {/if}
</section>

<style lang="scss">
    .na-property-section {
        min-width: 0;
        border-top: 1px solid color-mix(in srgb, var(--b3-border-color) 62%, transparent);
        background: var(--b3-theme-surface);
    }

    .na-property-section:first-child { border-top: 0; }

    .na-property-section__header,
    .na-property-section__trigger {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        min-height: 36px;
        padding: 9px 16px 6px;
        box-sizing: border-box;
        color: var(--b3-theme-on-surface);
        background: var(--b3-theme-surface);
        border: 0;
        text-align: left;
    }

    .na-property-section__trigger { cursor: pointer; }
    .na-property-section__trigger:hover { background: var(--b3-list-hover); }

    .na-property-section__heading {
        display: flex;
        flex: 1;
        min-width: 0;
        flex-direction: column;

        strong { font-size: 12px; font-weight: 600; line-height: 18px; }
        small { color: var(--b3-theme-on-surface-light); font-size: 10px; line-height: 15px; }
    }

    .na-property-section__chevron {
        display: grid;
        place-items: center;
        color: var(--b3-theme-on-surface-light);
        transition: transform 150ms ease;
    }
    .na-property-section__trigger[aria-expanded="true"] .na-property-section__chevron { transform: rotate(90deg); }

    .na-property-section__summary {
        overflow: hidden;
        max-width: 45%;
        color: var(--b3-theme-on-surface-light);
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .na-property-section__body { min-width: 0; padding: 0 16px 7px; }
    .na-property-section--danger .na-property-section__header { color: var(--b3-card-error-color); }
</style>
