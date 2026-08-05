<script lang="ts">
    import type { MyDayViewMode } from "../../../shared/settings";
    import type { ReminderSoundId } from "../../../shared/constants";
    import NaDotRating from "../../ui/NaDotRating.svelte";
    import NaIcon from "../../ui/NaIcon.svelte";
    import NaSettingRow from "../../ui/NaSettingRow.svelte";
    import NaSection from "../../ui/NaSection.svelte";

    export let i18n: any;
    export let defaultImportance: number;
    export let defaultEffort: number;
    export let myDayEnabled: boolean;
    export let myDayResetHour: number;
    export let myDayDefaultViewMode: MyDayViewMode;
    export let myDayDefaultDuration: number;
    export let reminderEnabled: boolean;
    export let reminderDefaultOffsets: number[];
    export let reminderDueSound: ReminderSoundId;
    export let reminderReviewSound: ReminderSoundId;
    export let reminderSoundEnabled: boolean;
    export let newOffsetValue: number;
    export let newOffsetUnit: "minutes" | "hours" | "days";
    export let soundIds: readonly ReminderSoundId[];
    export let getSoundLabel: (soundId: ReminderSoundId) => string;
    export let getUnitLabel: (unit: "minutes" | "hours" | "days") => string;
    export let minutesToDisplay: (minutes: number) => { value: number; unit: "minutes" | "hours" | "days" };
    export let onAddOffset: () => void;
    export let onRemoveOffset: (minutes: number) => void;
    export let onPreviewSound: (soundId: ReminderSoundId) => void;
    export let onResetDefaults: () => void;
    export let onResetMyDay: () => void;
    export let onResetReminder: () => void;
</script>

