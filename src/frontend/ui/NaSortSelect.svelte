<script context="module" lang="ts">
    let nextPanelId = 0;
</script>

<script lang="ts">
    import { tick } from "svelte";

    export let options: { value: string; label: string }[] = [];
    export let selected: string = "order";
    export let ascending: boolean = false;
    export let i18n: any;
    export let onChange: (value: string, ascending: boolean) => void;

    let open = false;
    let containerEl: HTMLElement;
    let triggerEl: HTMLButtonElement;
    const panelId = `na-sort-panel-${++nextPanelId}`;

    $: currentLabel = options.find((o) => o.value === selected)?.label || "";
    $: canToggleDirection = selected !== "order";

    function toggle() {
        open = !open;
        if (!open) triggerEl?.focus();
        else void tick().then(() => containerEl?.querySelector<HTMLElement>(".na-sort-select__option")?.focus());
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key !== "Escape" || !open) return;
        {
            event.preventDefault();
            open = false;
            triggerEl?.focus();
        }
    }

    function closeOnOutsideClick(e: MouseEvent) {
        if (containerEl && !containerEl.contains(e.target as Node)) {
            open = false;
        }
    }

    function selectOption(value: string) {
        const newAsc = value === "due" ? true : false;
        onChange(value, newAsc);
        open = false;
        void tick().then(() => triggerEl?.focus());
    }

    function toggleDirection() {
        onChange(selected, !ascending);
    }
</script>

<svelte:window on:click={closeOnOutsideClick} on:keydown={handleKeydown} />

<div class="na-sort-select" bind:this={containerEl}>
    <button
        class="na-sort-select__trigger"
        bind:this={triggerEl}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        on:click={toggle}
        on:keydown={handleKeydown}
    >
        <svg
            viewBox="0 0 12 12"
            width="10"
            height="10"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
        >
            <path d="M3 6l3 3 3-3" />
            <path d="M3 3l3 3 3-3" opacity="0.35" />
        </svg>
        <span class="na-sort-select__label">{currentLabel}</span>
    </button>
    {#if canToggleDirection}
        <button
            class="na-sort-select__dir-btn b3-tooltips b3-tooltips__n"
            on:click={toggleDirection}
            aria-label={ascending ? i18n?.sortAsc || "Ascending" : i18n?.sortDesc || "Descending"}
        >
            {#if ascending}
                <svg
                    viewBox="0 0 12 12"
                    width="10"
                    height="10"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M6 10V2" />
                    <path d="M3 5l3-3 3 3" />
                </svg>
            {:else}
                <svg
                    viewBox="0 0 12 12"
                    width="10"
                    height="10"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M6 2v8" />
                    <path d="M3 7l3 3 3-3" />
                </svg>
            {/if}
        </button>
    {/if}
    {#if open}
        <div
            class="na-sort-select__panel"
            id={panelId}
            role="group"
            aria-label={i18n?.sortBy || "Sort by"}
            tabindex="-1"
        >
            {#each options as opt (opt.value)}
                <button
                    type="button"
                    class="na-sort-select__option"
                    class:na-sort-select__option--active={opt.value === selected}
                    on:click={() => selectOption(opt.value)}
                >
                    <span class="na-sort-select__option-label">{opt.label}</span>
                    {#if opt.value === selected}
                        <svg
                            viewBox="0 0 12 12"
                            width="10"
                            height="10"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M2 6l3 3 5-5" />
                        </svg>
                    {/if}
                </button>
            {/each}
        </div>
    {/if}
</div>

<style lang="scss">
    .na-sort-select {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 0;
    }

    .na-sort-select__trigger {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 26px;
        padding: 0 8px;
        font-size: 11px;
        font-weight: 500;
        --na-filter-active-color: var(--na-filter-sort, var(--b3-theme-primary));
        color: var(--na-filter-active-fg);
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: 6px 0 0 6px;
        cursor: pointer;
        white-space: nowrap;
        transition:
            border-color 0.15s,
            background 0.15s;

        &:focus-visible,
        &:focus-visible + .na-sort-select__dir-btn {
            outline: 2px solid var(--b3-theme-primary);
            outline-offset: 2px;
        }

        &:hover {
            border-color: var(--na-filter-active-border);
            background: var(--b3-theme-surface-light);
        }
    }

    .na-sort-select__label {
        line-height: 1;
    }

    .na-sort-select__dir-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 26px;
        padding: 0;
        font-size: 11px;
        font-weight: 500;
        --na-filter-active-color: var(--na-filter-sort, var(--b3-theme-primary));
        color: var(--na-filter-active-fg);
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-left: none;
        border-radius: 0 6px 6px 0;
        cursor: pointer;
        transition:
            background 0.15s,
            border-color 0.15s;

        &:hover {
            background: var(--b3-theme-surface-light);
            border-color: var(--na-filter-active-border);
        }
    }

    .na-sort-select__panel {
        position: absolute;
        z-index: 20;
        top: calc(100% + 4px);
        right: 0;
        min-width: 140px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        box-shadow: var(--na-shadow-md);
        padding: 4px 0;
    }

    .na-sort-select__option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 6px 10px;
        font-size: 11px;
        color: var(--b3-theme-on-background);
        cursor: pointer;
        border-radius: 4px;
        margin: 0 4px;
        transition: background 0.1s;

        &:focus-visible {
            outline: 2px solid var(--b3-theme-primary);
            outline-offset: -2px;
        }

        &:hover {
            background: var(--na-color-hover-bg);
        }
    }

    .na-sort-select__option--active {
        --na-filter-active-color: var(--na-filter-sort, var(--b3-theme-primary));
        color: var(--na-filter-active-fg);
        font-weight: 500;
        background: var(--na-filter-active-bg);

        svg {
            color: var(--na-filter-active-fg);
        }

        &:hover {
            background: var(--na-filter-active-bg-hover);
        }
    }

    .na-sort-select__option-label {
        line-height: 1.2;
    }
</style>
