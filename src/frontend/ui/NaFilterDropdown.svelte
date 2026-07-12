<script lang="ts">
    import { onDestroy } from "svelte";

    export let label: string;
    export let options: { value: string; label: string; color?: string }[] = [];
    export let selected: string[] = [];
    export let i18n: any;
    export let onChange: (selected: string[]) => void;

    let open = false;
    let containerEl: HTMLElement;

    $: hasSelection = selected.length > 0;
    $: isAllSelected = options.length > 0 && selected.length === options.length;

    function toggle() {
        open = !open;
    }

    function closeOnOutsideClick(e: MouseEvent) {
        if (containerEl && !containerEl.contains(e.target as Node)) {
            open = false;
        }
    }

    function toggleOption(value: string) {
        if (selected.includes(value)) {
            onChange(selected.filter(v => v !== value));
        } else {
            onChange([...selected, value]);
        }
    }

    function selectAll() {
        onChange(options.map(o => o.value));
    }

    function clearAll() {
        onChange([]);
    }

    onDestroy(() => {});
</script>

<svelte:window on:click={closeOnOutsideClick} />

<div class="na-filter-dropdown" bind:this={containerEl}>
    <button
        class="na-filter-dropdown__trigger"
        class:na-filter-dropdown__trigger--active={hasSelection}
        on:click={toggle}
    >
        <span class="na-filter-dropdown__label">{label}</span>
        {#if hasSelection}
            <span class="na-filter-dropdown__count">{selected.length}</span>
        {/if}
        <svg class="na-filter-dropdown__arrow" viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M2.5 4.5l3.5 3.5 3.5-3.5" />
        </svg>
    </button>
    {#if open}
        <div class="na-filter-dropdown__panel">
            <div class="na-filter-dropdown__actions">
                <button class="na-filter-dropdown__action" on:click={selectAll} disabled={isAllSelected}>
                    {i18n?.selectAll || "Select all"}
                </button>
                <button class="na-filter-dropdown__action" on:click={clearAll} disabled={!hasSelection}>
                    {i18n?.clearFilter || "Clear"}
                </button>
            </div>
            {#each options as opt (opt.value)}
                <label class="na-filter-dropdown__option" on:click|stopPropagation={() => toggleOption(opt.value)}>
                    <input type="checkbox" class="na-filter-dropdown__sr-only" checked={selected.includes(opt.value)} on:change|stopPropagation={() => toggleOption(opt.value)} />
                    <span class="na-filter-dropdown__checkbox" class:na-filter-dropdown__checkbox--checked={selected.includes(opt.value)}>
                        {#if selected.includes(opt.value)}
                            <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M2 6l3 3 5-5" />
                            </svg>
                        {/if}
                    </span>
                    {#if opt.color}
                        <span class="na-filter-dropdown__dot" style="background: {opt.color}"></span>
                    {/if}
                    <span class="na-filter-dropdown__option-label">{opt.label}</span>
                </label>
            {/each}
        </div>
    {/if}
</div>

<style lang="scss">
    .na-filter-dropdown {
        position: relative;
    }

    .na-filter-dropdown__trigger {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 26px;
        padding: 0 8px;
        font-size: 11px;
        font-weight: 500;
        color: var(--b3-theme-on-surface-secondary);
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: 6px;
        cursor: pointer;
        white-space: nowrap;
        transition: border-color 0.15s, color 0.15s, background 0.15s;

        &:hover {
            border-color: var(--b3-theme-primary-light);
            background: var(--b3-theme-surface-light);
        }
    }

    .na-filter-dropdown__trigger--active {
        border-color: var(--na-filter-active-border);
        color: var(--na-filter-active-fg);
        background: var(--na-filter-active-bg);

        &:hover {
            border-color: var(--na-filter-active-border);
            background: var(--na-filter-active-bg-hover);
        }
    }

    .na-filter-dropdown__label {
        line-height: 1;
    }

    .na-filter-dropdown__count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 14px;
        height: 14px;
        padding: 0 3px;
        box-sizing: border-box;
        font-size: 10px;
        font-weight: 600;
        border-radius: 9999px;
        background: var(--na-filter-active-bg);
        color: var(--na-filter-active-fg);
        border: 1px solid var(--na-filter-active-border);
        line-height: 1;
    }

    .na-filter-dropdown__arrow {
        flex-shrink: 0;
        opacity: 0.6;
    }

    .na-filter-dropdown__panel {
        position: absolute;
        z-index: 20;
        top: calc(100% + 4px);
        left: 0;
        min-width: 160px;
        max-height: 240px;
        overflow-y: auto;
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        box-shadow: var(--na-shadow-md);
        padding: 4px 0;
    }

    .na-filter-dropdown__actions {
        display: flex;
        justify-content: space-between;
        padding: 4px 10px 6px;
        border-bottom: 1px solid var(--na-color-divider);
        margin-bottom: 2px;
    }

    .na-filter-dropdown__action {
        font-size: 10px;
        font-weight: 500;
        color: var(--b3-theme-primary);
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;

        &:disabled {
            color: var(--b3-theme-on-surface-light);
            cursor: default;
        }
    }

    .na-filter-dropdown__sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }

    .na-filter-dropdown__option {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        font-size: 11px;
        color: var(--b3-theme-on-background);
        cursor: pointer;
        border-radius: 4px;
        margin: 0 4px;
        transition: background 0.1s;

        &:hover {
            background: var(--na-color-hover-bg);
        }
    }

    .na-filter-dropdown__checkbox {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        border: 1.5px solid var(--na-color-divider);
        border-radius: 3px;
        flex-shrink: 0;
        color: var(--b3-theme-on-surface-secondary);
        transition: background 0.15s, border-color 0.15s, color 0.15s;

        svg {
            color: currentColor;
        }
    }

    .na-filter-dropdown__checkbox--checked {
        color: var(--na-filter-active-fg);
        background: var(--na-filter-active-bg);
        border-color: var(--na-filter-active-border);
    }

    .na-filter-dropdown__dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .na-filter-dropdown__option-label {
        line-height: 1.2;
    }
</style>
