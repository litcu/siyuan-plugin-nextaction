<script lang="ts">
    import type { TaskCacheEntry, ReminderItem, ReminderRelative, ReminderAbsolute } from "../../shared/types";
    import { KernelBridge } from "../kernel-bridge";
    import { taskStore } from "../stores/task-store";
    import { REMINDER_MAX_PER_TASK } from "../../shared/constants";
    import { parseReminderItems, serializeReminderItems, formatReminderDescription, formatOffset } from "../utils/reminder-utils";
    import NaDatePicker from "../ui/NaDatePicker.svelte";
    import { notifyError, formatRpcError } from "../notify";

    export let task: TaskCacheEntry;
    export let bridge: KernelBridge;
    export let i18n: any;
    export let onSave: ((updatedEntry: TaskCacheEntry) => void) | undefined = undefined;

    // Current reminder items
    let items: ReminderItem[] = parseReminderItems(task.reminder);
    let showAddAbsolute = false;
    let newAbsoluteTime = "";

    // Global presets from settings
    $: defaultOffsets = $taskStore.settings?.reminderSettings?.defaultOffsets ?? [];

    // Relative items currently in the list
    $: relativeItems = items.filter(i => i.type === "relative") as ReminderRelative[];
    $: absoluteItems = items.filter(i => i.type === "absolute") as ReminderAbsolute[];
    $: count = items.length;
    $: isFull = count >= REMINDER_MAX_PER_TASK;

    // Which default offsets are selected
    $: selectedOffsets = new Set(relativeItems.map(i => i.minutes));

    // Whether task has a due date
    $: hasDue = !!task.due;

    // Custom offset input
    let newOffsetValue: number = 30;
    let newOffsetUnit: string = "minutes";

    async function saveItems(newItems: ReminderItem[]) {
        try {
            const updated = await bridge.updateTask(task.blockId, {
                "na-reminder": serializeReminderItems(newItems),
            });
            items = newItems;
            if (onSave) onSave(updated);
        } catch (e: any) {
            console.error("[NextAction] updateTask (reminder) failed:", e);
            notifyError(formatRpcError(e, i18n));
        }
    }

    function removeItem(index: number) {
        const newItems = items.filter((_, i) => i !== index);
        saveItems(newItems);
    }

    function addAbsoluteItem() {
        if (!newAbsoluteTime || isFull) return;
        // Check duplicate
        if (items.some(i => i.type === "absolute" && (i as ReminderAbsolute).time === newAbsoluteTime)) return;
        const newItems = [...items, { type: "absolute", time: newAbsoluteTime }];
        saveItems(newItems);
        newAbsoluteTime = "";
        showAddAbsolute = false;
    }

    function toggleOffset(minutes: number) {
        if (selectedOffsets.has(minutes)) {
            // Remove
            const newItems = items.filter(i => !(i.type === "relative" && (i as ReminderRelative).minutes === minutes));
            saveItems(newItems);
        } else {
            if (isFull) return;
            // Add
            const newItems = [...items, { type: "relative", minutes } as ReminderRelative];
            // Sort: relative by minutes asc, then absolute by time asc
            newItems.sort((a, b) => {
                if (a.type === "relative" && b.type === "relative") return a.minutes - b.minutes;
                if (a.type === "absolute" && b.type === "absolute") return a.time.localeCompare(b.time);
                return a.type === "relative" ? -1 : 1;
            });
            saveItems(newItems);
        }
    }

    function addCustomOffset() {
        let mins = newOffsetValue;
        if (newOffsetUnit === "hours") mins *= 60;
        else if (newOffsetUnit === "days") mins *= 1440;
        if (mins < 1 || mins > 20160 || isFull) return;
        if (selectedOffsets.has(mins)) return;
        const newItems = [...items, { type: "relative", minutes: mins } as ReminderRelative];
        newItems.sort((a, b) => {
            if (a.type === "relative" && b.type === "relative") return a.minutes - b.minutes;
            if (a.type === "absolute" && b.type === "absolute") return a.time.localeCompare(b.time);
            return a.type === "relative" ? -1 : 1;
        });
        saveItems(newItems);
    }
</script>

