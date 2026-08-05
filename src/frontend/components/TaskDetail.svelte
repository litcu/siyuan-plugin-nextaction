<script lang="ts">
    import { confirm } from "siyuan";
    import { onDestroy } from "svelte";
    import type { TaskCacheEntry } from "../../shared/types";
    import type { CustomFieldDef } from "../../shared/settings";
    import { encodeCustomFieldValue, isCustomFieldApplicable } from "../../shared/custom-fields";
    import { parseRepeatState } from "../../shared/repeat";
    import type { KernelBridge } from "../kernel-bridge";
    import { normalizePriority, PRIORITY_LIST, STATUS_LIST } from "../constants";
    import { taskStore } from "../stores/task-store";
    import { formatRpcError, notifyInfo } from "../notify";
    import { jumpToBlock as jump, toI18nKey } from "../utils";
    import { parseReminderItems } from "../utils/reminder-utils";
    import { runAiDecomposeTask } from "../ai/ai-feature-service";
    import { openReminderSettingsDialog, openRepeatRuleDialog } from "../dialogs/task-property-dialogs";
    import {
        canSaveTaskDetailNow,
        isTaskDateRangeValid,
        shouldConfirmTaskDetailClose,
        shouldContinueTaskDetailSave,
        taskDetailDraftKey,
    } from "../utils/task-detail-draft";
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
    export let i18n: any;
    export let onSave: ((updatedEntry: TaskCacheEntry) => void) | undefined = undefined;
    export let onRemove: ((blockId: string) => void) | undefined = undefined;
    export let onClose: (() => void) | undefined = undefined;
    export let showJumpToBlock = true;
    export let dialogMode = false;

    type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

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
    let currentBlockId = "";
    let savedDraftKey = "";
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let savedStateTimer: ReturnType<typeof setTimeout> | null = null;
    let activeSave: Promise<boolean> | null = null;
    let activeClose: Promise<boolean> | null = null;
    let saveState: SaveState = "idle";
    let saveError = "";
    let depError = "";
    let customFieldError = "";
    let repeatDateError = "";
    let discardOnDestroy = false;
    let operationBusy = false;
    let repeatDateNoticeTaskId = "";
    let shellElement: HTMLDivElement | undefined;

    $: allTasks = $taskStore.allTasks || [];
    $: allContexts = $taskStore.contexts || [];
    $: allTags = $taskStore.tags || [];
    $: taskMap = new Map(allTasks.map(entry => [entry.blockId, entry]));
    $: parentLabel = parentId ? (taskMap.get(parentId)?.title || i18n?.untitled || "(untitled)") : "";
    $: depLabels = Object.fromEntries(depends.map(id => [id, taskMap.get(id)?.title || i18n?.untitled || "(untitled)"]));
    $: childTasks = allTasks
        .filter(entry => entry.parentId === task.blockId)
        .map(entry => ({ blockId: entry.blockId, title: entry.title || i18n?.untitled || "(untitled)", status: entry.status }));
    $: customFieldDefs = (($taskStore.settings.customFields || []) as CustomFieldDef[])
        .filter(field => isCustomFieldApplicable(field, task, taskMap));
    $: myDayEnabled = $taskStore.settings.myDayEnabled !== false;
    $: isInMyDay = !!$taskStore.myDayState?.tasks.some(entry => entry.blockId === task.blockId);
    $: hasReminders = parseReminderItems(task.reminder).length > 0;
    $: repeatRuntimeState = parseRepeatState(task.repeatState);
    $: repeatStatus = repeatRuntimeState?.status || (task.repeat ? "active" : "");
    $: dateError = getDateError(start, due);
    $: draftKey = taskDetailDraftKey({
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
    });
    $: dirty = !!savedDraftKey && draftKey !== savedDraftKey;
    $: canSaveNow = canSaveTaskDetailNow({
        dirty,
        saving: saveState === "saving",
        hasValidationError: !!dateError || !!customFieldError,
        operationBusy,
    });
    $: noticeMessage = dateError || depError || customFieldError || saveError || repeatDateError;
    $: noticeTone = dateError || depError || customFieldError || saveError
        ? "error"
        : repeatDateError
            ? "warning"
            : "info";
    $: statusLabel = saveState === "saving"
        ? (i18n?.saving || "Saving...")
        : saveState === "pending"
            ? (i18n?.savePending || "Pending")
            : saveState === "saved"
                ? (i18n?.saved || "Saved")
                : saveState === "error"
                    ? (i18n?.saveFailed || "Save failed")
                    : (i18n?.[toI18nKey("status", status)] || status);
    $: statusTone = saveState === "error" ? "error" : saveState === "pending" ? "warning" : "default";
    $: relationSummary = [
        childTasks.length ? (i18n?.subtaskCount || "{n} subtasks").replace("{n}", String(childTasks.length)) : "",
        depends.length ? (i18n?.dependencyCount || "{n} dependencies").replace("{n}", String(depends.length)) : "",
    ].filter(Boolean).join(" · ") || (i18n?.notConfigured || "Not configured");
    $: reviewSummary = reviewInterval > 0
        ? (i18n?.reviewEveryDays || "Every {n} days").replace("{n}", String(reviewInterval))
        : (i18n?.reviewIntervalNone || "None");
    $: taskTypeOptions = [
        { value: "1", label: i18n?.task || "Task" },
        { value: "2", label: i18n?.project || "Project" },
    ];
    $: headerSubtitle = [
        task.created ? formatCreated(task.created) : "",
        task.blocked && taskType !== "2"
            ? (task.blockedReason === "children"
                ? (i18n?.blockedByChildren || "Blocked by subtasks")
                : task.blockedReason === "sequential"
                    ? (i18n?.blockedBySequence || "Blocked by sequence")
                    : (i18n?.blockedByDependency || "Blocked by dependency"))
            : "",
    ].filter(Boolean).join(" · ");

    function syncFromTask(entry: TaskCacheEntry) {
        status = entry.status || "todo";
        priority = normalizePriority(entry.priority);
        importance = entry.importance || 4;
        effort = entry.effort || 4;
        due = entry.due || "";
        start = entry.start || "";
        note = entry.note || "";
        contexts = entry.context ? entry.context.split("|").filter(Boolean) : [];
        taskTags = entry.tags ? entry.tags.split("|").filter(Boolean) : [];
        parentId = entry.parentId || "";
        depends = entry.depends ? entry.depends.split("|").filter(Boolean) : [];
        depMode = entry.depMode || "all";
        sequentialEnabled = entry.sequential || false;
        repeatEnabled = !!entry.repeat;
        taskType = entry.taskType || "1";
        reviewInterval = entry.reviewInterval || 0;
        reviewDate = entry.reviewDate || "";
        reviewIntervalMode = reviewInterval === 0 ? "0" : [7, 14, 30, 60, 90].includes(reviewInterval) ? String(reviewInterval) : "custom";
        reviewIntervalCustom = reviewIntervalMode === "custom" ? String(reviewInterval) : "";
        customFieldValues = { ...(entry.customFields || {}) };
        depError = "";
        customFieldError = "";
        repeatDateError = "";
        saveError = "";
        saveState = "idle";
        savedDraftKey = buildDraftKey();
    }

    $: if (task.blockId !== currentBlockId) {
        currentBlockId = task.blockId;
        syncFromTask(task);
    }

    function buildDraftKey(): string {
        return taskDetailDraftKey({
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
        });
    }

    function getDateError(startValue: string, dueValue: string): string {
        if (!startValue || !dueValue) return "";
        return isTaskDateRangeValid(startValue, dueValue) ? "" : (i18n?.dueBeforeStart || "Due date must not be earlier than start date");
    }

    function scheduleSave() {
        if (debounceTimer) clearTimeout(debounceTimer);
        if (savedStateTimer) clearTimeout(savedStateTimer);
        depError = "";
        customFieldError = "";
        saveError = "";
        saveState = "pending";
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            flushPendingSave();
        }, 500);
    }

    function handleChange() {
        scheduleSave();
    }

    export async function flushPendingSave(): Promise<boolean> {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        if (activeSave) {
            const activeResult = await activeSave;
            if (!activeResult) return false;
            return dirty ? flushPendingSave() : true;
        }
        if (!dirty) {
            saveState = "idle";
            return true;
        }
        if (dateError) {
            saveState = "error";
            return false;
        }

        const savingDraftKey = draftKey;
        const savingBlockId = task.blockId;
        const savePromise = (async () => {
            const customAttrs: Record<string, string> = {};
            customFieldError = "";
            try {
                for (const def of customFieldDefs) {
                    try {
                        customAttrs["na-ext-" + def.key] = encodeCustomFieldValue(def, customFieldValues[def.key] || "");
                    } catch {
                        customFieldError = `${def.label}: ${getCustomFieldValidationError(def)}`;
                        saveState = "error";
                        return false;
                    }
                }

                saveState = "saving";
                saveError = "";
                const updated = await bridge.updateTask(task.blockId, {
                    "na-status": status,
                    "na-priority": priority,
                    "na-importance": String(importance),
                    "na-effort": String(effort),
                    "na-due": due,
                    "na-start": start,
                    "na-context": contexts.join("|"),
                    "na-tags": taskTags.join("|"),
                    "na-parent": parentId,
                    "na-task": taskType,
                    "na-depends": depends.join("|"),
                    "na-dep-mode": depMode,
                    "na-sequential": sequentialEnabled ? "1" : "",
                    "na-note": note,
                    "na-review-interval": reviewInterval > 0 ? String(reviewInterval) : "",
                    "na-review-date": reviewDate || "",
                    ...customAttrs,
                });
                if (updated?._rpcError) {
                    if (updated._rpcError.code === -32007) depError = i18n?.depCycleDetected || "Dependency cycle detected";
                    saveError = formatRpcError(updated, i18n);
                    saveState = "error";
                    return false;
                }
                task = updated;
                onSave?.(updated);
                if (currentBlockId === savingBlockId && draftKey === savingDraftKey) {
                    syncFromTask(updated);
                    savedDraftKey = buildDraftKey();
                    saveState = "saved";
                    savedStateTimer = setTimeout(() => {
                        if (saveState === "saved") saveState = "idle";
                    }, 1600);
                } else {
                    savedDraftKey = savingDraftKey;
                    saveState = "pending";
                }
                return true;
            } catch (error: any) {
                saveError = formatRpcError(error, i18n);
                saveState = "error";
                return false;
            }
        })();
        activeSave = savePromise;
        const result = await savePromise;
        if (activeSave === savePromise) activeSave = null;
        if (shouldContinueTaskDetailSave(savingDraftKey, draftKey, result)) {
            return flushPendingSave();
        }
        return result;
    }

    export async function requestClose(): Promise<boolean> {
        if (activeClose) return activeClose;
        const closePromise = (async () => {
            if (activeSave) await activeSave;
            if (!shouldConfirmTaskDetailClose(dirty)) {
                onClose?.();
                return true;
            }
            if (debounceTimer) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
            }
            return new Promise<boolean>((resolve) => {
                confirm(
                    i18n?.unsavedChangesTitle || "Unsaved changes",
                    i18n?.unsavedChangesMessage || "Discard unsaved changes?",
                    () => {
                        discardOnDestroy = true;
                        onClose?.();
                        resolve(true);
                    },
                    () => {
                        scheduleSave();
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
        if (!await flushPendingSave()) return;
        openReminderSettingsDialog(task, bridge, i18n, { onSave: applyExternalUpdate });
    }

    async function openRepeatSettings() {
        if (!start && !due) {
            repeatDateError = i18n?.repeatNeedsDate || "Set a start or due date first";
            return;
        }
        repeatDateError = "";
        if (!await flushPendingSave()) return;
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
            if (!await flushPendingSave()) return;
            operationBusy = true;
            try {
                const updated = await bridge.updateTask(task.blockId, { "na-repeat": "" });
                applyExternalUpdate(updated);
            } catch (error: any) {
                saveError = formatRpcError(error, i18n);
                saveState = "error";
            } finally {
                operationBusy = false;
            }
        }
    }

    async function handleRepeatPauseToggle() {
        if (!await flushPendingSave()) return;
        operationBusy = true;
        try {
            applyExternalUpdate(await bridge.setRepeatPaused(task.blockId, repeatStatus !== "paused"));
        } catch (error: any) {
            saveError = formatRpcError(error, i18n);
            saveState = "error";
        } finally {
            operationBusy = false;
        }
    }

    async function handleRepeatSkip() {
        if (!await flushPendingSave()) return;
        operationBusy = true;
        try {
            applyExternalUpdate(await bridge.skipRepeatOccurrence(task.blockId));
        } catch (error: any) {
            saveError = formatRpcError(error, i18n);
            saveState = "error";
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
            saveError = formatRpcError(error, i18n);
            saveState = "error";
        } finally {
            operationBusy = false;
        }
    }

    async function searchParentTasks(query: string) {
        return allTasks
            .filter(entry => entry.status !== "done" && entry.blockId !== task.blockId)
            .filter(entry => !query || entry.title.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 8)
            .map(entry => ({ id: entry.blockId, label: entry.title || i18n?.untitled || "(untitled)" }));
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
            .filter(entry => entry.status !== "done" && entry.blockId !== task.blockId && !ancestorIds.has(entry.blockId))
            .filter(entry => !query || entry.title.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 8)
            .map(entry => ({ id: entry.blockId, label: entry.title || i18n?.untitled || "(untitled)" }));
    }

    function handleDateChange() {
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
        if (def.type === "singleSelect" || def.type === "multiSelect") return i18n?.customFieldInvalidSelection || "Invalid selection";
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
            saveError = i18n?.customFieldInvalidLink || "Invalid link";
            saveState = "error";
        }
    }

    function handleRemove() {
        if (!onRemove) return;
        confirm(
            i18n?.removeTask || "Remove task",
            i18n?.confirmRemoveTask || "This action cannot be undone.",
            async () => {
                if (debounceTimer) clearTimeout(debounceTimer);
                discardOnDestroy = true;
                operationBusy = true;
                try {
                    await bridge.removeTask(task.blockId);
                    onRemove?.(task.blockId);
                    onClose?.();
                } catch (error: any) {
                    saveError = formatRpcError(error, i18n);
                    saveState = "error";
                } finally {
                    operationBusy = false;
                }
            },
        );
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
        const topDialog = Array.isArray(dialogs) && dialogs.length > 0
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
        if (debounceTimer) clearTimeout(debounceTimer);
        if (savedStateTimer) clearTimeout(savedStateTimer);
        if (dirty && !discardOnDestroy && !activeSave) flushPendingSave();
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
    on:close={requestClose}
>
    <div slot="headerActions" class="na-task-detail__header-actions">
        {#if showJumpToBlock}<NaIconButton symbol="iconOpenWindow" label={i18n?.jumpToBlock || "Jump to block"} size={14} on:click={() => jump(task.blockId)} />{/if}
        <NaIconButton symbol="iconSparkles" label={i18n?.aiDecomposeTask || "AI decompose task"} size={14} on:click={() => runAiDecomposeTask(task)} />
    </div>

    {#if noticeMessage}<NaInlineNotice slot="notice" message={noticeMessage} tone={noticeTone} />{/if}

    <NaPropertySection title={i18n?.detailGroupBasics || "Core properties"}>
        <NaPropertyRow label={i18n?.status || "Status"}>
            <select class="b3-select fn__block" bind:value={status} on:change={handleChange}>
                {#each STATUS_LIST as item}<option value={item}>{i18n?.[toI18nKey("status", item)] || item}</option>{/each}
            </select>
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.taskType || i18n?.type || "Type"}>
            <NaSegmentControl options={taskTypeOptions} bind:value={taskType} label={i18n?.taskType || "Task type"} on:change={handleChange} />
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.priority || "Priority"}>
            <select class="b3-select fn__block" bind:value={priority} on:change={handleChange}>
                {#each PRIORITY_LIST as item}<option value={item}>{i18n?.[toI18nKey("priority", item)] || item}</option>{/each}
            </select>
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.importance || "Importance"}><NaDotRating count={7} bind:value={importance} on:change={handleChange} /></NaPropertyRow>
        <NaPropertyRow label={i18n?.effort || "Effort"}><NaDotRating count={7} bind:value={effort} on:change={handleChange} /></NaPropertyRow>
    </NaPropertySection>

    <NaPropertySection title={i18n?.detailGroupTiming || "Schedule"}>
        <NaPropertyRow label={i18n?.startTime || i18n?.startDate || "Start"}><NaDatePicker bind:value={start} defaultTime="00:00" fixedDropdown={true} {i18n} on:change={handleDateChange} /></NaPropertyRow>
        <NaPropertyRow label={i18n?.dueTime || i18n?.dueDate || "Due"} error={dateError}><NaDatePicker bind:value={due} defaultTime="23:59" fixedDropdown={true} {i18n} on:change={handleDateChange} /></NaPropertyRow>
        {#if myDayEnabled}<NaPropertyRow label={i18n?.myDay || "My Day"}><NaToggle checked={isInMyDay} disabled={operationBusy} label={i18n?.myDay || "My Day"} on:change={toggleMyDay} /></NaPropertyRow>{/if}
        <NaPropertyRow label={i18n?.reminder || "Reminders"}>
            <button type="button" class="b3-button b3-button--text na-task-detail__setting-action" on:click={openReminders}>
                {hasReminders ? (i18n?.reminderConfigured || "Configured") : (i18n?.notConfigured || "Not configured")}
            </button>
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.repeat || "Repeat"}>
            <div class="na-task-detail__repeat-control">
                <NaToggle checked={repeatEnabled} disabled={operationBusy} label={i18n?.repeat || "Repeat"} on:change={handleRepeatToggle} />
                {#if repeatEnabled}
                    {#if repeatStatus !== "ended"}<button type="button" class="b3-button" disabled={operationBusy} on:click={handleRepeatPauseToggle}>{repeatStatus === "paused" ? (i18n?.repeatResume || "Resume") : (i18n?.repeatPause || "Pause")}</button>{/if}
                    {#if repeatStatus === "active"}<button type="button" class="b3-button" disabled={operationBusy} on:click={handleRepeatSkip}>{i18n?.repeatSkipOccurrence || "Skip"}</button>{/if}
                    <button type="button" class="b3-button b3-button--text" disabled={operationBusy} on:click={openRepeatSettings}>{i18n?.repeatConfigure || "Configure"}</button>
                {/if}
            </div>
        </NaPropertyRow>
    </NaPropertySection>

    <NaPropertySection title={i18n?.detailGroupOrganization || "Organization"}>
        <NaPropertyRow label={i18n?.parentTask || "Parent"}>
            <NaSearchSelect multi={false} bind:selected={parentId} bind:selectedLabel={parentLabel} searchFn={searchParentTasks} placeholder={i18n?.searchParentTask || "Search parent task"} emptyText={i18n?.noOptions || "No options"} noMatchText={i18n?.noMatches || "No matches"} loadingText={i18n?.loadingMore || "Loading"} clearLabel={i18n?.clearSelection || "Clear selection"} removeLabel={i18n?.removeSelection || "Remove selection"} fixedDropdown={true} on:change={handleChange} />
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.context || "Context"}>
            <NaSearchSelect multi={true} allowCreate={true} bind:selected={contexts} allOptions={allContexts} placeholder={i18n?.addContext || "Add context"} emptyText={i18n?.noOptions || "No options"} noMatchText={i18n?.noMatches || "No matches"} loadingText={i18n?.loadingMore || "Loading"} clearLabel={i18n?.clearSelection || "Clear selection"} removeLabel={i18n?.removeSelection || "Remove selection"} fixedDropdown={true} on:change={handleChange} />
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.tag || "Tags"}>
            <NaSearchSelect multi={true} allowCreate={true} bind:selected={taskTags} allOptions={allTags} placeholder={i18n?.addTag || "Add tag"} emptyText={i18n?.noOptions || "No options"} noMatchText={i18n?.noMatches || "No matches"} loadingText={i18n?.loadingMore || "Loading"} clearLabel={i18n?.clearSelection || "Clear selection"} removeLabel={i18n?.removeSelection || "Remove selection"} fixedDropdown={true} on:change={handleChange} />
        </NaPropertyRow>
    </NaPropertySection>

    <NaPropertySection title={i18n?.taskRelations || i18n?.detailGroupDependencies || "Task relations"} collapsible={true} open={false} summary={relationSummary}>
        <NaPropertyRow label={i18n?.subtasks || "Subtasks"} stacked={true}>
            <NaTaskLinkList items={childTasks} emptyText={i18n?.noSubtasks || "No subtasks"} openLabel={i18n?.jumpToBlock || "Jump to block"} onOpen={jump} />
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.dependencies || "Depends on"}>
            <NaSearchSelect multi={true} bind:selected={depends} searchFn={searchDepTasks} initialLabels={depLabels} placeholder={i18n?.searchDepTask || "Search tasks"} emptyText={i18n?.noOptions || "No options"} noMatchText={i18n?.noMatches || "No matches"} loadingText={i18n?.loadingMore || "Loading"} clearLabel={i18n?.clearSelection || "Clear selection"} removeLabel={i18n?.removeSelection || "Remove selection"} fixedDropdown={true} on:change={handleChange} />
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.depMode || "Dependency mode"} error={depError}>
            <select class="b3-select fn__block" bind:value={depMode} on:change={handleChange}><option value="all">{i18n?.depModeAll || "All must complete"}</option><option value="any">{i18n?.depModeAny || "Any can complete"}</option></select>
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.sequential || "Sequential"}><NaToggle bind:checked={sequentialEnabled} label={i18n?.sequential || "Sequential"} on:change={handleChange} /></NaPropertyRow>
    </NaPropertySection>

    <NaPropertySection title={i18n?.detailGroupReview || "Review"} collapsible={true} open={false} summary={reviewSummary}>
        <NaPropertyRow label={i18n?.reviewInterval || "Review interval"}>
            <div class="na-task-detail__review-control">
                <select class="b3-select" bind:value={reviewIntervalMode} on:change={handleReviewIntervalChange}>
                    <option value="0">{i18n?.reviewIntervalNone || "None"}</option>
                    {#each [7, 14, 30, 60, 90] as days}<option value={String(days)}>{days} {i18n?.days || "days"}</option>{/each}
                    <option value="custom">{i18n?.reviewIntervalCustom || "Custom"}</option>
                </select>
                {#if reviewIntervalMode === "custom"}<input class="b3-text-field" type="number" min="1" max="365" bind:value={reviewIntervalCustom} on:change={handleReviewIntervalCustomChange} />{/if}
            </div>
        </NaPropertyRow>
        {#if reviewInterval > 0}<NaPropertyRow label={i18n?.reviewDate || "Next review"}><NaDatePicker value={reviewDate} fixedDropdown={true} {i18n} on:change={(event) => { reviewDate = event.detail?.value || ""; handleChange(); }} /></NaPropertyRow>{/if}
    </NaPropertySection>

    <NaPropertySection title={i18n?.detailGroupNotes || "Notes"}>
        <NaPropertyRow label={i18n?.note || "Note"} stacked={true}><textarea class="b3-text-field fn__block" rows="3" bind:value={note} on:input={handleChange}></textarea></NaPropertyRow>
    </NaPropertySection>

    {#if customFieldDefs.length > 0}
        <NaPropertySection title={i18n?.customFields || "Custom fields"}>
            {#each customFieldDefs as def (def.key)}
                <NaPropertyRow label={def.label} error={customFieldError.startsWith(def.label + ":") ? customFieldError : ""}>
                    <NaCustomFieldInput {def} value={customFieldValues[def.key] || ""} {i18n} fixedDropdown={true} on:change={(event) => { customFieldValues = { ...customFieldValues, [def.key]: event.detail.value }; handleChange(); }} on:open={(event) => openCustomFieldLink(event.detail.value)} />
                </NaPropertyRow>
            {/each}
        </NaPropertySection>
    {/if}

    <div slot="footerStart">
        <button type="button" class="b3-button b3-button--cancel na-task-detail__delete" disabled={operationBusy || saveState === "saving"} on:click={handleRemove}>{i18n?.removeTask || "Remove task"}</button>
    </div>
    <div slot="footerEnd">
        <button type="button" class="b3-button" disabled={operationBusy} on:click={requestClose}>{i18n?.close || "Close"}</button>
        <button type="button" class="b3-button b3-button--text" disabled={!canSaveNow} on:click={flushPendingSave}>{i18n?.saveNow || "Save now"}</button>
    </div>
</NaDialogShell>

<style lang="scss">
    .na-task-detail__header-actions { display: flex; align-items: center; gap: 2px; }
    .na-task-detail__setting-action { min-width: 104px; justify-content: center; }
    .na-task-detail__repeat-control { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px; width: 100%; }
    .na-task-detail__review-control { display: flex; align-items: center; gap: 6px; width: 100%; }
    .na-task-detail__review-control .b3-select { min-width: 0; flex: 1; }
    .na-task-detail__review-control .b3-text-field { width: 72px; flex: 0 0 72px; }
    .na-task-detail__delete { color: var(--b3-card-error-color); }
    :global(.na-task-dialog-container) { width: min(520px, calc(100vw - 24px)) !important; height: min(720px, calc(100vh - 24px)); max-height: calc(100vh - 24px); overflow: hidden; }
    :global(.na-task-dialog-container > .b3-dialog__body),
    :global(.na-task-dialog-content) { width: 100%; height: 100%; min-height: 0; overflow: hidden; }
    :global(.na-task-detail__repeat-control .b3-button) { min-height: var(--na-control-height-sm); padding: 2px 7px; font-size: var(--na-font-size-sm); }
    :global(.na-property-row__control > .na-date-picker),
    :global(.na-property-row__control > .na-search-select),
    :global(.na-property-row__control > .na-custom-field-input) { width: 100%; }
    @media (max-width: 520px) {
        .na-task-detail__repeat-control { justify-content: flex-start; }
        :global(.na-task-dialog-container) { width: calc(100vw - 12px) !important; height: calc(100vh - 12px); max-height: calc(100vh - 12px); }
    }
</style>
