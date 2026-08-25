<script lang="ts">
    import type { I18nStrings } from "../../../shared/i18n";
    import type { TaskCacheEntry } from "../../../shared/types";
    import { ATTR_DOD, ATTR_OUTCOME } from "../../../shared/constants";
    import {
        ProjectDefinitionController,
        type ProjectDefinitionField,
        type ProjectDefinitionSnapshot,
        type ProjectDefinitionValues,
    } from "../../controllers/project-definition-controller";
    import { formatRpcError } from "../../error-format";
    import NaButton from "../../ui/NaButton.svelte";
    import NaInlineNotice from "../../ui/NaInlineNotice.svelte";
    import NaPropertyRow from "../../ui/NaPropertyRow.svelte";

    export let project: TaskCacheEntry;
    export let i18n: I18nStrings;
    export let onSave: ((task: TaskCacheEntry, attrs: Record<string, string>) => Promise<TaskCacheEntry>) | undefined =
        undefined;

    const fields: ProjectDefinitionField[] = ["outcome", "dod"];
    const attrByField = { outcome: ATTR_OUTCOME, dod: ATTR_DOD } as const;

    let activeProjectId = project.blockId;
    let controller = createController(project);
    let snapshot: ProjectDefinitionSnapshot = controller.snapshot;

    function valuesFromTask(task: TaskCacheEntry): ProjectDefinitionValues {
        return { outcome: task.outcome || "", dod: task.dod || "" };
    }

    function createController(task: TaskCacheEntry): ProjectDefinitionController {
        return new ProjectDefinitionController(valuesFromTask(task), {
            save: async (field, value) => {
                if (!onSave) throw new Error(i18n?.errNotReady || "Task update is unavailable");
                const updated = await onSave(task, { [attrByField[field]]: value });
                return valuesFromTask(updated);
            },
            formatError: (error) => formatRpcError(error, i18n),
        });
    }

    function refresh(): void {
        snapshot = controller.snapshot;
    }

    function edit(field: ProjectDefinitionField, event: Event): void {
        controller.edit(field, (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value);
        refresh();
    }

    async function save(field: ProjectDefinitionField): Promise<void> {
        const pending = controller.save(field);
        refresh();
        await pending;
        refresh();
    }

    function cancel(field: ProjectDefinitionField): void {
        controller.cancel(field);
        refresh();
    }

    function reloadRemote(field: ProjectDefinitionField): void {
        controller.reloadRemote(field);
        refresh();
    }

    function keepDraft(field: ProjectDefinitionField): void {
        controller.keepDraft(field);
        refresh();
    }

    $: if (project.blockId !== activeProjectId) {
        activeProjectId = project.blockId;
        controller = createController(project);
        refresh();
    }

    $: if (project.blockId === activeProjectId) {
        controller.sync(valuesFromTask(project));
        refresh();
    }
    $: anySaving = fields.some((field) => snapshot[field].saveState === "saving");
</script>

<section class="na-project-definition" aria-labelledby="na-project-definition-title">
    <div class="na-project-definition__heading">
        <div>
            <h3 id="na-project-definition-title">{i18n?.detailGroupProjectDefinition || "Project definition"}</h3>
            <p>
                {i18n?.projectDefinitionSourceHint ||
                    "These properties control the project; document content remains free-form notes."}
            </p>
        </div>
    </div>

    {#each fields as field}
        {@const state = snapshot[field]}
        {@const fieldId = `na-project-definition-${field}`}
        {@const fieldSaving = state.saveState === "saving"}
        <div class="na-project-definition__field">
            <NaPropertyRow
                label={field === "outcome"
                    ? i18n?.outcome || "Outcome"
                    : i18n?.definitionOfDone || "Definition of Done"}
                description={field === "outcome"
                    ? i18n?.outcomeHint || "The result this project is meant to create"
                    : i18n?.dodHint || "Conditions to check before confirming completion"}
                forId={fieldId}
                stacked
                disabled={!onSave}
            >
                {#if field === "outcome"}
                    <input
                        id={fieldId}
                        class="b3-text-field na-project-definition__input"
                        type="text"
                        value={state.draft}
                        placeholder={i18n?.outcomePlaceholder || "Describe the result in one sentence"}
                        disabled={!onSave || anySaving}
                        aria-describedby={`${fieldId}-feedback`}
                        on:input={(event) => edit(field, event)}
                    />
                {:else}
                    <textarea
                        id={fieldId}
                        class="b3-text-field na-project-definition__input na-project-definition__textarea"
                        rows="3"
                        value={state.draft}
                        placeholder={i18n?.dodPlaceholder ||
                            "Describe the conditions that mean the outcome is achieved"}
                        disabled={!onSave || anySaving}
                        aria-describedby={`${fieldId}-feedback`}
                        on:input={(event) => edit(field, event)}
                    ></textarea>
                {/if}
            </NaPropertyRow>

            <div class="na-project-definition__actions">
                <NaButton
                    size="sm"
                    variant="primary"
                    loading={fieldSaving}
                    disabled={!onSave || anySaving || !state.dirty || state.conflict !== null}
                    on:click={() => save(field)}
                >
                    {state.saveState === "error" ? i18n?.projectDefinitionRetry || "Retry" : i18n?.save || "Save"}
                </NaButton>
                <NaButton size="sm" disabled={!state.dirty || anySaving} on:click={() => cancel(field)}>
                    {i18n?.cancel || "Cancel"}
                </NaButton>
            </div>

            <div id={`${fieldId}-feedback`} class="na-project-definition__feedback">
                {#if state.conflict !== null}
                    <NaInlineNotice
                        message={i18n?.projectDefinitionConflict ||
                            "This field changed elsewhere. Reload the remote value or keep your draft before saving."}
                        tone="warning"
                    />
                    <div class="na-project-definition__conflict-actions">
                        <NaButton size="sm" disabled={anySaving} on:click={() => reloadRemote(field)}>
                            {i18n?.projectDefinitionReloadRemote || "Reload remote"}
                        </NaButton>
                        <NaButton size="sm" variant="primary" disabled={anySaving} on:click={() => keepDraft(field)}>
                            {i18n?.projectDefinitionKeepDraft || "Keep draft"}
                        </NaButton>
                    </div>
                {:else if state.saveState === "error"}
                    <NaInlineNotice message={state.error} tone="error" />
                {:else if state.saveState === "saved"}
                    <NaInlineNotice message={i18n?.saved || "Saved"} tone="success" />
                {:else if fieldSaving}
                    <NaInlineNotice message={i18n?.saving || "Saving…"} />
                {/if}
            </div>
        </div>
    {/each}
</section>

<style lang="scss">
    .na-project-definition {
        min-width: 0;
        margin-bottom: 10px;
        padding: 12px;
        border-top: 2px solid var(--na-accent);
        background: var(--b3-theme-surface);
    }
    .na-project-definition__heading {
        margin-bottom: 4px;
    }
    .na-project-definition__heading h3 {
        margin: 0;
        color: var(--na-text-primary);
        font-size: var(--na-font-size-md);
        font-weight: 700;
    }
    .na-project-definition__heading p {
        margin: 3px 0 0;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        line-height: 1.45;
    }
    .na-project-definition__field + .na-project-definition__field {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid var(--na-color-divider);
    }
    .na-project-definition__input {
        width: 100%;
    }
    .na-project-definition__textarea {
        box-sizing: border-box;
        min-height: 72px;
        resize: vertical;
        font-family: var(--b3-font-family);
        font-size: var(--na-font-size-md);
        line-height: 1.5;
    }
    .na-project-definition__actions,
    .na-project-definition__conflict-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--na-space-sm);
        margin-top: var(--na-space-sm);
    }
    .na-project-definition__feedback:empty {
        display: none;
    }
    .na-project-definition__feedback:not(:empty) {
        margin-top: var(--na-space-sm);
    }
    @container nextaction-app (max-width: 520px) {
        .na-project-definition {
            padding: 10px;
        }
    }
</style>