<div class="na-page-stack na-settings-general">
    <NaSection
        icon="iconCheck"
        title={i18n?.settingDefaults || "Task defaults"}
        description={i18n?.settingDefaultsDesc || "Initial attributes when creating a task"}
        actionLabel={i18n?.settingResetSection || i18n?.settingReset || "Reset"}
        onAction={onResetDefaults}
    >
        <NaSettingRow title={i18n?.settingDefaultImportance || "Default importance"} description={i18n?.settingDefaultImportanceDesc || "Importance value for new tasks (1-7)"}>
            <NaDotRating count={7} bind:value={defaultImportance} color="var(--na-color-importance)" />
        </NaSettingRow>
        <NaSettingRow title={i18n?.settingDefaultEffort || "Default effort"} description={i18n?.settingDefaultEffortDesc || "Effort value for new tasks (1-7)"}>
            <NaDotRating count={7} bind:value={defaultEffort} color="var(--na-color-effort)" />
        </NaSettingRow>
    </NaSection>

    <NaSection
        icon="iconCalendar"
        title={i18n?.settingMyDay || "My Day"}
        description={i18n?.settingMyDayDesc || "Settings for the daily task planning view"}
        actionLabel={i18n?.settingResetSection || i18n?.settingReset || "Reset"}
        onAction={onResetMyDay}
    >
        <NaSettingRow forId="setting-myday-enabled" title={i18n?.settingMyDayEnabled || "Enable My Day"} description={i18n?.settingMyDayEnabledDesc || "Show the My Day view in the navigation rail"}>
            <input id="setting-myday-enabled" class="b3-switch" type="checkbox" bind:checked={myDayEnabled} />
        </NaSettingRow>
        <NaSettingRow disabled={!myDayEnabled} forId="setting-myday-reset-hour" title={i18n?.settingMyDayResetHour || "Daily reset hour"} description={i18n?.settingMyDayResetHourDesc || "Before this hour still counts as the previous day (0-23)"}>
            <div class="na-settings-general__inline-control">
                <input id="setting-myday-reset-hour" class="b3-text-field na-settings-general__number" type="number" min={0} max={23} step={1} bind:value={myDayResetHour} disabled={!myDayEnabled} />
                <span>:00</span>
            </div>
        </NaSettingRow>
        <NaSettingRow disabled={!myDayEnabled} title={i18n?.settingMyDayDefaultViewMode || "Default view mode"} description={i18n?.settingMyDayDefaultViewModeDesc || "Initial view when opening My Day"}>
            <div class="na-settings-general__segmented" aria-label={i18n?.settingMyDayDefaultViewMode || "Default view mode"}>
                <label class:active={myDayDefaultViewMode === "timeline"}>
                    <input type="radio" value="timeline" bind:group={myDayDefaultViewMode} disabled={!myDayEnabled} />
                    <span>{i18n?.settingMyDayDefaultViewModeTimeline || "Timeline"}</span>
                </label>
                <label class:active={myDayDefaultViewMode === "list"}>
                    <input type="radio" value="list" bind:group={myDayDefaultViewMode} disabled={!myDayEnabled} />
                    <span>{i18n?.settingMyDayDefaultViewModeList || "List"}</span>
                </label>
            </div>
        </NaSettingRow>
        <NaSettingRow disabled={!myDayEnabled} forId="setting-myday-duration" title={i18n?.settingMyDayDefaultDuration || "Default schedule duration"} description={i18n?.settingMyDayDefaultDurationDesc || "Default duration when dropping a task onto the timeline"}>
            <div class="na-settings-general__inline-control">
                <input id="setting-myday-duration" class="b3-text-field na-settings-general__number" type="number" min={15} max={480} step={15} bind:value={myDayDefaultDuration} disabled={!myDayEnabled} />
                <span>{i18n?.settingMinutes || "min"}</span>
            </div>
        </NaSettingRow>
    </NaSection>

    <NaSection
        icon="iconClock"
        title={i18n?.reminder || "Reminders"}
        description={i18n?.reminderSettingEnabledDesc || "Show notifications before due dates and on review dates"}
        actionLabel={i18n?.settingResetSection || i18n?.settingReset || "Reset"}
        onAction={onResetReminder}
    >
        <NaSettingRow forId="setting-reminder-enabled" title={i18n?.reminderSettingEnabled || i18n?.reminder || "Enable reminders"} description={i18n?.reminderSettingEnabledDesc || "Show notifications before due dates and on review dates"}>
            <input id="setting-reminder-enabled" class="b3-switch" type="checkbox" bind:checked={reminderEnabled} />
        </NaSettingRow>
        <NaSettingRow stacked={true} disabled={!reminderEnabled} title={i18n?.reminderSettingDefaultOffsets || "Default advance times"} description={i18n?.reminderSettingDefaultOffsetsDesc || "Advance times offered when configuring task reminders"}>
            <div class="na-settings-general__offset-editor">
                <div class="na-settings-general__offset-list">
                    {#each reminderDefaultOffsets as offset}
                        {@const display = minutesToDisplay(offset)}
                        <span class="na-settings-general__offset-chip">
                            <strong>{display.value}</strong>
                            <span>{getUnitLabel(display.unit)}</span>
                            <button type="button" on:click={() => onRemoveOffset(offset)} disabled={!reminderEnabled} title={i18n?.reminderRemoveOffset || "Remove"} aria-label={i18n?.reminderRemoveOffset || "Remove"}>
                                <NaIcon symbol="iconCloseRound" size={13} />
                            </button>
                        </span>
                    {:else}
                        <span class="na-settings-general__empty">{i18n?.reminderNoPending || "No advance times configured"}</span>
                    {/each}
                </div>
                <div class="na-settings-general__offset-add">
                    <input class="b3-text-field na-settings-general__number" type="number" min={1} bind:value={newOffsetValue} disabled={!reminderEnabled} />
                    <select class="b3-select" bind:value={newOffsetUnit} disabled={!reminderEnabled}>
                        <option value="minutes">{i18n?.reminderOffsetMinutes || "minutes"}</option>
                        <option value="hours">{i18n?.reminderOffsetHours || "hours"}</option>
                        <option value="days">{i18n?.reminderOffsetDays || "days"}</option>
                    </select>
                    <button type="button" class="b3-button" on:click={onAddOffset} disabled={!reminderEnabled}>
                        <NaIcon symbol="iconAdd" size={14} />
                        {i18n?.reminderAddOffset || "Add"}
                    </button>
                </div>
            </div>
        </NaSettingRow>
        <NaSettingRow disabled={!reminderEnabled} forId="setting-reminder-due-sound" title={i18n?.reminderSettingDueSound || "Due reminder sound"}>
            <div class="na-settings-general__sound-control">
                <select id="setting-reminder-due-sound" class="b3-select" bind:value={reminderDueSound} disabled={!reminderEnabled}>
                    {#each soundIds as soundId}<option value={soundId}>{getSoundLabel(soundId)}</option>{/each}
                </select>
                <button type="button" class="b3-button b3-button--text" on:click={() => onPreviewSound(reminderDueSound)} disabled={!reminderEnabled} title={i18n?.reminderPreviewSound || "Preview"}>
                    <NaIcon symbol="iconPlay" size={14} />
                </button>
            </div>
        </NaSettingRow>
        <NaSettingRow disabled={!reminderEnabled} forId="setting-reminder-review-sound" title={i18n?.reminderSettingReviewSound || "Review reminder sound"}>
            <div class="na-settings-general__sound-control">
                <select id="setting-reminder-review-sound" class="b3-select" bind:value={reminderReviewSound} disabled={!reminderEnabled}>
                    {#each soundIds as soundId}<option value={soundId}>{getSoundLabel(soundId)}</option>{/each}
                </select>
                <button type="button" class="b3-button b3-button--text" on:click={() => onPreviewSound(reminderReviewSound)} disabled={!reminderEnabled} title={i18n?.reminderPreviewSound || "Preview"}>
                    <NaIcon symbol="iconPlay" size={14} />
                </button>
            </div>
        </NaSettingRow>
        <NaSettingRow disabled={!reminderEnabled} forId="setting-reminder-sound-enabled" title={i18n?.reminderSettingSoundEnabled || "Play reminder sounds"} description={i18n?.reminderSettingSoundEnabledDesc || "Play a sound when a reminder appears"}>
            <input id="setting-reminder-sound-enabled" class="b3-switch" type="checkbox" bind:checked={reminderSoundEnabled} disabled={!reminderEnabled} />
        </NaSettingRow>
    </NaSection>
</div>

<style lang="scss">
    .na-settings-general__inline-control,
    .na-settings-general__sound-control,
    .na-settings-general__offset-add {
        display: flex;
        align-items: center;
        gap: 7px;
        color: var(--b3-theme-on-surface-light);
        font-size: 12px;
    }

    :global(.na-settings-general__number) {
        width: 82px;
    }

    .na-settings-general__segmented {
        display: inline-flex;
        padding: 2px;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius);
        background: var(--b3-theme-background);

        label {
            position: relative;
            padding: 4px 10px;
            border-radius: calc(var(--b3-border-radius) - 2px);
            color: var(--b3-theme-on-surface-light);
            cursor: pointer;
            font-size: 12px;

            &.active {
                color: var(--b3-theme-primary);
                background: var(--b3-theme-primary-lightest);
            }
        }

        input {
            position: absolute;
            opacity: 0;
            pointer-events: none;
        }
    }

    .na-settings-general__offset-editor {
        width: 100%;
    }

    .na-settings-general__offset-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        min-height: 27px;
    }

    .na-settings-general__offset-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 5px 3px 9px;
        border: 1px solid var(--b3-border-color);
        border-radius: 999px;
        color: var(--b3-theme-on-surface-light);
        background: var(--b3-theme-background);
        font-size: 11px;

        strong {
            color: var(--b3-theme-on-surface);
            font-weight: 600;
        }

        button {
            display: grid;
            place-items: center;
            width: 20px;
            height: 20px;
            padding: 0;
            border: 0;
            border-radius: 50%;
            color: var(--b3-theme-on-surface-light);
            background: transparent;
            cursor: pointer;

            &:hover:not(:disabled) {
                color: var(--b3-theme-error);
                background: var(--b3-theme-error-lightest);
            }
        }
    }

    .na-settings-general__offset-add {
        margin-top: 9px;
    }

    .na-settings-general__sound-control :global(.b3-select) {
        min-width: 128px;
    }

    .na-settings-general__empty {
        color: var(--b3-theme-on-surface-light);
        font-size: 11px;
        font-style: italic;
    }
</style>
