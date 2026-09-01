<script lang="ts">
    import type { ExtractActionInput } from "../../shared/action-extraction";
    import type { I18nStrings } from "../../shared/i18n";
    import type { TaskActionKind, TaskCacheEntry } from "../../shared/types";
    import { onMount } from "svelte";
    import type { KernelBridge } from "../kernel-bridge";
    import { STATUS_LIST } from "../constants";
    import { statusI18nKey, translateKey } from "../i18n";
    import { formatOperationError } from "../error-format";
    import NaButton from "../ui/NaButton.svelte";
    import NaDatePicker from "../ui/NaDatePicker.svelte";
    import NaDialogShell from "../ui/NaDialogShell.svelte";
    import NaInlineNotice from "../ui/NaInlineNotice.svelte";
    import NaPropertyRow from "../ui/NaPropertyRow.svelte";
    import NaPropertySection from "../ui/NaPropertySection.svelte";
    import NaSearchSelect from "../ui/NaSearchSelect.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";

    export let bridge: KernelBridge;
    export let i18n: I18nStrings;
    export let sourceBlockId: string;
    export let sourceTitle: string;
    export let projects: TaskCacheEntry[] = [];
    export let defaultProjectId = "";
    export let onCreated: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onClose: (() => void) | undefined = undefined;

    let title = sourceTitle;
    let status = "inbox";
    let actionKind: Exclude<TaskActionKind, ""> = "action";
    let start = "";
    let due = "";
    let projectId = defaultProjectId;
    let busy = false;
    let error = "";
    let titleInput: HTMLInputElement;

    const actionKindOptions = [
        { value: "action", label: i18n.actionKindAction },
        { value: "stage", label: i18n.actionKindStage },
    ];

    $: projectLabels = Object.fromEntries(projects.map((project) => [project.blockId, project.title]));
    $: selectedProjectLabel = projectLabels[projectId] || "";

    onMount(() => titleInput?.focus());

    async function searchProjects(query: string): Promise<{ id: string; label: string }[]> {
        const normalized = query.trim().toLowerCase();
        return projects
            .filter((project) => !normalized || project.title.toLowerCase().includes(normalized))
            .slice(0, 8)
            .map((project) => ({ id: project.blockId, label: project.title }));
    }

    function handleActionKindChange(value: string): void {
        actionKind = value as Exclude<TaskActionKind, "">;
    }

    function handleProjectChange(selected: string | string[]): void {
        projectId = typeof selected === "string" ? selected : "";
    }

    async function submit(): Promise<void> {
        if (busy) return;
        const cleanTitle = title.replace(/[\r\n]+/g, " ").trim();
        if (!cleanTitle) {
            error = i18n.createTitleRequired;
            return;
        }
        const input: ExtractActionInput = {
            sourceBlockId,
            title: cleanTitle,
            status,
            actionKind,
            ...(start ? { start } : {}),
            ...(due ? { due } : {}),
            ...(projectId ? { projectId } : {}),
        };
        busy = true;
        error = "";
        try {
            const result = await bridge.extractAction(input);
            onCreated?.(result.task);
        } catch (cause: unknown) {
            error = formatOperationError(cause, i18n);
        } finally {
            busy = false;
        }
    }
</script>

<NaDialogShell
    variant="dialog"
    title={i18n.extractActionTitle}
    subtitle={i18n.extractActionDescription}
    closeLabel={i18n.close}
    onClose={() => onClose?.()}
>
    {#snippet notice()}
        <div>
            {#if error}<NaInlineNotice message={error} tone="error" />{/if}
        </div>
    {/snippet}

    <form class="na-extract-action" on:submit|preventDefault={submit}>
        <div class="na-extract-action__source">
            <strong>{i18n.extractActionSource}</strong>
            <span>{sourceTitle}</span>
            <small>{i18n.extractActionSourcePreserved} {i18n.extractActionInPlaceHint}</small>
        </div>

        <NaPropertySection title={i18n.extractActionTitle}>
            <NaPropertyRow label={i18n.extractActionTaskTitle} forId="na-extract-action-title" stacked>
                <input
                    id="na-extract-action-title"
                    bind:this={titleInput}
                    class="na-input"
                    bind:value={title}
                    maxlength="512"
                    disabled={busy}
                    placeholder={i18n.extractActionTitlePlaceholder}
                />
            </NaPropertyRow>
            <NaPropertyRow label={i18n.actionKind} description={i18n.actionKindHint}>
                <NaSegmentControl
                    options={actionKindOptions}
                    value={actionKind}
                    size="sm"
                    label={i18n.actionKind}
                    disabled={busy}
                    onChange={handleActionKindChange}
                />
            </NaPropertyRow>
            <NaPropertyRow label={i18n.status} forId="na-extract-action-status">
                <select id="na-extract-action-status" class="na-select" bind:value={status} disabled={busy}>
                    {#each STATUS_LIST as item}
                        <option value={item}>{translateKey(i18n, statusI18nKey(item), item)}</option>
                    {/each}
                </select>
            </NaPropertyRow>
            <NaPropertyRow label={i18n.startDate}>
                <NaDatePicker bind:value={start} {i18n} disabled={busy} fixedDropdown />
            </NaPropertyRow>
            <NaPropertyRow label={i18n.dueDate}>
                <NaDatePicker bind:value={due} {i18n} disabled={busy} fixedDropdown />
            </NaPropertyRow>
            <NaPropertyRow label={i18n.extractActionProject} description={projectId ? "" : i18n.extractActionNoProject}>
                <NaSearchSelect
                    selected={projectId}
                    selectedLabel={selectedProjectLabel}
                    initialLabels={projectLabels}
                    searchFn={searchProjects}
                    placeholder={i18n.extractActionProjectPlaceholder}
                    emptyText={i18n.extractActionProjectEmpty}
                    noMatchText={i18n.noMatches}
                    loadingText={i18n.loading}
                    clearLabel={i18n.clearSelection}
                    disabled={busy}
                    fixedDropdown
                    onChange={handleProjectChange}
                />
            </NaPropertyRow>
        </NaPropertySection>
    </form>

    {#snippet footerEnd()}
        <div>
            <NaButton disabled={busy} onclick={() => onClose?.()}>{i18n.cancel}</NaButton>
            <NaButton variant="primary" loading={busy} onclick={submit}>{i18n.extractActionSubmit}</NaButton>
        </div>
    {/snippet}
</NaDialogShell>

<style lang="scss">
    .na-extract-action {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-lg);
        min-width: 0;
        padding: var(--na-space-lg);
    }
    .na-extract-action__source {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--na-space-xs) var(--na-space-md);
        min-width: 0;
        padding: var(--na-space-md);
        border: 1px solid var(--na-color-info-border);
        border-radius: var(--na-radius-md);
        color: var(--b3-card-info-color);
        background: var(--na-color-info-bg);
    }
    .na-extract-action__source span {
        min-width: 0;
        overflow-wrap: anywhere;
    }
    .na-extract-action__source small {
        grid-column: 1 / -1;
        color: var(--na-text-secondary);
        line-height: 1.45;
    }
    :global(.na-extract-action .na-property-section) {
        padding: 0;
    }
    :global(.na-extract-action .na-select),
    :global(.na-extract-action .na-search-select) {
        width: 100%;
    }
    @media (max-width: 420px) {
        .na-extract-action {
            padding: var(--na-space-md);
        }
        .na-extract-action__source {
            grid-template-columns: minmax(0, 1fr);
        }
        .na-extract-action__source small {
            grid-column: 1;
        }
    }
</style>
