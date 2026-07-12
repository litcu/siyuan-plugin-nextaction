<script lang="ts">
    import { onDestroy, createEventDispatcher } from "svelte";

    export let placeholder = "";
    export let multi = false;
    export let selected: string | string[] = multi ? [] : "";
    export let selectedLabel: string = "";
    export let searchFn: (query: string) => Promise<{ id: string; label: string }[]> = () => Promise.resolve([]);
    export let allOptions: string[] = [];
    export let allowCreate: boolean = false;
    export let initialLabels: Record<string, string> = {};
    export let emptyText: string = "No options";
    export let noMatchText: string = "No matches";
    export let loadingText: string = "Loading...";

    const dispatch = createEventDispatcher();

    let input = "";
    let results: { id: string; label: string }[] = [];
    let dropdownOpen = false;
    let searching = false;
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    let containerEl: HTMLElement;
    let inputEl: HTMLInputElement | undefined;
    let _prevInitialLabels: Record<string, string> = initialLabels;
    let labelMap: Map<string, string> = new Map(Object.entries(initialLabels));
    $: if (initialLabels !== _prevInitialLabels) {
        _prevInitialLabels = initialLabels;
        const merged = new Map(labelMap);
        for (const [k, v] of Object.entries(initialLabels)) {
            merged.set(k, v);
        }
        labelMap = merged;
    }
    let isClicking = false;

    $: selectedArray = Array.isArray(selected) ? (selected as string[]) : (selected ? [selected] : []);
    $: availableOptions = allOptions.filter(o => !selectedArray.includes(o));
    $: filteredOptions = input.trim()
        ? availableOptions.filter(o => o.toLowerCase().includes(input.trim().toLowerCase())).slice(0, 8)
        : availableOptions.slice(0, 8);
    $: filteredResults = results.filter(r => !selectedArray.includes(r.id));
    $: hasDropdownContent = filteredResults.length > 0 || filteredOptions.length > 0;

    function openDropdown() {
        if (hasDropdownContent) {
            // Cached results available — open immediately, no flicker
            dropdownOpen = true;
        }
        // Always refresh; doSearch will open dropdown when results arrive
        doSearch();
    }

    function handleBoxMousedown() {
        isClicking = true;
    }

    function handleBoxClick() {
        if (dropdownOpen) {
            dropdownOpen = false;
        } else {
            openDropdown();
        }
        if (inputEl) {
            inputEl.focus();
        }
        setTimeout(() => { isClicking = false; }, 0);
    }

    function clearAndReopen() {
        selected = "";
        selectedLabel = "";
        results = [];
        input = "";
        dispatch("change");
        // Focus input after Svelte updates the DOM (input becomes visible)
        setTimeout(() => {
            if (inputEl) inputEl.focus();
            openDropdown();
        }, 0);
    }

    async function doSearch() {
        searching = true;
        try {
            if (searchFn) {
                results = await searchFn(input.trim() || "");
                for (const r of results) {
                    labelMap.set(r.id, r.label);
                }
            } else {
                results = [];
            }
            // Open (or keep open) now that we have results
            if (hasDropdownContent || allowCreate) {
                dropdownOpen = true;
            } else if (allOptions.length === 0) {
                // No searchFn and no allOptions — still show dropdown with "No options"
                dropdownOpen = true;
            } else {
                dropdownOpen = false;
            }
        } catch (e) {
            results = [];
            dropdownOpen = false;
        } finally {
            searching = false;
        }
    }

    function onInputChange() {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(doSearch, 200);
    }

    function selectItem(item: { id: string; label: string }) {
        if (multi) {
            const arr = [...selectedArray];
            if (!arr.includes(item.id)) {
                arr.push(item.id);
                selected = arr;
            }
        } else {
            selected = item.id;
            selectedLabel = item.label;
        }
        input = "";
        dropdownOpen = false;
        results = [];
        dispatch("change");
    }

    function selectOption(option: string) {
        selectItem({ id: option, label: option });
    }

    function removeItem(id: string) {
        if (multi) {
            selected = selectedArray.filter(x => x !== id);
        } else {
            selected = "";
            selectedLabel = "";
        }
        dispatch("change");
    }

    function onKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            e.preventDefault();
            if (filteredResults.length > 0) {
                selectItem(filteredResults[0]);
            } else if (allowCreate && input.trim() && multi && !selectedArray.includes(input.trim())) {
                selectItem({ id: input.trim(), label: input.trim() });
            }
        } else if (e.key === "Backspace" && !input && multi && selectedArray.length > 0) {
            removeItem(selectedArray[selectedArray.length - 1]);
        } else if (e.key === "Escape") {
            dropdownOpen = false;
        }
    }

    function closeDropdown(e: MouseEvent) {
        if (containerEl && !containerEl.contains(e.target as Node)) {
            dropdownOpen = false;
        }
    }

    onDestroy(() => {
        if (searchTimer) clearTimeout(searchTimer);
    });
</script>

<svelte:window on:click={closeDropdown} />

