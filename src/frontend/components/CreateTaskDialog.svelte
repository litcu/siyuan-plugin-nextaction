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
    import NaDatePicker from "../ui/NaDatePicker.svelte";
    import NaDocumentPicker from "../ui/NaDocumentPicker.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";
    import NaToggle from "../ui/NaToggle.svelte";

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
    let addToMyDay = false;
    let scheduleStart = "";
    let scheduleEnd = "";
    let targetMode: TargetMode = parentTask ? "block" : initialSettings.mcpSettings.defaultCreateTarget;
    let format: CreateTaskFormat = parentTask ? "list" : "paragraph";
    let selectedDocument: DocumentSelection | null = null;
    let notebooks: Array<{ id: string; name: string; icon: string }> = [];
    let dailyNotebookId = initialSettings.mcpSettings.dailyNoteNotebookId;
    let busy = false;
    let error = "";
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

    function timeToMinutes(value: string): number {
        const [hour, minute] = value.split(":").map(Number);
        return hour * 60 + minute;
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
        let schedule: { start: number; end: number } | undefined;
        if (addToMyDay && (scheduleStart || scheduleEnd)) {
            if (!scheduleStart || !scheduleEnd || timeToMinutes(scheduleEnd) <= timeToMinutes(scheduleStart)) {
                error = i18n?.createScheduleInvalid || "Schedule end must be later than start";
                return null;
            }
            schedule = { start: timeToMinutes(scheduleStart), end: timeToMinutes(scheduleEnd) };
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
            addToMyDay,
            ...(schedule ? { schedule } : {}),
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
    <input
        bind:this={titleInput}
        class="na-create-task__title"
        bind:value={title}
        maxlength="512"
        disabled={busy}
        placeholder={i18n?.createTitlePlaceholder || "What needs to be done?"}
        aria-label={i18n?.createTask || "Create task"}
    />

    <section class="na-create-task__section">
        <h3>{i18n?.createProperties || "Properties"}</h3>
        <div class="na-create-task__grid">
            <div class="na-create-task__field">
                <span>{i18n?.taskType || "Task type"}</span>
                <NaSegmentControl options={kindOptions} value={kind} size="sm" stretch label={i18n?.taskType || "Task type"} disabled={busy} on:change={changeKind} />
            </div>
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
            {#if initialSettings.myDayEnabled}
                <div class="na-create-task__field na-create-task__toggle-field">
                    <span>{i18n?.myDay || "My Day"}</span>
                    <NaToggle checked={addToMyDay} disabled={busy} label={i18n?.myDay || "My Day"} on:change={(event) => addToMyDay = event.detail.checked} />
                </div>
            {/if}
            <label class="na-create-task__field">
                <span>{i18n?.context || "Context"}</span>
                <input class="na-input" bind:value={contextsText} disabled={busy} placeholder={i18n?.createValuesPlaceholder || "Comma separated"} />
            </label>
            <label class="na-create-task__field">
                <span>{i18n?.tag || "Tag"}</span>
                <input class="na-input" bind:value={tagsText} disabled={busy} placeholder={i18n?.createValuesPlaceholder || "Comma separated"} />
            </label>
            {#if addToMyDay}
                <label class="na-create-task__field na-create-task__field--full">
                    <span>{i18n?.createSchedule || "Schedule"}</span>
                    <span class="na-create-task__schedule"><input type="time" bind:value={scheduleStart} disabled={busy} /><span>–</span><input type="time" bind:value={scheduleEnd} disabled={busy} /></span>
                </label>
            {/if}
            <label class="na-create-task__field na-create-task__field--full">
                <span>{i18n?.note || "Note"}</span>
                <textarea class="na-create-task__note" bind:value={note} maxlength="4000" rows="2" disabled={busy}></textarea>
            </label>
        </div>
    </section>

    <section class="na-create-task__section">
        <h3>{i18n?.createSaveOptions || "Save"}</h3>
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
                    <NaDocumentPicker {bridge} {i18n} bind:value={selectedDocument} disabled={busy} />
                </div>
            {:else if targetMode === "block" && parentTask}
                <div class="na-create-task__parent na-create-task__field--full">{parentTask.title}</div>
            {/if}
        </div>
    </section>

    {#if error}<div class="na-create-task__error" role="alert">{error}</div>{/if}

    <footer class="na-create-task__actions">
        <NaButton disabled={busy} on:click={() => dialog?.destroy?.()}>{i18n?.cancel || "Cancel"}</NaButton>
        <NaButton type="submit" variant="primary" icon="iconAdd" loading={busy}>{i18n?.createTask || "Create task"}</NaButton>
    </footer>
</form>

<style lang="scss">
    .na-create-task { display: grid; gap: 0; max-height: min(78vh, 720px); overflow-y: auto; color: var(--b3-theme-on-surface); background: var(--b3-theme-surface); }
    .na-create-task__title { width: auto; height: 44px; margin: 14px 16px 12px; padding: 0 12px; box-sizing: border-box; border: 1px solid var(--na-color-divider); border-radius: var(--na-radius-md); outline: 0; color: var(--b3-theme-on-surface); background: var(--b3-theme-background); font: 600 15px/1 var(--b3-font-family); }
    .na-create-task__title:focus { border-color: var(--b3-theme-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--b3-theme-primary) 12%, transparent); }
    .na-create-task__section { padding: 12px 16px 14px; border-top: 1px solid var(--na-color-divider); }
    .na-create-task__section h3 { margin: 0 0 10px; color: var(--b3-theme-on-surface); font-size: var(--na-font-size-md); font-weight: 600; letter-spacing: 0; }
    .na-create-task__grid, .na-create-task__save-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
    .na-create-task__field { display: grid; align-content: start; gap: 5px; min-width: 0; margin: 0; }
    .na-create-task__field > span:first-child { color: var(--b3-theme-on-surface-light); font-size: var(--na-font-size-sm); line-height: 1.2; }
    .na-create-task__field :global(.na-select), .na-create-task__field > .na-input { width: 100%; min-width: 0; height: var(--na-control-height-sm); }
    .na-create-task__field--full { grid-column: 1 / -1; }
    .na-create-task__toggle-field { grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-height: 50px; padding: 0 2px; }
    .na-create-task__toggle-field > span:first-child { color: var(--b3-theme-on-surface); font-size: var(--na-font-size-md); }
    .na-create-task__note { width: 100%; min-height: 54px; padding: 7px 8px; resize: vertical; box-sizing: border-box; border: 1px solid var(--na-color-divider); border-radius: var(--na-radius-sm); outline: 0; color: var(--b3-theme-on-surface); background: var(--b3-theme-background); font: inherit; }
    .na-create-task__note:focus { border-color: var(--b3-theme-primary); }
    .na-create-task__schedule { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 7px; }
    .na-create-task__schedule input { width: 100%; height: var(--na-control-height-sm); padding: 0 7px; box-sizing: border-box; border: 1px solid var(--na-color-divider); border-radius: var(--na-radius-sm); color: var(--b3-theme-on-surface); background: var(--b3-theme-background); font: inherit; }
    .na-create-task__parent { overflow: hidden; padding: 8px 10px; border: 1px solid var(--na-color-divider); border-radius: var(--na-radius-sm); color: var(--b3-theme-on-surface); background: var(--b3-theme-background); font-size: var(--na-font-size-md); text-overflow: ellipsis; white-space: nowrap; }
    .na-create-task__error { margin: 0 16px 10px; padding: 8px 10px; border-radius: var(--na-radius-sm); color: var(--na-color-error); background: var(--na-color-error-bg); font-size: var(--na-font-size-sm); }
    .na-create-task__actions { position: sticky; bottom: 0; display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px max(10px, env(safe-area-inset-bottom)); border-top: 1px solid var(--na-color-divider); background: var(--na-color-panel-header); z-index: 2; }
    @media (max-width: 500px) {
        .na-create-task__title { margin-inline: 12px; }
        .na-create-task__section { padding-inline: 12px; }
        .na-create-task__grid, .na-create-task__save-grid { grid-template-columns: minmax(0, 1fr); }
        .na-create-task__field--full { grid-column: auto; }
        .na-create-task__error { margin-inline: 12px; }
        .na-create-task__actions { padding-inline: 12px; }
    }
</style>
