<script lang="ts">
    import NaFilterDropdown from "../ui/NaFilterDropdown.svelte";
    import NaSortSelect from "../ui/NaSortSelect.svelte";
    import { PRIORITY_LIST, STATUS_LIST } from "../constants";
    import { PRIORITY_COLORS } from "../constants";
    import { toI18nKey } from "../utils";
    import type { FilterState } from "../utils/filter";

    export let contexts: string[] = [];
    export let tags: string[] = [];
    export let filterState: FilterState;
    export let showStatus: boolean = false;
    export let showPriority: boolean = true;
    export let statusValues: readonly string[] = STATUS_LIST;
    export let sortOptions: { value: string; label: string }[] | undefined = undefined;
    export let i18n: any;
    export let onFilterChange: (state: FilterState) => void;

    let searchText = filterState.searchText;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    $: contextOptions = contexts.map(c => ({ value: c, label: c }));
    $: tagOptions = tags.map(t => ({ value: t, label: t }));
    $: priorityOptions = PRIORITY_LIST.map(p => ({
        value: p,
        label: i18n?.[toI18nKey("priority", p)] || p,
        color: PRIORITY_COLORS[p],
    }));
    $: statusOptions = statusValues.map(s => ({
        value: s,
        label: i18n?.[toI18nKey("status", s)] || s,
    }));
    $: computedSortOptions = sortOptions || [
        { value: "order", label: i18n?.sortByOrder || "Priority score" },
        { value: "due", label: i18n?.sortByDue || "Due date" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
        { value: "priority", label: i18n?.sortByPriority || "Manual priority" },
    ];

    function onSearchInput() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            onFilterChange({ ...filterState, searchText });
        }, 300);
    }

    function onContextChange(selected: string[]) {
        onFilterChange({ ...filterState, contexts: selected });
    }

    function onTagChange(selected: string[]) {
        onFilterChange({ ...filterState, tags: selected });
    }

    function onPriorityChange(selected: string[]) {
        onFilterChange({ ...filterState, priorities: selected });
    }

    function onStatusChange(selected: string[]) {
        onFilterChange({ ...filterState, statuses: selected });
    }

    function onSortChange(value: string, ascending: boolean) {
        onFilterChange({ ...filterState, sortBy: value, sortAsc: ascending });
    }
</script>

<div class="na-search-filter-bar">
    <label class="na-search-filter-bar__search">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <circle cx="6.5" cy="6.5" r="4.5" />
            <line x1="10" y1="10" x2="14" y2="14" />
        </svg>
        <input
            type="text"
            bind:value={searchText}
            on:input={onSearchInput}
            placeholder={i18n?.searchPlaceholder || "Search..."}
        />
    </label>
    <div class="na-search-filter-bar__filters">
        <div style="--na-filter-active-color: var(--na-filter-context)">
            <NaFilterDropdown
                label={i18n?.context || "Context"}
                options={contextOptions}
                selected={filterState.contexts}
                {i18n}
                onChange={onContextChange}
            />
        </div>
        <div style="--na-filter-active-color: var(--na-filter-tag, var(--na-accent))">
            <NaFilterDropdown
                label={i18n?.tag || "Tag"}
                options={tagOptions}
                selected={filterState.tags}
                {i18n}
                onChange={onTagChange}
            />
        </div>
        {#if showPriority}
            <div style="--na-filter-active-color: var(--na-filter-priority)">
                <NaFilterDropdown
                    label={i18n?.priority || "Priority"}
                    options={priorityOptions}
                    selected={filterState.priorities}
                    {i18n}
                    onChange={onPriorityChange}
                />
            </div>
        {/if}
        {#if showStatus}
            <div style="--na-filter-active-color: var(--na-filter-status)">
                <NaFilterDropdown
                    label={i18n?.status || "Status"}
                    options={statusOptions}
                    selected={filterState.statuses}
                    {i18n}
                    onChange={onStatusChange}
                />
            </div>
        {/if}
        <NaSortSelect
            options={computedSortOptions}
            selected={filterState.sortBy}
            ascending={filterState.sortAsc}
            {i18n}
            onChange={onSortChange}
        />
    </div>
</div>