<div class="na-search-select" bind:this={containerEl}>
    <div class="na-search-select__box" on:mousedown={handleBoxMousedown} on:click={handleBoxClick}>
        {#if !multi && selected}
            <span class="na-search-select__selected">{selectedLabel || String(selected)}</span>
            <button class="na-search-select__clear" on:click|stopPropagation={clearAndReopen} aria-label="Clear">
                <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <line x1="4" y1="4" x2="12" y2="12" />
                    <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
            </button>
        {:else}
            {#if multi && selectedArray.length > 0}
                <span class="na-search-select__chips">
                    {#each selectedArray as item}
                        <span class="na-search-select__chip">
                            {labelMap.get(item) || item}
                            <button class="na-search-select__chip-remove" on:click|stopPropagation={() => removeItem(item)}>
                                <svg viewBox="0 0 16 16" width="8" height="8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                                    <line x1="4" y1="4" x2="12" y2="12" />
                                    <line x1="12" y1="4" x2="4" y2="12" />
                                </svg>
                            </button>
                        </span>
                    {/each}
                </span>
            {/if}
            <input
                type="text"
                bind:this={inputEl}
                bind:value={input}
                on:input={onInputChange}
                on:keydown={onKeydown}
                on:focus={() => {
                    if (isClicking) return;
                    if (!dropdownOpen) {
                        openDropdown();
                    }
                }}
                placeholder={selectedArray.length ? "" : placeholder}
                class="na-search-select__input"
            />
        {/if}
    </div>
    {#if dropdownOpen}
        <div class="na-search-select__dropdown">
            {#each filteredResults as item}
                <div class="na-search-select__option" on:click={() => selectItem(item)}>
                    {item.label}
                </div>
            {/each}
            {#each filteredOptions as option}
                <div class="na-search-select__option" on:click={() => selectOption(option)}>
                    {option}
                </div>
            {/each}
            {#if allowCreate && multi && input.trim() && !selectedArray.includes(input.trim()) && !filteredOptions.includes(input.trim()) && filteredResults.length === 0}
                <div class="na-search-select__option na-search-select__option--create" on:click={() => selectItem({ id: input.trim(), label: input.trim() })}>
                    + {input.trim()}
                </div>
            {/if}
            {#if filteredResults.length === 0 && filteredOptions.length === 0}
                <div class="na-search-select__empty">
                    {#if searching}
                        {loadingText}
                    {:else if input.trim()}
                        {noMatchText}
                    {:else}
                        {emptyText}
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
</div>

<style lang="scss">
    .na-search-select {
        position: relative;
        width: 100%;
    }

    .na-search-select__box {
        display: flex;
        align-items: center;
        background: var(--b3-theme-background);
        border: 1px solid var(--na-color-divider);
        border-radius: 8px;
        height: 30px;
        padding: 0 8px;
        transition: border-color 0.15s;
        cursor: pointer;

        &:focus-within {
            border-color: var(--b3-theme-primary);
        }
    }

    .na-search-select__selected {
        flex: 1;
        font-size: 12px;
        color: var(--b3-theme-on-background);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .na-search-select__clear {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        padding: 0;
        border: none;
        background: none;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        border-radius: 50%;
        flex-shrink: 0;
        transition: color 0.15s, background 0.15s;

        &:hover {
            color: var(--b3-theme-on-background);
            background: var(--b3-theme-surface-light);
        }
    }

    .na-search-select__chips {
        display: flex;
        gap: 3px;
        overflow: hidden;
        flex-shrink: 0;
    }

    .na-search-select__chip {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 1px 6px;
        background: var(--b3-theme-surface-light);
        border-radius: 4px;
        font-size: 12px;
        color: var(--b3-theme-on-background);
        white-space: nowrap;
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .na-search-select__chip-remove {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 12px;
        height: 12px;
        padding: 0;
        border: none;
        background: none;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        border-radius: 50%;
        flex-shrink: 0;

        &:hover {
            color: var(--b3-theme-on-background);
        }
    }

    .na-search-select__input {
        border: none !important;
        background: none !important;
        outline: none !important;
        padding: 0 !important;
        margin: 0 !important;
        font-size: 12px !important;
        color: var(--b3-theme-on-background);
        flex: 1;
        min-width: 40px;
        height: 100%;
        cursor: text;

        &::placeholder {
            color: var(--b3-theme-on-surface-light);
        }
    }

    .na-search-select__dropdown {
        position: absolute;
        z-index: 10;
        left: 0;
        right: 0;
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: 8px;
        max-height: 200px;
        overflow-y: auto;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
        margin-top: 4px;
        padding: 4px 0;
    }

    .na-search-select__option {
        padding: 6px 12px;
        font-size: 12px;
        color: var(--b3-theme-on-background);
        cursor: pointer;
        transition: background 0.1s;

        &:hover {
            background: var(--b3-theme-surface-light);
        }
    }

    .na-search-select__option--create {
        color: var(--b3-theme-primary);
        font-weight: 500;
    }

    .na-search-select__empty {
        padding: 8px 12px;
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        text-align: center;
    }
</style>
