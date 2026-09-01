<script lang="ts">
    import type { CustomFieldDef } from "../../shared/settings";
    import NaDatePicker from "./NaDatePicker.svelte";
    import NaLinkInput from "./NaLinkInput.svelte";
    import NaSearchSelect from "./NaSearchSelect.svelte";
    import NaToggle from "./NaToggle.svelte";

    export let def: CustomFieldDef;
    export let value = "";
    export let i18n: any;
    export let fixedDropdown = true;
    export let disabled = false;

    export let onChange: (value: string) => void = () => {};
    export let onOpen: (value: string) => void = () => {};

    $: placeholder = (
        {
            text: i18n?.customFieldTypeText || "Text",
            textarea: i18n?.customFieldTypeTextarea || "Long text",
            number: i18n?.customFieldTypeNumber || "Number",
            boolean: i18n?.customFieldTypeBoolean || "Yes / No",
            date: i18n?.customFieldTypeDate || "Date",
            datetime: i18n?.customFieldTypeDatetime || "Date & time",
            singleSelect: i18n?.customFieldTypeSingleSelect || "Single select",
            multiSelect: i18n?.customFieldTypeMultiSelect || "Multi-select",
            url: i18n?.customFieldTypeUrl || "URL",
        } as Record<CustomFieldDef["type"], string>
    )[def.type];

    $: selectedIds = (() => {
        if (def.type !== "multiSelect") return [] as string[];
        try {
            const parsed = JSON.parse(value || "[]");
            return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
            return [] as string[];
        }
    })();
    $: optionLabels = Object.fromEntries(
        (def.options || []).map((option) => [
            option.id,
            option.label + (option.status === "archived" ? i18n?.customFieldArchivedOptionSuffix || " (archived)" : ""),
        ]),
    );

    function emit(nextValue: string) {
        value = nextValue;
        onChange(nextValue);
    }

    function searchOptions(query: string, selected: Set<string>) {
        return Promise.resolve(
            (def.options || [])
                .filter((option) => option.status === "active" || selected.has(option.id))
                .filter((option) => !query || option.label.toLowerCase().includes(query.toLowerCase()))
                .map((option) => ({ id: option.id, label: optionLabels[option.id] })),
        );
    }
</script>

{#if def.type === "textarea"}
    <textarea
        class="b3-text-field fn__block"
        rows="3"
        {disabled}
        {placeholder}
        {value}
        oninput={(event) => emit(event.currentTarget.value)}
    ></textarea>
{:else if def.type === "boolean"}
    <div class="na-custom-field-input__toggle">
        <NaToggle
            checked={value === "1" || value === "true"}
            {disabled}
            label={def.label}
            onChange={(checked) => emit(checked ? "1" : "0")}
        />
        <span
            >{value === "1" || value === "true"
                ? i18n?.customFieldBooleanYes || "Yes"
                : i18n?.customFieldBooleanNo || "No"}</span
        >
    </div>
{:else if def.type === "singleSelect"}
    {@const selected = value || ""}
    <NaSearchSelect
        multi={false}
        {selected}
        selectedLabel={optionLabels[selected] || ""}
        initialLabels={optionLabels}
        searchFn={(query) => searchOptions(query, new Set(selected ? [selected] : []))}
        {placeholder}
        emptyText={i18n?.noOptions || "No options"}
        noMatchText={i18n?.noMatches || "No matches"}
        loadingText={i18n?.loadingMore || "Loading..."}
        clearLabel={i18n?.clearSelection || "Clear selection"}
        removeLabel={i18n?.removeSelection || "Remove selection"}
        {fixedDropdown}
        onChange={(selected) => emit(Array.isArray(selected) ? selected[0] || "" : selected)}
    />
{:else if def.type === "multiSelect"}
    <NaSearchSelect
        multi={true}
        selected={selectedIds}
        initialLabels={optionLabels}
        searchFn={(query) => searchOptions(query, new Set(selectedIds))}
        {placeholder}
        emptyText={i18n?.noOptions || "No options"}
        noMatchText={i18n?.noMatches || "No matches"}
        loadingText={i18n?.loadingMore || "Loading..."}
        clearLabel={i18n?.clearSelection || "Clear selection"}
        removeLabel={i18n?.removeSelection || "Remove selection"}
        {fixedDropdown}
        onChange={(selected) => emit(JSON.stringify(Array.isArray(selected) ? selected.map(String) : []))}
    />
{:else if def.type === "date" || def.type === "datetime"}
    <NaDatePicker
        {value}
        {placeholder}
        requireTime={def.type === "datetime"}
        {fixedDropdown}
        {disabled}
        {i18n}
        onChange={emit}
    />
{:else if def.type === "url"}
    <NaLinkInput
        {value}
        {placeholder}
        {i18n}
        openLabel={i18n?.customFieldOpenLink || "Open link"}
        onInput={emit}
        {onOpen}
    />
{:else}
    <input
        class="b3-text-field fn__block"
        type={def.type === "number" ? "number" : "text"}
        {value}
        {placeholder}
        {disabled}
        oninput={(event) => emit(event.currentTarget.value)}
    />
{/if}

<style lang="scss">
    .na-custom-field-input__toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-md);
    }
</style>
