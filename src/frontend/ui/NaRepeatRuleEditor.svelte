<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import type { TaskCacheEntry } from "../../shared/types";
    import {
        normalizeRepeatRule,
        parseRepeatRule,
        previewRepeatOccurrences,
        type IsoWeekday,
        type RepeatRuleV2,
    } from "../../shared/repeat";
    import NaDatePicker from "./NaDatePicker.svelte";
    import NaDialogShell from "./NaDialogShell.svelte";
    import NaInlineNotice from "./NaInlineNotice.svelte";
    import NaPropertyRow from "./NaPropertyRow.svelte";
    import NaPropertySection from "./NaPropertySection.svelte";
    import NaSegmentControl from "./NaSegmentControl.svelte";

    export let task: TaskCacheEntry;
    export let i18n: any;
    export let saving = false;
    export let error = "";

    const dispatch = createEventDispatcher<{
        apply: { rule: RepeatRuleV2 };
        requestClose: { dirty: boolean };
    }>();

    const existing = parseRepeatRule(task.repeat);
    const initialRuleKey = JSON.stringify(existing || null);
    const anchorDate = (task.due || task.start || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const anchorDay = Number(anchorDate.slice(8, 10)) || 1;
    const anchorWeekday = (() => {
        const [year, month, day] = anchorDate.split("-").map(Number);
        const value = new Date(year, month - 1, day).getDay();
        return (value === 0 ? 7 : value) as IsoWeekday;
    })();

    let frequency = existing?.frequency || "week";
    let interval = existing?.interval || 1;
    let basis = existing?.basis || "schedule";
    let weekdays: IsoWeekday[] = existing?.weekdays?.length ? [...existing.weekdays] : [anchorWeekday];
    let monthlyType = existing?.monthly?.type || "dayOfMonth";
    let monthDay = existing?.monthly?.type === "dayOfMonth" ? existing.monthly.day : anchorDay;
    let monthlyNth = existing?.monthly?.type === "nthWeekday" ? String(existing.monthly.nth) : "1";
    let monthlyWeekday: IsoWeekday =
        existing?.monthly?.type === "nthWeekday" ? existing.monthly.weekday : anchorWeekday;
    let overflow = existing?.overflow || "lastDay";
    let missedPolicy = existing?.missedPolicy || "nextFuture";
    let endType = existing?.end.type || "never";
    let endCount = existing?.end.type === "count" ? existing.end.count : 10;
    let endDate = existing?.end.type === "date" ? existing.end.date : "";

    const weekdayLabels = [
        i18n?.weekdayMon || "Mon",
        i18n?.weekdayTue || "Tue",
        i18n?.weekdayWed || "Wed",
        i18n?.weekdayThu || "Thu",
        i18n?.weekdayFri || "Fri",
        i18n?.weekdaySat || "Sat",
        i18n?.weekdaySun || "Sun",
    ];

    $: frequencyOptions = [
        { value: "day", label: i18n?.repeatUnitDay || "Day" },
        { value: "week", label: i18n?.repeatUnitWeek || "Week" },
        { value: "month", label: i18n?.repeatUnitMonth || "Month" },
        { value: "year", label: i18n?.repeatUnitYear || "Year" },
    ];
    $: endOptions = [
        { value: "never", label: i18n?.repeatEndNever || "Never" },
        { value: "count", label: i18n?.repeatEndCount || "Count" },
        { value: "date", label: i18n?.repeatEndDate || "Date" },
    ];

    type RepeatRuleDraftInput = {
        frequency: string;
        interval: number;
        basis: string;
        overflow: string;
        missedPolicy: string;
        endType: string;
        endCount: number;
        endDate: string;
        weekdays: IsoWeekday[];
        monthlyType: string;
        monthlyNth: string;
        monthlyWeekday: IsoWeekday;
        monthDay: number;
    };

    function buildRule(input: RepeatRuleDraftInput): RepeatRuleV2 | null {
        const draft: Record<string, any> = {
            version: 2,
            frequency: input.frequency,
            interval: Number(input.interval),
            basis: input.basis,
            overflow: input.overflow,
            missedPolicy: input.missedPolicy,
            end:
                input.endType === "count"
                    ? { type: "count", count: Number(input.endCount) }
                    : input.endType === "date"
                      ? { type: "date", date: input.endDate }
                      : { type: "never" },
        };
        if (input.frequency === "week") draft.weekdays = input.weekdays;
        if (input.frequency === "month") {
            draft.monthly =
                input.monthlyType === "lastDay"
                    ? { type: "lastDay" }
                    : input.monthlyType === "nthWeekday"
                      ? { type: "nthWeekday", nth: Number(input.monthlyNth), weekday: Number(input.monthlyWeekday) }
                      : { type: "dayOfMonth", day: Number(input.monthDay) };
        }
        return normalizeRepeatRule(draft);
    }

    $: draftRule = buildRule({
        frequency,
        interval,
        basis,
        overflow,
        missedPolicy,
        endType,
        endCount,
        endDate,
        weekdays,
        monthlyType,
        monthlyNth,
        monthlyWeekday,
        monthDay,
    });
    $: validationError =
        !task.start && !task.due
            ? i18n?.repeatNeedsDate || "Set a start or due date first"
            : !draftRule
              ? i18n?.invalidRepeatRule || "Invalid repeat rule"
              : "";
    $: dirty = JSON.stringify(draftRule || null) !== initialRuleKey;
    $: previews = draftRule ? previewRepeatOccurrences(draftRule, task.start, task.due, 5) : [];
    $: summary = `${i18n?.repeatEvery || "Every"} ${interval} ${frequencyOptions.find((option) => option.value === frequency)?.label || frequency}`;

    export function hasUnsavedChanges(): boolean {
        return dirty;
    }

    function requestClose() {
        dispatch("requestClose", { dirty });
    }

    function applyDraft() {
        if (saving || validationError || !dirty || !draftRule) return;
        dispatch("apply", { rule: draftRule });
    }

    function applyPreset(preset: "daily" | "workdays" | "weekly" | "monthly" | "yearly") {
        interval = 1;
        if (preset === "daily") frequency = "day";
        if (preset === "workdays") {
            frequency = "week";
            weekdays = [1, 2, 3, 4, 5];
        }
        if (preset === "weekly") {
            frequency = "week";
            weekdays = [anchorWeekday];
        }
        if (preset === "monthly") {
            frequency = "month";
            monthlyType = "dayOfMonth";
            monthDay = anchorDay;
        }
        if (preset === "yearly") frequency = "year";
    }

    function isPresetActive(preset: "daily" | "workdays" | "weekly" | "monthly" | "yearly"): boolean {
        if (interval !== 1) return false;
        if (preset === "daily") return frequency === "day";
        if (preset === "workdays") return frequency === "week" && weekdays.join(",") === "1,2,3,4,5";
        if (preset === "weekly") return frequency === "week" && weekdays.length === 1 && weekdays[0] === anchorWeekday;
        if (preset === "monthly")
            return frequency === "month" && monthlyType === "dayOfMonth" && monthDay === anchorDay;
        return frequency === "year";
    }

    function toggleWeekday(day: IsoWeekday) {
        weekdays = weekdays.includes(day)
            ? weekdays.filter((item) => item !== day)
            : [...weekdays, day].sort((a, b) => a - b);
    }

    function weekdayAt(index: number): IsoWeekday {
        return (index + 1) as IsoWeekday;
    }
</script>

<NaDialogShell
    variant="dialog"
    title={i18n?.repeatSettingsTitle || "Repeat settings"}
    subtitle={task.title || summary}
    closeLabel={i18n?.close || "Close"}
    status={saving ? i18n?.saving || "Saving..." : dirty ? i18n?.unsavedChangesShort || "Modified" : ""}
    statusTone={error ? "error" : dirty ? "warning" : "default"}
    on:close={requestClose}
>
    {#if error}<NaInlineNotice slot="notice" message={error} tone="error" />{:else if validationError}<NaInlineNotice
            slot="notice"
            message={validationError}
            tone="warning"
        />{/if}

    <NaPropertySection title={i18n?.repeatPresets || "Presets"}>
        <div class="na-repeat-rule-editor__presets">
            <button
                type="button"
                class:active={isPresetActive("daily")}
                aria-pressed={isPresetActive("daily")}
                on:click={() => applyPreset("daily")}>{i18n?.repeatDaily || "Daily"}</button
            >
            <button
                type="button"
                class:active={isPresetActive("workdays")}
                aria-pressed={isPresetActive("workdays")}
                on:click={() => applyPreset("workdays")}>{i18n?.repeatWorkdays || "Workdays"}</button
            >
            <button
                type="button"
                class:active={isPresetActive("weekly")}
                aria-pressed={isPresetActive("weekly")}
                on:click={() => applyPreset("weekly")}>{i18n?.repeatWeekly || "Weekly"}</button
            >
            <button
                type="button"
                class:active={isPresetActive("monthly")}
                aria-pressed={isPresetActive("monthly")}
                on:click={() => applyPreset("monthly")}>{i18n?.repeatMonthly || "Monthly"}</button
            >
            <button
                type="button"
                class:active={isPresetActive("yearly")}
                aria-pressed={isPresetActive("yearly")}
                on:click={() => applyPreset("yearly")}>{i18n?.repeatYearly || "Yearly"}</button
            >
        </div>
    </NaPropertySection>

    <NaPropertySection title={i18n?.repeatFrequency || "Schedule"}>
        <NaPropertyRow label={i18n?.repeatFrequency || "Frequency"} stacked={true}>
            <NaSegmentControl
                options={frequencyOptions}
                bind:value={frequency}
                stretch={true}
                label={i18n?.repeatFrequency || "Frequency"}
            />
        </NaPropertyRow>
        <NaPropertyRow
            label={i18n?.repeatInterval || "Interval"}
            helpText={i18n?.repeatIntervalHint || "Repeat after this many selected time units"}
        >
            <input class="b3-text-field" type="number" min="1" max="999" bind:value={interval} />
        </NaPropertyRow>
        <NaPropertyRow
            label={i18n?.repeatBasis || "Basis"}
            helpText={i18n?.repeatBasisHint || "Advance from the original schedule, or recalculate from completion"}
        >
            <select class="b3-select" bind:value={basis}>
                <option value="schedule">{i18n?.repeatBasisSchedule || "Scheduled date"}</option>
                <option value="completion">{i18n?.repeatBasisCompletion || "Completion date"}</option>
            </select>
        </NaPropertyRow>
        <NaPropertyRow
            label={i18n?.repeatMissedPolicy || "Missed occurrences"}
            helpText={i18n?.repeatMissedPolicyHint ||
                "After missed dates, jump to the next future date or catch up one by one"}
        >
            <select class="b3-select" bind:value={missedPolicy}>
                <option value="nextFuture">{i18n?.repeatMissedFuture || "Next future occurrence"}</option>
                <option value="catchUp">{i18n?.repeatMissedCatchUp || "Catch up"}</option>
            </select>
        </NaPropertyRow>
    </NaPropertySection>

    {#if frequency === "week"}
        <NaPropertySection title={i18n?.repeatWeekdays || "Weekdays"}>
            <div class="na-repeat-rule-editor__weekdays">
                {#each weekdayLabels as label, index}
                    <button
                        type="button"
                        class:active={weekdays.includes(weekdayAt(index))}
                        aria-pressed={weekdays.includes(weekdayAt(index))}
                        on:click={() => toggleWeekday(weekdayAt(index))}>{label.slice(0, 2)}</button
                    >
                {/each}
            </div>
        </NaPropertySection>
    {/if}

    {#if frequency === "month"}
        <NaPropertySection title={i18n?.repeatMonthlyPattern || "Monthly pattern"}>
            <NaPropertyRow label={i18n?.repeatMonthlyPattern || "Pattern"}>
                <select class="b3-select" bind:value={monthlyType}>
                    <option value="dayOfMonth">{i18n?.repeatMonthDay || "Day of month"}</option>
                    <option value="lastDay">{i18n?.repeatLastDay || "Last day"}</option>
                    <option value="nthWeekday">{i18n?.repeatNthWeekday || "Nth weekday"}</option>
                </select>
            </NaPropertyRow>
            {#if monthlyType === "dayOfMonth"}
                <NaPropertyRow label={i18n?.repeatMonthDay || "Day"}
                    ><input class="b3-text-field" type="number" min="1" max="31" bind:value={monthDay} /></NaPropertyRow
                >
                <NaPropertyRow
                    label={i18n?.repeatOverflow || "Missing day"}
                    helpText={i18n?.repeatOverflowHint ||
                        "If the target date is absent, use month-end or skip that month"}
                >
                    <select class="b3-select" bind:value={overflow}
                        ><option value="lastDay">{i18n?.repeatOverflowLastDay || "Use last day"}</option><option
                            value="skip">{i18n?.repeatOverflowSkip || "Skip month"}</option
                        ></select
                    >
                </NaPropertyRow>
            {:else if monthlyType === "nthWeekday"}
                <NaPropertyRow label={i18n?.repeatNthWeekday || "Ordinal"}>
                    <select class="b3-select" bind:value={monthlyNth}
                        ><option value="1">{i18n?.ordinalFirst || "First"}</option><option value="2"
                            >{i18n?.ordinalSecond || "Second"}</option
                        ><option value="3">{i18n?.ordinalThird || "Third"}</option><option value="4"
                            >{i18n?.ordinalFourth || "Fourth"}</option
                        ><option value="-1">{i18n?.ordinalLast || "Last"}</option></select
                    >
                </NaPropertyRow>
                <NaPropertyRow label={i18n?.repeatWeekdays || "Weekday"}>
                    <select class="b3-select" bind:value={monthlyWeekday}
                        >{#each weekdayLabels as label, index}<option value={index + 1}>{label}</option>{/each}</select
                    >
                </NaPropertyRow>
            {/if}
        </NaPropertySection>
    {/if}

    <NaPropertySection title={i18n?.repeatEnd || "End condition"}>
        <NaPropertyRow label={i18n?.repeatEnd || "End"} stacked={true}
            ><NaSegmentControl
                options={endOptions}
                bind:value={endType}
                stretch={true}
                label={i18n?.repeatEnd || "End"}
            /></NaPropertyRow
        >
        {#if endType === "count"}<NaPropertyRow label={i18n?.repeatEndCount || "Count"}
                ><input class="b3-text-field" type="number" min="1" max="99999" bind:value={endCount} /></NaPropertyRow
            >{/if}
        {#if endType === "date"}<NaPropertyRow label={i18n?.repeatEndDate || "Date"}
                ><NaDatePicker
                    value={endDate}
                    fixedDropdown={true}
                    {i18n}
                    on:change={(event) => (endDate = event.detail?.value || "")}
                /></NaPropertyRow
            >{/if}
    </NaPropertySection>

    <NaPropertySection title={i18n?.repeatPreview || "Preview"}>
        {#if previews.length > 0}
            <ol class="na-repeat-rule-editor__preview">
                {#each previews as item, index}
                    <li>
                        <span>{index + 1}</span><strong>{item.start || item.due}</strong
                        >{#if item.start && item.due && item.start !== item.due}<small>{item.due}</small>{/if}
                    </li>
                {/each}
            </ol>
        {:else}
            <div class="na-repeat-rule-editor__empty">{validationError}</div>
        {/if}
    </NaPropertySection>

    <div slot="footerEnd">
        <button type="button" class="b3-button b3-button--text" disabled={saving} on:click={requestClose}
            >{i18n?.cancel || "Cancel"}</button
        >
        <button
            type="button"
            class="b3-button b3-button--primary"
            disabled={saving || !!validationError || !dirty || !draftRule}
            on:click={applyDraft}>{saving ? i18n?.saving || "Saving..." : i18n?.save || "Save"}</button
        >
    </div>
</NaDialogShell>

<style lang="scss">
    :global(.na-repeat-dialog-container) {
        width: min(620px, calc(100vw - 24px)) !important;
        height: min(680px, calc(100vh - 24px));
        max-height: calc(100vh - 24px);
        overflow: hidden;
    }
    :global(.na-repeat-dialog-container > .b3-dialog__body) {
        width: 100%;
        flex: 1 1 0;
        min-height: 0;
        overflow: hidden;
    }
    :global(.na-repeat-rule-editor) {
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
    }
    :global(.na-repeat-rule-editor .na-property-row__control) {
        justify-content: flex-start;
    }
    :global(.na-repeat-rule-editor .na-property-row__control > .b3-select),
    :global(.na-repeat-rule-editor .na-property-row__control > .na-date-picker) {
        width: 100%;
    }
    :global(.na-repeat-rule-editor .na-property-row__control > .b3-text-field) {
        width: min(100%, 180px);
    }
    .na-repeat-rule-editor__presets {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 6px;
        padding: 10px 0;
    }
    .na-repeat-rule-editor__presets button,
    .na-repeat-rule-editor__weekdays button {
        min-width: 0;
        min-height: 30px;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius);
        color: var(--na-text-secondary);
        background: var(--b3-theme-background);
        cursor: pointer;
        font-family: var(--b3-font-family);
        font-size: var(--na-font-size-sm);
    }
    .na-repeat-rule-editor__presets button:hover,
    .na-repeat-rule-editor__weekdays button:hover {
        border-color: var(--b3-theme-primary-light);
        color: var(--na-text-primary);
    }
    .na-repeat-rule-editor__presets button.active,
    .na-repeat-rule-editor__weekdays button.active {
        border-color: var(--b3-theme-primary);
        color: var(--na-text-interactive);
        background: var(--b3-theme-primary-lightest);
    }
    .na-repeat-rule-editor__weekdays {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 5px;
        padding: 10px 0;
    }
    :global(.na-repeat-rule-editor .na-segment-control) {
        width: 100%;
    }
    .na-repeat-rule-editor__preview {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
        margin: 0;
        padding: 10px 0;
        list-style: none;
    }
    .na-repeat-rule-editor__preview li {
        display: grid;
        grid-template-columns: 20px minmax(0, 1fr);
        align-items: center;
        gap: 1px 7px;
        min-width: 0;
        padding: 7px 8px;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius);
        background: var(--b3-theme-background);
    }
    .na-repeat-rule-editor__preview li > span {
        grid-row: 1 / 3;
        color: var(--na-text-interactive);
        font-size: 10px;
        font-weight: 600;
    }
    .na-repeat-rule-editor__preview strong {
        overflow: hidden;
        color: var(--na-text-primary);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .na-repeat-rule-editor__preview small {
        color: var(--na-text-secondary);
        font-size: 10px;
    }
    .na-repeat-rule-editor__empty {
        padding: 18px 0;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-md);
        text-align: center;
    }
    @media (max-width: 520px) {
        .na-repeat-rule-editor__presets {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .na-repeat-rule-editor__preview {
            grid-template-columns: 1fr;
        }
    }
</style>
