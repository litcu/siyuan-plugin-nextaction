<script lang="ts">
    import type { TaskCacheEntry } from "../../shared/types";
    import { KernelBridge } from "../kernel-bridge";
    import { taskStore } from "../stores/task-store";
    import { normalizePriority, PRIORITY_LIST, STATUS_LIST } from "../constants";
    import { onMount, onDestroy } from "svelte";
    import { confirm, Dialog } from "siyuan";
    import { jumpToBlock as jump, toI18nKey } from "../utils";
    import { notifyError, notifyInfo, formatRpcError } from "../notify";
    import NaSearchSelect from "../ui/NaSearchSelect.svelte";
    import NaToggle from "../ui/NaToggle.svelte";
    import NaDotRating from "../ui/NaDotRating.svelte";
    import NaDatePicker from "../ui/NaDatePicker.svelte";
    import NaLinkInput from "../ui/NaLinkInput.svelte";
    import ReminderPopup from "./ReminderPopup.svelte";
    import RepeatRuleDialog from "./RepeatRuleDialog.svelte";
    import { parseReminderItems } from "../utils/reminder-utils";
    import { parseRepeatState } from "../../shared/repeat";
    import type { CustomFieldDef } from "../../shared/settings";
    import { decodeCustomFieldValue, encodeCustomFieldValue, isCustomFieldApplicable } from "../../shared/custom-fields";
    import { runAiDecomposeTask } from "../ai/ai-feature-service";

    export let task: TaskCacheEntry;
    export let bridge: KernelBridge;
    export let i18n: any;
    export let onSave: ((updatedEntry: TaskCacheEntry) => void) | undefined = undefined;
    export let onRemove: ((blockId: string) => void) | undefined = undefined;
    export let onClose: (() => void) | undefined = undefined;
    export let showJumpToBlock: boolean = true;
    export let dialogMode: boolean = false;

    let status = task.status || "todo";
    let priority = normalizePriority(task.priority);
    let importance = task.importance || 4;
    let effort = task.effort || 4;
    let due = task.due || "";
    let start = task.start || "";
    let note = task.note || "";

    // Context state
    let contexts: string[] = task.context ? task.context.split("|").filter(Boolean) : [];
    let allContexts: string[] = [];

    // Tags state
    let taskTags: string[] = task.tags ? task.tags.split("|").filter(Boolean) : [];
    let allTags: string[] = [];

    // Parent task state
    let parentId = task.parentId || "";
    let parentLabel = "";

    // Dependency / Repeat / TaskType state
    let depends: string[] = task.depends ? task.depends.split("|").filter(Boolean) : [];
    let depLabels: Record<string, string> = {};
    let depMode: string = task.depMode || "all";
    let sequentialEnabled: boolean = task.sequential || false;
    let repeatEnabled: boolean = !!task.repeat;
    let taskType: string = task.taskType || "1";
    let depError: string = "";
    let dateError: string = "";

    // Reminder popup opener
    function openReminderPopup() {
        const dialog = new Dialog({
            title: i18n?.reminderPopupTitle || "提醒设置",
            content: `<div id="na-reminder-popup-container"></div>`,
            width: "360px",
        });
        // Add .nextaction class to dialog so --na-* CSS variables are available
        dialog.element.classList.add("nextaction");
        const container = dialog.element.querySelector("#na-reminder-popup-container");
        if (container) {
            new ReminderPopup({
                target: container,
                props: {
                    task,
                    bridge,
                    i18n,
                    onSave: (updated: TaskCacheEntry) => {
                        if (onSave) onSave(updated);
                    },
                },
            });
        }
    }

    $: hasReminders = parseReminderItems(task.reminder).length > 0;

    // Track previous due date
    let prevDue = task.due || "";
    $: if (due !== prevDue) {
        prevDue = due;
    }

    // Review interval state
    let reviewInterval: number = task.reviewInterval || 0;
    let reviewDate: string = task.reviewDate || "";
    let reviewIntervalMode: string = "0";
    let reviewIntervalCustom: string = "";

    // Custom fields state
    let customFieldDefs: CustomFieldDef[] = [];
    let customFieldValues: Record<string, string> = {};
    let customFieldError = "";

    function getCustomFieldTypePlaceholder(def: CustomFieldDef): string {
        const labels: Record<CustomFieldDef["type"], string> = {
            text: i18n?.customFieldTypeText || "Text",
            textarea: i18n?.customFieldTypeTextarea || "Long text",
            number: i18n?.customFieldTypeNumber || "Number",
            boolean: i18n?.customFieldTypeBoolean || "Yes / No",
            date: i18n?.customFieldTypeDate || "Date",
            datetime: i18n?.customFieldTypeDatetime || "Date & time",
            singleSelect: i18n?.customFieldTypeSingleSelect || "Single select",
            multiSelect: i18n?.customFieldTypeMultiSelect || "Multi-select",
            url: i18n?.customFieldTypeUrl || "URL",
        };
        return labels[def.type];
    }

    function openCustomFieldLink(raw: string) {
        const value = raw.trim();
        try {
            const url = new URL(value);
            if (url.protocol === "siyuan:" && value.startsWith("siyuan://blocks/")) {
                const blockId = value.slice("siyuan://blocks/".length).split(/[/?#]/)[0];
                if (!blockId) throw new Error("missing block id");
                jump(blockId);
                return;
            }
            if (url.protocol === "http:" || url.protocol === "https:") {
                window.open(url.toString(), "_blank", "noopener,noreferrer");
                return;
            }
            throw new Error("unsupported protocol");
        } catch (_error) {
            notifyError(i18n?.customFieldInvalidLink || "Invalid link");
        }
    }

    function getCustomFieldValidationError(def: CustomFieldDef): string {
        if (def.type === "number") return i18n?.customFieldInvalidNumber || "Enter a valid number";
        if (def.type === "date") return i18n?.customFieldInvalidDate || "Enter a valid date";
        if (def.type === "datetime") return i18n?.customFieldInvalidDatetime || "Enter a valid date and time";
        if (def.type === "singleSelect" || def.type === "multiSelect") return i18n?.customFieldInvalidSelection || "The selected value is invalid";
        if (def.type === "url") return i18n?.customFieldInvalidLink || "Invalid link";
        if (def.type === "textarea") return i18n?.customFieldTextareaTooLong || "Long text cannot exceed 4000 characters";
        if (def.type === "text") return i18n?.customFieldTextTooLong || "Text cannot exceed 500 characters";
        return i18n?.customFieldInvalidValue || "Invalid value";
    }

    // Initialize review interval mode from task data
    {
        const interval = task.reviewInterval || 0;
        if (interval === 0) {
            reviewIntervalMode = "0";
        } else if ([7, 14, 30, 60, 90].includes(interval)) {
            reviewIntervalMode = String(interval);
        } else {
            reviewIntervalMode = "custom";
            reviewIntervalCustom = String(interval);
        }
    }

    // Initialize custom field values from task data
    {
        if (task.customFields) {
            for (const [key, value] of Object.entries(task.customFields)) {
                customFieldValues[key] = value;
            }
        }
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    $: repeatRuntimeState = parseRepeatState(task.repeatState);
    $: repeatStatus = repeatRuntimeState?.status || (task.repeat ? "active" : "");

    function formatCreated(created: string): string {
        // created is "YYYY-MM-DDTHH:mm:ss" in UTC
        const d = new Date(created + "Z");
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const hour = String(d.getHours()).padStart(2, "0");
        const minute = String(d.getMinutes()).padStart(2, "0");
        return `${year}-${month}-${day} ${hour}:${minute}`;
    }

    // Track which task we're editing, so we can reset on task switch
    let currentBlockId = task.blockId;

    function syncFromTask() {
        status = task.status || "todo";
        priority = normalizePriority(task.priority);
        importance = task.importance || 4;
        effort = task.effort || 4;
        due = task.due || "";
        start = task.start || "";
        note = task.note || "";
        parentId = task.parentId || "";
        depMode = task.depMode || "all";
        sequentialEnabled = task.sequential || false;
        taskType = task.taskType || "1";
        repeatEnabled = !!task.repeat;
        depError = "";
        dateError = "";
        prevDue = due;
        contexts = task.context ? task.context.split("|").filter(Boolean) : [];
        taskTags = task.tags ? task.tags.split("|").filter(Boolean) : [];
        depends = task.depends ? task.depends.split("|").filter(Boolean) : [];
        reviewInterval = task.reviewInterval || 0;
        reviewDate = task.reviewDate || "";
        const interval = task.reviewInterval || 0;
        if (interval === 0) {
            reviewIntervalMode = "0";
        } else if ([7, 14, 30, 60, 90].includes(interval)) {
            reviewIntervalMode = String(interval);
        } else {
            reviewIntervalMode = "custom";
            reviewIntervalCustom = String(interval);
        }
        // Sync custom field values
        customFieldValues = {};
        if (task.customFields) {
            for (const [key, value] of Object.entries(task.customFields)) {
                customFieldValues[key] = value;
            }
        }
    }

    // Only sync on task switch (different blockId). 
    // External changes on the same task (e.g. repeat re-open) are handled
    // inside scheduleSave's callback after comparing the server response.
    $: if (task.blockId !== currentBlockId) {
        currentBlockId = task.blockId;
        syncFromTask();
    }

    onMount(() => {
        // Read contexts and task lookups from store instead of RPC
        let storeState: any;
        const unsub = taskStore.subscribe((s) => { storeState = s; });
        try {
            allContexts = storeState?.contexts || [];
            allTags = storeState?.tags || [];

            if (parentId) {
                const parent = storeState?.allTasks?.find((t: TaskCacheEntry) => t.blockId === parentId);
                if (parent) {
                    parentLabel = parent.title || i18n?.untitled || "(untitled)";
                }
            }

            if (depends.length > 0) {
                const labels: Record<string, string> = {};
                for (const id of depends) {
                    const depTask = storeState?.allTasks?.find((t: TaskCacheEntry) => t.blockId === id);
                    if (depTask) labels[id] = depTask.title || i18n?.untitled || "(untitled)";
                }
                depLabels = labels;
            }

            customFieldDefs = storeState?.settings?.customFields || [];
            const taskMap = new Map((storeState?.allTasks || []).map((entry: TaskCacheEntry) => [entry.blockId, entry]));
            customFieldDefs = customFieldDefs.filter((field: CustomFieldDef) => isCustomFieldApplicable(field, task, taskMap));
        } finally {
            unsub();
        }
    });

    // --- Context handlers ---
    function handleContextChange() {
        scheduleSave();
    }

    // --- Parent task handlers ---
    async function searchParentTasks(query: string): Promise<{ id: string; label: string }[]> {
        let storeState: any;
        const unsub = taskStore.subscribe((s) => { storeState = s; });
        try {
            const allTasks: TaskCacheEntry[] = storeState?.allTasks || [];
            return allTasks
                .filter((t: TaskCacheEntry) =>
                    t.status !== "done" &&
                    t.blockId !== task.blockId &&
                    (!query || (t.title && t.title.toLowerCase().includes(query.toLowerCase())))
                )
                .slice(0, 8)
                .map((t: TaskCacheEntry) => ({ id: t.blockId, label: t.title || i18n?.untitled || "(untitled)" }));
        } finally {
            unsub();
        }
    }

    async function handleParentChange() {
        try {
            const updated = await bridge.updateTask(task.blockId, { "na-parent": parentId });
            if (onSave) onSave(updated);
        } catch (e: any) {
            console.error("[NextAction] updateTask (parent) failed:", e);
            notifyError(formatRpcError(e, i18n));
        }
    }

    async function searchDepTasks(query: string): Promise<{ id: string; label: string }[]> {
        let storeState: any;
        const unsub = taskStore.subscribe((s) => { storeState = s; });
        try {
            const allTasks: TaskCacheEntry[] = storeState?.allTasks || [];
            const taskMap = new Map(allTasks.map((t: TaskCacheEntry) => [t.blockId, t]));
            // Collect ancestor IDs (parent chain) to exclude — use store data
            const ancestorIds = new Set<string>();
            let current = task.parentId;
            let depth = 0;
            while (current && depth < 20) {
                ancestorIds.add(current);
                const entry = taskMap.get(current);
                current = entry?.parentId || "";
                depth++;
            }
            return allTasks
                .filter(t => t.status !== "done")
                .filter(t => t.blockId !== task.blockId && !ancestorIds.has(t.blockId))
                .filter(t => !query || t.title.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 8)
                .map(t => ({ id: t.blockId, label: t.title || i18n?.untitled || "(untitled)" }));
        } finally {
            unsub();
        }
    }

    function applyRepeatUpdate(updated: TaskCacheEntry) {
        task = updated;
        repeatEnabled = !!updated.repeat;
        status = updated.status || "todo";
        due = updated.due || "";
        start = updated.start || "";
        onSave?.(updated);
    }

    async function openRepeatDialog() {
        if (!start && !due) {
            repeatEnabled = !!task.repeat;
            notifyError(i18n?.repeatNeedsDate || "请先设置开始日期或截止日期");
            return;
        }
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
            await flushSave();
        }

        let component: RepeatRuleDialog | null = null;
        const dialog = new Dialog({
            title: i18n?.repeatSettingsTitle || "重复设置",
            content: `<div id="na-repeat-rule-container"></div>`,
            width: "620px",
            destroyCallback: () => component?.$destroy(),
        });
        dialog.element.classList.add("nextaction");
        const container = dialog.element.querySelector("#na-repeat-rule-container");
        if (!container) return;
        component = new RepeatRuleDialog({
            target: container,
            props: {
                task: { ...task, start, due },
                bridge,
                i18n,
                onSave: applyRepeatUpdate,
                onClose: () => dialog.destroy(),
            },
        });
    }

    async function handleRepeatToggle() {
        if (!repeatEnabled) {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = null;
            try {
                const updated = await bridge.updateTask(task.blockId, { "na-repeat": "" });
                applyRepeatUpdate(updated);
            } catch (e: any) {
                console.error("[NextAction] updateTask (repeat toggle) failed:", e);
                notifyError(formatRpcError(e, i18n));
                repeatEnabled = true;
            }
        } else {
            repeatEnabled = !!task.repeat;
            await openRepeatDialog();
        }
    }

    async function handleRepeatPauseToggle() {
        try {
            const updated = await bridge.setRepeatPaused(task.blockId, repeatStatus !== "paused");
            applyRepeatUpdate(updated);
        } catch (e: any) {
            notifyError(formatRpcError(e, i18n));
        }
    }

    async function handleRepeatSkip() {
        try {
            const updated = await bridge.skipRepeatOccurrence(task.blockId);
            applyRepeatUpdate(updated);
        } catch (e: any) {
            notifyError(formatRpcError(e, i18n));
        }
    }

    async function handleTaskTypeChange(newType: string) {
        if (newType === taskType) return;
        taskType = newType;
        try {
            const updated = await bridge.updateTask(task.blockId, { "na-task": newType });
            if (onSave) onSave(updated);
        } catch (e: any) {
            console.error("[NextAction] updateTask (taskType) failed:", e);
            notifyError(formatRpcError(e, i18n));
        }
    }

    async function flushSave() {
        const prevDepends = [...depends];

        // Validate: due must not be earlier than start
        if (start && due) {
            const startDate = new Date(start.includes("T") ? start : start + "T00:00");
            const dueDate = new Date(due.includes("T") ? due : due + "T23:59");
            if (dueDate < startDate) {
                dateError = i18n?.dueBeforeStart || "Due date must not be earlier than start date";
                return;
            }
        }
        dateError = "";

        try {
            const contextStr = contexts.join("|");
            const tagsStr = taskTags.join("|");
            const dependsStr = Array.isArray(depends) ? depends.join("|") : depends;

            // Build custom field attrs
            const customAttrs: Record<string, string> = {};
            customFieldError = "";
            for (const def of customFieldDefs) {
                const val = customFieldValues[def.key] || "";
                try {
                    customAttrs["na-ext-" + def.key] = encodeCustomFieldValue(def, val);
                } catch (e: any) {
                    customFieldError = `${def.label}: ${getCustomFieldValidationError(def)}`;
                    return;
                }
            }

            const updated = await bridge.updateTask(task.blockId, {
                "na-status": status,
                "na-priority": priority,
                "na-importance": String(importance),
                "na-effort": String(effort),
                "na-due": due,
                "na-start": start,
                "na-context": contextStr,
                "na-tags": tagsStr,
                "na-depends": dependsStr,
                "na-dep-mode": depMode,
                "na-sequential": sequentialEnabled ? "1" : "",
                "na-note": note,
                "na-review-interval": reviewInterval > 0 ? String(reviewInterval) : "",
                "na-review-date": reviewDate || "",
                ...customAttrs,
            });
            if (updated?._rpcError) {
                if (updated._rpcError.code === -32007) {
                    depError = i18n?.depCycleDetected || "Dependency cycle detected";
                    depends = prevDepends;
                }
                return;
            }
            // Sync local state if server changed something we didn't request
            // (e.g. repeat task re-opened: status done→todo, dates advanced)
            if (updated.status !== undefined && updated.status !== status) {
                status = updated.status || "todo";
            }
            if (updated.due !== undefined && updated.due !== due) {
                due = updated.due || "";
            }
            if (updated.start !== undefined && updated.start !== start) {
                start = updated.start || "";
            }
            task = updated;
            if (onSave) onSave(updated);
        } catch (e: any) {
            console.error("[NextAction] updateTask failed:", e);
            notifyError(formatRpcError(e, i18n));
        }
    }

    function scheduleSave() {
        if (debounceTimer) clearTimeout(debounceTimer);
        depError = "";
        dateError = "";
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            flushSave();
        }, 500);
    }

    function handleChange() {
        scheduleSave();
    }

    let repeatDateNoticeTaskId = "";

    function handleDateChange() {
        if (repeatEnabled && repeatDateNoticeTaskId !== task.blockId) {
            repeatDateNoticeTaskId = task.blockId;
            notifyInfo(
                i18n?.repeatDateCurrentOnly
                    || "This date change only affects the current occurrence. Edit the repeat rule to change the series."
            );
        }
        handleChange();
    }

    function localDateStr(): string {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    function addDaysToDate(dateStr: string, days: number): string {
        const d = new Date(dateStr + "T00:00:00");
        d.setDate(d.getDate() + days);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    function handleReviewIntervalChange() {
        if (reviewIntervalMode === "0") {
            reviewInterval = 0;
            reviewDate = "";
        } else if (reviewIntervalMode === "custom") {
            // Wait for custom input
            return;
        } else {
            reviewInterval = parseInt(reviewIntervalMode);
            const today = localDateStr();
            reviewDate = addDaysToDate(today, reviewInterval);
        }
        handleChange();
    }

    function handleReviewIntervalCustomChange() {
        const days = parseInt(reviewIntervalCustom);
        if (days > 0 && days <= 365) {
            reviewInterval = days;
            const today = localDateStr();
            reviewDate = addDaysToDate(today, reviewInterval);
            handleChange();
        }
    }

    async function handleRemove() {
        if (!onRemove) return;
        confirm(
            i18n?.removeTask || "Remove Task",
            i18n?.confirmRemoveTask || "This will clear all task attributes. This action cannot be undone.",
            async () => {
                try {
                    await bridge.removeTask(task.blockId);
                    onRemove(task.blockId);
                    if (onClose) onClose();
                } catch (e: any) {
                    console.error("[NextAction] removeTask failed:", e);
                    notifyError(formatRpcError(e, i18n));
                }
            },
        );
    }

    onDestroy(() => {
        // Flush pending save instead of discarding it
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
            flushSave();
        }
    });
</script>

<div class="na-detail" class:na-detail--dialog={dialogMode}>
    <div class="na-detail__header">
        <div class="na-detail__header-top">
            <span class="na-detail__title">
                {task.title || i18n?.untitled || "(untitled)"}
            </span>
            <button
                type="button"
                class="na-detail__type-switch"
                class:na-detail__type-switch--project={taskType === "2"}
                on:click={() => handleTaskTypeChange(taskType === "2" ? "1" : "2")}
                aria-pressed={taskType === "2"}
                title={taskType === "2" ? (i18n?.project || "Project") : (i18n?.task || "Task")}
            >
                <span class="na-detail__type-option">{i18n?.task || "Task"}</span>
                <span class="na-detail__type-option">{i18n?.project || "Project"}</span>
            </button>
            {#if task.blocked && task.taskType !== "2"}
                <span class="na-detail__blocked-badge">
                    {task.blockedReason === "children" ? (i18n?.blockedByChildren || "Blocked - subtasks incomplete") : task.blockedReason === "sequential" ? (i18n?.blockedBySequence || "Blocked - waiting in sequence") : (i18n?.blockedByDependency || "Blocked - dependency incomplete")}
                </span>
            {/if}
            {#if !dialogMode}
                <button class="na-detail__close" on:click={onClose} aria-label="Close">
                    <svg><use xlink:href="#iconClose"></use></svg>
                </button>
            {/if}
        </div>
        {#if task.created}
            <span class="na-detail__created">{formatCreated(task.created)}</span>
        {/if}
    </div>

    <div class="na-detail__body">
        <div class="na-detail__section na-detail__section--compact">
            <div class="na-detail__section-title">{i18n?.detailGroupBasics || "Basic"}</div>
            <div class="na-detail__field">
                <span class="na-detail__label">{i18n?.status || "Status"}</span>
                <div class="na-detail__value">
                    <select class="na-select" bind:value={status} on:change={handleChange}>
                        {#each STATUS_LIST as s}
                            <option value={s}>{i18n?.[toI18nKey("status", s)] || s}</option>
                        {/each}
                    </select>
                </div>
            </div>
            <div class="na-detail__field">
                <span class="na-detail__label">{i18n?.priority || "Priority"}</span>
                <div class="na-detail__value">
                    <select class="na-select" bind:value={priority} on:change={handleChange}>
                        {#each PRIORITY_LIST as p}
                            <option value={p}>{i18n?.[toI18nKey("priority", p)] || p}</option>
                        {/each}
                    </select>
                </div>
            </div>
            <div class="na-detail__field">
                <span class="na-detail__label">{i18n?.importance || "Importance"}</span>
                <div class="na-detail__value">
                    <NaDotRating count={7} bind:value={importance} on:change={handleChange} />
                </div>
            </div>
            <div class="na-detail__field">
                <span class="na-detail__label">{i18n?.effort || "Effort"}</span>
                <div class="na-detail__value">
                    <NaDotRating count={7} bind:value={effort} on:change={handleChange} />
                </div>
            </div>
        </div>

        <div class="na-detail__section">
            <div class="na-detail__section-title">{i18n?.detailGroupTiming || "Timing"}</div>
            <div class="na-detail__field">
                <span class="na-detail__label">{i18n?.startTime || i18n?.startDate || "Start Time"}</span>
                <div class="na-detail__value">
                    <NaDatePicker bind:value={start} placeholder={i18n?.startTime || i18n?.startDate || "Start Time"} defaultTime="00:00" fixedDropdown={dialogMode} {i18n} on:change={handleDateChange} />
                </div>
            </div>
            <div class="na-detail__field">
                <span class="na-detail__label">{i18n?.dueTime || i18n?.dueDate || "Due Time"}</span>
                <div class="na-detail__value na-detail__value--with-bell">
                    <NaDatePicker bind:value={due} placeholder={i18n?.dueTime || i18n?.dueDate || "Due Time"} defaultTime="23:59" fixedDropdown={dialogMode} {i18n} on:change={handleDateChange} />
                    <button
                        class="na-detail__bell-btn"
                        class:na-detail__bell-btn--active={hasReminders}
                        on:click={openReminderPopup}
                        title={i18n?.reminder || "Reminders"}
                    >
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M8 14.5c-.83 0-1.5-.67-1.5-1.5h3c0 .83-.67 1.5-1.5 1.5z"/>
                            <path d="M12.5 11V7.5a4.5 4.5 0 0 0-9 0V11l-1 1.5h11L12.5 11z"/>
                        </svg>
                    </button>
                </div>
            </div>
            {#if dateError}
                <div class="na-detail__field na-detail__field--message">
                    <div class="na-detail__error">{dateError}</div>
                </div>
            {/if}
        </div>

        <div class="na-detail__section">
            <div class="na-detail__section-title">{i18n?.detailGroupOrganization || "Organization"}</div>
            <div class="na-detail__field">
                <span class="na-detail__label">{i18n?.context || "Context"}</span>
                <div class="na-detail__value">
                    <NaSearchSelect
                        multi={true}
                        allowCreate={true}
                        bind:selected={contexts}
                        allOptions={allContexts}
                        placeholder={i18n?.addContext || "Add context..."}
                        emptyText={i18n?.noOptions || "No options"}
                        noMatchText={i18n?.noMatches || "No matches"}
                        loadingText={i18n?.loadingMore || "Loading..."}
                        fixedDropdown={dialogMode}
                        on:change={handleContextChange}
                    />
                </div>
            </div>
            <div class="na-detail__field">
                <span class="na-detail__label">{i18n?.tag || "Tag"}</span>
                <div class="na-detail__value">
                    <NaSearchSelect
                        multi={true}
                        allowCreate={true}
                        bind:selected={taskTags}
                        allOptions={allTags}
                        placeholder={i18n?.addTag || "Add tag..."}
                        emptyText={i18n?.noOptions || "No options"}
                        noMatchText={i18n?.noMatches || "No matches"}
                        loadingText={i18n?.loadingMore || "Loading..."}
                        fixedDropdown={dialogMode}
                        on:change={handleChange}
                    />
                </div>
            </div>
            <div class="na-detail__field">
                <span class="na-detail__label">{i18n?.parentTask || "Parent"}</span>
                <div class="na-detail__value">
                    <NaSearchSelect
                        multi={false}
                        bind:selected={parentId}
                        bind:selectedLabel={parentLabel}
                        searchFn={searchParentTasks}
                        placeholder={i18n?.searchParentTask || "Search parent task..."}
                        emptyText={i18n?.noOptions || "No options"}
                        noMatchText={i18n?.noMatches || "No matches"}
                        loadingText={i18n?.loadingMore || "Loading..."}
                        fixedDropdown={dialogMode}
                        on:change={handleParentChange}
                    />
                </div>
            </div>
        </div>

        <div class="na-detail__section">
            <div class="na-detail__section-title">{i18n?.detailGroupDependencies || "Dependencies"}</div>
            <div class="na-detail__field">
                <span class="na-detail__label">{i18n?.dependencies || "Depends On"}</span>
                <div class="na-detail__value">
                    <NaSearchSelect
                        multi={true}
                        bind:selected={depends}
                        searchFn={searchDepTasks}
                        initialLabels={depLabels}
                        placeholder={i18n?.searchDepTask || "Search dependency tasks..."}
                        emptyText={i18n?.noOptions || "No options"}
                        noMatchText={i18n?.noMatches || "No matches"}
                        loadingText={i18n?.loadingMore || "Loading..."}
                        fixedDropdown={dialogMode}
                        on:change={handleChange}
                    />
                </div>
            </div>
            {#if depError}
                <div class="na-detail__field na-detail__field--message">
                    <div class="na-detail__error">{depError}</div>
                </div>
            {/if}
            <div class="na-detail__field">
                <span class="na-detail__label">{i18n?.depMode || "Mode"}</span>
                <div class="na-detail__value">
                    <select class="na-select" bind:value={depMode} on:change={handleChange}>
                        <option value="all">{i18n?.depModeAll || "All must complete"}</option>
                        <option value="any">{i18n?.depModeAny || "Any can complete"}</option>
                    </select>
                </div>
            </div>
            <div class="na-detail__field">
                <span class="na-detail__label">{i18n?.sequential || "Sequential"}</span>
                <div class="na-detail__value">
                    <NaToggle bind:checked={sequentialEnabled} on:change={handleChange} />
                </div>
            </div>
        </div>

        <div class="na-detail__section">
            <div class="na-detail__section-title">{i18n?.detailGroupRepeat || "Repeat"}</div>
            <div class="na-detail__field">
                <span class="na-detail__label">{i18n?.repeat || "Repeat"}</span>
                <div class="na-detail__value na-detail__repeat-controls">
                    <NaToggle bind:checked={repeatEnabled} on:change={handleRepeatToggle} />
                    {#if repeatEnabled}
                        <div class="na-detail__repeat-actions">
                            {#if repeatStatus !== "ended"}
                                <button class="na-button na-button--sm" on:click={handleRepeatPauseToggle}>
                                    {repeatStatus === "paused" ? (i18n?.repeatResume || "恢复") : (i18n?.repeatPause || "暂停")}
                                </button>
                            {/if}
                            {#if repeatStatus === "active"}
                                <button class="na-button na-button--sm" on:click={handleRepeatSkip}>
                                    {i18n?.repeatSkipOccurrence || "跳过本次"}
                                </button>
                            {/if}
                            <button class="na-button na-button--sm" on:click={openRepeatDialog}>
                                {i18n?.repeatConfigure || "设置"}
                            </button>
                        </div>
                    {/if}
                </div>
            </div>
        </div>

        <div class="na-detail__section">
            <div class="na-detail__section-title">{i18n?.detailGroupReview || "Review"}</div>
            <div class="na-detail__field">
                <span class="na-detail__label">{i18n?.reviewInterval || "Review Interval"}</span>
                <div class="na-detail__value na-detail__review-interval">
                    <select class="na-select" bind:value={reviewIntervalMode} on:change={handleReviewIntervalChange}>
                        <option value="0">{i18n?.reviewIntervalNone || "None"}</option>
                        <option value="7">7 {i18n?.days || "days"}</option>
                        <option value="14">14 {i18n?.days || "days"}</option>
                        <option value="30">30 {i18n?.days || "days"}</option>
                        <option value="60">60 {i18n?.days || "days"}</option>
                        <option value="90">90 {i18n?.days || "days"}</option>
                        <option value="custom">{i18n?.reviewIntervalCustom || "Custom"}</option>
                    </select>
                    {#if reviewIntervalMode === "custom"}
                        <input class="na-input" type="number" min="1" max="365" bind:value={reviewIntervalCustom} on:change={handleReviewIntervalCustomChange} placeholder={i18n?.reviewIntervalDays || "Days"} />
                    {/if}
                </div>
            </div>
            {#if reviewInterval > 0}
                <div class="na-detail__field">
                    <span class="na-detail__label">{i18n?.reviewDate || "Next Review"}</span>
                    <div class="na-detail__value">
                        <NaDatePicker value={reviewDate} fixedDropdown={dialogMode} {i18n} on:change={(e) => { reviewDate = e.detail?.value || ""; handleChange(); }} />
                    </div>
                </div>
            {/if}
        </div>

        <div class="na-detail__section">
            <div class="na-detail__section-title">{i18n?.detailGroupNotes || "Notes"}</div>
            <div class="na-detail__field na-detail__field--wide">
                <span class="na-detail__label">{i18n?.note || "Note"}</span>
                <div class="na-detail__value">
                    <textarea class="na-textarea" bind:value={note} on:input={handleChange} rows="3" placeholder={i18n?.note || "Note"}></textarea>
                </div>
            </div>
            {#if customFieldDefs.length > 0}
                {#each customFieldDefs as def}
                    <div class="na-detail__field">
                        <span class="na-detail__label">{def.label}</span>
                        <div class="na-detail__value">
                            {#if def.type === "textarea"}
                                <textarea class="na-textarea" rows="3" value={customFieldValues[def.key] || ''} on:input={(e) => { customFieldValues[def.key] = e.currentTarget.value; handleChange(); }} placeholder={getCustomFieldTypePlaceholder(def)}></textarea>
                            {:else if def.type === "boolean"}
                                <div class="na-detail__custom-toggle">
                                    <NaToggle
                                        checked={customFieldValues[def.key] === "1" || customFieldValues[def.key] === "true"}
                                        on:change={(e) => { customFieldValues[def.key] = e.detail.checked ? "1" : "0"; handleChange(); }}
                                    />
                                    <span>{customFieldValues[def.key] === "1" || customFieldValues[def.key] === "true"
                                        ? (i18n?.customFieldBooleanYes || "Yes")
                                        : (i18n?.customFieldBooleanNo || "No")}</span>
                                </div>
                            {:else if def.type === "singleSelect"}
                                {@const selectedId = customFieldValues[def.key] || ""}
                                {@const selectedOption = (def.options || []).find(option => option.id === selectedId)}
                                {@const optionLabels = Object.fromEntries((def.options || []).map(option => [option.id, option.label + (option.status === "archived" ? (i18n?.customFieldArchivedOptionSuffix || " (archived)") : "")]))}
                                <NaSearchSelect
                                    multi={false}
                                    selected={selectedId}
                                    selectedLabel={selectedOption ? optionLabels[selectedOption.id] : ""}
                                    initialLabels={optionLabels}
                                    searchFn={(query) => Promise.resolve((def.options || [])
                                        .filter(option => option.status === "active" || option.id === selectedId)
                                        .filter(option => !query || option.label.toLowerCase().includes(query.toLowerCase()))
                                        .map(option => ({ id: option.id, label: optionLabels[option.id] })))}
                                    placeholder={getCustomFieldTypePlaceholder(def)}
                                    emptyText={i18n?.noOptions || "No options"}
                                    noMatchText={i18n?.noMatches || "No matches"}
                                    loadingText={i18n?.loadingMore || "Loading..."}
                                    fixedDropdown={dialogMode}
                                    on:change={(e) => {
                                        customFieldValues[def.key] = Array.isArray(e.detail?.selected) ? (e.detail.selected[0] || "") : String(e.detail?.selected || "");
                                        handleChange();
                                    }}
                                />
                            {:else if def.type === "multiSelect"}
                                {@const selected = (() => { try { return new Set(JSON.parse(customFieldValues[def.key] || "[]")); } catch { return new Set(); } })()}
                                {@const optionLabels = Object.fromEntries((def.options || []).map(option => [option.id, option.label + (option.status === "archived" ? (i18n?.customFieldArchivedOptionSuffix || " (archived)") : "")]))}
                                <NaSearchSelect
                                    multi={true}
                                    selected={[...selected].map(String)}
                                    initialLabels={optionLabels}
                                    searchFn={(query) => Promise.resolve((def.options || [])
                                        .filter(option => option.status === "active" || selected.has(option.id))
                                        .filter(option => !query || option.label.toLowerCase().includes(query.toLowerCase()))
                                        .map(option => ({ id: option.id, label: option.label + (option.status === "archived" ? (i18n?.customFieldArchivedOptionSuffix || " (archived)") : "") })))}
                                    placeholder={getCustomFieldTypePlaceholder(def)}
                                    emptyText={i18n?.noOptions || "No options"}
                                    noMatchText={i18n?.noMatches || "No matches"}
                                    loadingText={i18n?.loadingMore || "Loading..."}
                                    fixedDropdown={dialogMode}
                                    on:change={(e) => {
                                        const next = Array.isArray(e.detail?.selected) ? e.detail.selected.map(String) : [];
                                        customFieldValues[def.key] = JSON.stringify(next);
                                        handleChange();
                                    }}
                                />
                            {:else if def.type === "date" || def.type === "datetime"}
                                <NaDatePicker
                                    value={customFieldValues[def.key] || ""}
                                    placeholder={getCustomFieldTypePlaceholder(def)}
                                    requireTime={def.type === "datetime"}
                                    fixedDropdown={dialogMode}
                                    {i18n}
                                    on:change={(e) => { customFieldValues[def.key] = e.detail?.value || ""; handleChange(); }}
                                />
                            {:else if def.type === "url"}
                                <NaLinkInput
                                    value={customFieldValues[def.key] || ""}
                                    placeholder={getCustomFieldTypePlaceholder(def)}
                                    openLabel={i18n?.customFieldOpenLink || "Open link"}
                                    on:input={(e) => { customFieldValues[def.key] = e.detail.value; handleChange(); }}
                                    on:open={(e) => openCustomFieldLink(e.detail.value)}
                                />
                            {:else}
                                <input
                                    class="na-input"
                                    type={def.type === "number" ? "number" : "text"}
                                    value={customFieldValues[def.key] || ''}
                                    on:input={(e) => { customFieldValues[def.key] = e.currentTarget.value; handleChange(); }}
                                    placeholder={getCustomFieldTypePlaceholder(def)}
                                />
                            {/if}
                        </div>
                    </div>
                {/each}
            {/if}
            {#if customFieldError}<div class="na-detail__error">{customFieldError}</div>{/if}
        </div>
    </div>

    <div class="na-detail__footer">
        {#if dialogMode}
            <button class="na-button na-button--sm na-ai-trigger na-detail__ai-button" on:click={() => runAiDecomposeTask(task)}>
                <svg><use xlink:href="#iconSparkles"></use></svg>
                {i18n?.aiDecomposeTask || "AI 拆解任务"}
            </button>
            <button class="na-button na-button--danger na-button--sm" on:click={handleRemove}>
                {i18n?.removeTask || "Remove Task"}
            </button>
        {:else}
            {#if showJumpToBlock}
                <button class="na-button na-button--sm na-detail__jump-button" on:click={() => jump(task.blockId)}>
                    <svg aria-hidden="true"><use xlink:href="#iconOpenWindow"></use></svg>
                    {i18n?.jumpToBlock || "Jump to Block"}
                </button>
            {/if}
            <button class="na-button na-button--sm na-ai-trigger na-detail__ai-button" on:click={() => runAiDecomposeTask(task)}>
                <svg><use xlink:href="#iconSparkles"></use></svg>
                {i18n?.aiDecomposeTask || "AI 拆解任务"}
            </button>
            <button class="na-button na-button--danger na-button--sm" on:click={handleRemove}>
                {i18n?.removeTask || "Remove Task"}
            </button>
        {/if}
    </div>
</div>
