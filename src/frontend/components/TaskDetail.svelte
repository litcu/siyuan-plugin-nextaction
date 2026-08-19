<script lang="ts">
    import { confirm } from "siyuan";
    import { onDestroy } from "svelte";
    import type { TaskCacheEntry } from "../../shared/types";
    import type { I18nStrings } from "../../shared/i18n";
    import type { CustomFieldDef } from "../../shared/settings";
    import { encodeCustomFieldValue, isCustomFieldApplicable } from "../../shared/custom-fields";
    import { parseRepeatState } from "../../shared/repeat";
    import type { KernelBridge } from "../kernel-bridge";
    import { PRIORITY_LIST, STATUS_LIST } from "../constants";
    import { taskStore } from "../stores/task-store";
    import { formatRpcError, notifyInfo } from "../notify";
    import { jumpToBlock as jump } from "../utils";
    import { priorityI18nKey, statusI18nKey, translateKey } from "../i18n";
    import { parseReminderItems } from "../utils/reminder-utils";
    import { runAiDecomposeTask } from "../ai/ai-feature-service";
    import { openReminderSettingsDialog, openRepeatRuleDialog } from "../dialogs/task-property-dialogs";
    import { isTaskDateRangeValid, taskDetailDraftKey, type TaskDetailDraft } from "../utils/task-detail-draft";
    import {
        TaskDetailController,
        taskDetailDraftToAttrs,
        type TaskDetailControllerSnapshot,
        type TaskDetailSaveState,
    } from "../controllers/task-detail-controller";
    import NaCustomFieldInput from "../ui/NaCustomFieldInput.svelte";
    import NaDatePicker from "../ui/NaDatePicker.svelte";
    import NaDialogShell from "../ui/NaDialogShell.svelte";
    import NaDotRating from "../ui/NaDotRating.svelte";
    import NaIconButton from "../ui/NaIconButton.svelte";
    import NaInlineNotice from "../ui/NaInlineNotice.svelte";
    import NaPropertyRow from "../ui/NaPropertyRow.svelte";
    import NaPropertySection from "../ui/NaPropertySection.svelte";
    import NaSearchSelect from "../ui/NaSearchSelect.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";
    import NaTaskLinkList from "../ui/NaTaskLinkList.svelte";
    import NaToggle from "../ui/NaToggle.svelte";

    export let task: TaskCacheEntry;
    export let bridge: KernelBridge;
    export let i18n: I18nStrings;
    export let onSave: ((updatedEntry: TaskCacheEntry) => void) | undefined = undefined;
    export let onRemove: ((blockId: string) => void) | undefined = undefined;
    export let onClose: (() => void) | undefined = undefined;
    export let onConfirmDiscard: ((confirmDiscard: () => void, cancelClose: () => void) => void) | undefined =
        undefined;
    export let onCreateChild: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onOpenTask: ((blockId: string) => void) | undefined = undefined;
    export let showJumpToBlock = true;
    export let dialogMode = false;

    let status = "todo";
    let priority = "none";
    let importance = 4;
    let effort = 4;
    let due = "";
    let start = "";
    let note = "";
    let contexts: string[] = [];
    let taskTags: string[] = [];
    let parentId = "";
    let depends: string[] = [];
    let depMode = "all";
    let sequentialEnabled = false;
    let repeatEnabled = false;
    let taskType = "1";
    let reviewInterval = 0;
    let reviewDate = "";
    let reviewIntervalMode = "0";
    let reviewIntervalCustom = "";
    let customFieldValues: Record<string, string> = {};
    let activeClose: Promise<boolean> | null = null;
    let saveState: TaskDetailSaveState = "idle";
    let saveError = "";
    let depError = "";
    let customFieldError = "";
    let repeatDateError = "";
    let operationBusy = false;
    let repeatDateNoticeTaskId = "";
    let repeatDateErrorTimer: ReturnType<typeof setTimeout> | null = null;
    let shellElement: HTMLDivElement | undefined;
    let appliedControllerTask: TaskCacheEntry | null = null;

    $: allTasks = $taskStore.allTasks || [];
    $: allContexts = $taskStore.contexts || [];
    $: allTags = $taskStore.tags || [];
    $: taskMap = new Map(allTasks.map((entry) => [entry.blockId, entry]));
    $: parentLabel = parentId ? taskMap.get(parentId)?.title || i18n?.untitled || "(untitled)" : "";
    $: depLabels = Object.fromEntries(
        depends.map((id) => [id, taskMap.get(id)?.title || i18n?.untitled || "(untitled)"]),
    );
    $: childTasks = allTasks
        .filter((entry) => entry.parentId === task.blockId)
        .map((entry) => ({
            blockId: entry.blockId,
            title: entry.title || i18n?.untitled || "(untitled)",
            status: entry.status,
        }));
    $: customFieldDefs = (($taskStore.settings.customFields || []) as CustomFieldDef[]).filter((field) =>
        isCustomFieldApplicable(field, task, taskMap),
    );
    $: isInMyDay = !!$taskStore.myDayState?.tasks.some((entry) => entry.blockId === task.blockId);
    $: hasReminders = parseReminderItems(task.reminder).length > 0;
    $: repeatRuntimeState = parseRepeatState(task.repeatState);
    $: repeatStatus = repeatRuntimeState?.status || (task.repeat ? "active" : "");
    $: dateError = getDateError(start, due);
    let dirty = false;
    $: noticeMessage = dateError || depError || customFieldError || saveError || repeatDateError;
    $: noticeTone = (
        dateError || depError || customFieldError || saveError ? "error" : repeatDateError ? "warning" : "info"
    ) as "error" | "warning" | "info";
    $: statusLabel =
        saveState === "saving"
            ? i18n?.saving || "Saving..."
            : saveState === "pending"
              ? i18n?.savePending || "Pending"
              : saveState === "saved"
                ? i18n?.saved || "Saved"
                : saveState === "error"
                  ? i18n?.saveFailed || "Save failed"
                  : translateKey(i18n, statusI18nKey(status), status);
    $: statusTone = (saveState === "error" ? "error" : saveState === "pending" ? "warning" : "default") as
        "error" | "warning" | "default";
    $: relationSummary =
        [
            childTasks.length ? (i18n?.subtaskCount || "{n} subtasks").replace("{n}", String(childTasks.length)) : "",
            depends.length ? (i18n?.dependencyCount || "{n} dependencies").replace("{n}", String(depends.length)) : "",
        ]
            .filter(Boolean)
            .join(" · ") ||
        i18n?.notConfigured ||
        "Not configured";
    $: reviewSummary =
        reviewInterval > 0
            ? (i18n?.reviewEveryDays || "Every {n} days").replace("{n}", String(reviewInterval))
            : i18n?.reviewIntervalNone || "None";
    $: taskTypeOptions = [
        { value: "1", label: i18n?.task || "Task" },
        { value: "2", label: i18n?.project || "Project" },
    ];
    $: isProject = taskType === "2";
    $: aiDecomposeLabel = isProject
        ? i18n?.aiDecomposeProject || "Break down project with AI"
        : i18n?.aiDecomposeTask || "Break down with AI";
    $: removeLabel = isProject ? i18n?.removeProject || "Remove project" : i18n?.removeTask || "Remove task";
    $: removeConfirmMessage = isProject
        ? i18n?.confirmRemoveProject || "This will clear all project attributes. This action cannot be undone."
        : i18n?.confirmRemoveTask || "This will clear all task attributes. This action cannot be undone.";
    $: headerSubtitle = [
        task.created ? formatCreated(task.created) : "",
        task.blocked && taskType !== "2"
            ? task.blockedReason === "children"
                ? i18n?.blockedByChildren || "Blocked by subtasks"
                : task.blockedReason === "sequential"
                  ? i18n?.blockedBySequence || "Blocked by sequence"
                  : i18n?.blockedByDependency || "Blocked by dependency"
            : "",
    ]
        .filter(Boolean)
        .join(" · ");

    function buildDraft(): TaskDetailDraft {
        return {
            status,
            priority,
            importance,
            effort,
            due,
            start,
            note,
            contexts,
            taskTags,
            parentId,
            depends,
            depMode,
            sequentialEnabled,
            taskType,
            reviewInterval,
            reviewDate,
            customFieldValues,
        };
    }

    function applyControllerSnapshot(snapshot: TaskDetailControllerSnapshot) {
        const incomingKey = taskDetailDraftKey(snapshot.draft);
        if (incomingKey !== taskDetailDraftKey(buildDraft())) {
            const draft = snapshot.draft;
            status = draft.status;
            priority = draft.priority;
            importance = draft.importance;
            effort = draft.effort;
            due = draft.due;
            start = draft.start;
            note = draft.note;
            contexts = [...draft.contexts];
            taskTags = [...draft.taskTags];
            parentId = draft.parentId;
            depends = [...draft.depends];
            depMode = draft.depMode;
            sequentialEnabled = draft.sequentialEnabled;
            taskType = draft.taskType;
            reviewInterval = draft.reviewInterval;
            reviewDate = draft.reviewDate;
            reviewIntervalMode =
                reviewInterval === 0
                    ? "0"
                    : [7, 14, 30, 60, 90].includes(reviewInterval)
                      ? String(reviewInterval)
                      : "custom";
            reviewIntervalCustom = reviewIntervalMode === "custom" ? String(reviewInterval) : "";
            customFieldValues = { ...draft.customFieldValues };
        }
        if (appliedControllerTask !== snapshot.task) {
            appliedControllerTask = snapshot.task;
            task = snapshot.task;
            repeatEnabled = !!snapshot.task.repeat;
            depError = "";
            customFieldError = "";
            repeatDateError = "";
        }
        dirty = snapshot.dirty;
        saveState = snapshot.saveState;
        saveError = snapshot.saveError;
    }

    class CustomFieldDraftError extends Error {}

    const controller = new TaskDetailController(task, {
        save: async (blockId, draft) => {
            const customAttrs: Record<string, string> = {};
            for (const def of customFieldDefs) {
                try {
                    customAttrs["na-ext-" + def.key] = encodeCustomFieldValue(
                        def,
                        draft.customFieldValues[def.key] || "",
                    );
                } catch {
                    throw new CustomFieldDraftError(`${def.label}: ${getCustomFieldValidationError(def)}`);
                }
            }
            const updated = await bridge.updateTask(blockId, taskDetailDraftToAttrs(draft, customAttrs));
            onSave?.(updated);
            return updated;
        },
        formatError: (error) => (error instanceof CustomFieldDraftError ? error.message : formatRpcError(error, i18n)),
    });
    const unsubscribeController = controller.subscribe(applyControllerSnapshot);

    $: if (task !== controller.snapshot.task) controller.receiveExternalTask(task);

    function syncFromTask(entry: TaskCacheEntry) {
        controller.receiveExternalTask(entry);
    }

    function getDateError(startValue: string, dueValue: string): string {
        if (!startValue || !dueValue) return "";
        return isTaskDateRangeValid(startValue, dueValue)
            ? ""
            : i18n?.dueBeforeStart || "Due date must not be earlier than start date";
    }

    function handleChange() {
        depError = "";
        customFieldError = "";
        saveError = "";
        controller.edit(buildDraft());
    }

    export async function flushPendingSave(): Promise<boolean> {
        return controller.flush();
    }

    export async function requestClose(): Promise<boolean> {
        if (activeClose) return activeClose;
        const closePromise = (async () => {
            const decision = await controller.requestClose();
            if (decision === "close") {
                onClose?.();
                return true;
            }
            return new Promise<boolean>((resolve) => {
                if (!onConfirmDiscard) {
                    controller.cancelClose();
                    resolve(false);
                    return;
                }
                onConfirmDiscard(
                    () => {
                        controller.confirmDiscard();
                        onClose?.();
                        resolve(true);
                    },
                    () => {
                        controller.cancelClose();
                        resolve(false);
                    },
                );
            });
        })();
        activeClose = closePromise;
        const result = await closePromise;
        if (activeClose === closePromise) activeClose = null;
        return result;
    }

    async function openReminders() {
        if (!(await flushPendingSave())) return;
        openReminderSettingsDialog(task, bridge, i18n, { onSave: applyExternalUpdate });
    }

    async function handleOpenTask(blockId: string) {
        if (!(await flushPendingSave())) return;
        onOpenTask?.(blockId);
    }

    async function handleJumpToBlock(blockId: string) {
        await jump(blockId);
        if (dialogMode) onClose?.();
    }

    async function openRepeatSettings() {
        if (!start && !due) {
            repeatDateError = i18n?.repeatNeedsDate || "Set a start or due date first";
            if (repeatDateErrorTimer) clearTimeout(repeatDateErrorTimer);
            repeatDateErrorTimer = setTimeout(() => {
                repeatDateError = "";
                repeatDateErrorTimer = null;
            }, 4200);
            return;
        }
        if (repeatDateErrorTimer) {
            clearTimeout(repeatDateErrorTimer);
            repeatDateErrorTimer = null;
        }
        repeatDateError = "";
        if (!(await flushPendingSave())) return;
        openRepeatRuleDialog({ ...task, start, due }, bridge, i18n, { onSave: applyExternalUpdate });
    }

    function applyExternalUpdate(updated: TaskCacheEntry) {
        task = updated;
        syncFromTask(updated);
        onSave?.(updated);
    }

    async function handleRepeatToggle(event: CustomEvent<{ checked: boolean }>) {
        const nextEnabled = event.detail.checked;
        if (nextEnabled && !repeatEnabled) {
            await openRepeatSettings();
            return;
        }
        if (!nextEnabled && repeatEnabled) {
            if (!(await flushPendingSave())) return;
            operationBusy = true;
            try {
                const updated = await bridge.updateTask(task.blockId, { "na-repeat": "" });
                applyExternalUpdate(updated);
            } catch (error: any) {
                controller.reportError(formatRpcError(error, i18n));
            } finally {
                operationBusy = false;
            }
        }
    }

    async function handleRepeatPauseToggle() {
        if (!(await flushPendingSave())) return;
        operationBusy = true;
        try {
            applyExternalUpdate(await bridge.setRepeatPaused(task.blockId, repeatStatus !== "paused"));
        } catch (error: any) {
            controller.reportError(formatRpcError(error, i18n));
        } finally {
            operationBusy = false;
        }
    }

    async function handleRepeatSkip() {
        if (!(await flushPendingSave())) return;
        operationBusy = true;
        try {
            applyExternalUpdate(await bridge.skipRepeatOccurrence(task.blockId));
        } catch (error: any) {
            controller.reportError(formatRpcError(error, i18n));
        } finally {
            operationBusy = false;
        }
    }

    async function toggleMyDay() {
        operationBusy = true;
        try {
            const state = isInMyDay
                ? await bridge.removeTaskFromMyDay(task.blockId)
                : await bridge.addTaskToMyDay(task.blockId);
            taskStore.applyMyDayUpdate(state);
        } catch (error: any) {
            controller.reportError(formatRpcError(error, i18n));
        } finally {
            operationBusy = false;
        }
    }

    async function searchParentTasks(query: string) {
        return allTasks
            .filter((entry) => entry.status !== "done" && entry.blockId !== task.blockId)
            .filter((entry) => !query || entry.title.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 8)
            .map((entry) => ({ id: entry.blockId, label: entry.title || i18n?.untitled || "(untitled)" }));
    }

    async function searchDepTasks(query: string) {
        const ancestorIds = new Set<string>();
        let current = task.parentId;
        let depth = 0;
        while (current && depth < 20) {
            ancestorIds.add(current);
            current = taskMap.get(current)?.parentId || "";
            depth++;
        }
        return allTasks
            .filter(
                (entry) => entry.status !== "done" && entry.blockId !== task.blockId && !ancestorIds.has(entry.blockId),
            )
            .filter((entry) => !query || entry.title.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 8)
            .map((entry) => ({ id: entry.blockId, label: entry.title || i18n?.untitled || "(untitled)" }));
    }

    function handleDateChange() {
        if (repeatDateErrorTimer) {
            clearTimeout(repeatDateErrorTimer);
            repeatDateErrorTimer = null;
        }
        repeatDateError = "";
        if (repeatEnabled && repeatDateNoticeTaskId !== task.blockId) {
            repeatDateNoticeTaskId = task.blockId;
            notifyInfo(i18n?.repeatDateCurrentOnly || "This date change only affects the current occurrence.");
        }
        handleChange();
    }

    function handleReviewIntervalChange() {
        if (reviewIntervalMode === "0") {
            reviewInterval = 0;
            reviewDate = "";
        } else if (reviewIntervalMode === "custom") {
            return;
        } else {
            reviewInterval = Number(reviewIntervalMode);
            reviewDate = addDays(localDateStr(), reviewInterval);
        }
        handleChange();
    }

    function handleReviewIntervalCustomChange() {
        const days = Number(reviewIntervalCustom);
        if (days < 1 || days > 365) return;
        reviewInterval = days;
        reviewDate = addDays(localDateStr(), days);
        handleChange();
    }

    function localDateStr() {
        const value = new Date();
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    }

    function addDays(date: string, days: number) {
        const value = new Date(date + "T00:00:00");
        value.setDate(value.getDate() + days);
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    }

    function getCustomFieldValidationError(def: CustomFieldDef) {
        if (def.type === "number") return i18n?.customFieldInvalidNumber || "Enter a valid number";
        if (def.type === "date") return i18n?.customFieldInvalidDate || "Enter a valid date";
        if (def.type === "datetime") return i18n?.customFieldInvalidDatetime || "Enter a valid date and time";
        if (def.type === "singleSelect" || def.type === "multiSelect")
            return i18n?.customFieldInvalidSelection || "Invalid selection";
        if (def.type === "url") return i18n?.customFieldInvalidLink || "Invalid link";
        if (def.type === "textarea") return i18n?.customFieldTextareaTooLong || "Long text is too long";
        if (def.type === "text") return i18n?.customFieldTextTooLong || "Text is too long";
        return i18n?.customFieldInvalidValue || "Invalid value";
    }

    function openCustomFieldLink(raw: string) {
        try {
            const value = raw.trim();
            const url = new URL(value);
            if (url.protocol === "siyuan:" && value.startsWith("siyuan://blocks/")) {
                jump(value.slice("siyuan://blocks/".length).split(/[/?#]/)[0]);
            } else if (url.protocol === "http:" || url.protocol === "https:") {
                window.open(url.toString(), "_blank", "noopener,noreferrer");
            } else {
                throw new Error("unsupported protocol");
            }
        } catch {
            controller.reportError(i18n?.customFieldInvalidLink || "Invalid link");
        }
    }

    function handleRemove() {
        if (!onRemove) return;
        confirm(removeLabel, removeConfirmMessage, async () => {
            controller.confirmDiscard();
            operationBusy = true;
            try {
                await bridge.removeTask(task.blockId);
                onRemove?.(task.blockId);
                onClose?.();
            } catch (error: any) {
                controller.reportError(formatRpcError(error, i18n));
            } finally {
                operationBusy = false;
            }
        });
    }

    function handleWindowKeydown(event: KeyboardEvent) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            flushPendingSave();
            return;
        }
        if (!dialogMode || event.key !== "Escape" || event.defaultPrevented) return;
        const dialogs = (window as any).siyuan?.dialogs;
        const ownDialog = shellElement?.closest(".b3-dialog");
        const topDialog =
            Array.isArray(dialogs) && dialogs.length > 0
                ? dialogs[dialogs.length - 1]?.element?.querySelector(".b3-dialog")
                : null;
        if (topDialog && ownDialog !== topDialog) return;
        event.preventDefault();
        requestClose();
    }

    function formatCreated(created: string) {
        const value = new Date(created + "Z");
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")} ${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
    }

    onDestroy(() => {
        if (repeatDateErrorTimer) clearTimeout(repeatDateErrorTimer);
        unsubscribeController();
        controller.dispose({ bestEffort: true });
    });
</script>

<svelte:window on:keydown={handleWindowKeydown} />

<NaDialogShell
    bind:element={shellElement}
    variant={dialogMode ? "dialog" : "drawer"}
    title={task.title || i18n?.untitled || "(untitled)"}
    subtitle={headerSubtitle}
    closeLabel={i18n?.close || "Close"}
    status={statusLabel}
    {statusTone}
    showFooter={false}
    on:close={requestClose}
>
    <div slot="headerActions" class="na-task-detail__header-actions">
        <NaIconButton
            symbol="iconAdd"
            label={i18n?.createChildTask || "Create child task"}
            size={14}
            on:click={() => onCreateChild?.(task)}
        />
        {#if showJumpToBlock}<NaIconButton
                symbol="iconOpenWindow"
                label={i18n?.jumpToBlock || "Jump to block"}
                size={14}
                on:click={() => handleJumpToBlock(task.contentBlockId || task.blockId)}
            />{/if}
        <NaIconButton
            symbol="iconSparkles"
            label={aiDecomposeLabel}
            size={14}
            on:click={() => runAiDecomposeTask(task)}
        />
        <NaIconButton
            symbol="iconTrashcan"
            label={removeLabel}
            size={14}
            tone="danger"
            disabled={operationBusy || saveState === "saving"}
            on:click={handleRemove}
        />
    </div>

    {#if noticeMessage}
        <div class="na-task-detail__notice"><NaInlineNotice message={noticeMessage} tone={noticeTone} /></div>
    {/if}

    <NaPropertySection title={i18n?.detailGroupBasics || i18n?.detailGroupNotes || "Core properties"}>
        <NaPropertyRow label={i18n?.status || "Status"}>
            <select class="b3-select fn__block" bind:value={status} on:change={handleChange}>
                {#each STATUS_LIST as item}<option value={item}>{translateKey(i18n, statusI18nKey(item), item)}</option
                    >{/each}
            </select>
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.taskType || "Item type"}>
            <NaSegmentControl
                options={taskTypeOptions}
                bind:value={taskType}
                label={i18n?.taskType || "Task type"}
                on:change={handleChange}
            />
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.priority || "Priority"}>
            <select class="b3-select fn__block" bind:value={priority} on:change={handleChange}>
                {#each PRIORITY_LIST as item}<option value={item}
                        >{translateKey(i18n, priorityI18nKey(item), item)}</option
                    >{/each}
            </select>
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.importance || "Importance"}
            ><NaDotRating count={7} bind:value={importance} on:change={handleChange} /></NaPropertyRow
        >
        <NaPropertyRow label={i18n?.effort || "Effort"}
            ><NaDotRating count={7} bind:value={effort} on:change={handleChange} /></NaPropertyRow
        >
        <NaPropertyRow label={i18n?.note || "Note"} stacked={true}
            ><textarea class="b3-text-field fn__block" rows="3" bind:value={note} on:input={handleChange}
            ></textarea></NaPropertyRow
        >
    </NaPropertySection>

    <NaPropertySection title={i18n?.detailGroupTiming || "Schedule"}>
        <NaPropertyRow label={i18n?.startTime || i18n?.startDate || "Start"}
            ><NaDatePicker
                bind:value={start}
                defaultTime="00:00"
                fixedDropdown={true}
                {i18n}
                on:change={handleDateChange}
            /></NaPropertyRow
        >
        <NaPropertyRow label={i18n?.dueTime || i18n?.dueDate || "Due"}
            ><NaDatePicker
                bind:value={due}
                defaultTime="23:59"
                fixedDropdown={true}
                {i18n}
                on:change={handleDateChange}
            /></NaPropertyRow
        >
        <NaPropertyRow label={i18n?.myDay || "My Day"}
            ><NaToggle
                checked={isInMyDay}
                disabled={operationBusy}
                label={i18n?.myDay || "My Day"}
                on:change={toggleMyDay}
            /></NaPropertyRow
        >
        <NaPropertyRow label={i18n?.reminder || "Reminders"}>
            <button
                type="button"
                class="b3-button b3-button--text na-task-detail__setting-action"
                on:click={openReminders}
            >
                {hasReminders ? i18n?.reminderConfigured || "Configured" : i18n?.notConfigured || "Not configured"}
            </button>
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.repeat || "Repeat"}>
            <div class="na-task-detail__repeat-control">
                <NaToggle
                    checked={repeatEnabled}
                    disabled={operationBusy}
                    label={i18n?.repeat || "Repeat"}
                    on:change={handleRepeatToggle}
                />
                {#if repeatEnabled}
                    {#if repeatStatus !== "ended"}<button
                            type="button"
                            class="b3-button"
                            disabled={operationBusy}
                            on:click={handleRepeatPauseToggle}
                            >{repeatStatus === "paused"
                                ? i18n?.repeatResume || "Resume"
                                : i18n?.repeatPause || "Pause"}</button
                        >{/if}
                    {#if repeatStatus === "active"}<button
                            type="button"
                            class="b3-button"
                            disabled={operationBusy}
                            on:click={handleRepeatSkip}>{i18n?.repeatSkipOccurrence || "Skip"}</button
                        >{/if}
                    <button
                        type="button"
                        class="b3-button b3-button--text"
                        disabled={operationBusy}
                        on:click={openRepeatSettings}>{i18n?.repeatConfigure || "Configure"}</button
                    >
                {/if}
            </div>
        </NaPropertyRow>
    </NaPropertySection>

    <NaPropertySection title={i18n?.detailGroupOrganization || "Organization"}>
        <NaPropertyRow label={i18n?.parentItem || "Parent item"}>
            <NaSearchSelect
                multi={false}
                bind:selected={parentId}
                bind:selectedLabel={parentLabel}
                searchFn={searchParentTasks}
                placeholder={i18n?.searchParentItem || "Search projects and tasks"}
                emptyText={i18n?.noOptions || "No options"}
                noMatchText={i18n?.noMatches || "No matches"}
                loadingText={i18n?.loadingMore || "Loading"}
                clearLabel={i18n?.clearSelection || "Clear selection"}
                removeLabel={i18n?.removeSelection || "Remove selection"}
                fixedDropdown={true}
                on:change={handleChange}
            />
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.context || "Context"}>
            <NaSearchSelect
                multi={true}
                allowCreate={true}
                bind:selected={contexts}
                allOptions={allContexts}
                placeholder={i18n?.addContext || "Add context"}
                emptyText={i18n?.noOptions || "No options"}
                noMatchText={i18n?.noMatches || "No matches"}
                loadingText={i18n?.loadingMore || "Loading"}
                clearLabel={i18n?.clearSelection || "Clear selection"}
                removeLabel={i18n?.removeSelection || "Remove selection"}
                fixedDropdown={true}
                on:change={handleChange}
            />
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.tag || "Tags"}>
            <NaSearchSelect
                multi={true}
                allowCreate={true}
                bind:selected={taskTags}
                allOptions={allTags}
                placeholder={i18n?.addTag || "Add tag"}
                emptyText={i18n?.noOptions || "No options"}
                noMatchText={i18n?.noMatches || "No matches"}
                loadingText={i18n?.loadingMore || "Loading"}
                clearLabel={i18n?.clearSelection || "Clear selection"}
                removeLabel={i18n?.removeSelection || "Remove selection"}
                fixedDropdown={true}
                on:change={handleChange}
            />
        </NaPropertyRow>
    </NaPropertySection>

    <NaPropertySection
        title={isProject
            ? i18n?.projectRelations || "Project relations"
            : i18n?.taskRelations || i18n?.detailGroupDependencies || "Task relations"}
        collapsible={true}
        open={false}
        summary={relationSummary}
    >
        <NaPropertyRow label={i18n?.subtasks || "Subtasks"} stacked={true}>
            <NaTaskLinkList
                items={childTasks}
                emptyText={i18n?.noSubtasks || "No subtasks"}
                openLabel={i18n?.jumpToBlock || "Jump to block"}
                onOpen={handleJumpToBlock}
                onSelect={handleOpenTask}
            />
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.dependencies || "Depends on"}>
            <NaSearchSelect
                multi={true}
                bind:selected={depends}
                searchFn={searchDepTasks}
                initialLabels={depLabels}
                placeholder={i18n?.searchDepTask || "Search tasks"}
                emptyText={i18n?.noOptions || "No options"}
                noMatchText={i18n?.noMatches || "No matches"}
                loadingText={i18n?.loadingMore || "Loading"}
                clearLabel={i18n?.clearSelection || "Clear selection"}
                removeLabel={i18n?.removeSelection || "Remove selection"}
                fixedDropdown={true}
                on:change={handleChange}
            />
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.depMode || "Dependency mode"}>
            <select class="b3-select fn__block" bind:value={depMode} on:change={handleChange}
                ><option value="all">{i18n?.depModeAll || "All must complete"}</option><option value="any"
                    >{i18n?.depModeAny || "Any can complete"}</option
                ></select
            >
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.sequential || "Sequential"}
            ><NaToggle
                bind:checked={sequentialEnabled}
                label={i18n?.sequential || "Sequential"}
                on:change={handleChange}
            /></NaPropertyRow
        >
    </NaPropertySection>

    <NaPropertySection
        title={i18n?.detailGroupReview || "Review"}
        collapsible={true}
        open={false}
        summary={reviewSummary}
    >
        <NaPropertyRow label={i18n?.reviewInterval || "Review interval"}>
            <div class="na-task-detail__review-control">
                <select class="b3-select" bind:value={reviewIntervalMode} on:change={handleReviewIntervalChange}>
                    <option value="0">{i18n?.reviewIntervalNone || "None"}</option>
                    {#each [7, 14, 30, 60, 90] as days}<option value={String(days)}
                            >{days} {i18n?.days || "days"}</option
                        >{/each}
                    <option value="custom">{i18n?.reviewIntervalCustom || "Custom"}</option>
                </select>
                {#if reviewIntervalMode === "custom"}<input
                        class="b3-text-field"
                        type="number"
                        min="1"
                        max="365"
                        bind:value={reviewIntervalCustom}
                        on:change={handleReviewIntervalCustomChange}
                    />{/if}
            </div>
        </NaPropertyRow>
        {#if reviewInterval > 0}<NaPropertyRow label={i18n?.reviewDate || "Next review"}
                ><NaDatePicker
                    value={reviewDate}
                    fixedDropdown={true}
                    {i18n}
                    on:change={(event) => {
                        reviewDate = event.detail?.value || "";
                        handleChange();
                    }}
                /></NaPropertyRow
            >{/if}
    </NaPropertySection>

    {#if customFieldDefs.length > 0}
        <NaPropertySection title={i18n?.customFields || "Custom fields"}>
            {#each customFieldDefs as def (def.key)}
                <NaPropertyRow label={def.label}>
                    <NaCustomFieldInput
                        {def}
                        value={customFieldValues[def.key] || ""}
                        {i18n}
                        fixedDropdown={true}
                        on:change={(event) => {
                            customFieldValues = { ...customFieldValues, [def.key]: event.detail.value };
                            handleChange();
                        }}
                        on:open={(event) => openCustomFieldLink(event.detail.value)}
                    />
                </NaPropertyRow>
            {/each}
        </NaPropertySection>
    {/if}
</NaDialogShell>

<style lang="scss">
    .na-task-detail__header-actions {
        display: flex;
        align-items: center;
        gap: 2px;
    }
    .na-task-detail__notice {
        position: sticky;
        top: 0;
        z-index: 5;
        padding: 8px 16px;
        border-bottom: 1px solid var(--b3-border-color);
        background: color-mix(in srgb, var(--b3-theme-surface) 94%, transparent);
        box-shadow: 0 6px 18px color-mix(in srgb, var(--b3-theme-on-surface) 10%, transparent);
        backdrop-filter: blur(8px);
    }
    .na-task-detail__setting-action {
        min-width: 104px;
        justify-content: center;
    }
    .na-task-detail__repeat-control {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: 6px;
        width: 100%;
    }
    .na-task-detail__review-control {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
    }
    .na-task-detail__review-control .b3-select {
        min-width: 0;
        flex: 1;
    }
    .na-task-detail__review-control .b3-text-field {
        width: 72px;
        flex: 0 0 72px;
    }
    :global(.na-task-dialog-container) {
        width: min(520px, calc(100vw - 24px)) !important;
        height: min(720px, calc(100vh - 24px));
        max-height: calc(100vh - 24px);
        overflow: hidden;
    }
    :global(.na-task-dialog-container > .b3-dialog__body),
    :global(.na-task-dialog-content) {
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
    }
    :global(.na-task-detail__repeat-control .b3-button) {
        min-height: var(--na-control-height-sm);
        padding: 2px 7px;
        font-size: var(--na-font-size-sm);
    }
    :global(.na-property-row__control > .na-date-picker),
    :global(.na-property-row__control > .na-search-select),
    :global(.na-property-row__control > .na-custom-field-input) {
        width: 100%;
    }
    @media (max-width: 520px) {
        .na-task-detail__repeat-control {
            justify-content: flex-start;
        }
        :global(.na-task-dialog-container) {
            width: calc(100vw - 12px) !important;
            height: calc(100vh - 12px);
            max-height: calc(100vh - 12px);
        }
    }
</style>
