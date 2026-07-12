<script lang="ts">
    import { onMount } from "svelte";
    import type { PluginSettings, PriorityEngineSettings, MyDayViewMode, CustomFieldDef, ReminderSettings } from "../../shared/settings";
    import { DEFAULT_SETTINGS, DEFAULT_PRIORITY_ENGINE, DEFAULT_REMINDER_SETTINGS, validateSettings } from "../../shared/settings";
    import { REMINDER_SOUND_IDS, type ReminderSoundId } from "../../shared/constants";
    import NaDotRating from "../ui/NaDotRating.svelte";
    import { formatRpcError, formatValidationError, notifyInfo, notifyError } from "../notify";
    import { playSound, unlockAutoplay } from "../utils/audio-player";

    export let bridge: any;
    export let i18n: any;
    export let onSave: (settings: PluginSettings) => void;
    export let onClose: () => void;

    type TabId = "defaults" | "myDay" | "customFields" | "priority" | "reminder";

    let activeTab: TabId = "defaults";
    let current: PluginSettings = { ...DEFAULT_SETTINGS };
    let saving = false;
    let rebuilding = false;
    let rebuildingParents = false;
    let error = "";

    // Local editable copies
    let defaultImportance: number = DEFAULT_SETTINGS.defaultImportance;
    let defaultEffort: number = DEFAULT_SETTINGS.defaultEffort;

    // My Day
    let myDayEnabled: boolean = DEFAULT_SETTINGS.myDayEnabled;
    let myDayResetHour: number = DEFAULT_SETTINGS.myDayResetHour;
    let myDayDefaultViewMode: MyDayViewMode = DEFAULT_SETTINGS.myDayDefaultViewMode;
    let myDayDefaultDuration: number = DEFAULT_SETTINGS.myDayDefaultDuration;

    // Priority engine
    let dueWeight: number = DEFAULT_PRIORITY_ENGINE.dueWeight;
    let startWeight: number = DEFAULT_PRIORITY_ENGINE.startWeight;
    let importanceWeight: number = DEFAULT_PRIORITY_ENGINE.importanceWeight;
    let dueDecayTau: number = DEFAULT_PRIORITY_ENGINE.dueDecayTau;
    let overdueGrowth: number = DEFAULT_PRIORITY_ENGINE.overdueGrowth;
    let overdueCap: number = DEFAULT_PRIORITY_ENGINE.overdueCap;
    let startHorizon: number = DEFAULT_PRIORITY_ENGINE.startHorizon;
    let effortScale: number = DEFAULT_PRIORITY_ENGINE.effortScale;
    let startPreviewDays: number = DEFAULT_PRIORITY_ENGINE.startPreviewDays;

    // Reminder
    let reminderEnabled: boolean = DEFAULT_REMINDER_SETTINGS.enabled;
    let reminderDefaultOffsets: number[] = [...DEFAULT_REMINDER_SETTINGS.defaultOffsets];
    let reminderDueSound: ReminderSoundId = DEFAULT_REMINDER_SETTINGS.dueSound;
    let reminderReviewSound: ReminderSoundId = DEFAULT_REMINDER_SETTINGS.reviewSound;
    let reminderSoundEnabled: boolean = DEFAULT_REMINDER_SETTINGS.soundEnabled;
    let newOffsetValue: number = 60;
    let newOffsetUnit: "minutes" | "hours" | "days" = "minutes";

    // Custom fields
    let customFields: CustomFieldDef[] = [];
    let newFieldKey: string = "";
    let newFieldLabel: string = "";
    let newFieldError: string = "";

    $: weightSum = Math.round((dueWeight + startWeight + importanceWeight) * 100) / 100;

    const tabs: { id: TabId; label: string; desc: string }[] = [
        { id: "defaults", label: "", desc: "" },
        { id: "myDay", label: "", desc: "" },
        { id: "reminder", label: "", desc: "" },
        { id: "customFields", label: "", desc: "" },
        { id: "priority", label: "", desc: "" },
    ];

    $: tabs[0].label = i18n.settingDefaults || "Task Defaults";
    $: tabs[0].desc = i18n.settingDefaultsDesc || "Initial attributes when creating a task";
    $: tabs[1].label = i18n.settingMyDay || "My Day";
    $: tabs[1].desc = i18n.settingMyDayDesc || "Settings for the daily task planning view";
    $: tabs[2].label = i18n.reminder || "Reminders";
    $: tabs[2].desc = i18n.reminderSettingEnabledDesc || "Show notifications before due dates and on review dates";
    $: tabs[3].label = i18n.settingCustomFields || "Custom Fields";
    $: tabs[3].desc = i18n.settingCustomFieldsDesc || "Add custom attribute fields to tasks";
    $: tabs[4].label = i18n.settingPriorityEngine || "Priority Parameters";
    $: tabs[4].desc = i18n.settingPriorityEngineDesc || "Auto priority calculation parameters — do not modify if unsure";

    $: tabTitle = tabs.find(t => t.id === activeTab)?.label || "";
    $: tabDesc = tabs.find(t => t.id === activeTab)?.desc || "";

    onMount(async () => {
        try {
            const settings = await bridge.getSettings();
            current = settings;
            defaultImportance = settings.defaultImportance;
            defaultEffort = settings.defaultEffort;
            myDayEnabled = settings.myDayEnabled ?? DEFAULT_SETTINGS.myDayEnabled;
            myDayResetHour = settings.myDayResetHour ?? DEFAULT_SETTINGS.myDayResetHour;
            myDayDefaultViewMode = settings.myDayDefaultViewMode ?? DEFAULT_SETTINGS.myDayDefaultViewMode;
            myDayDefaultDuration = settings.myDayDefaultDuration ?? DEFAULT_SETTINGS.myDayDefaultDuration;
            dueWeight = settings.priorityEngine.dueWeight;
            startWeight = settings.priorityEngine.startWeight;
            importanceWeight = settings.priorityEngine.importanceWeight;
            dueDecayTau = settings.priorityEngine.dueDecayTau;
            overdueGrowth = settings.priorityEngine.overdueGrowth;
            overdueCap = settings.priorityEngine.overdueCap;
            startHorizon = settings.priorityEngine.startHorizon;
            effortScale = settings.priorityEngine.effortScale;
            startPreviewDays = settings.priorityEngine.startPreviewDays ?? DEFAULT_PRIORITY_ENGINE.startPreviewDays;
            customFields = settings.customFields ? [...settings.customFields] : [];
            // Reminder settings
            const rs = settings.reminderSettings ?? DEFAULT_REMINDER_SETTINGS;
            reminderEnabled = rs.enabled ?? DEFAULT_REMINDER_SETTINGS.enabled;
            reminderDefaultOffsets = [...(rs.defaultOffsets ?? DEFAULT_REMINDER_SETTINGS.defaultOffsets)];
            reminderDueSound = rs.dueSound ?? DEFAULT_REMINDER_SETTINGS.dueSound;
            reminderReviewSound = rs.reviewSound ?? DEFAULT_REMINDER_SETTINGS.reviewSound;
            reminderSoundEnabled = rs.soundEnabled ?? DEFAULT_REMINDER_SETTINGS.soundEnabled;
        } catch (e: any) {
            console.error("[NextAction] loadSettings failed:", e);
            error = formatRpcError(e, i18n);
        }
    });

    function buildSettings(): PluginSettings {
        return {
            defaultImportance,
            defaultEffort,
            priorityEngine: {
                dueWeight,
                startWeight,
                importanceWeight,
                overdueBase: current.priorityEngine.overdueBase,
                dueDecayTau,
                noDueScore: current.priorityEngine.noDueScore,
                overdueGrowth,
                overdueCap,
                startHorizon,
                minStartScore: current.priorityEngine.minStartScore,
                effortScale,
                startPreviewDays,
                priorityOffsetCritical: current.priorityEngine.priorityOffsetCritical,
                priorityOffsetHigh: current.priorityEngine.priorityOffsetHigh,
                priorityOffsetMedium: current.priorityEngine.priorityOffsetMedium,
                priorityOffsetLow: current.priorityEngine.priorityOffsetLow,
                priorityOffsetNone: current.priorityEngine.priorityOffsetNone,
            },
            myDayEnabled,
            myDayResetHour,
            myDayDefaultViewMode,
            myDayDefaultDuration,
            customFields: [...customFields],
            reminderSettings: {
                enabled: reminderEnabled,
                defaultOffsets: [...reminderDefaultOffsets],
                dueSound: reminderDueSound,
                reviewSound: reminderReviewSound,
                soundEnabled: reminderSoundEnabled,
            },
        };
    }

    async function handleSave() {
        error = "";
        const settings = buildSettings();
        const validationError = validateSettings(settings);
        if (validationError) {
            error = formatValidationError(validationError, i18n);
            return;
        }
        saving = true;
        try {
            const result = await bridge.updateSettings(settings);
            if (result && result._rpcError) {
                error = formatRpcError(result._rpcError, i18n);
                return;
            }
            onSave(result);
        } catch (e: any) {
            console.error("[NextAction] saveSettings failed:", e);
            error = formatRpcError(e, i18n);
        } finally {
            saving = false;
        }
    }

    async function handleRebuildCache() {
        rebuilding = true;
        error = "";
        try {
            await bridge.rebuildCache();
            notifyInfo(i18n?.rebuildCacheSuccess || "Cache rebuilt successfully");
        } catch (e: any) {
            console.error("[NextAction] rebuildCache failed:", e);
            const msg = formatRpcError(e, i18n);
            error = msg;
            notifyError(i18n?.rebuildCacheFailed || "Failed to rebuild cache");
        } finally {
            rebuilding = false;
        }
    }

    async function handleRebuildParents() {
        rebuildingParents = true;
        error = "";
        try {
            const fixed = await bridge.rebuildParentRelationships();
            const msg = i18n?.rebuildParentsSuccess
                ? i18n.rebuildParentsSuccess.replace("{count}", String(fixed))
                : `Fixed ${fixed} parent relationship(s)`;
            notifyInfo(msg);
        } catch (e: any) {
            console.error("[NextAction] rebuildParents failed:", e);
            const msg = formatRpcError(e, i18n);
            error = msg;
            notifyError(i18n?.rebuildParentsFailed || "Failed to fix parent relationships");
        } finally {
            rebuildingParents = false;
        }
    }

    function handleResetPriority() {
        dueWeight = DEFAULT_PRIORITY_ENGINE.dueWeight;
        startWeight = DEFAULT_PRIORITY_ENGINE.startWeight;
        importanceWeight = DEFAULT_PRIORITY_ENGINE.importanceWeight;
        dueDecayTau = DEFAULT_PRIORITY_ENGINE.dueDecayTau;
        overdueGrowth = DEFAULT_PRIORITY_ENGINE.overdueGrowth;
        overdueCap = DEFAULT_PRIORITY_ENGINE.overdueCap;
        startHorizon = DEFAULT_PRIORITY_ENGINE.startHorizon;
        effortScale = DEFAULT_PRIORITY_ENGINE.effortScale;
        startPreviewDays = DEFAULT_PRIORITY_ENGINE.startPreviewDays;
    }

    function handleResetDefaults() {
        defaultImportance = DEFAULT_SETTINGS.defaultImportance;
        defaultEffort = DEFAULT_SETTINGS.defaultEffort;
    }

    function handleResetReminder() {
        reminderEnabled = DEFAULT_REMINDER_SETTINGS.enabled;
        reminderDefaultOffsets = [...DEFAULT_REMINDER_SETTINGS.defaultOffsets];
        reminderDueSound = DEFAULT_REMINDER_SETTINGS.dueSound;
        reminderReviewSound = DEFAULT_REMINDER_SETTINGS.reviewSound;
        reminderSoundEnabled = DEFAULT_REMINDER_SETTINGS.soundEnabled;
    }

    function offsetToMinutes(value: number, unit: "minutes" | "hours" | "days"): number {
        if (unit === "hours") return value * 60;
        if (unit === "days") return value * 1440;
        return value;
    }

    function minutesToDisplay(minutes: number): { value: number; unit: "minutes" | "hours" | "days" } {
        if (minutes % 1440 === 0 && minutes >= 1440) {
            return { value: minutes / 1440, unit: "days" };
        }
        if (minutes % 60 === 0 && minutes >= 60) {
            return { value: minutes / 60, unit: "hours" };
        }
        return { value: minutes, unit: "minutes" };
    }

    function handleAddOffset() {
        const mins = offsetToMinutes(newOffsetValue, newOffsetUnit);
        if (mins < 1 || mins > 20160) return;
        if (reminderDefaultOffsets.includes(mins)) return;
        reminderDefaultOffsets = [...reminderDefaultOffsets, mins].sort((a, b) => a - b);
    }

    function handleRemoveOffset(minutes: number) {
        reminderDefaultOffsets = reminderDefaultOffsets.filter(o => o !== minutes);
    }

    function handlePreviewSound(soundId: ReminderSoundId) {
        unlockAutoplay();
        playSound(soundId);
    }

    function getSoundLabel(soundId: ReminderSoundId): string {
        const key = "reminderSound" + soundId.charAt(0).toUpperCase() + soundId.slice(1);
        return i18n?.[key] || soundId;
    }

    function getUnitLabel(unit: "minutes" | "hours" | "days"): string {
        if (unit === "hours") return i18n?.reminderOffsetHours || "hours";
        if (unit === "days") return i18n?.reminderOffsetDays || "days";
        return i18n?.reminderOffsetMinutes || "minutes";
    }

    function handleResetMyDay() {
        myDayEnabled = DEFAULT_SETTINGS.myDayEnabled;
        myDayResetHour = DEFAULT_SETTINGS.myDayResetHour;
        myDayDefaultViewMode = DEFAULT_SETTINGS.myDayDefaultViewMode;
        myDayDefaultDuration = DEFAULT_SETTINGS.myDayDefaultDuration;
    }

    function handleResetCustomFields() {
        customFields = [];
    }

    function handleAddCustomField() {
        newFieldError = "";
        const key = newFieldKey.trim();
        const label = newFieldLabel.trim();
        if (!key) {
            newFieldError = i18n?.customFieldKeyRequired || "Key is required";
            return;
        }
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
            newFieldError = i18n?.customFieldKeyInvalid || "Key must start with a letter, only letters, digits, underscores";
            return;
        }
        if (!label) {
            newFieldError = i18n?.customFieldLabelRequired || "Label is required";
            return;
        }
        if (customFields.some(f => f.key === key)) {
            newFieldError = i18n?.customFieldKeyDuplicate || "Key already exists";
            return;
        }
        customFields = [...customFields, { key, label, type: "text" }];
        newFieldKey = "";
        newFieldLabel = "";
    }

    function handleRemoveCustomField(key: string) {
        customFields = customFields.filter(f => f.key !== key);
    }

    function handleMoveCustomFieldUp(index: number) {
        if (index <= 0) return;
        const arr = [...customFields];
        [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
        customFields = arr;
    }

    function handleMoveCustomFieldDown(index: number) {
        if (index >= customFields.length - 1) return;
        const arr = [...customFields];
        [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
        customFields = arr;
    }

    function handleUpdateCustomFieldLabel(index: number, newLabel: string) {
        const arr = [...customFields];
        arr[index] = { ...arr[index], label: newLabel };
        customFields = arr;
    }

    function handleReset() {
        if (activeTab === "priority") handleResetPriority();
        else if (activeTab === "myDay") handleResetMyDay();
        else if (activeTab === "customFields") handleResetCustomFields();
        else if (activeTab === "reminder") handleResetReminder();
        else handleResetDefaults();
    }
</script>

<div class="na-settings">
    <!-- Left nav -->
    <nav class="na-settings__nav">
        <div class="na-settings__nav-title">{i18n.settingsTitle || "Settings"}</div>
        {#each tabs as tab}
            <button
                class="na-settings__nav-item"
                class:active={activeTab === tab.id}
                on:click={() => activeTab = tab.id}
            >
                {#if tab.id === "defaults"}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="14" height="14" rx="2"/><polyline points="7 10 9 12 13 8"/>
                    </svg>
                {:else if tab.id === "myDay"}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="10" cy="10" r="4"/>
                        <line x1="10" y1="2" x2="10" y2="3.5"/>
                        <line x1="10" y1="16.5" x2="10" y2="18"/>
                        <line x1="2" y1="10" x2="3.5" y2="10"/>
                        <line x1="16.5" y1="10" x2="18" y2="10"/>
                    </svg>
                {:else if tab.id === "reminder"}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10 2a5 5 0 015 5c0 4 2 5 2 5H3s2-1 2-5a5 5 0 015-5"/>
                        <path d="M8 17a2 2 0 004 0"/>
                    </svg>
                {:else if tab.id === "customFields"}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="14" height="14" rx="2"/>
                        <line x1="7" y1="7" x2="13" y2="7"/>
                        <line x1="7" y1="10" x2="13" y2="10"/>
                        <line x1="7" y1="13" x2="10" y2="13"/>
                    </svg>
                {:else}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                        <path d="M4 14l4-8 3 5 2-3 3 6"/>
                    </svg>
                {/if}
                <span>{tab.label}</span>
            </button>
        {/each}
    </nav>

    <!-- Right content -->
    <div class="na-settings__content">
        <!-- Page header -->
        <div class="na-settings__header">
            <div class="na-settings__header-text">
                <span class="na-settings__header-title">{tabTitle}</span>
                <span class="na-settings__header-desc">{tabDesc}</span>
            </div>
        </div>

        <!-- Scrollable body -->
        <div class="na-settings__body">
            <!-- Tab: Defaults -->
            {#if activeTab === "defaults"}
                <div class="na-settings__page">
                    <div class="na-settings__field">
                        <label class="na-settings__field-label" for="setting-default-importance">
                            {i18n.settingDefaultImportance || "Default Importance"}
                            <span class="na-settings__field-hint">{i18n.settingDefaultImportanceDesc || "1-7"}</span>
                        </label>
                        <div class="na-settings__field-value">
                            <NaDotRating count={7} bind:value={defaultImportance} color="var(--na-color-importance)" id="setting-default-importance" />
                        </div>
                    </div>
                    <div class="na-settings__field">
                        <label class="na-settings__field-label" for="setting-default-effort">
                            {i18n.settingDefaultEffort || "Default Effort"}
                            <span class="na-settings__field-hint">{i18n.settingDefaultEffortDesc || "1-7"}</span>
                        </label>
                        <div class="na-settings__field-value">
                            <NaDotRating count={7} bind:value={defaultEffort} color="var(--na-color-effort)" id="setting-default-effort" />
                        </div>
                    </div>

                    <!-- Rebuild cache -->
                    <div class="na-settings__field na-settings__field--action">
                        <span class="na-settings__field-label">
                            {i18n.rebuildCache || "Rebuild Cache"}
                            <span class="na-settings__field-hint">{i18n.rebuildCacheDesc || "Reload all task data from database"}</span>
                        </span>
                        <div class="na-settings__field-value">
                            <button class="na-button na-button--sm" on:click={handleRebuildCache} disabled={rebuilding}>
                                {rebuilding ? (i18n.loading || "...") : (i18n.rebuildCache || "Rebuild Cache")}
                            </button>
                        </div>
                    </div>
                    <!-- Rebuild parent relationships -->
                    <div class="na-settings__field na-settings__field--action">
                        <span class="na-settings__field-label">
                            {i18n.rebuildParents || "Fix Parent Relationships"}
                            <span class="na-settings__field-hint">{i18n.rebuildParentsDesc || "Check and fix task hierarchy relationships"}</span>
                        </span>
                        <div class="na-settings__field-value">
                            <button class="na-button na-button--sm" on:click={handleRebuildParents} disabled={rebuildingParents}>
                                {rebuildingParents ? (i18n.loading || "...") : (i18n.rebuildParents || "Fix Parent Relationships")}
                            </button>
                        </div>
                    </div>
                </div>

            {:else if activeTab === "myDay"}
                <div class="na-settings__page">
                    <div class="na-settings__field">
                        <label class="na-settings__field-label" for="setting-myday-enabled">
                            {i18n.settingMyDayEnabled || "Enable My Day"}
                            <span class="na-settings__field-hint">{i18n.settingMyDayEnabledDesc || "Show the My Day view in the navigation rail"}</span>
                        </label>
                        <div class="na-settings__field-value">
                            <label class="na-settings__toggle">
                                <input type="checkbox" id="setting-myday-enabled" bind:checked={myDayEnabled} />
                                <span class="na-settings__toggle-track"></span>
                            </label>
                        </div>
                    </div>
                    <div class="na-settings__field" class:na-settings__field--disabled={!myDayEnabled}>
                        <label class="na-settings__field-label" for="setting-myday-reset-hour">
                            {i18n.settingMyDayResetHour || "Daily Reset Hour"}
                            <span class="na-settings__field-hint">{i18n.settingMyDayResetHourDesc || "0-23"}</span>
                        </label>
                        <div class="na-settings__field-value">
                            <input type="number" id="setting-myday-reset-hour" class="na-input na-settings__input--sm" min={0} max={23} step={1} bind:value={myDayResetHour} disabled={!myDayEnabled} />
                            <span class="na-settings__unit">:00</span>
                        </div>
                    </div>
                    <div class="na-settings__field" class:na-settings__field--disabled={!myDayEnabled}>
                        <span class="na-settings__field-label">
                            {i18n.settingMyDayDefaultViewMode || "Default View Mode"}
                            <span class="na-settings__field-hint">{i18n.settingMyDayDefaultViewModeDesc || ""}</span>
                        </span>
                        <div class="na-settings__field-value">
                            <label class="na-settings__radio">
                                <input type="radio" name="myDayViewMode" value="timeline" bind:group={myDayDefaultViewMode} disabled={!myDayEnabled} />
                                <span>{i18n.settingMyDayDefaultViewModeTimeline || "Timeline"}</span>
                            </label>
                            <label class="na-settings__radio">
                                <input type="radio" name="myDayViewMode" value="list" bind:group={myDayDefaultViewMode} disabled={!myDayEnabled} />
                                <span>{i18n.settingMyDayDefaultViewModeList || "List"}</span>
                            </label>
                        </div>
                    </div>
                    <div class="na-settings__field" class:na-settings__field--disabled={!myDayEnabled}>
                        <label class="na-settings__field-label" for="setting-myday-duration">
                            {i18n.settingMyDayDefaultDuration || "Default Schedule Duration"}
                            <span class="na-settings__field-hint">{i18n.settingMyDayDefaultDurationDesc || "min"}</span>
                        </label>
                        <div class="na-settings__field-value">
                            <input type="number" id="setting-myday-duration" class="na-input na-settings__input--sm" min={15} max={480} step={15} bind:value={myDayDefaultDuration} disabled={!myDayEnabled} />
                            <span class="na-settings__unit">{i18n.settingMinutes || "min"}</span>
                        </div>
                    </div>
                </div>

            {:else if activeTab === "reminder"}
                <div class="na-settings__page">
                    <!-- Enabled toggle -->
                    <div class="na-settings__field">
                        <label class="na-settings__field-label" for="setting-reminder-enabled">
                            {i18n.reminderSettingEnabled || "Enable Reminders"}
                            <span class="na-settings__field-hint">{i18n.reminderSettingEnabledDesc || "Show notifications before due dates and on review dates"}</span>
                        </label>
                        <div class="na-settings__field-value">
                            <label class="na-settings__toggle">
                                <input type="checkbox" id="setting-reminder-enabled" bind:checked={reminderEnabled} />
                                <span class="na-settings__toggle-track"></span>
                            </label>
                        </div>
                    </div>

                    <!-- Default offsets list -->
                    <div class="na-settings__field" class:na-settings__field--disabled={!reminderEnabled}>
                        <span class="na-settings__field-label">
                            {i18n.reminderSettingDefaultOffsets || "Default Advance Times"}
                            <span class="na-settings__field-hint">{i18n.reminderSettingDefaultOffsetsDesc || "List of advance times for due reminders"}</span>
                        </span>
                        <div class="na-settings__offset-list">
                            {#each reminderDefaultOffsets as offset (offset)}
                                {@const display = minutesToDisplay(offset)}
                                <div class="na-settings__offset-item">
                                    <span class="na-settings__offset-value">{display.value}</span>
                                    <span class="na-settings__offset-unit">{getUnitLabel(display.unit)}</span>
                                    <button class="na-settings__offset-remove" on:click={() => handleRemoveOffset(offset)} title={i18n?.reminderRemoveOffset || "Remove"} disabled={!reminderEnabled}>
                                        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
                                    </button>
                                </div>
                            {/each}
                            {#if reminderDefaultOffsets.length === 0}
                                <div class="na-settings__offset-empty">{i18n?.reminderNoPending || "No advance times configured"}</div>
                            {/if}
                        </div>
                        <!-- Add new offset -->
                        <div class="na-settings__offset-add">
                            <input type="number" class="na-input na-settings__input--sm" min={1} bind:value={newOffsetValue} disabled={!reminderEnabled} />
                            <select class="na-settings__offset-unit-select" bind:value={newOffsetUnit} disabled={!reminderEnabled}>
                                <option value="minutes">{i18n?.reminderOffsetMinutes || "minutes"}</option>
                                <option value="hours">{i18n?.reminderOffsetHours || "hours"}</option>
                                <option value="days">{i18n?.reminderOffsetDays || "days"}</option>
                            </select>
                            <button class="na-button na-button--sm" on:click={handleAddOffset} disabled={!reminderEnabled}>
                                {i18n?.reminderAddOffset || "Add"}
                            </button>
                        </div>
                    </div>

                    <!-- Due sound -->
                    <div class="na-settings__field" class:na-settings__field--disabled={!reminderEnabled}>
                        <label class="na-settings__field-label" for="setting-reminder-due-sound">
                            {i18n.reminderSettingDueSound || "Due Reminder Sound"}
                        </label>
                        <div class="na-settings__field-value">
                            <select id="setting-reminder-due-sound" class="na-settings__sound-select" bind:value={reminderDueSound} disabled={!reminderEnabled}>
                                {#each REMINDER_SOUND_IDS as sid}
                                    <option value={sid}>{getSoundLabel(sid)}</option>
                                {/each}
                            </select>
                            <button class="na-button na-button--sm" on:click={() => handlePreviewSound(reminderDueSound)} disabled={!reminderEnabled} title={i18n?.reminderSoundPreview || "Preview"}>
                                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3,5 7,2 7,14 3,11"/><path d="M10 5a3 3 0 010 6"/><path d="M12 3a6 6 0 010 10"/></svg>
                            </button>
                        </div>
                    </div>

                    <!-- Review sound -->
                    <div class="na-settings__field" class:na-settings__field--disabled={!reminderEnabled}>
                        <label class="na-settings__field-label" for="setting-reminder-review-sound">
                            {i18n.reminderSettingReviewSound || "Review Reminder Sound"}
                        </label>
                        <div class="na-settings__field-value">
                            <select id="setting-reminder-review-sound" class="na-settings__sound-select" bind:value={reminderReviewSound} disabled={!reminderEnabled}>
                                {#each REMINDER_SOUND_IDS as sid}
                                    <option value={sid}>{getSoundLabel(sid)}</option>
                                {/each}
                            </select>
                            <button class="na-button na-button--sm" on:click={() => handlePreviewSound(reminderReviewSound)} disabled={!reminderEnabled} title={i18n?.reminderSoundPreview || "Preview"}>
                                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3,5 7,2 7,14 3,11"/><path d="M10 5a3 3 0 010 6"/><path d="M12 3a6 6 0 010 10"/></svg>
                            </button>
                        </div>
                    </div>

                    <!-- Sound enabled -->
                    <div class="na-settings__field" class:na-settings__field--disabled={!reminderEnabled}>
                        <label class="na-settings__field-label" for="setting-reminder-sound-enabled">
                            {i18n.reminderSettingSoundEnabled || "Sound"}
                            <span class="na-settings__field-hint">{i18n.reminderSettingSoundEnabledDesc || "Play sound on reminder"}</span>
                        </label>
                        <div class="na-settings__field-value">
                            <label class="na-settings__toggle">
                                <input type="checkbox" id="setting-reminder-sound-enabled" bind:checked={reminderSoundEnabled} disabled={!reminderEnabled} />
                                <span class="na-settings__toggle-track"></span>
                            </label>
                        </div>
                    </div>
                </div>

            {:else if activeTab === "customFields"}
                <div class="na-settings__page">
                    <!-- Existing fields -->
                    {#if customFields.length > 0}
                        <div class="na-settings__custom-fields-list">
                            {#each customFields as field, i (field.key)}
                                <div class="na-settings__custom-field-item">
                                    <div class="na-settings__custom-field-info">
                                        <span class="na-settings__custom-field-key">{field.key}</span>
                                        <input
                                            type="text"
                                            class="na-input na-settings__custom-field-label-input"
                                            bind:value={customFields[i].label}
                                            placeholder={i18n?.customFieldLabelPlaceholder || "Field label"}
                                            on:change={() => { customFields = [...customFields]; }}
                                        />
                                        <span class="na-settings__custom-field-type">{field.type}</span>
                                    </div>
                                    <div class="na-settings__custom-field-actions">
                                        <button class="na-settings__custom-field-btn" on:click={() => handleMoveCustomFieldUp(i)} disabled={i === 0} title={i18n?.moveUp || "Move Up"}>
                                            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 10 8 6 12 10"/></svg>
                                        </button>
                                        <button class="na-settings__custom-field-btn" on:click={() => handleMoveCustomFieldDown(i)} disabled={i === customFields.length - 1} title={i18n?.moveDown || "Move Down"}>
                                            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg>
                                        </button>
                                        <button class="na-settings__custom-field-btn na-settings__custom-field-btn--danger" on:click={() => handleRemoveCustomField(field.key)} title={i18n?.removeCustomField || "Remove"}>
                                            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
                                        </button>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {:else}
                        <div class="na-settings__empty-state">
                            <svg viewBox="0 0 48 48" width="32" height="32" fill="none" stroke="var(--b3-theme-on-surface-light)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5">
                                <rect x="8" y="6" width="32" height="36" rx="4"/>
                                <line x1="16" y1="16" x2="32" y2="16"/>
                                <line x1="16" y1="22" x2="28" y2="22"/>
                                <line x1="16" y1="28" x2="24" y2="28"/>
                                <circle cx="34" cy="34" r="8" fill="var(--b3-theme-surface-lighter)" stroke="var(--b3-theme-primary)" stroke-width="1.5"/>
                                <line x1="34" y1="30" x2="34" y2="38"/>
                                <line x1="30" y1="34" x2="38" y2="34"/>
                            </svg>
                            <span class="na-settings__empty-text">{i18n?.customFieldEmpty || "No custom fields yet"}</span>
                            <span class="na-settings__empty-hint">{i18n?.customFieldEmptyHint || "Add fields to extend task attributes, e.g. delegated to, reference link, etc."}</span>
                        </div>
                    {/if}

                    <!-- Add new field -->
                    <div class="na-settings__add-field-card">
                        <div class="na-settings__add-field-header">
                            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="var(--b3-theme-primary)" stroke-width="1.5" stroke-linecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
                            <span class="na-settings__add-field-title">{i18n?.addCustomField || "Add Custom Field"}</span>
                        </div>
                        <div class="na-settings__add-field-form">
                            <label class="na-settings__add-field-label na-settings__add-field-key-label" for="setting-new-field-key">Key</label>
                            <input
                                type="text"
                                id="setting-new-field-key"
                                class="na-input na-settings__custom-field-key-input na-settings__add-field-key-input"
                                value={newFieldKey}
                                placeholder={i18n?.customFieldKeyPlaceholder || "e.g. delegatedTo"}
                                on:input={(e) => {
                                    const raw = e.currentTarget.value;
                                    newFieldKey = raw.replace(/[^a-zA-Z0-9_]/g, '').replace(/^[^a-zA-Z]/, '');
                                }}
                                on:keydown={(e) => { if (e.key === 'Enter') handleAddCustomField(); }}
                            />
                            <label class="na-settings__add-field-label na-settings__add-field-name-label" for="setting-new-field-label">{i18n?.customFieldLabelPlaceholder || "Label"}</label>
                            <input
                                type="text"
                                id="setting-new-field-label"
                                class="na-input na-settings__add-field-name-input"
                                bind:value={newFieldLabel}
                                placeholder={i18n?.customFieldLabelPlaceholder || "e.g. Delegated to"}
                                on:keydown={(e) => { if (e.key === 'Enter') handleAddCustomField(); }}
                            />
                            <div class="na-settings__add-field-btn-cell">
                                <button class="na-button na-button--primary na-button--sm" on:click={handleAddCustomField}>
                                    {i18n?.addCustomFieldBtn || "Add"}
                                </button>
                            </div>
                        </div>
                        <div class="na-settings__add-field-hint">{i18n?.addCustomFieldDesc || "Key cannot be changed after creation"}</div>
                        {#if newFieldError}
                            <div class="na-settings__field-error">{newFieldError}</div>
                        {/if}
                    </div>
                </div>

            {:else if activeTab === "priority"}
                <div class="na-settings__page">
                    <!-- Weight distribution card -->
                    <div class="na-settings__card">
                        <div class="na-settings__card-header">
                            <span class="na-settings__card-title">{i18n.settingWeightDistribution || "Weight Distribution"}</span>
                            <span class="na-settings__card-desc">{i18n.settingWeightDistributionDesc || "Share of each factor in priority; must sum to 1.0"}</span>
                        </div>
                        <div class="na-settings__weight-rows">
                            <div class="na-settings__weight-row">
                                <span class="na-settings__weight-label">{i18n.settingDueWeight || "Due date"}</span>
                                <div class="na-settings__weight-track na-settings__weight-track--due">
                                    <div class="na-settings__weight-fill" style="width:{dueWeight * 100}%"></div>
                                </div>
                                <input type="number" class="na-input na-settings__input--weight" min={0} max={1} step={0.05} bind:value={dueWeight} />
                            </div>
                            <div class="na-settings__weight-row">
                                <span class="na-settings__weight-label">{i18n.settingStartWeight || "Start date"}</span>
                                <div class="na-settings__weight-track na-settings__weight-track--start">
                                    <div class="na-settings__weight-fill" style="width:{startWeight * 100}%"></div>
                                </div>
                                <input type="number" class="na-input na-settings__input--weight" min={0} max={1} step={0.05} bind:value={startWeight} />
                            </div>
                            <div class="na-settings__weight-row">
                                <span class="na-settings__weight-label">{i18n.settingImportanceWeight || "Importance"}</span>
                                <div class="na-settings__weight-track na-settings__weight-track--importance">
                                    <div class="na-settings__weight-fill" style="width:{importanceWeight * 100}%"></div>
                                </div>
                                <input type="number" class="na-input na-settings__input--weight" min={0} max={1} step={0.05} bind:value={importanceWeight} />
                            </div>
                            <div class="na-settings__weight-sum" class:na-settings__weight-sum--error={weightSum !== 1}>
                                <span class="na-settings__weight-sum-label">{i18n.settingWeightSum || "Sum"}</span>
                                <span class="na-settings__weight-sum-value">
                                    {weightSum.toFixed(2)}
                                    {#if weightSum === 1}
                                        <svg viewBox="0 0 16 16" width="12" height="12"><polyline points="3,8 7,12 13,4" fill="none" stroke="var(--na-color-done)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                    {:else}
                                        <svg viewBox="0 0 16 16" width="12" height="12"><line x1="4" y1="4" x2="12" y2="12" fill="none" stroke="var(--na-color-error)" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="4" x2="4" y2="12" fill="none" stroke="var(--na-color-error)" stroke-width="2" stroke-linecap="round"/></svg>
                                    {/if}
                                </span>
                            </div>
                        </div>
                    </div>

                    <!-- Parameters card -->
                    <div class="na-settings__card">
                        <div class="na-settings__card-header">
                            <span class="na-settings__card-title">{i18n.settingPriorityParams || "Parameters"}</span>
                        </div>
                        <div class="na-settings__params">
                            <div class="na-settings__field">
                                <label class="na-settings__field-label" for="setting-due-decay-tau">
                                    {i18n.settingDueDecayTau || "Urgency Decay"}
                                    <span class="na-settings__field-hint">{i18n.settingDueDecayTauDesc || "days"}</span>
                                </label>
                                <div class="na-settings__field-value">
                                    <input type="number" id="setting-due-decay-tau" class="na-input na-settings__input--sm" min={1} max={30} step={1} bind:value={dueDecayTau} />
                                    <span class="na-settings__unit">{i18n.settingDays || "days"}</span>
                                </div>
                            </div>
                            <div class="na-settings__field">
                                <label class="na-settings__field-label" for="setting-overdue-growth">
                                    {i18n.settingOverdueGrowth || "Overdue Growth"}
                                    <span class="na-settings__field-hint">{i18n.settingOverdueGrowthDesc || ""}</span>
                                </label>
                                <div class="na-settings__field-value">
                                    <input type="number" id="setting-overdue-growth" class="na-input na-settings__input--sm" min={0} max={5} step={0.1} bind:value={overdueGrowth} />
                                    <span class="na-settings__unit">/{i18n.settingDays || "days"}</span>
                                </div>
                            </div>
                            <div class="na-settings__field">
                                <label class="na-settings__field-label" for="setting-overdue-cap">
                                    {i18n.settingOverdueCap || "Overdue Cap"}
                                    <span class="na-settings__field-hint">{i18n.settingOverdueCapDesc || ""}</span>
                                </label>
                                <div class="na-settings__field-value">
                                    <input type="number" id="setting-overdue-cap" class="na-input na-settings__input--sm" min={0} max={100} step={1} bind:value={overdueCap} />
                                </div>
                            </div>
                            <div class="na-settings__field">
                                <label class="na-settings__field-label" for="setting-start-horizon">
                                    {i18n.settingStartHorizon || "Start Date Horizon"}
                                    <span class="na-settings__field-hint">{i18n.settingStartHorizonDesc || ""}</span>
                                </label>
                                <div class="na-settings__field-value">
                                    <input type="number" id="setting-start-horizon" class="na-input na-settings__input--sm" min={1} max={60} step={1} bind:value={startHorizon} />
                                    <span class="na-settings__unit">{i18n.settingDays || "days"}</span>
                                </div>
                            </div>
                            <div class="na-settings__field">
                                <label class="na-settings__field-label" for="setting-start-preview-days">
                                    {i18n.settingStartPreviewDays || "Start Preview Days"}
                                    <span class="na-settings__field-hint">{i18n.settingStartPreviewDaysDesc || "0-14"}</span>
                                </label>
                                <div class="na-settings__field-value">
                                    <input type="number" id="setting-start-preview-days" class="na-input na-settings__input--sm" min={0} max={14} step={1} bind:value={startPreviewDays} />
                                    <span class="na-settings__unit">{i18n.settingDays || "days"}</span>
                                </div>
                            </div>
                            <div class="na-settings__field">
                                <label class="na-settings__field-label" for="setting-effort-scale">
                                    {i18n.settingEffortScale || "Effort Penalty"}
                                    <span class="na-settings__field-hint">{i18n.settingEffortScaleDesc || ""}</span>
                                </label>
                                <div class="na-settings__field-value">
                                    <input type="number" id="setting-effort-scale" class="na-input na-settings__input--sm" min={0} max={0.5} step={0.01} bind:value={effortScale} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            {/if}
        </div>

        <!-- Error -->
        {#if error}
            <div class="na-settings__error">{error}</div>
        {/if}

        <!-- Footer -->
        <div class="na-settings__footer">
            <button class="na-settings__reset-btn" on:click={handleReset}>
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2 8a6 6 0 0110-4.5"/><path d="M14 8a6 6 0 01-10 4.5"/><polyline points="11 1 11 4 8 4"/><polyline points="5 15 5 12 8 12"/>
                </svg>
                {i18n.settingReset || "Reset to Defaults"}
            </button>
            <div style="flex:1"></div>
            <button class="na-button na-button--sm" on:click={onClose}>{i18n.cancel || "Cancel"}</button>
            <button class="na-button na-button--primary na-button--sm" on:click={handleSave} disabled={saving}>
                {saving ? (i18n.loading || "...") : (i18n.confirm || "OK")}
            </button>
        </div>
    </div>
</div>

<style lang="scss">
    :global(.b3-dialog__content:has(.na-settings)) {
        padding: 0 !important;
    }

    .na-settings {
        display: flex;
        height: 480px;
        background: var(--b3-theme-background);
        border-radius: var(--na-radius-lg);
        overflow: hidden;
    }

    // ===== Left nav =====
    .na-settings__nav {
        flex: 0 0 140px;
        background: var(--b3-theme-surface);
        border-right: 1px solid var(--na-color-divider);
        display: flex;
        flex-direction: column;
        padding: 0;
    }

    .na-settings__nav-title {
        font-size: var(--na-font-size-lg);
        font-weight: 600;
        color: var(--b3-theme-on-surface);
        padding: 20px 16px 12px;
        letter-spacing: -0.01em;
    }

    .na-settings__nav-item {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        cursor: pointer;
        border: none;
        background: none;
        color: var(--b3-theme-on-surface-secondary);
        position: relative;
        transition: color 0.15s, background 0.15s;
        width: 100%;
        font-size: var(--na-font-size-md);
        text-align: left;

        svg {
            flex-shrink: 0;
        }

        &:hover {
            color: var(--b3-theme-primary);
            background: var(--na-color-hover-bg);
        }

        &.active {
            color: var(--b3-theme-primary);
            font-weight: 500;
            background: var(--na-color-selected-bg);

            &::before {
                content: "";
                position: absolute;
                left: 0;
                top: 6px;
                bottom: 6px;
                width: 3px;
                background: var(--b3-theme-primary);
                border-radius: 0 2px 2px 0;
            }
        }
    }

    // ===== Right content =====
    .na-settings__content {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    // ===== Page header =====
    .na-settings__header {
        padding: 20px 24px 0;
        flex-shrink: 0;
    }

    .na-settings__header-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding-bottom: 14px;
        border-bottom: 1px solid var(--na-color-divider);
    }

    .na-settings__header-title {
        font-size: 15px;
        font-weight: 600;
        color: var(--b3-theme-on-surface);
        letter-spacing: -0.01em;
    }

    .na-settings__header-desc {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-light);
    }

    // ===== Scrollable body =====
    .na-settings__body {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 20px 24px;
    }

    .na-settings__page {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    // ===== Field layout (label over value) =====
    .na-settings__field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px 0;
        border-bottom: 1px solid var(--na-color-divider);

        &:last-child {
            border-bottom: none;
        }

        &--action {
            margin-top: 8px;
            padding-top: 16px;
        }
    }

    .na-settings__field-label {
        font-size: var(--na-font-size-md);
        font-weight: 500;
        color: var(--b3-theme-on-surface);
        display: flex;
        align-items: baseline;
        gap: 6px;
    }

    .na-settings__field-hint {
        font-size: var(--na-font-size-xs);
        font-weight: 400;
        color: var(--b3-theme-on-surface-light);
    }

    .na-settings__field-value {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 30px;
    }

    // ===== Unit suffix =====
    .na-settings__unit {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-light);
        flex-shrink: 0;
    }

    // ===== Input sizes =====
    :global(.na-settings__input--sm) {
        width: 80px !important;
    }

    :global(.na-settings__input--weight) {
        width: 64px !important;
    }

    // ===== Card containers (priority page) =====
    .na-settings__card {
        background: var(--b3-theme-surface);
        border-radius: var(--na-radius-lg);
        border: 1px solid var(--na-color-divider);
        padding: 16px;
        margin-bottom: 14px;

        &:last-child {
            margin-bottom: 0;
        }
    }

    .na-settings__card-header {
        margin-bottom: 12px;
    }

    .na-settings__card-title {
        font-size: var(--na-font-size-md);
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }

    .na-settings__card-desc {
        display: block;
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface-light);
        margin-top: 2px;
    }

    // ===== Weight distribution rows =====
    .na-settings__weight-rows {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .na-settings__weight-row {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .na-settings__weight-label {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-secondary);
        width: 56px;
        flex-shrink: 0;
    }

    .na-settings__weight-track {
        flex: 1;
        height: 6px;
        background: var(--b3-theme-surface-lighter);
        border-radius: 3px;
        overflow: hidden;
    }

    .na-settings__weight-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .na-settings__weight-track--due .na-settings__weight-fill {
        background: var(--na-priority-critical);
    }

    .na-settings__weight-track--start .na-settings__weight-fill {
        background: var(--na-priority-medium);
    }

    .na-settings__weight-track--importance .na-settings__weight-fill {
        background: var(--na-color-importance);
    }

    // ===== Weight sum =====
    .na-settings__weight-sum {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: 8px;
        border-top: 1px solid var(--na-color-divider);
        margin-top: 4px;
    }

    .na-settings__weight-sum-label {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-secondary);
    }

    .na-settings__weight-sum-value {
        font-size: var(--na-font-size-md);
        font-variant-numeric: tabular-nums;
        color: var(--na-color-done);
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-weight: 500;
    }

    .na-settings__weight-sum--error .na-settings__weight-sum-value {
        color: var(--na-color-error);
    }

    // ===== Params inside card =====
    .na-settings__params {
        display: flex;
        flex-direction: column;
        gap: 0;
    }

    .na-settings__params .na-settings__field {
        padding: 10px 0;
    }

    // ===== Error =====
    .na-settings__error {
        font-size: var(--na-font-size-md);
        color: var(--na-color-error);
        padding: 8px 24px;
        background: rgba(229, 57, 53, 0.04);
        border-top: 1px solid rgba(229, 57, 53, 0.15);
        flex-shrink: 0;
    }

    // ===== Footer =====
    .na-settings__footer {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 24px;
        border-top: 1px solid var(--na-color-divider);
        background: var(--b3-theme-surface);
        flex-shrink: 0;
    }

    .na-settings__reset-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-light);
        background: none;
        border: none;
        cursor: pointer;
        border-radius: var(--na-radius-sm);
        transition: color 0.15s, background 0.15s;

        &:hover {
            color: var(--b3-theme-primary);
            background: var(--na-color-hover-bg);
        }

        &:active {
            transform: scale(0.96);
        }
    }

    // ===== Toggle switch =====
    .na-settings__toggle {
        position: relative;
        display: inline-block;
        cursor: pointer;

        input {
            position: absolute;
            opacity: 0;
            width: 0;
            height: 0;
        }
    }

    .na-settings__toggle-track {
        display: block;
        width: 36px;
        height: 20px;
        border-radius: 10px;
        background: var(--b3-theme-surface-lighter);
        border: 1px solid var(--na-color-divider);
        position: relative;
        transition: background 0.2s, border-color 0.2s;

        &::after {
            content: "";
            position: absolute;
            top: 2px;
            left: 2px;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: var(--b3-theme-on-surface-light);
            transition: transform 0.2s, background 0.2s;
        }

        .na-settings__toggle input:checked + & {
            background: var(--b3-theme-primary);
            border-color: var(--b3-theme-primary);

            &::after {
                transform: translateX(16px);
                background: var(--b3-theme-on-primary);
            }
        }
    }

    // ===== Radio =====
    .na-settings__radio {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface);

        input[type="radio"] {
            margin: 0;
            accent-color: var(--b3-theme-primary);
        }
    }

    // ===== Disabled field =====
    .na-settings__field--disabled {
        opacity: 0.45;
        pointer-events: none;
    }

    // ===== Custom fields =====
    .na-settings__custom-fields-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 16px;
    }

    .na-settings__custom-field-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        transition: border-color 0.15s;

        &:hover {
            border-color: var(--b3-theme-primary-light, var(--na-color-divider));
        }
    }

    .na-settings__custom-field-info {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }

    .na-settings__custom-field-key {
        font-size: var(--na-font-size-xs);
        font-family: var(--na-font-mono, monospace);
        color: var(--b3-theme-primary);
        flex-shrink: 0;
        padding: 2px 8px;
        background: var(--na-color-selected-bg);
        border-radius: var(--na-radius-pill);
        letter-spacing: 0.02em;
    }

    .na-settings__custom-field-type {
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface-light);
        padding: 1px 6px;
        background: var(--b3-theme-surface-lighter);
        border-radius: var(--na-radius-sm);
        flex-shrink: 0;
    }

    .na-settings__custom-field-actions {
        display: flex;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
    }

    .na-settings__custom-field-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border: none;
        background: none;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        border-radius: var(--na-radius-sm);
        transition: color 0.15s, background 0.15s;

        &:hover:not(:disabled) {
            color: var(--b3-theme-primary);
            background: var(--na-color-hover-bg);
        }

        &:disabled {
            opacity: 0.25;
            cursor: default;
        }

        &--danger:hover:not(:disabled) {
            color: var(--na-color-error);
            background: rgba(229, 57, 53, 0.06);
        }
    }

    // ===== Empty state =====
    .na-settings__empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 28px 16px;
        margin-bottom: 16px;
        background: var(--b3-theme-surface);
        border: 1px dashed var(--na-color-divider);
        border-radius: var(--na-radius-lg);
    }

    .na-settings__empty-text {
        font-size: var(--na-font-size-md);
        font-weight: 500;
        color: var(--b3-theme-on-surface-secondary);
    }

    .na-settings__empty-hint {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-light);
        text-align: center;
        max-width: 240px;
    }

    // ===== Add field card =====
    .na-settings__add-field-card {
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-lg);
        padding: 14px 16px;
    }

    .na-settings__add-field-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 10px;
    }

    .na-settings__add-field-title {
        font-size: var(--na-font-size-md);
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }

    .na-settings__add-field-form {
        display: grid;
        grid-template-columns: 120px 1fr auto;
        grid-template-rows: auto auto;
        gap: 3px 8px;
        align-items: center;
    }

    .na-settings__add-field-key-label   { grid-column: 1; grid-row: 1; }
    .na-settings__add-field-key-input   { grid-column: 1; grid-row: 2; }
    .na-settings__add-field-name-label  { grid-column: 2; grid-row: 1; }
    .na-settings__add-field-name-input  { grid-column: 2; grid-row: 2; }
    .na-settings__add-field-btn-cell    { grid-column: 3; grid-row: 1 / 3; align-self: center; }

    .na-settings__add-field-label {
        font-size: var(--na-font-size-xs);
        font-weight: 500;
        color: var(--b3-theme-on-surface-secondary);
    }

    .na-settings__add-field-btn-cell {
        display: flex;
        align-items: center;
    }

    .na-settings__add-field-hint {
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface-light);
        margin-top: 8px;
    }

    :global(.na-settings__custom-field-key-input) {
        font-family: var(--na-font-mono, monospace);
    }

    .na-settings__field-error {
        font-size: var(--na-font-size-xs);
        color: var(--na-color-error);
        margin-top: 6px;
        padding: 4px 8px;
        background: rgba(229, 57, 53, 0.06);
        border-radius: var(--na-radius-sm);
    }

    // ===== Reminder offsets =====
    .na-settings__offset-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
        min-height: 28px;
    }

    .na-settings__offset-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-pill);
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-secondary);
    }

    .na-settings__offset-value {
        font-variant-numeric: tabular-nums;
        font-weight: 500;
        color: var(--b3-theme-on-surface);
    }

    .na-settings__offset-unit {
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface-light);
    }

    .na-settings__offset-remove {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border: none;
        background: none;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        border-radius: 50%;
        transition: color 0.15s, background 0.15s;
        padding: 0;

        &:hover:not(:disabled) {
            color: var(--na-color-error);
            background: rgba(229, 57, 53, 0.06);
        }

        &:disabled {
            opacity: 0.25;
            cursor: default;
        }
    }

    .na-settings__offset-empty {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-light);
        padding: 8px 0;
    }

    .na-settings__offset-add {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
    }

    .na-settings__offset-unit-select {
        height: 28px;
        padding: 0 6px;
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-sm);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        font-size: var(--na-font-size-sm);
        cursor: pointer;
        outline: none;

        &:disabled {
            opacity: 0.45;
            cursor: default;
        }
    }

    // ===== Sound selector =====
    .na-settings__sound-select {
        height: 28px;
        min-width: 100px;
        padding: 0 8px;
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-sm);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        font-size: var(--na-font-size-sm);
        cursor: pointer;
        outline: none;

        &:disabled {
            opacity: 0.45;
            cursor: default;
        }
    }
</style>
