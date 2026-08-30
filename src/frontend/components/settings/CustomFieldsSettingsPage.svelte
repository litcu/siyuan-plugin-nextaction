<script lang="ts">
    import {
        CUSTOM_FIELD_TYPES,
        isValidCustomFieldKey,
        normalizeCustomFieldKey,
        type CustomFieldDef,
        type CustomFieldOption,
        type CustomFieldType,
    } from "../../../shared/custom-fields";
    import type { I18nStrings } from "../../../shared/i18n";
    import { customFieldTypeI18nKey, translateKey } from "../../i18n";
    import NaIcon from "../../ui/NaIcon.svelte";

    export let i18n: I18nStrings;
    export let customFields: CustomFieldDef[];
    export let customFieldUsage: Record<string, number> = {};
    export let purgingFieldId = "";
    export let onPurgeField: (field: CustomFieldDef) => void;

    let builderOpen = false;
    let newFieldKey = "";
    let newFieldLabel = "";
    let newFieldType: CustomFieldType = "text";
    let newFieldOptions = "";
    let newFieldScope: "all" | "task" | "project" | "projectTree" = "all";
    let newFieldProjectIds = "";
    let newFieldShowOnCard = true;
    let error = "";

    function typeLabel(type: CustomFieldType): string {
        const fallback: Record<CustomFieldType, string> = {
            text: "Text",
            textarea: "Long text",
            number: "Number",
            boolean: "Yes / No",
            date: "Date",
            datetime: "Date & time",
            singleSelect: "Single select",
            multiSelect: "Multi-select",
            url: "URL",
        };
        return translateKey(i18n, customFieldTypeI18nKey(type), fallback[type]);
    }

    function scopeLabel(scope: CustomFieldDef["scope"]): string {
        if (scope.mode === "task") return i18n?.customFieldScopeTask || "Tasks only";
        if (scope.mode === "project") return i18n?.customFieldScopeProject || "Projects only";
        if (scope.mode === "projectTree") return i18n?.customFieldScopeTree || "Project tree";
        return i18n?.customFieldScopeAll || "All tasks";
    }

    function createFieldId(): string {
        try {
            return crypto.randomUUID();
        } catch (_e) {
            return `field-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        }
    }

    function scopeFromForm(): CustomFieldDef["scope"] {
        if (newFieldScope === "task" || newFieldScope === "project") return { mode: newFieldScope };
        if (newFieldScope === "projectTree")
            return {
                mode: "projectTree",
                projectIds: newFieldProjectIds
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
            };
        return { mode: "all" };
    }

    function parseOptions(): CustomFieldOption[] | undefined {
        if (newFieldType !== "singleSelect" && newFieldType !== "multiSelect") return undefined;
        const labels = newFieldOptions
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
        if (!labels.length) return undefined;
        return labels.map((label, index) => ({
            id: `option-${index + 1}-${
                label
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "") || "value"
            }`,
            label,
            status: "active" as const,
        }));
    }

    function resetBuilder() {
        newFieldKey = "";
        newFieldLabel = "";
        newFieldType = "text";
        newFieldOptions = "";
        newFieldScope = "all";
        newFieldProjectIds = "";
        newFieldShowOnCard = true;
        error = "";
    }

    function addField() {
        error = "";
        const key = normalizeCustomFieldKey(newFieldKey);
        const label = newFieldLabel.trim();
        if (!key) {
            error = i18n?.customFieldKeyRequired || "Key is required";
            return;
        }
        if (!isValidCustomFieldKey(key)) {
            error = i18n?.customFieldKeyInvalid || "Key must use lowercase letters, digits and hyphens";
            return;
        }
        if (!label) {
            error = i18n?.customFieldLabelRequired || "Label is required";
            return;
        }
        if (customFields.some((field) => field.key === key)) {
            error = i18n?.customFieldKeyDuplicate || "Key already exists";
            return;
        }
        customFields = [
            ...customFields,
            {
                version: 2,
                id: createFieldId(),
                key,
                label,
                description: "",
                type: newFieldType,
                status: "active",
                scope: scopeFromForm(),
                showOnCard: newFieldShowOnCard,
                options: parseOptions(),
            },
        ];
        resetBuilder();
        builderOpen = false;
    }

    function updateField(index: number, patch: Partial<CustomFieldDef>) {
        const next = [...customFields];
        next[index] = { ...next[index], ...patch };
        customFields = next;
    }

    function updateType(index: number, value: string) {
        if (!(CUSTOM_FIELD_TYPES as readonly string[]).includes(value)) return;
        const field = customFields[index];
        if ((customFieldUsage[field.key] || 0) > 0 && value !== field.type) {
            error = i18n?.customFieldTypeLocked || "A field with existing values cannot change type";
            return;
        }
        updateField(index, { type: value as CustomFieldType });
        error = "";
    }

    function updateScope(index: number, value: string) {
        if (value === "task" || value === "project") updateField(index, { scope: { mode: value } });
        else if (value === "projectTree")
            updateField(index, {
                scope: {
                    mode: "projectTree",
                    projectIds:
                        customFields[index].scope.mode === "projectTree" ? customFields[index].scope.projectIds : [],
                },
            });
        else updateField(index, { scope: { mode: "all" } });
    }

    function updateOptions(index: number, raw: string) {
        const previous = customFields[index].options || [];
        const options = raw
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
            .map((label, optionIndex) => ({
                id:
                    previous[optionIndex]?.id ||
                    `option-${optionIndex + 1}-${
                        label
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .replace(/^-|-$/g, "") || "value"
                    }`,
                label,
                status: previous[optionIndex]?.status || "active",
            }));
        updateField(index, { options });
    }

    function toggleStatus(index: number) {
        const field = customFields[index];
        updateField(index, {
            status: field.status === "active" ? "archived" : "active",
            showOnCard: field.status === "active" ? false : field.showOnCard,
        });
    }

    function moveField(index: number, direction: -1 | 1) {
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= customFields.length) return;
        const next = [...customFields];
        [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
        customFields = next;
    }

    function purgeField(field: CustomFieldDef) {
        if (field.status !== "archived") return;
        onPurgeField(field);
    }
</script>

<div class="na-page-stack na-settings-custom-fields">
    <div class="na-settings-custom-fields__toolbar">
        <div>
            <span class="na-settings-custom-fields__eyebrow">{i18n?.customFieldCollectionKicker || "YOUR SCHEMA"}</span>
            <strong>{i18n?.customFieldExisting || "Existing fields"}</strong>
            <span>{customFields.length} {i18n?.customFieldCount || "fields"}</span>
        </div>
        <button
            type="button"
            class="b3-button b3-button--primary"
            on:click={() => {
                builderOpen = !builderOpen;
                if (!builderOpen) resetBuilder();
            }}
        >
            <NaIcon symbol={builderOpen ? "iconClose" : "iconAdd"} size={14} />
            {builderOpen ? i18n?.cancel || "Cancel" : i18n?.addCustomFieldBtn || "Add field"}
        </button>
    </div>

    {#if builderOpen}
        <section class="na-settings-custom-fields__builder">
            <div class="na-settings-custom-fields__builder-header">
                <div>
                    <span class="na-settings-custom-fields__eyebrow"
                        >{i18n?.customFieldBuilderKicker || "FIELD BUILDER"}</span
                    >
                    <h2>{i18n?.addCustomField || "Add custom field"}</h2>
                    <p>{i18n?.addCustomFieldDesc || "The key cannot be changed after creation."}</p>
                </div>
            </div>
            <div class="na-settings-custom-fields__form">
                <label
                    >{i18n?.customFieldKeyLabel || "Key"}<input
                        class="b3-text-field"
                        bind:value={newFieldKey}
                        placeholder={i18n?.customFieldKeyPlaceholder || "e.g. delegated-to"}
                    /></label
                >
                <label
                    >{i18n?.customFieldLabelPlaceholder || "Label"}<input
                        class="b3-text-field"
                        bind:value={newFieldLabel}
                        placeholder={i18n?.customFieldLabelPlaceholder || "e.g. Delegated to"}
                    /></label
                >
                <label
                    >{i18n?.customFieldType || "Type"}<select class="b3-select" bind:value={newFieldType}
                        >{#each CUSTOM_FIELD_TYPES as type}<option value={type}>{typeLabel(type)}</option
                            >{/each}</select
                    ></label
                >
                {#if newFieldType === "singleSelect" || newFieldType === "multiSelect"}
                    <label
                        >{i18n?.customFieldOptions || "Options"}<input
                            class="b3-text-field"
                            bind:value={newFieldOptions}
                            placeholder={i18n?.customFieldOptionsPlaceholder || "Home, Work, Waiting"}
                        /></label
                    >
                {/if}
                <label
                    >{i18n?.customFieldScope || "Scope"}<select class="b3-select" bind:value={newFieldScope}>
                        <option value="all">{i18n?.customFieldScopeAll || "All tasks"}</option>
                        <option value="task">{i18n?.customFieldScopeTask || "Tasks only"}</option>
                        <option value="project">{i18n?.customFieldScopeProject || "Projects only"}</option>
                        <option value="projectTree">{i18n?.customFieldScopeTree || "Project tree"}</option>
                    </select></label
                >
                {#if newFieldScope === "projectTree"}
                    <label class="wide"
                        >{i18n?.customFieldProjectIds || "Project IDs"}<input
                            class="b3-text-field"
                            bind:value={newFieldProjectIds}
                            placeholder={i18n?.customFieldProjectIdsPlaceholder || "Project block IDs, comma separated"}
                        /></label
                    >
                {/if}
            </div>
            <div class="na-settings-custom-fields__builder-footer">
                <label class="na-settings-custom-fields__check"
                    ><input
                        class="b3-switch"
                        type="checkbox"
                        bind:checked={newFieldShowOnCard}
                    />{i18n?.customFieldShowOnCard || "Show on card"}</label
                >
                {#if error}<span class="na-settings-custom-fields__error">{error}</span>{/if}
                <button type="button" class="b3-button b3-button--primary" on:click={addField}
                    ><NaIcon symbol="iconAdd" size={14} />{i18n?.addCustomFieldBtn || "Add field"}</button
                >
            </div>
        </section>
    {/if}

    {#if error && !builderOpen}<div class="na-settings-custom-fields__error">{error}</div>{/if}

    {#if customFields.length}
        <div class="na-settings-custom-fields__list">
            {#each customFields as field, index (field.id)}
                <article
                    class="na-settings-custom-field"
                    class:na-settings-custom-field--archived={field.status === "archived"}
                >
                    <header class="na-settings-custom-field__header">
                        <div class="na-settings-custom-field__identity">
                            <code>{field.key}</code>
                            <input
                                class="b3-text-field"
                                value={field.label}
                                on:change={(event) => updateField(index, { label: event.currentTarget.value })}
                                aria-label={i18n?.customFieldLabelPlaceholder || "Field label"}
                            />
                            <span>{customFieldUsage[field.key] || 0} {i18n?.customFieldUsed || "used"}</span>
                            {#if field.status === "archived"}<em>{i18n?.archived || "Archived"}</em>{/if}
                        </div>
                        <div class="na-settings-custom-field__actions">
                            <label class="na-settings-custom-field__show-card">
                                <input
                                    class="b3-switch"
                                    type="checkbox"
                                    checked={field.showOnCard && field.status === "active"}
                                    on:change={(event) =>
                                        updateField(index, { showOnCard: event.currentTarget.checked })}
                                    disabled={field.status !== "active"}
                                />
                                <span>{i18n?.customFieldShowOnCard || "Show on card"}</span>
                            </label>
                            <button
                                type="button"
                                class="b3-button b3-button--text b3-tooltips b3-tooltips__n"
                                on:click={() => moveField(index, -1)}
                                disabled={index === 0}
                                aria-label={i18n?.moveUp || "Move up"}><NaIcon symbol="iconUp" size={14} /></button
                            >
                            <button
                                type="button"
                                class="b3-button b3-button--text b3-tooltips b3-tooltips__n"
                                on:click={() => moveField(index, 1)}
                                disabled={index === customFields.length - 1}
                                aria-label={i18n?.moveDown || "Move down"}
                                ><NaIcon symbol="iconDown" size={14} /></button
                            >
                            <button type="button" class="b3-button b3-button--text" on:click={() => toggleStatus(index)}
                                >{field.status === "active"
                                    ? i18n?.archiveCustomField || "Archive"
                                    : i18n?.restoreCustomField || "Restore"}</button
                            >
                            {#if field.status === "archived"}<button
                                    type="button"
                                    class="b3-button b3-button--text na-settings-custom-field__danger"
                                    disabled={purgingFieldId === field.id}
                                    on:click={() => purgeField(field)}>{i18n?.purgeCustomField || "Purge"}</button
                                >{/if}
                        </div>
                    </header>
                    <div class="na-settings-custom-field__details">
                        <label
                            >{i18n?.customFieldType || "Type"}<select
                                class="b3-select"
                                value={field.type}
                                on:change={(event) => updateType(index, event.currentTarget.value)}
                                disabled={field.status === "archived"}
                                >{#each CUSTOM_FIELD_TYPES as type}<option value={type}>{typeLabel(type)}</option
                                    >{/each}</select
                            ></label
                        >
                        <label
                            >{i18n?.customFieldScope || "Scope"}<select
                                class="b3-select"
                                value={field.scope.mode}
                                on:change={(event) => updateScope(index, event.currentTarget.value)}
                                disabled={field.status === "archived"}
                            >
                                <option value="all">{i18n?.customFieldScopeAll || "All tasks"}</option><option
                                    value="task">{i18n?.customFieldScopeTask || "Tasks only"}</option
                                ><option value="project">{i18n?.customFieldScopeProject || "Projects only"}</option
                                ><option value="projectTree">{i18n?.customFieldScopeTree || "Project tree"}</option>
                            </select></label
                        >
                        {#if field.type === "singleSelect" || field.type === "multiSelect"}
                            <label class="wide"
                                >{i18n?.customFieldOptions || "Options"}<input
                                    class="b3-text-field"
                                    value={(field.options || []).map((option) => option.label).join(", ")}
                                    on:change={(event) => updateOptions(index, event.currentTarget.value)}
                                    disabled={field.status === "archived"}
                                /></label
                            >
                        {/if}
                        {#if field.scope.mode === "projectTree"}
                            <label class="wide"
                                >{i18n?.customFieldProjectIds || "Project IDs"}<input
                                    class="b3-text-field"
                                    value={field.scope.projectIds.join(", ")}
                                    on:change={(event) =>
                                        updateField(index, {
                                            scope: {
                                                mode: "projectTree",
                                                projectIds: event.currentTarget.value
                                                    .split(",")
                                                    .map((item) => item.trim())
                                                    .filter(Boolean),
                                            },
                                        })}
                                    disabled={field.status === "archived"}
                                /></label
                            >
                        {/if}
                    </div>
                </article>
            {/each}
        </div>
    {:else}
        <div class="na-settings-custom-fields__empty">
            <NaIcon symbol="iconDatabase" size={28} />
            <strong>{i18n?.customFieldEmpty || "No custom fields yet"}</strong>
            <span>{i18n?.customFieldEmptyHint || "Add fields to extend task attributes."}</span>
        </div>
    {/if}
</div>

<style lang="scss">
    .na-settings-custom-fields__toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 0 2px 2px;
    }
    .na-settings-custom-fields__toolbar > div {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 7px 10px;
    }
    .na-settings-custom-fields__toolbar strong {
        color: var(--na-text-primary);
        font-size: 14px;
    }
    .na-settings-custom-fields__toolbar > div > span:last-child {
        color: var(--na-text-secondary);
        font-size: 11px;
    }
    .na-settings-custom-fields__eyebrow {
        flex-basis: 100%;
        color: var(--na-text-interactive);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
    }
    .na-settings-custom-fields__builder {
        padding: 16px;
        border: 1px solid color-mix(in srgb, var(--b3-theme-primary) 32%, var(--b3-border-color));
        border-left: 3px solid var(--b3-theme-primary);
        border-radius: 0 var(--b3-border-radius-b, 8px) var(--b3-border-radius-b, 8px) 0;
        background: var(--b3-theme-surface);
    }
    .na-settings-custom-fields__builder-header h2 {
        margin: 4px 0 2px;
        color: var(--na-text-primary);
        font-size: 15px;
    }
    .na-settings-custom-fields__builder-header p {
        margin: 0;
        color: var(--na-text-secondary);
        font-size: 11px;
    }
    .na-settings-custom-fields__form {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 15px;
    }
    .na-settings-custom-fields__form label,
    .na-settings-custom-field__details label {
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-width: 0;
        color: var(--na-text-secondary);
        font-size: 10px;
        font-weight: 600;
    }
    .na-settings-custom-fields__form .wide,
    .na-settings-custom-field__details .wide {
        grid-column: 1 / -1;
    }
    .na-settings-custom-fields__builder-footer {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 14px;
    }
    .na-settings-custom-fields__check {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--na-text-secondary);
        font-size: 11px;
    }
    .na-settings-custom-fields__builder-footer > button {
        margin-left: auto;
    }
    .na-settings-custom-fields__error {
        color: var(--na-text-danger);
        font-size: 11px;
    }
    .na-settings-custom-fields__list {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .na-settings-custom-field {
        overflow: hidden;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius-b, 8px);
        background: var(--b3-theme-surface);
    }
    .na-settings-custom-field--archived {
        border-style: dashed;
    }
    .na-settings-custom-field__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 11px 13px;
    }
    .na-settings-custom-field__identity {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px 8px;
        min-width: 0;
    }
    .na-settings-custom-field__identity code {
        display: block;
        box-sizing: border-box;
        width: 104px;
        overflow: hidden;
        padding: 3px 7px;
        border-radius: 4px;
        color: var(--na-text-interactive);
        background: var(--b3-theme-primary-lightest);
        font: 10px var(--b3-font-family-code);
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .na-settings-custom-field__identity :global(.b3-text-field) {
        width: min(220px, 35vw);
        min-width: 120px;
        height: 28px;
    }
    .na-settings-custom-field__identity span,
    .na-settings-custom-field__identity em {
        color: var(--na-text-secondary);
        font-size: 10px;
        font-style: normal;
    }
    .na-settings-custom-field__actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 2px;
        flex: 0 0 auto;
    }
    .na-settings-custom-field__actions label {
        display: inline-flex;
        align-items: center;
        margin-right: 4px;
    }
    .na-settings-custom-field__show-card {
        gap: 6px;
        color: var(--na-text-secondary);
        font-size: 10px;
        white-space: nowrap;
    }
    .na-settings-custom-field__actions :global(.b3-button) {
        min-height: 26px;
        padding: 3px 6px;
        font-size: 10px;
    }
    .na-settings-custom-field__danger {
        color: var(--na-text-danger) !important;
    }
    .na-settings-custom-field__details {
        display: grid;
        grid-template-columns: 160px 160px minmax(0, 1fr);
        gap: 12px;
        padding: 12px 13px 14px;
        border-top: 1px solid var(--b3-border-color);
    }
    .na-settings-custom-fields__empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 7px;
        padding: 35px 16px;
        border: 1px dashed var(--b3-border-color);
        border-radius: var(--b3-border-radius-b, 8px);
        color: var(--na-text-secondary);
        text-align: center;
    }
    .na-settings-custom-fields__empty strong {
        color: var(--na-text-primary);
        font-size: 13px;
    }
    .na-settings-custom-fields__empty span {
        max-width: 280px;
        font-size: 11px;
    }
    @media (max-width: 680px) {
        .na-settings-custom-fields__form,
        .na-settings-custom-field__details {
            grid-template-columns: 1fr;
        }
        .na-settings-custom-fields__form .wide,
        .na-settings-custom-field__details .wide {
            grid-column: auto;
        }
        .na-settings-custom-field__header {
            align-items: flex-start;
            flex-direction: column;
        }
        .na-settings-custom-field__actions {
            justify-content: flex-start;
        }
        .na-settings-custom-field__identity :global(.b3-text-field) {
            width: min(100%, 220px);
        }
    }
</style>
