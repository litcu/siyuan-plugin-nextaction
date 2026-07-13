<script lang="ts">
    import type { TaskCacheEntry } from "../../shared/types";
    import { KernelBridge } from "../kernel-bridge";
    import { taskStore } from "../stores/task-store";
    import { PRIORITY_LIST, STATUS_LIST } from "../constants";
    import { onMount, onDestroy } from "svelte";
    import { confirm, Dialog } from "siyuan";
    import { jumpToBlock as jump, toI18nKey } from "../utils";
    import { notifyError, formatRpcError } from "../notify";
    import NaSearchSelect from "../ui/NaSearchSelect.svelte";
    import NaToggle from "../ui/NaToggle.svelte";
    import NaDotRating from "../ui/NaDotRating.svelte";
    import NaDatePicker from "../ui/NaDatePicker.svelte";
    import ReminderPopup from "./ReminderPopup.svelte";
    import { parseReminderItems } from "../utils/reminder-utils";
    import type { CustomFieldDef } from "../../shared/settings";

    export let task: TaskCacheEntry;
    export let bridge: KernelBridge;
    export let i18n: any;
    export let onSave: ((updatedEntry: TaskCacheEntry) => void) | undefined = undefined;
    export let onRemove: ((blockId: string) => void) | undefined = undefined;
    export let onClose: (() => void) | undefined = undefined;
    export let showJumpToBlock: boolean = true;
    export let dialogMode: boolean = false;

    let status = task.status || "todo";
    let priority = task.priority || "none";
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
    let repeatFreq: string = "week";
    let repeatInterval: number = 1;
    let repeatFrom: string = "due";
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

    // Parse repeat config once at init (not reactively — otherwise user edits get overwritten)
    {
        if (task.repeat) {
            try {
                const parsed = JSON.parse(task.repeat);
                repeatFreq = parsed.freq || "week";
                repeatInterval = parsed.interval || 1;
                repeatFrom = parsed.from || "due";
            } catch {}
        }
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

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
        priority = task.priority || "none";
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
        if (task.repeat) {
            try {
                const parsed = JSON.parse(task.repeat);
                repeatFreq = parsed.freq || "week";
                repeatInterval = parsed.interval || 1;
                repeatFrom = parsed.from || "due";
            } catch {}
        }
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

    async function handleRepeatToggle() {
        // bind:checked already toggles repeatEnabled, so don't flip again
        if (!repeatEnabled) {
            // 关闭时立即保存，不经防抖
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = null;
            try {
                const updated = await bridge.updateTask(task.blockId, { "na-repeat": "" });
                if (onSave) onSave(updated);
            } catch (e: any) {
                console.error("[NextAction] updateTask (repeat toggle) failed:", e);
                notifyError(formatRpcError(e, i18n));
            }
        } else {
            handleChange();
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
            for (const def of customFieldDefs) {
                const val = customFieldValues[def.key] || "";
                customAttrs["na-ext-" + def.key] = val;
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
                "na-repeat": repeatEnabled ? JSON.stringify({ freq: repeatFreq, interval: repeatInterval, from: repeatFrom }) : "",
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
                    <NaDatePicker bind:value={start} placeholder={i18n?.startTime || i18n?.startDate || "Start Time"} defaultTime="00:00" {i18n} on:change={handleChange} />
                </div>
            </div>
            <div class="na-detail__field">
                <span class="na-detail__label">{i18n?.dueTime || i18n?.dueDate || "Due Time"}</span>
                <div class="na-detail__value na-detail__value--with-bell">
                    <NaDatePicker bind:value={due} placeholder={i18n?.dueTime || i18n?.dueDate || "Due Time"} defaultTime="23:59" {i18n} on:change={handleChange} />
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
                <div class="na-detail__value">
                    <NaToggle bind:checked={repeatEnabled} on:change={handleRepeatToggle} />
                </div>
            </div>
            {#if repeatEnabled}
                <div class="na-detail__field">
                    <span class="na-detail__label">{i18n?.repeatFreq || "Frequency"}</span>
                    <div class="na-detail__value">
                        <select class="na-select" bind:value={repeatFreq} on:change={handleChange}>
                            <option value="day">{i18n?.repeatEveryDay || "Every day"}</option>
                            <option value="week">{i18n?.repeatEveryWeek || "Every week"}</option>
                            <option value="month">{i18n?.repeatEveryMonth || "Every month"}</option>
                            <option value="year">{i18n?.repeatEveryYear || "Every year"}</option>
                        </select>
                    </div>
                </div>
                <div class="na-detail__field">
                    <span class="na-detail__label">{i18n?.repeatInterval || "Interval"}</span>
                    <div class="na-detail__value">
                        <input class="na-input" type="number" min="1" max="999" bind:value={repeatInterval} on:change={handleChange} />
                    </div>
                </div>
                <div class="na-detail__field">
                    <span class="na-detail__label">{i18n?.repeatFrom || "From"}</span>
                    <div class="na-detail__value">
                        <select class="na-select" bind:value={repeatFrom} on:change={handleChange}>
                            <option value="due">{i18n?.repeatFromDue || "Due date"}</option>
                            <option value="complete">{i18n?.repeatFromComplete || "Completion date"}</option>
                        </select>
                    </div>
                </div>
            {/if}
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
                        <NaDatePicker value={reviewDate} {i18n} on:change={(e) => { reviewDate = e.detail?.value || ""; handleChange(); }} />
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
                            <input
                                class="na-input"
                                type="text"
                                value={customFieldValues[def.key] || ''}
                                on:change={(e) => { customFieldValues[def.key] = e.currentTarget.value; handleChange(); }}
                                placeholder={def.label}
                            />
                        </div>
                    </div>
                {/each}
            {/if}
        </div>
    </div>

    <div class="na-detail__footer">
        {#if dialogMode}
            <span></span>
            <button class="na-button na-button--danger na-button--sm" on:click={handleRemove}>
                {i18n?.removeTask || "Remove Task"}
            </button>
        {:else}
            {#if showJumpToBlock}
                <button class="na-link" on:click={() => jump(task.blockId)}>
                    {i18n?.jumpToBlock || "Jump to Block"}
                </button>
            {:else}
                <span></span>
            {/if}
            <button class="na-button na-button--danger na-button--sm" on:click={handleRemove}>
                {i18n?.removeTask || "Remove Task"}
            </button>
        {/if}
    </div>
</div>
