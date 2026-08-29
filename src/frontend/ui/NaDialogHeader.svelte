<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import NaIconButton from "./NaIconButton.svelte";

    export let title: string;
    export let subtitle = "";
    export let closeLabel: string;
    export let status = "";
    export let statusTone: "default" | "warning" | "error" = "default";
    export let titleId = "na-drawer-title";

    const dispatch = createEventDispatcher<{ close: void }>();
</script>

<header class="na-dialog-header">
    <div class="na-dialog-header__copy">
        <div class="na-dialog-header__title-row">
            <h2 id={titleId}>{title}</h2>
            {#if status}<span class="na-dialog-header__status na-dialog-header__status--{statusTone}">{status}</span
                >{/if}
        </div>
        {#if subtitle}<p>{subtitle}</p>{/if}
    </div>
    <div class="na-dialog-header__actions">
        <slot name="actions" />
        <NaIconButton symbol="iconClose" label={closeLabel} on:click={() => dispatch("close")} />
    </div>
</header>

<style lang="scss">
    .na-dialog-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        min-width: 0;
        padding: 12px 14px 10px 16px;
        border-bottom: 1px solid var(--b3-border-color);
        background: var(--na-color-panel-header);
    }
    .na-dialog-header__copy {
        min-width: 0;
        flex: 1;
    }
    .na-dialog-header__title-row {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }
    h2 {
        overflow: hidden;
        margin: 0;
        color: var(--b3-theme-on-surface);
        font-size: 14px;
        font-weight: 600;
        line-height: 20px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    p {
        margin: 2px 0 0;
        color: var(--b3-theme-on-surface-light);
        font-size: 10px;
        line-height: 15px;
    }
    .na-dialog-header__actions {
        display: flex;
        align-items: center;
        gap: 2px;
        flex: none;
    }
    .na-dialog-header__status {
        flex: none;
        padding: 1px 6px;
        border-radius: var(--b3-border-radius);
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
        font-size: 10px;
        font-weight: 600;
    }
    .na-dialog-header__status--warning {
        color: var(--b3-card-warning-color);
        background: var(--na-color-warning-bg);
    }
    .na-dialog-header__status--error {
        color: var(--b3-card-error-color);
        background: var(--na-color-error-bg);
    }
</style>
