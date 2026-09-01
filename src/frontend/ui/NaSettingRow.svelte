<script lang="ts">
    import type { Snippet } from "svelte";

    export let title: string;
    export let description = "";
    export let forId = "";
    export let disabled = false;
    export let stacked = false;
    export let children: Snippet;
</script>

<div class="na-setting-row" class:na-setting-row--disabled={disabled} class:na-setting-row--stacked={stacked}>
    <div class="na-setting-row__copy">
        {#if forId}
            <label for={forId}>{title}</label>
        {:else}
            <span class="na-setting-row__title">{title}</span>
        {/if}
        {#if description}<span class="na-setting-row__description">{description}</span>{/if}
    </div>
    <div class="na-setting-row__control">{@render children()}</div>
</div>

<style lang="scss">
    .na-setting-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(180px, auto);
        align-items: center;
        gap: 24px;
        min-height: 62px;
        padding: 10px 0;
        border-bottom: 1px solid var(--b3-border-color);

        &:last-child {
            border-bottom: 0;
        }
    }

    .na-setting-row--stacked {
        grid-template-columns: minmax(0, 1fr);
        align-items: stretch;
        gap: 9px;
    }

    .na-setting-row--disabled {
        opacity: 0.48;
    }

    .na-setting-row__copy {
        display: flex;
        flex-direction: column;
        min-width: 0;

        label,
        .na-setting-row__title {
            color: var(--na-text-primary);
            font-size: 13px;
            font-weight: 500;
            line-height: 19px;
        }
    }

    .na-setting-row__description {
        margin-top: 2px;
        color: var(--na-text-secondary);
        font-size: 11px;
        line-height: 17px;
    }

    .na-setting-row__control {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        min-width: 0;
    }

    .na-setting-row--stacked .na-setting-row__control {
        justify-content: flex-start;
        width: 100%;
    }

    @media (max-width: 620px) {
        .na-setting-row {
            grid-template-columns: minmax(0, 1fr);
            gap: 8px;
            padding: 13px 0;
        }

        .na-setting-row__control {
            justify-content: flex-start;
        }
    }
</style>
