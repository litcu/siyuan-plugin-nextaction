<script lang="ts">
    import { get } from "svelte/store";
    import { onMount } from "svelte";
    import type { KernelBridge } from "../kernel-bridge";
    import type { TaskCacheEntry } from "../../shared/types";
    import type { CreateTaskDestinationType, CreateTaskFormat, CreateTaskInput } from "../../shared/task-creation";
    import { PRIORITY_LIST, STATUS_LIST } from "../constants";
    import { taskStore } from "../stores/task-store";
    import { formatRpcError, notifyInfo } from "../notify";
    import { toI18nKey } from "../utils";
    import NaButton from "../ui/NaButton.svelte";
    import NaAccordion from "../ui/NaAccordion.svelte";
    import NaDatePicker from "../ui/NaDatePicker.svelte";
    import NaDocumentPicker from "../ui/NaDocumentPicker.svelte";
    import NaIcon from "../ui/NaIcon.svelte";
    import NaInlineNotice from "../ui/NaInlineNotice.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";

    export let bridge: KernelBridge;
    export let i18n: any;
    export let dialog: any;
    export let parentTask: TaskCacheEntry | null = null;
    export let onCreated: ((task: TaskCacheEntry) => void) | undefined = undefined;

    type TargetMode = CreateTaskDestinationType;
    type DocumentSelection = { id: string; title: string; notebookId: string; notebookName: string; path: string; icon: string };

    const initialSettings = get(taskStore).settings;
    let title = "";
    let kind: "task" | "project" = "task";
    let status = "inbox";
    let priority = "medium";
    let start = "";
    let due = "";
    let contextsText = "";
    let tagsText = "";
    let note = "";
    let targetMode: TargetMode = parentTask ? "block" : initialSettings.mcpSettings.defaultCreateTarget;
    let format: CreateTaskFormat = parentTask ? "list" : "paragraph";
    let selectedDocument: DocumentSelection | null = null;
    let notebooks: Array<{ id: string; name: string; icon: string }> = [];
    let dailyNotebookId = initialSettings.mcpSettings.dailyNoteNotebookId;
    let busy = false;
    let error = "";
    let morePropertiesOpen = false;
    let titleInput: HTMLInputElement;

    const kindOptions = [
        { value: "task", label: i18n?.task || "Task" },
        { value: "project", label: i18n?.project || "Project" },
    ];
    const formatOptions = [
        { value: "paragraph", label: i18n?.createFormatParagraph || "Text" },
        { value: "list", label: i18n?.createFormatList || "List" },
    ];

    $: locationOptions = [
        { value: "inbox", label: i18n?.createInbox || "Inbox" },
        { value: "daily_note", label: i18n?.createDailyNote || "Daily note" },
        { value: "document", label: i18n?.createDocument || "Document" },
        ...(parentTask && kind === "task" ? [{ value: "block", label: i18n?.createChildTask || "Child task" }] : []),
    ];
    $: if (kind === "project" && targetMode === "block") targetMode = "document";
    $: if (targetMode === "block") format = "list";
    $: if (kind === "project") format = "paragraph";
    $: morePropertiesCount = [contextsText, tagsText, note].filter(value => value.trim()).length;

    onMount(async () => {
        titleInput?.focus();
        try {
            notebooks = await bridge.listMcpTargetNotebooks();
            if (dailyNotebookId && !notebooks.some(notebook => notebook.id === dailyNotebookId)) dailyNotebookId = "";
            if (!dailyNotebookId) dailyNotebookId = notebooks[0]?.id || "";
        } catch {
            notebooks = [];
            dailyNotebookId = "";
        }
    });

    function splitValues(value: string): string[] {
        return [...new Set(value.split(/[,，|]/).map(item => item.trim()).filter(Boolean))];
    }

    function changeKind(event: CustomEvent<string>) {
        kind = event.detail as "task" | "project";
    }

    function changeFormat(event: CustomEvent<string>) {
        format = event.detail as CreateTaskFormat;
    }

    function buildInput(): CreateTaskInput | null {
        const cleanTitle = title.replace(/[\r\n]+/g, " ").trim();
        if (!cleanTitle) {
            error = i18n?.createTitleRequired || "Enter a task title";
            return null;
        }
        if (targetMode === "document" && !selectedDocument) {
            error = i18n?.createSelectDocumentError || "Select a document first";
            return null;
        }
        if (targetMode === "daily_note" && !dailyNotebookId) {
            error = i18n?.createSelectNotebookError || "Select a notebook first";
            return null;
        }
        if (targetMode === "block" && !parentTask) {
            error = i18n?.createParentUnavailable || "Parent task is unavailable";
            return null;
        }
        const destination = targetMode === "document"
            ? { type: "document" as const, documentId: selectedDocument!.id, format }
            : targetMode === "daily_note"
                ? { type: "daily_note" as const, notebookId: dailyNotebookId, format }
                : targetMode === "block"
                    ? { type: "block" as const, parentBlockId: parentTask!.blockId, format: "list" as const }
                    : { type: "inbox" as const, format };
        return {
            title: cleanTitle,
            kind,
            destination,
            properties: {
                status,
                priority,
                ...(start ? { start } : {}),
                ...(due ? { due } : {}),
                ...(contextsText.trim() ? { contexts: splitValues(contextsText) } : {}),
                ...(tagsText.trim() ? { tags: splitValues(tagsText) } : {}),
                ...(note.trim() ? { note: note.trim() } : {}),
            },
        };
    }

    async function submit() {
        error = "";
        const input = buildInput();
        if (!input) return;
        busy = true;
        try {
            const result = await bridge.createTask(input);
            const createdTask = await bridge.getTask(result.task.id);
            if (!createdTask) throw new Error(i18n?.createTaskUnavailable || "Created task is not available yet");
            for (const warning of result.warnings || []) notifyInfo(warning);
            onCreated?.(createdTask);
            dialog?.destroy?.();
        } catch (cause: any) {
            error = formatRpcError(cause, i18n);
        } finally {
            busy = false;
        }
    }
