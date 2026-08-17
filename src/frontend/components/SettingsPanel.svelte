<script lang="ts">
    import { onMount, tick } from "svelte";
    import { confirm } from "siyuan";
    import type { PluginSettings, MyDayViewMode, CustomFieldDef } from "../../shared/settings";
    import type { CreateTaskDefaultTarget } from "../../shared/task-creation";
    import type { AiFeatureId } from "../../shared/ai";
    import type { I18nStrings } from "../../shared/i18n";
    import type { RpcMcpStatus } from "../../shared/rpc-methods";
    import {
        DEFAULT_SETTINGS,
        DEFAULT_PRIORITY_ENGINE,
        DEFAULT_REMINDER_SETTINGS,
        DEFAULT_MCP_SETTINGS,
        DEFAULT_AI_SETTINGS,
    } from "../../shared/settings";
    import { REMINDER_SOUND_IDS, type ReminderSoundId } from "../../shared/constants";
    import { formatOperationError, formatValidationError, notifyInfo, notifyError } from "../notify";
    import type { KernelBridge } from "../kernel-bridge";
    import {
        SettingsPanelController,
        type SettingsAction,
        type SettingsPage,
    } from "../controllers/settings-panel-controller";
    import { playSound, unlockAutoplay } from "../utils/audio-player";
    import { getAiPromptRuntimePreview } from "../ai/ai-feature-service";
    import { reminderSoundI18nKey, translateKey } from "../i18n";
    import NaIcon from "../ui/NaIcon.svelte";
    import NaPanelHeader from "../ui/NaPanelHeader.svelte";
    import GeneralSettingsPage from "./settings/GeneralSettingsPage.svelte";
    import CustomFieldsSettingsPage from "./settings/CustomFieldsSettingsPage.svelte";
    import AiSettingsPage from "./settings/AiSettingsPage.svelte";
    import McpSettingsPage from "./settings/McpSettingsPage.svelte";
    import AdvancedSettingsPage from "./settings/AdvancedSettingsPage.svelte";

    export let bridge: KernelBridge;
    export let i18n: I18nStrings;
    export let onSave: (settings: PluginSettings) => void | Promise<void>;
    export let onClose: () => void;

    type ModernTabId = SettingsPage;
    type DocumentSelection = {
        id: string;
        title: string;
        notebookId: string;
        notebookName: string;
        path: string;
        icon: string;
    };

    let current: PluginSettings = { ...DEFAULT_SETTINGS };
    let saving = false;
    let rebuilding = false;
    let error = "";
    let modernTab: ModernTabId = "general";
    let settingsRootEl: HTMLDivElement;
    let settingsBodyEl: HTMLDivElement;
    let settingsLoaded = false;
    let isDirty = false;

    $: modernTabs = [
        {
            id: "general" as const,
            label: i18n?.settingGeneral || "General",
            desc: i18n?.settingGeneralDesc || "Task creation, defaults, My Day and reminders",
            icon: "iconSettings",
            group: i18n?.settingNavGroupTask || "Workspace",
        },
        {
            id: "customFields" as const,
            label: i18n?.settingCustomFields || "Custom fields",
            desc: i18n?.settingCustomFieldsDesc || "Extend task attributes",
            icon: "iconDatabase",
            group: i18n?.settingNavGroupTask || "Workspace",
        },
        {
            id: "ai" as const,
            label: i18n?.settingAi || "AI features",
            desc: i18n?.settingAiDesc || "Customize prompts used by AI features",
            icon: "iconSparkles",
            group: i18n?.settingNavGroupIntegration || "Integrations",
        },
        {
            id: "mcp" as const,
            label: i18n?.settingMcp || "MCP",
            desc: i18n?.settingMcpDesc || "Expose task tools to AI clients",
            icon: "iconCloud",
            group: i18n?.settingNavGroupIntegration || "Integrations",
        },
        {
            id: "advanced" as const,
            label: i18n?.settingAdvanced || "Advanced",
            desc: i18n?.settingAdvancedDesc || "Priority engine and maintenance",
            icon: "iconSort",
            group: i18n?.settingNavGroupSystem || "System",
        },
    ];

    let defaultImportance = DEFAULT_SETTINGS.defaultImportance;
    let defaultEffort = DEFAULT_SETTINGS.defaultEffort;
    let semanticDateParsingEnabled = DEFAULT_SETTINGS.semanticDateParsingEnabled;
    let myDayResetHour = DEFAULT_SETTINGS.myDayResetHour;
    let myDayDefaultViewMode: MyDayViewMode = DEFAULT_SETTINGS.myDayDefaultViewMode;
    let myDayDefaultDuration = DEFAULT_SETTINGS.myDayDefaultDuration;

    let dueWeight = DEFAULT_PRIORITY_ENGINE.dueWeight;
    let startWeight = DEFAULT_PRIORITY_ENGINE.startWeight;
    let importanceWeight = DEFAULT_PRIORITY_ENGINE.importanceWeight;
    let dueDecayTau = DEFAULT_PRIORITY_ENGINE.dueDecayTau;
    let overdueGrowth = DEFAULT_PRIORITY_ENGINE.overdueGrowth;
    let overdueCap = DEFAULT_PRIORITY_ENGINE.overdueCap;
    let startHorizon = DEFAULT_PRIORITY_ENGINE.startHorizon;
    let effortScale = DEFAULT_PRIORITY_ENGINE.effortScale;
    let startPreviewDays = DEFAULT_PRIORITY_ENGINE.startPreviewDays;

    let reminderEnabled = DEFAULT_REMINDER_SETTINGS.enabled;
    let reminderDefaultOffsets = [...DEFAULT_REMINDER_SETTINGS.defaultOffsets];
    let reminderDueSound: ReminderSoundId = DEFAULT_REMINDER_SETTINGS.dueSound;
    let reminderReviewSound: ReminderSoundId = DEFAULT_REMINDER_SETTINGS.reviewSound;
    let reminderSoundEnabled = DEFAULT_REMINDER_SETTINGS.soundEnabled;
    let newOffsetValue = 60;
    let newOffsetUnit: "minutes" | "hours" | "days" = "minutes";

    let mcpEnabled = DEFAULT_MCP_SETTINGS.enabled;
    let mcpAllowWrite = DEFAULT_MCP_SETTINGS.allowWrite;
    let taskCreationDefaultCreateTarget: CreateTaskDefaultTarget =
        DEFAULT_SETTINGS.taskCreationSettings.defaultCreateTarget;
    let taskCreationInboxDocumentId = DEFAULT_SETTINGS.taskCreationSettings.inboxDocumentId;
    let taskCreationInboxDocument: DocumentSelection | null = null;
    let taskCreationDailyNoteNotebookId = DEFAULT_SETTINGS.taskCreationSettings.dailyNoteNotebookId;
    let mcpStatus: RpcMcpStatus | null = null;
    let mcpNotebooks: Array<{ id: string; name: string; icon: string }> = [];
    let mcpCopied = false;
    // SiYuan's desktop kernel listens on a random internal port and proxies
    // the first workspace through the stable external service port 6806.
    const mcpEndpoint = "http://127.0.0.1:6806/mcp";

    let aiPrompts: Record<AiFeatureId, string> = { ...DEFAULT_AI_SETTINGS.prompts };
    let customFields: CustomFieldDef[] = [];
    let customFieldUsage: Record<string, number> = {};
    let purgingFieldId = "";

    const controller = new SettingsPanelController({
        formatError: (error) => formatOperationError(error, i18n),
        formatValidationError: (validationError) => formatValidationError(validationError, i18n),
    });

    function syncControllerState() {
        const state = controller.snapshot;
        current = state.saved;
        saving = state.saveState === "saving";
        rebuilding = state.maintenanceBusy.has("cache");
        purgingFieldId = [...state.maintenanceBusy].find((id) => id.startsWith("purge:"))?.slice("purge:".length) || "";
        error = state.error;
        modernTab = state.page;
        settingsLoaded = state.loadState === "loaded";
        isDirty = state.dirty;
    }

    $: weightSum = Math.round((dueWeight + startWeight + importanceWeight) * 100) / 100;
    $: draftRevision = [
        defaultImportance,
        defaultEffort,
        semanticDateParsingEnabled,
        dueWeight,
        startWeight,
        importanceWeight,
        dueDecayTau,
        overdueGrowth,
        overdueCap,
        startHorizon,
        effortScale,
        startPreviewDays,
        myDayResetHour,
        myDayDefaultViewMode,
        myDayDefaultDuration,
        reminderEnabled,
        reminderDefaultOffsets,
        reminderDueSound,
        reminderReviewSound,
        reminderSoundEnabled,
        mcpEnabled,
        mcpAllowWrite,
        taskCreationDefaultCreateTarget,
        taskCreationInboxDocumentId,
        taskCreationDailyNoteNotebookId,
        aiPrompts,
        customFields,
    ];
    $: if (settingsLoaded && draftRevision) {
        controller.edit(buildSettings());
        syncControllerState();
    }

    function applySettings(settings: PluginSettings) {
        defaultImportance = settings.defaultImportance;
        defaultEffort = settings.defaultEffort;
        semanticDateParsingEnabled = settings.semanticDateParsingEnabled ?? DEFAULT_SETTINGS.semanticDateParsingEnabled;
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
        customFields = [...settings.customFields];
        const reminder = settings.reminderSettings ?? DEFAULT_REMINDER_SETTINGS;
        reminderEnabled = reminder.enabled ?? DEFAULT_REMINDER_SETTINGS.enabled;
        reminderDefaultOffsets = [...(reminder.defaultOffsets ?? DEFAULT_REMINDER_SETTINGS.defaultOffsets)];
        reminderDueSound = reminder.dueSound ?? DEFAULT_REMINDER_SETTINGS.dueSound;
        reminderReviewSound = reminder.reviewSound ?? DEFAULT_REMINDER_SETTINGS.reviewSound;
        reminderSoundEnabled = reminder.soundEnabled ?? DEFAULT_REMINDER_SETTINGS.soundEnabled;
        const mcp = settings.mcpSettings ?? DEFAULT_MCP_SETTINGS;
        mcpEnabled = mcp.enabled;
        mcpAllowWrite = mcp.allowWrite;
        const creation = settings.taskCreationSettings ?? DEFAULT_SETTINGS.taskCreationSettings;
        taskCreationDefaultCreateTarget = creation.defaultCreateTarget;
        taskCreationInboxDocumentId = creation.inboxDocumentId;
        taskCreationDailyNoteNotebookId = creation.dailyNoteNotebookId;
        aiPrompts = { ...DEFAULT_AI_SETTINGS.prompts, ...(settings.aiSettings?.prompts || {}) };
    }

    onMount(async () => {
        controller.beginLoad();
        syncControllerState();
        try {
            const rawSettings = await bridge.getSettings();
            const settings = controller.load(rawSettings);
            syncControllerState();
            applySettings(settings);

            try {
                const diagnostics = await bridge.getCustomFieldDiagnostics();
                customFieldUsage = Object.fromEntries(diagnostics.fields.map((item) => [item.key, item.count]));
            } catch (_e) {
                customFieldUsage = {};
            }

            try {
                [mcpStatus, mcpNotebooks] = await Promise.all([bridge.getMcpStatus(), bridge.listMcpTargetNotebooks()]);
                if (taskCreationInboxDocumentId) await loadTaskCreationInboxDocument(taskCreationInboxDocumentId);
            } catch (_e) {
                mcpStatus = null;
                mcpNotebooks = [];
            }

            await tick();
            settingsBodyEl?.scrollTo({ top: 0, behavior: "auto" });
            controller.edit(buildSettings());
            syncControllerState();
        } catch (e: any) {
            console.error("[NextAction] loadSettings failed:", e);
            controller.loadFailed(e);
            syncControllerState();
        }
    });

    function selectModernTab(tab: ModernTabId) {
        controller.setPage(tab);
        syncControllerState();
        requestAnimationFrame(() => settingsBodyEl?.scrollTo({ top: 0, behavior: "auto" }));
    }

    function isTopmostSettingsDialog(): boolean {
        const ownDialog = settingsRootEl?.closest(".b3-dialog");
        const dialogs = (window as any).siyuan?.dialogs || [];
        const topDialog = dialogs.length ? dialogs[dialogs.length - 1]?.element?.querySelector(".b3-dialog") : null;
        return !topDialog || ownDialog === topDialog;
    }

    export async function requestClose() {
        const decision = await controller.requestClose();
        syncControllerState();
        if (decision === "close") {
            onClose();
            return;
        }
        confirm(
            i18n?.settingsUnsavedTitle || i18n?.settingsTitle || "Unsaved changes",
            i18n?.settingsUnsavedDesc || "You have unsaved changes. Close without saving?",
            () => {
                controller.confirmDiscard();
                syncControllerState();
                onClose();
            },
            () => {
                controller.cancelClose();
                syncControllerState();
            },
        );
    }

    function handleWindowKeydown(event: KeyboardEvent) {
        if (event.key !== "Escape" || event.isComposing || !isTopmostSettingsDialog()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        requestClose();
    }

    function buildSettings(): PluginSettings {
        return {
            defaultImportance,
            defaultEffort,
            semanticDateParsingEnabled,
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
            myDayResetHour,
            myDayDefaultViewMode,
            myDayDefaultDuration,
            lastReviewAt: current.lastReviewAt,
            customFields: [...customFields],
            reminderSettings: {
                enabled: reminderEnabled,
                defaultOffsets: [...reminderDefaultOffsets],
                dueSound: reminderDueSound,
                reviewSound: reminderReviewSound,
                soundEnabled: reminderSoundEnabled,
            },
            mcpSettings: {
                enabled: mcpEnabled,
                allowWrite: mcpAllowWrite,
            },
            taskCreationSettings: {
                defaultCreateTarget: taskCreationDefaultCreateTarget,
                inboxDocumentId: taskCreationInboxDocumentId.trim(),
                dailyNoteNotebookId: taskCreationDailyNoteNotebookId,
                recentTargets: [...(current.taskCreationSettings?.recentTargets || [])],
                presets: [...(current.taskCreationSettings?.presets || [])],
            },
            aiSettings: {
                prompts: { ...aiPrompts },
            },
        };
    }

    async function handleSave() {
        controller.edit(buildSettings());
        const result = await controller.save((settings) => bridge.updateSettings(settings));
        syncControllerState();
        if (!result) return;
        applySettings(result);
        try {
            await onSave(result);
        } catch (e: unknown) {
            console.error("[NextAction] settings post-save refresh failed:", e);
            controller.reportPostSaveError(
                i18n?.settingsSavedRefreshFailed ||
                    "Settings were saved, but task order refresh failed. Use Refresh or maintenance tools to retry.",
            );
            syncControllerState();
        }
        try {
            mcpStatus = await bridge.getMcpStatus();
        } catch (e: unknown) {
            console.error("[NextAction] MCP status refresh after settings save failed:", e);
            controller.reportPostSaveError(
                i18n?.settingsSavedMcpRefreshFailed ||
                    "Settings were saved, but MCP tool status could not be refreshed. Retry or reopen settings.",
            );
            syncControllerState();
        }
    }

    function requestDraftAction(action: SettingsAction, title: string, message: string, apply: () => void) {
        controller.requestAction(action);
        confirm(
            title,
            message,
            () => {
                controller.confirmAction();
                apply();
                controller.clearError();
                syncControllerState();
            },
            () => {
                controller.cancelAction();
                syncControllerState();
            },
        );
    }

    function requestMaintenanceAction(
        action: SettingsAction,
        title: string,
        message: string,
        run: () => Promise<void>,
    ) {
        controller.requestAction(action);
        confirm(
            title,
            message,
            () => {
                controller.confirmAction();
                void run();
            },
            () => {
                controller.cancelAction();
                syncControllerState();
            },
        );
    }

    function handleRebuildCache() {
        requestMaintenanceAction(
            { id: "maintenance:cache", kind: "maintenance" },
            i18n?.rebuildCache || "Rebuild Cache",
            i18n?.rebuildCacheConfirm ||
                "This will reload all task data from the database. The operation runs immediately and may take a moment.",
            async () => {
                try {
                    const running = controller.runMaintenance("cache", () => bridge.rebuildCache());
                    syncControllerState();
                    await running;
                    notifyInfo(i18n?.rebuildCacheSuccess || "Cache rebuilt successfully");
                } catch (e: any) {
                    console.error("[NextAction] rebuildCache failed:", e);
                    notifyError(i18n?.rebuildCacheFailed || "Failed to rebuild cache");
                } finally {
                    syncControllerState();
                }
            },
        );
    }

    function doResetPriority() {
        current = { ...current, priorityEngine: { ...DEFAULT_PRIORITY_ENGINE } };
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

    function handleResetPriority() {
        requestDraftAction(
            { id: "reset:priority", kind: "draft" },
            i18n?.settingResetSection || "Reset",
            i18n?.settingResetSectionConfirm ||
                "Restore this section's settings to their default values? The reset only takes effect after you click Save, and can still be discarded by cancelling the settings dialog.",
            () => doResetPriority(),
        );
    }

    function doResetDefaults() {
        defaultImportance = DEFAULT_SETTINGS.defaultImportance;
        defaultEffort = DEFAULT_SETTINGS.defaultEffort;
        semanticDateParsingEnabled = DEFAULT_SETTINGS.semanticDateParsingEnabled;
    }

    function handleResetDefaults() {
        requestDraftAction(
            { id: "reset:defaults", kind: "draft" },
            i18n?.settingResetSection || "Reset",
            i18n?.settingResetSectionConfirm ||
                "Restore this section's settings to their default values? The reset only takes effect after you click Save, and can still be discarded by cancelling the settings dialog.",
            () => doResetDefaults(),
        );
    }

    function doResetMyDay() {
        myDayResetHour = DEFAULT_SETTINGS.myDayResetHour;
        myDayDefaultViewMode = DEFAULT_SETTINGS.myDayDefaultViewMode;
        myDayDefaultDuration = DEFAULT_SETTINGS.myDayDefaultDuration;
    }

    function handleResetMyDay() {
        requestDraftAction(
            { id: "reset:my-day", kind: "draft" },
            i18n?.settingResetSection || "Reset",
            i18n?.settingResetSectionConfirm ||
                "Restore this section's settings to their default values? The reset only takes effect after you click Save, and can still be discarded by cancelling the settings dialog.",
            () => doResetMyDay(),
        );
    }

    function doResetReminder() {
        reminderEnabled = DEFAULT_REMINDER_SETTINGS.enabled;
        reminderDefaultOffsets = [...DEFAULT_REMINDER_SETTINGS.defaultOffsets];
        reminderDueSound = DEFAULT_REMINDER_SETTINGS.dueSound;
        reminderReviewSound = DEFAULT_REMINDER_SETTINGS.reviewSound;
        reminderSoundEnabled = DEFAULT_REMINDER_SETTINGS.soundEnabled;
    }

    function handleResetReminder() {
        requestDraftAction(
            { id: "reset:reminder", kind: "draft" },
            i18n?.settingResetSection || "Reset",
            i18n?.settingResetSectionConfirm ||
                "Restore this section's settings to their default values? The reset only takes effect after you click Save, and can still be discarded by cancelling the settings dialog.",
            () => doResetReminder(),
        );
    }

    function doResetMcp() {
        mcpEnabled = DEFAULT_MCP_SETTINGS.enabled;
        mcpAllowWrite = DEFAULT_MCP_SETTINGS.allowWrite;
    }

    function handleResetMcp() {
        requestDraftAction(
            { id: "reset:mcp", kind: "draft" },
            i18n?.settingResetSection || "Reset",
            i18n?.settingResetSectionConfirm ||
                "Restore this section's settings to their default values? The reset only takes effect after you click Save, and can still be discarded by cancelling the settings dialog.",
            () => doResetMcp(),
        );
    }

    function doResetTaskCreation() {
        taskCreationDefaultCreateTarget = DEFAULT_SETTINGS.taskCreationSettings.defaultCreateTarget;
        taskCreationInboxDocumentId = DEFAULT_SETTINGS.taskCreationSettings.inboxDocumentId;
        taskCreationInboxDocument = null;
        taskCreationDailyNoteNotebookId = DEFAULT_SETTINGS.taskCreationSettings.dailyNoteNotebookId;
    }

    function handleResetTaskCreation() {
        requestDraftAction(
            { id: "reset:task-creation", kind: "draft" },
            i18n?.settingResetSection || "Reset",
            i18n?.settingResetSectionConfirm ||
                "Restore this section's settings to their default values? The reset only takes effect after you click Save, and can still be discarded by cancelling the settings dialog.",
            () => doResetTaskCreation(),
        );
    }

    function handleResetAi() {
        aiPrompts = { ...DEFAULT_AI_SETTINGS.prompts };
    }

    function handleResetAiPrompt(feature: AiFeatureId) {
        requestDraftAction(
            { id: `reset:ai:${feature}`, kind: "draft" },
            i18n?.settingAiPromptReset || "Reset",
            i18n?.settingAiPromptResetConfirm ||
                "Restore this prompt to its default? Any custom instructions will be lost. The reset only takes effect after you click Save.",
            () => {
                aiPrompts = { ...aiPrompts, [feature]: DEFAULT_AI_SETTINGS.prompts[feature] };
            },
        );
    }

    function handleResetCustomFields() {
        customFields = [];
    }

    function handlePurgeCustomField(field: CustomFieldDef) {
        requestMaintenanceAction(
            { id: `maintenance:purge:${field.id}`, kind: "maintenance" },
            i18n?.purgeCustomField || "Clear field values",
            i18n?.customFieldPurgeConfirm ||
                "This immediately clears all values for this archived field. The action cannot be undone.",
            async () => {
                try {
                    const running = controller.runMaintenance(`purge:${field.id}`, () =>
                        bridge.purgeCustomField(field.id),
                    );
                    syncControllerState();
                    const result = await running;
                    if (result.failedBlockIds?.length) {
                        controller.reportError(
                            (i18n?.customFieldPurgePartial || "{key}: {count} task value(s) could not be cleared")
                                .replace("{key}", field.key)
                                .replace("{count}", String(result.failedBlockIds.length)),
                        );
                    } else {
                        customFields = customFields.filter((item) => item.id !== field.id);
                    }
                } catch (e: unknown) {
                    console.error("[NextAction] purgeCustomField failed:", e);
                } finally {
                    syncControllerState();
                }
            },
        );
    }

    function handleResetAll() {
        requestDraftAction(
            { id: "reset:all", kind: "draft" },
            i18n?.settingResetAllTitle || i18n?.settingResetAll || "Reset all settings",
            i18n?.settingResetAllConfirm || "Restore every saved setting to its default value?",
            () => {
                doResetDefaults();
                doResetTaskCreation();
                doResetMyDay();
                doResetReminder();
                handleResetCustomFields();
                doResetMcp();
                handleResetAi();
                doResetPriority();
                error = "";
            },
        );
    }

    async function loadTaskCreationInboxDocument(documentId: string) {
        try {
            const resolved = await bridge.resolveMcpDocumentTarget(documentId.trim());
            const notebook = mcpNotebooks.find((item) => item.id === resolved.notebookId);
            taskCreationInboxDocument = {
                id: resolved.id,
                title: resolved.title,
                notebookId: resolved.notebookId,
                notebookName: notebook?.name || "",
                path: resolved.path || "",
                icon: resolved.icon || notebook?.icon || "",
            };
            taskCreationInboxDocumentId = resolved.id;
        } catch (_e) {
            taskCreationInboxDocument = null;
        }
    }

    function handleTaskCreationDocumentChange(document: DocumentSelection | null) {
        taskCreationInboxDocumentId = document?.id || "";
    }

    async function copyMcpEndpoint() {
        try {
            await navigator.clipboard.writeText(mcpEndpoint);
            mcpCopied = true;
            setTimeout(() => {
                mcpCopied = false;
            }, 1600);
        } catch (_e) {
            error = i18n?.settingMcpCopyFailed || "Failed to copy MCP endpoint";
        }
    }

    function offsetToMinutes(value: number, unit: "minutes" | "hours" | "days"): number {
        if (unit === "hours") return value * 60;
        if (unit === "days") return value * 1440;
        return value;
    }

    function minutesToDisplay(minutes: number): { value: number; unit: "minutes" | "hours" | "days" } {
        if (minutes % 1440 === 0 && minutes >= 1440) return { value: minutes / 1440, unit: "days" };
        if (minutes % 60 === 0 && minutes >= 60) return { value: minutes / 60, unit: "hours" };
        return { value: minutes, unit: "minutes" };
    }

    function handleAddOffset() {
        const minutes = offsetToMinutes(newOffsetValue, newOffsetUnit);
        if (minutes < 1 || minutes > 20160 || reminderDefaultOffsets.includes(minutes)) return;
        reminderDefaultOffsets = [...reminderDefaultOffsets, minutes].sort((a, b) => a - b);
    }

    function handleRemoveOffset(minutes: number) {
        reminderDefaultOffsets = reminderDefaultOffsets.filter((offset) => offset !== minutes);
    }

    function handlePreviewSound(soundId: ReminderSoundId) {
        unlockAutoplay();
        playSound(soundId);
    }

    function getSoundLabel(soundId: ReminderSoundId): string {
        return translateKey(i18n, reminderSoundI18nKey(soundId), soundId);
    }

    function getUnitLabel(unit: "minutes" | "hours" | "days"): string {
        if (unit === "hours") return i18n?.reminderOffsetHours || "hours";
        if (unit === "days") return i18n?.reminderOffsetDays || "days";
        return i18n?.reminderOffsetMinutes || "minutes";
    }
</script>

<svelte:window on:keydown|capture={handleWindowKeydown} />

<div class="na-settings-modern" bind:this={settingsRootEl}>
    <aside class="na-settings-modern__nav" aria-label={i18n?.settingsTitle || "Settings"}>
        <div class="na-settings-modern__brand">
            <span class="na-settings-modern__brand-mark"><NaIcon symbol="iconNextAction" size={19} /></span>
            <div><strong>{i18n?.settingsTitle || "Settings"}</strong><span>NextAction</span></div>
        </div>
        {#each [i18n?.settingNavGroupTask || "Workspace", i18n?.settingNavGroupIntegration || "Integrations", i18n?.settingNavGroupSystem || "System"] as group}
            <div class="na-settings-modern__group">
                <span>{group}</span>
                {#each modernTabs.filter((tab) => tab.group === group) as tab}
                    <button
                        type="button"
                        class:active={modernTab === tab.id}
                        class="na-settings-modern__nav-item b3-tooltips b3-tooltips__e"
                        on:click={() => selectModernTab(tab.id)}
                        aria-label={tab.label}
                        aria-current={modernTab === tab.id ? "page" : undefined}
                    >
                        <NaIcon symbol={tab.icon} size={17} />
                        <span>{tab.label}</span>
                    </button>
                {/each}
            </div>
        {/each}
        <button type="button" class="b3-button b3-button--text na-settings-modern__reset-all" on:click={handleResetAll}>
            <NaIcon symbol="iconRefresh" size={16} />
            <span>{i18n?.settingResetAll || "Reset all settings"}</span>
        </button>
    </aside>

    <main class="na-settings-modern__content">
        <div class="na-settings-modern__header">
            <NaPanelHeader
                eyebrow={i18n?.settingsTitle || "Settings"}
                title={modernTabs.find((tab) => tab.id === modernTab)?.label || ""}
                description={modernTabs.find((tab) => tab.id === modernTab)?.desc || ""}
            >
                <svelte:fragment slot="actions">
                    <button
                        type="button"
                        class="b3-button b3-button--text na-settings-modern__close b3-tooltips b3-tooltips__n"
                        on:click={requestClose}
                        aria-label={i18n?.cancel || "Close"}
                    >
                        <NaIcon symbol="iconCloseRound" size={18} />
                    </button>
                </svelte:fragment>
            </NaPanelHeader>
        </div>

        <div class="na-settings-modern__body" bind:this={settingsBodyEl}>
            {#if modernTab === "general"}
                <GeneralSettingsPage
                    {bridge}
                    {i18n}
                    bind:taskCreationDefaultCreateTarget
                    bind:taskCreationInboxDocument
                    bind:taskCreationDailyNoteNotebookId
                    taskCreationNotebooks={mcpNotebooks}
                    bind:defaultImportance
                    bind:defaultEffort
                    bind:semanticDateParsingEnabled
                    bind:myDayResetHour
                    bind:myDayDefaultViewMode
                    bind:myDayDefaultDuration
                    bind:reminderEnabled
                    bind:reminderDefaultOffsets
                    bind:reminderDueSound
                    bind:reminderReviewSound
                    bind:reminderSoundEnabled
                    bind:newOffsetValue
                    bind:newOffsetUnit
                    soundIds={REMINDER_SOUND_IDS}
                    {getSoundLabel}
                    {getUnitLabel}
                    {minutesToDisplay}
                    onAddOffset={handleAddOffset}
                    onRemoveOffset={handleRemoveOffset}
                    onPreviewSound={handlePreviewSound}
                    onTaskCreationDocumentChange={handleTaskCreationDocumentChange}
                    onResetTaskCreation={handleResetTaskCreation}
                    onResetDefaults={handleResetDefaults}
                    onResetMyDay={handleResetMyDay}
                    onResetReminder={handleResetReminder}
                />
            {:else if modernTab === "customFields"}
                <CustomFieldsSettingsPage
                    {i18n}
                    bind:customFields
                    {customFieldUsage}
                    {purgingFieldId}
                    onPurgeField={handlePurgeCustomField}
                />
            {:else if modernTab === "ai"}
                <AiSettingsPage
                    {i18n}
                    bind:aiPrompts
                    defaultPrompts={DEFAULT_AI_SETTINGS.prompts}
                    getRuntimePreview={getAiPromptRuntimePreview}
                    onResetPrompt={handleResetAiPrompt}
                />
            {:else if modernTab === "mcp"}
                <McpSettingsPage
                    {i18n}
                    bind:mcpEnabled
                    bind:mcpAllowWrite
                    {mcpStatus}
                    {mcpCopied}
                    {mcpEndpoint}
                    onCopyEndpoint={copyMcpEndpoint}
                    onReset={handleResetMcp}
                />
            {:else}
                <AdvancedSettingsPage
                    {i18n}
                    bind:dueWeight
                    bind:startWeight
                    bind:importanceWeight
                    bind:dueDecayTau
                    bind:overdueGrowth
                    bind:overdueCap
                    bind:startHorizon
                    bind:effortScale
                    bind:startPreviewDays
                    {weightSum}
                    {rebuilding}
                    onResetPriority={handleResetPriority}
                    onRebuildCache={handleRebuildCache}
                />
            {/if}
        </div>

        {#if error}<div class="na-settings-modern__error" role="alert" aria-live="polite">{error}</div>{/if}
        <footer class="na-settings-modern__footer">
            <div class="na-settings-modern__dirty" class:visible={isDirty}>
                <span></span>{i18n?.settingsUnsaved || "Unsaved changes"}
            </div>
            <div class="na-settings-modern__footer-actions">
                <button type="button" class="b3-button b3-button--text" on:click={requestClose}
                    >{i18n?.cancel || "Cancel"}</button
                >
                <button
                    type="button"
                    class="b3-button b3-button--primary"
                    on:click={handleSave}
                    disabled={saving || !settingsLoaded || !isDirty}
                    >{saving ? i18n?.loading || "…" : i18n?.save || "Save"}</button
                >
            </div>
        </footer>
    </main>
</div>

<style lang="scss">
    // ===== Modern settings shell =====
    :global(.b3-dialog__content:has(.na-settings-modern)) {
        display: flex;
        height: 100%;
        min-height: 0;
        overflow: hidden !important;
        padding: 0 !important;
    }

    :global(#naSettingsPanel:has(.na-settings-modern)) {
        flex: 1;
        height: 100%;
        min-height: 0;
        overflow: hidden;
    }

    .na-settings-modern {
        --na-settings-nav-width: 176px;
        display: flex;
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        color: var(--b3-theme-on-background);
        background: var(--b3-theme-background);
        font-family: var(--b3-font-family);
    }

    .na-settings-modern__nav {
        position: sticky;
        top: 0;
        display: flex;
        flex: 0 0 var(--na-settings-nav-width);
        flex-direction: column;
        gap: 16px;
        padding: 19px 10px 14px;
        overflow: hidden;
        border-right: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
    }

    .na-settings-modern__brand {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 0 7px 8px;
        border-bottom: 1px solid var(--b3-border-color);

        > div {
            display: flex;
            flex-direction: column;
            min-width: 0;
        }
        strong {
            color: var(--b3-theme-on-surface);
            font-size: 13px;
            font-weight: 650;
        }
        span {
            margin-top: 1px;
            color: var(--b3-theme-on-surface-light);
            font-size: 10px;
        }
    }

    .na-settings-modern__brand-mark {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 9px;
        color: var(--b3-theme-on-primary);
        background: var(--b3-theme-primary);
    }

    .na-settings-modern__group {
        display: flex;
        flex-direction: column;
        gap: 3px;

        > span {
            padding: 0 9px 4px;
            color: var(--b3-theme-on-surface-light);
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
        }
    }

    .na-settings-modern__nav-item {
        display: flex;
        align-items: center;
        gap: 9px;
        min-height: 34px;
        padding: 0 9px;
        border: 0;
        border-radius: var(--b3-border-radius);
        color: var(--b3-theme-on-surface-light);
        background: transparent;
        cursor: pointer;
        text-align: left;
        transition:
            background 130ms ease,
            color 130ms ease;

        &:hover {
            color: var(--b3-theme-on-surface);
            background: var(--b3-list-hover);
        }
        &.active {
            color: var(--b3-theme-primary);
            background: var(--b3-theme-primary-lightest);
            font-weight: 600;
        }
    }

    .na-settings-modern__reset-all {
        display: flex;
        align-items: center;
        align-self: flex-start;
        gap: 8px;
        width: auto;
        min-height: 30px;
        margin-top: auto;
        padding: 4px 8px;
        color: var(--b3-theme-on-surface-light);
        font: 400 11px/1.4 var(--b3-font-family);

        &:hover {
            color: var(--b3-theme-error);
            background: color-mix(in srgb, var(--b3-theme-error) 7%, var(--b3-theme-surface));
        }
    }

    .na-settings-modern__content {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
    }
    .na-settings-modern__header {
        position: sticky;
        top: 0;
        z-index: 2;
        display: contents;
    }
    :global(.na-settings-modern__close) {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        padding: 0;
        color: var(--b3-theme-on-surface-light);
    }
    .na-settings-modern__body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 18px 24px 22px;
        scrollbar-gutter: stable;
    }
    .na-settings-modern__error {
        flex: 0 0 auto;
        padding: 9px 24px;
        border-top: 1px solid color-mix(in srgb, var(--b3-theme-error) 25%, var(--b3-border-color));
        color: var(--b3-theme-error);
        background: color-mix(in srgb, var(--b3-theme-error) 8%, var(--b3-theme-background));
        font-size: 11px;
        line-height: 16px;
    }
    .na-settings-modern__footer {
        position: sticky;
        z-index: 2;
        bottom: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex: 0 0 auto;
        min-height: 52px;
        padding: 9px 24px;
        border-top: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
    }
    .na-settings-modern__footer-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
    }
    .na-settings-modern__dirty {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: var(--b3-theme-on-surface-light);
        font-size: 10px;
        opacity: 0;
        transition: opacity 130ms ease;
    }
    .na-settings-modern__dirty.visible {
        opacity: 1;
    }
    .na-settings-modern__dirty span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--b3-theme-primary);
    }

    @media (max-width: 720px) {
        .na-settings-modern {
            --na-settings-nav-width: 58px;
        }
        .na-settings-modern__nav {
            align-items: center;
            padding: 13px 7px;
        }
        .na-settings-modern__brand {
            padding: 0 0 9px;
            border-bottom: 0;
        }
        .na-settings-modern__brand > div,
        .na-settings-modern__group > span,
        .na-settings-modern__nav-item > span,
        .na-settings-modern__reset-all > span {
            display: none;
        }
        .na-settings-modern__group {
            width: 100%;
            gap: 5px;
        }
        .na-settings-modern__nav-item,
        .na-settings-modern__reset-all {
            justify-content: center;
            width: 44px;
            padding: 0;
        }
    }

    @media (max-width: 520px) {
        .na-settings-modern {
            flex-direction: column;
        }
        .na-settings-modern__nav {
            position: sticky;
            flex: 0 0 auto;
            flex-direction: row;
            gap: 5px;
            width: 100%;
            padding: 7px 9px;
            overflow-x: auto;
            overflow-y: hidden;
            border-right: 0;
            border-bottom: 1px solid var(--b3-border-color);
        }
        .na-settings-modern__brand {
            flex: 0 0 auto;
            padding: 0 7px 0 0;
        }
        .na-settings-modern__group {
            flex: 0 0 auto;
            flex-direction: row;
            width: auto;
        }
        .na-settings-modern__nav-item {
            width: 38px;
            min-height: 34px;
        }
        .na-settings-modern__reset-all {
            flex: 0 0 38px;
            width: 38px;
            min-height: 34px;
            margin-top: 0;
            margin-left: auto;
        }
        .na-settings-modern__body {
            padding: 14px 16px 18px;
        }
        .na-settings-modern__footer {
            padding: 8px 16px;
        }
        .na-settings-modern__dirty {
            display: none;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .na-settings-modern__nav-item,
        .na-settings-modern__dirty {
            transition: none;
        }
    }
</style>
