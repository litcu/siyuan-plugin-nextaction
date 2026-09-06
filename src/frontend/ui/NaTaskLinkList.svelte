<script lang="ts">
    import NaIconButton from "./NaIconButton.svelte";

    export let items: { blockId: string; title: string; status: string; reason?: string }[] = [];
    export let emptyText: string;
    export let openLabel: string;
    export let onOpen: (blockId: string) => void;
    export let onSelect: ((blockId: string) => void) | undefined = undefined;
</script>

{#if items.length === 0}
    <div class="na-task-link-list__empty">{emptyText}</div>
{:else}
    <div class="na-task-link-list">
        {#each items as item (item.blockId)}
            <div class="na-task-link-list__item">
                <span class="na-task-link-list__status na-task-link-list__status--{item.status}" aria-hidden="true"
                ></span>
                {#if onSelect}
                    <button
                        type="button"
                        class="na-task-link-list__title na-task-link-list__title-button"
                        onclick={() => onSelect?.(item.blockId)}>{item.title}</button
                    >
                {:else}
                    <span class="na-task-link-list__title">{item.title}</span>
                {/if}
                {#if item.reason}<span class="na-task-link-list__reason">{item.reason}</span>{/if}
                <NaIconButton
                    symbol="iconOpenWindow"
                    label={openLabel}
                    size={13}
                    onclick={() => onOpen(item.blockId)}
                />
            </div>
        {/each}
    </div>
{/if}

<style lang="scss">
    .na-task-link-list {
        display: flex;
        width: 100%;
        min-width: 0;
        flex-direction: column;
    }
    .na-task-link-list__item {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
        min-height: 34px;
        padding: 2px 0;
        border-bottom: 1px solid var(--b3-border-color);
    }
    .na-task-link-list__item:last-child {
        border-bottom: 0;
    }
    .na-task-link-list__status {
        width: 7px;
        height: 7px;
        flex: 0 0 7px;
        border-radius: 50%;
        background: var(--b3-theme-on-surface-light);
    }
    .na-task-link-list__status--doing {
        background: var(--b3-theme-primary);
    }
    .na-task-link-list__status--waiting {
        background: var(--b3-card-warning-color);
    }
    .na-task-link-list__status--done {
        background: var(--b3-card-success-color);
    }
    .na-task-link-list__status--inbox {
        background: var(--b3-card-info-color);
    }
    .na-task-link-list__title {
        overflow: hidden;
        min-width: 0;
        flex: 1;
        color: var(--na-text-primary);
        font-size: var(--na-font-size-md);
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .na-task-link-list__title-button {
        margin: 0;
        padding: 5px 6px;
        border-radius: 4px;
        border: 0;
        background: transparent;
        cursor: pointer;
        font: inherit;
        text-align: left;
    }
    .na-task-link-list__title-button:hover,
    .na-task-link-list__title-button:focus-visible {
        color: var(--na-text-interactive);
        background: var(--b3-list-hover);
    }
    .na-task-link-list__title-button:focus-visible {
        outline: 2px solid var(--b3-theme-primary);
        outline-offset: -1px;
    }
    .na-task-link-list__reason {
        overflow: hidden;
        flex: 0 0 auto;
        max-width: 42%;
        padding: 2px 6px;
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
        line-height: 18px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .na-task-link-list__empty {
        width: 100%;
        padding: 8px 0;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
        text-align: center;
    }
</style>