<div class="na-reminder-popup">
    <!-- Header -->
    <div class="na-reminder-popup__header">
        <span class="na-reminder-popup__title">{i18n?.reminderPopupTitle || "提醒设置"}</span>
        <span class="na-reminder-popup__count">{count}/{REMINDER_MAX_PER_TASK}</span>
    </div>

    <!-- Current reminders list -->
    <div class="na-reminder-popup__list">
        {#if items.length === 0}
            <div class="na-reminder-popup__empty">{i18n?.reminderEmptyList || "暂无提醒"}</div>
        {:else}
            {#each items as item, index}
                <div class="na-reminder-popup__item">
                    <span class="na-reminder-popup__item-icon">
                        {#if item.type === "absolute"}
                            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="1"/><line x1="5" y1="1" x2="5" y2="4"/><line x1="11" y1="1" x2="11" y2="4"/><line x1="2" y1="6" x2="14" y2="6"/></svg>
                        {:else}
                            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8.5" r="5.5"/><polyline points="8 5.5 8 8.5 10.5 9.5"/></svg>
                        {/if}
                    </span>
                    <span class="na-reminder-popup__item-desc">{formatReminderDescription(item, i18n)}</span>
                    <button class="na-reminder-popup__item-remove" on:click={() => removeItem(index)} title={i18n?.reminderRemoveOffset || "删除"}>×</button>
                </div>
            {/each}
        {/if}
    </div>

    <!-- Add absolute reminder -->
    <div class="na-reminder-popup__section">
        <div class="na-reminder-popup__section-row">
            <span class="na-reminder-popup__section-title">{i18n?.reminderAbsolute || "固定提醒"}</span>
            <button
                class="na-reminder-popup__add-btn"
                on:click={() => { showAddAbsolute = !showAddAbsolute; if (!showAddAbsolute) newAbsoluteTime = ""; }}
                disabled={isFull}
            >
                {showAddAbsolute
                    ? (i18n?.reminderAddAbsoluteCollapse || "收起")
                    : (i18n?.reminderAddAbsolute || "添加")}
            </button>
        </div>
        {#if showAddAbsolute}
            <div class="na-reminder-popup__absolute-form">
                <NaDatePicker
                    bind:value={newAbsoluteTime}
                    placeholder={i18n?.reminderAddAbsoluteDate || "选择日期时间"}
                    defaultTime="09:00"
                    requireTime={true}
                    fixedDropdown={true}
                    {i18n}
                />
                <button class="na-reminder-popup__confirm-btn" on:click={addAbsoluteItem} disabled={!newAbsoluteTime || isFull}>
                    ✓
                </button>
            </div>
        {/if}
    </div>

    <!-- Relative reminders section -->
    <div class="na-reminder-popup__section" class:na-reminder-popup__section--disabled={!hasDue}>
        <div class="na-reminder-popup__section-title">{i18n?.reminderRelativeSection || "截止日期前提醒"}</div>
        {#if !hasDue}
            <div class="na-reminder-popup__no-due">{i18n?.reminderNoDueDate || "请先设置截止日期"}</div>
        {:else}
            {#if defaultOffsets.length > 0}
                <div class="na-reminder-popup__presets">
                    {#each defaultOffsets as offset}
                        <label class="na-reminder-popup__check">
                            <input
                                type="checkbox"
                                checked={selectedOffsets.has(offset)}
                                on:change={() => toggleOffset(offset)}
                                disabled={isFull && !selectedOffsets.has(offset)}
                            />
                            <span class="na-reminder-popup__check-label">{formatOffset(offset, i18n)}</span>
                        </label>
                    {/each}
                </div>
            {/if}
            <div class="na-reminder-popup__custom-offset">
                <input class="na-input na-reminder-popup__custom-input" type="number" min="1" bind:value={newOffsetValue} disabled={isFull} />
                <select class="na-select na-reminder-popup__custom-unit" bind:value={newOffsetUnit} disabled={isFull}>
                    <option value="minutes">{i18n?.reminderOffsetMinutes || "分钟"}</option>
                    <option value="hours">{i18n?.reminderOffsetHours || "小时"}</option>
                    <option value="days">{i18n?.reminderOffsetDays || "天"}</option>
                </select>
                <button class="na-button na-button--sm" on:click={addCustomOffset} disabled={isFull}>+</button>
            </div>
        {/if}
    </div>
</div>