</script>

<form class="na-create-task" on:submit|preventDefault={submit}>
    <div class="na-create-task__composer">
        <div class="na-create-task__title-row">
            <span class="na-create-task__kind-mark" class:na-create-task__kind-mark--project={kind === "project"} aria-hidden="true">
                <NaIcon symbol={kind === "project" ? "iconFile" : "iconCheck"} size={16} />
            </span>
            <input
                bind:this={titleInput}
                class="na-create-task__title"
                bind:value={title}
                maxlength="512"
                disabled={busy}
                placeholder={i18n?.createTitlePlaceholder || "What needs to be done?"}
                aria-label={i18n?.createTask || "Create task"}
            />
        </div>
        <div class="na-create-task__kind-row">
            <span>{i18n?.taskType || "Task type"}</span>
            <NaSegmentControl options={kindOptions} value={kind} size="sm" label={i18n?.taskType || "Task type"} disabled={busy} on:change={changeKind} />
        </div>
    </div>

    <section class="na-create-task__section na-create-task__section--properties">
        <header class="na-create-task__section-header">
            <span class="na-create-task__section-icon"><NaIcon symbol="iconCalendar" size={14} /></span>
            <h3>{i18n?.createProperties || "Properties"}</h3>
        </header>
        <div class="na-create-task__grid">
            <label class="na-create-task__field">
                <span>{i18n?.status || "Status"}</span>
                <select class="na-select" bind:value={status} disabled={busy}>{#each STATUS_LIST as item}<option value={item}>{i18n?.[toI18nKey("status", item)] || item}</option>{/each}</select>
            </label>
            <label class="na-create-task__field">
                <span>{i18n?.priority || "Priority"}</span>
                <select class="na-select" bind:value={priority} disabled={busy}>{#each PRIORITY_LIST as item}<option value={item}>{i18n?.[toI18nKey("priority", item)] || item}</option>{/each}</select>
            </label>
            <div class="na-create-task__field">
                <span>{i18n?.startDate || "Start"}</span>
                <NaDatePicker bind:value={start} {i18n} disabled={busy} fixedDropdown />
            </div>
            <div class="na-create-task__field">
                <span>{i18n?.dueDate || "Due"}</span>
                <NaDatePicker bind:value={due} {i18n} disabled={busy} fixedDropdown />
            </div>
        </div>

        <NaAccordion
            title={i18n?.createMoreProperties || "More properties"}
            icon="iconList"
            variant="plain"
            bind:open={morePropertiesOpen}
            count={morePropertiesCount || undefined}
        >
            <div class="na-create-task__more-grid">
                <label class="na-create-task__field">
                    <span>{i18n?.context || "Context"}</span>
                    <input class="na-input" bind:value={contextsText} disabled={busy} placeholder={i18n?.createValuesPlaceholder || "Comma separated"} />
                </label>
                <label class="na-create-task__field">
                    <span>{i18n?.tag || "Tag"}</span>
                    <input class="na-input" bind:value={tagsText} disabled={busy} placeholder={i18n?.createValuesPlaceholder || "Comma separated"} />
                </label>
                <label class="na-create-task__field na-create-task__field--full">
                    <span>{i18n?.note || "Note"}</span>
                    <textarea class="na-create-task__note" bind:value={note} maxlength="4000" rows="3" disabled={busy}></textarea>
                </label>
            </div>
        </NaAccordion>
    </section>

    <section class="na-create-task__section na-create-task__section--destination">
        <header class="na-create-task__section-header">
            <span class="na-create-task__section-icon"><NaIcon symbol="iconInbox" size={14} /></span>
            <h3>{i18n?.createSaveOptions || "Save"}</h3>
        </header>
        <div class="na-create-task__save-grid">
            <label class="na-create-task__field">
                <span>{i18n?.createLocation || "Location"}</span>
                <select class="na-select" bind:value={targetMode} disabled={busy}>
                    {#each locationOptions as option}<option value={option.value}>{option.label}</option>{/each}
                </select>
            </label>
            {#if targetMode !== "block" && kind !== "project"}
                <div class="na-create-task__field">
                    <span>{i18n?.createFormat || "Format"}</span>
                    <NaSegmentControl options={formatOptions} value={format} size="sm" stretch label={i18n?.createFormat || "Format"} disabled={busy} on:change={changeFormat} />
                </div>
            {/if}
            {#if targetMode === "daily_note"}
                <label class="na-create-task__field na-create-task__field--full">
                    <span>{i18n?.createNotebook || "Notebook"}</span>
                    <select class="na-select" bind:value={dailyNotebookId} disabled={busy}>
                        <option value="">{i18n?.createSelectNotebook || "Select notebook"}</option>
                        {#each notebooks as notebook}<option value={notebook.id}>{notebook.name}</option>{/each}
                    </select>
                </label>
            {:else if targetMode === "document"}
                <div class="na-create-task__field na-create-task__field--full">
                    <span>{i18n?.createDocument || "Document"}</span>
                    <NaDocumentPicker {bridge} {i18n} bind:value={selectedDocument} disabled={busy} fixedDropdown />
                </div>
            {:else if targetMode === "block" && parentTask}
                <div class="na-create-task__parent na-create-task__field--full">
                    <NaIcon symbol="iconFile" size={14} />
                    <span>{parentTask.title}</span>
                </div>
            {/if}
        </div>
    </section>

    {#if error}<div class="na-create-task__error"><NaInlineNotice message={error} tone="error" /></div>{/if}

    <footer class="na-create-task__actions">
        <NaButton disabled={busy} on:click={() => dialog?.destroy?.()}>{i18n?.cancel || "Cancel"}</NaButton>
        <NaButton type="submit" variant="primary" icon="iconAdd" loading={busy}>{i18n?.createTask || "Create task"}</NaButton>
    </footer>
</form>

<style lang="scss">
    .na-create-task { display: grid; max-height: min(78vh, 720px); overflow-x: hidden; overflow-y: auto; color: var(--b3-theme-on-surface); background: var(--b3-theme-surface); }
    .na-create-task__composer { margin: 16px 18px; padding: 13px 14px 10px; border: 1px solid color-mix(in srgb, var(--b3-theme-primary) 24%, var(--na-color-divider)); border-left: 3px solid var(--b3-theme-primary); border-radius: 7px; background: color-mix(in srgb, var(--b3-theme-primary) 3%, var(--b3-theme-background)); transition: border-color 140ms ease, background 140ms ease; }
    .na-create-task__composer:focus-within { border-color: color-mix(in srgb, var(--b3-theme-primary) 58%, var(--na-color-divider)); background: var(--b3-theme-surface); }
    .na-create-task__title-row { display: grid; grid-template-columns: 28px minmax(0, 1fr); align-items: center; gap: 8px; }
    .na-create-task__kind-mark { display: grid; place-items: center; width: 26px; height: 26px; border: 1px solid color-mix(in srgb, var(--b3-theme-primary) 36%, var(--na-color-divider)); border-radius: 6px; color: var(--b3-theme-primary); background: var(--b3-theme-primary-lightest); }
    .na-create-task__kind-mark--project { color: var(--b3-card-warning-color); background: var(--na-color-warning-bg); border-color: var(--na-color-warning-border); }
    .na-create-task__title { width: 100%; height: 34px; padding: 0; box-sizing: border-box; border: 0; outline: 0; color: var(--b3-theme-on-surface); background: transparent; font: 650 17px/1.2 var(--b3-font-family); letter-spacing: 0; }
    .na-create-task__title::placeholder { color: var(--b3-theme-on-surface-light); font-weight: 450; }
    .na-create-task__kind-row { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 8px; padding-top: 9px; border-top: 1px solid color-mix(in srgb, var(--na-color-divider) 68%, transparent); }
    .na-create-task__kind-row > span { color: var(--b3-theme-on-surface-light); font-size: var(--na-font-size-sm); }
    .na-create-task__section { padding: 15px 18px 17px; border-top: 1px solid var(--na-color-divider); }
    .na-create-task__section-header { display: flex; align-items: center; gap: 8px; min-height: 20px; margin-bottom: 12px; }
    .na-create-task__section-header h3 { margin: 0; color: var(--b3-theme-on-surface); font-size: var(--na-font-size-md); font-weight: 650; letter-spacing: 0; }
    .na-create-task__section-icon { display: grid; place-items: center; color: var(--b3-theme-on-surface-light); }
    .na-create-task__grid, .na-create-task__save-grid, .na-create-task__more-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px 14px; }
    .na-create-task__field { display: grid; align-content: start; gap: 6px; min-width: 0; margin: 0; }
    .na-create-task__field > span:first-child { color: var(--b3-theme-on-surface-light); font-size: var(--na-font-size-sm); font-weight: 500; line-height: 1.2; }
    .na-create-task__field :global(.na-select), .na-create-task__field > .na-input { width: 100%; min-width: 0; height: var(--na-control-height-sm); }
    .na-create-task__field--full { grid-column: 1 / -1; }
    .na-create-task__more-grid { padding-top: 11px; }
    .na-create-task__note { width: 100%; min-height: 74px; padding: 8px 9px; resize: vertical; box-sizing: border-box; border: 1px solid var(--na-color-divider); border-radius: var(--na-radius-sm); outline: 0; color: var(--b3-theme-on-surface); background: var(--b3-theme-background); font: inherit; }
    .na-create-task__note:focus { border-color: var(--b3-theme-primary); }
    .na-create-task__parent { display: flex; align-items: center; gap: 8px; overflow: hidden; padding: 9px 10px; border: 1px solid var(--na-color-divider); border-radius: var(--na-radius-sm); color: var(--b3-theme-on-surface); background: var(--b3-theme-background); font-size: var(--na-font-size-md); }
    .na-create-task__parent span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .na-create-task__error { padding: 0 18px 11px; }
    .na-create-task__actions { position: sticky; bottom: 0; display: flex; justify-content: flex-end; gap: 8px; padding: 11px 18px max(11px, env(safe-area-inset-bottom)); border-top: 1px solid var(--na-color-divider); background: color-mix(in srgb, var(--b3-theme-surface) 94%, var(--b3-theme-background)); z-index: 2; }
    @media (max-width: 500px) {
        .na-create-task__composer { margin: 12px; }
        .na-create-task__title { font-size: 16px; }
        .na-create-task__section { padding-inline: 12px; }
        .na-create-task__grid, .na-create-task__save-grid, .na-create-task__more-grid { grid-template-columns: minmax(0, 1fr); }
        .na-create-task__field--full { grid-column: auto; }
        .na-create-task__error { padding-inline: 12px; }
        .na-create-task__actions { padding-inline: 12px; }
    }
</style>
