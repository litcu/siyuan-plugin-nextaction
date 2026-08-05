<script lang="ts">
    export let label: string;
    export let description = "";
    export let forId = "";
    export let disabled = false;
    export let stacked = false;
    export let error = "";
</script>

<div class="na-property-row" class:na-property-row--disabled={disabled} class:na-property-row--stacked={stacked}>
    <div class="na-property-row__label">
        {#if forId}<label for={forId}>{label}</label>{:else}<span>{label}</span>{/if}
        {#if description}<small>{description}</small>{/if}
    </div>
    <div class="na-property-row__control" role="group" aria-label={label}><slot /></div>
    {#if error}<div class="na-property-row__error" role="alert">{error}</div>{/if}
</div>

<style lang="scss">
    .na-property-row {
        display: grid;
        grid-template-columns: minmax(104px, 32%) minmax(0, 1fr);
        align-items: center;
        gap: 8px 14px;
        min-width: 0;
        padding: 7px 0;
    }

    .na-property-row--stacked { grid-template-columns: minmax(0, 1fr); }
    .na-property-row--disabled { opacity: .48; }

    .na-property-row__label {
        display: flex;
        min-width: 0;
        flex-direction: column;

        label,
        > span {
            color: var(--b3-theme-on-surface);
            font-size: var(--na-font-size-md);
            font-weight: 500;
            line-height: 18px;
        }

        small {
            margin-top: 1px;
            color: var(--b3-theme-on-surface-light);
            font-size: var(--na-font-size-xs);
            line-height: 15px;
        }
    }

    .na-property-row__control {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--na-space-sm);
        min-width: 0;

        :global(> *) { min-width: 0; }
    }

    .na-property-row--stacked .na-property-row__control { justify-content: flex-start; width: 100%; }
    .na-property-row__error { grid-column: 2; color: var(--b3-card-error-color); font-size: var(--na-font-size-sm); }

    @media (max-width: 520px) {
        .na-property-row {
            grid-template-columns: minmax(0, 1fr);
            align-items: stretch;
            gap: 6px;
            padding: 9px 0;
        }
        .na-property-row__control { justify-content: flex-start; }
        .na-property-row__error { grid-column: 1; }
    }
</style>
