// Plugin settings: type definition, defaults, and validation
import { type ReminderSoundId, REMINDER_SOUND_IDS } from "./constants";

export interface PriorityEngineSettings {
    dueWeight: number;
    startWeight: number;
    importanceWeight: number;
    overdueBase: number;
    dueDecayTau: number;
    noDueScore: number;
    overdueGrowth: number;
    overdueCap: number;
    startHorizon: number;
    minStartScore: number;
    effortScale: number;
    startPreviewDays: number;
    priorityOffsetCritical: number;
    priorityOffsetHigh: number;
    priorityOffsetMedium: number;
    priorityOffsetLow: number;
    priorityOffsetNone: number;
}

export type MyDayViewMode = "timeline" | "list";

export type CustomFieldType = "text";

export interface CustomFieldDef {
    key: string;
    label: string;
    type: CustomFieldType;
}

export interface ReminderSettings {
    enabled: boolean;
    defaultOffsets: number[];       // 默认提前量（分钟数）
    dueSound: ReminderSoundId;
    reviewSound: ReminderSoundId;
    soundEnabled: boolean;
}

export interface PluginSettings {
    defaultImportance: number;
    defaultEffort: number;
    priorityEngine: PriorityEngineSettings;
    myDayEnabled: boolean;
    myDayResetHour: number;
    myDayDefaultViewMode: MyDayViewMode;
    myDayDefaultDuration: number;
    customFields: CustomFieldDef[];
    reminderSettings: ReminderSettings;
}

export const DEFAULT_PRIORITY_ENGINE: PriorityEngineSettings = {
    dueWeight: 0.45,
    startWeight: 0.25,
    importanceWeight: 0.30,
    overdueBase: 35,
    dueDecayTau: 5,
    noDueScore: 35,
    overdueGrowth: 0.5,
    overdueCap: 20,
    startHorizon: 14,
    minStartScore: 10,
    effortScale: 0.05,
    startPreviewDays: 0,
    priorityOffsetCritical: 1.5,
    priorityOffsetHigh: 0.8,
    priorityOffsetMedium: 0,
    priorityOffsetLow: -0.8,
    priorityOffsetNone: -1.2,
};

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
    enabled: true,
    defaultOffsets: [60, 720, 1440, 4320, 7200, 10080],
    dueSound: "chime",
    reviewSound: "soft",
    soundEnabled: true,
};

export const DEFAULT_SETTINGS: PluginSettings = {
    defaultImportance: 4,
    defaultEffort: 4,
    priorityEngine: { ...DEFAULT_PRIORITY_ENGINE },
    myDayEnabled: true,
    myDayResetHour: 5,
    myDayDefaultViewMode: "timeline",
    myDayDefaultDuration: 60,
    customFields: [],
    reminderSettings: { ...DEFAULT_REMINDER_SETTINGS },
};

export function validateSettings(settings: Partial<PluginSettings>): string | null {
    if (settings.defaultImportance !== undefined) {
        if (!Number.isInteger(settings.defaultImportance) || settings.defaultImportance < 1 || settings.defaultImportance > 7) {
            return "defaultImportance must be integer 1-7";
        }
    }
    if (settings.defaultEffort !== undefined) {
        if (!Number.isInteger(settings.defaultEffort) || settings.defaultEffort < 1 || settings.defaultEffort > 7) {
            return "defaultEffort must be integer 1-7";
        }
    }
    const pe = settings.priorityEngine;
    if (pe) {
        const weightSum = (pe.dueWeight ?? 0) + (pe.startWeight ?? 0) + (pe.importanceWeight ?? 0);
        if (Math.abs(weightSum - 1.0) > 0.01) {
            return "dueWeight + startWeight + importanceWeight must equal 1.0";
        }
        if (pe.dueDecayTau !== undefined && (pe.dueDecayTau < 1 || pe.dueDecayTau > 30)) {
            return "dueDecayTau must be 1-30";
        }
        if (pe.startHorizon !== undefined && (pe.startHorizon < 1 || pe.startHorizon > 60)) {
            return "startHorizon must be 1-60";
        }
        if (pe.effortScale !== undefined && (pe.effortScale < 0 || pe.effortScale > 0.5)) {
            return "effortScale must be 0-0.5";
        }
        if (pe.startPreviewDays !== undefined && (!Number.isInteger(pe.startPreviewDays) || pe.startPreviewDays < 0 || pe.startPreviewDays > 14)) {
            return "startPreviewDays must be integer 0-14";
        }
    }
    if (settings.myDayResetHour !== undefined) {
        if (!Number.isInteger(settings.myDayResetHour) || settings.myDayResetHour < 0 || settings.myDayResetHour > 23) {
            return "myDayResetHour must be integer 0-23";
        }
    }
    if (settings.myDayDefaultViewMode !== undefined) {
        if (settings.myDayDefaultViewMode !== "timeline" && settings.myDayDefaultViewMode !== "list") {
            return "myDayDefaultViewMode must be 'timeline' or 'list'";
        }
    }
    if (settings.myDayDefaultDuration !== undefined) {
        if (!Number.isInteger(settings.myDayDefaultDuration) || settings.myDayDefaultDuration < 15 || settings.myDayDefaultDuration > 480) {
            return "myDayDefaultDuration must be integer 15-480";
        }
    }
    if (settings.customFields) {
        const keys = new Set<string>();
        for (const field of settings.customFields) {
            if (!field.key || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.key)) {
                return "customFields key must start with a letter and contain only letters, digits, underscores";
            }
            if (keys.has(field.key)) {
                return "customFields key must be unique: " + field.key;
            }
            keys.add(field.key);
            if (!field.label || field.label.trim().length === 0) {
                return "customFields label must not be empty";
            }
        }
    }
    const rs = settings.reminderSettings;
    if (rs) {
        if (rs.enabled !== undefined && typeof rs.enabled !== "boolean") {
            return "reminderSettings.enabled must be boolean";
        }
        if (rs.defaultOffsets !== undefined) {
            if (!Array.isArray(rs.defaultOffsets)) {
                return "reminderSettings.defaultOffsets must be an array";
            }
            if (rs.defaultOffsets.length > 10) {
                return "reminderSettings.defaultOffsets must have at most 10 items";
            }
            for (const v of rs.defaultOffsets) {
                if (!Number.isInteger(v) || v < 1 || v > 20160) {
                    return "reminderSettings.defaultOffsets items must be positive integers <= 20160 (14 days)";
                }
            }
            const unique = new Set(rs.defaultOffsets);
            if (unique.size !== rs.defaultOffsets.length) {
                return "reminderSettings.defaultOffsets must not contain duplicates";
            }
        }
        if (rs.dueSound !== undefined && (REMINDER_SOUND_IDS as readonly string[]).indexOf(rs.dueSound) === -1) {
            return "reminderSettings.dueSound must be one of: " + REMINDER_SOUND_IDS.join(", ");
        }
        if (rs.reviewSound !== undefined && (REMINDER_SOUND_IDS as readonly string[]).indexOf(rs.reviewSound) === -1) {
            return "reminderSettings.reviewSound must be one of: " + REMINDER_SOUND_IDS.join(", ");
        }
        if (rs.soundEnabled !== undefined && typeof rs.soundEnabled !== "boolean") {
            return "reminderSettings.soundEnabled must be boolean";
        }
    }
    return null;
}

export function mergeSettings(base: PluginSettings, override: Partial<PluginSettings>): PluginSettings {
    return {
        defaultImportance: override.defaultImportance ?? base.defaultImportance,
        defaultEffort: override.defaultEffort ?? base.defaultEffort,
        priorityEngine: {
            ...base.priorityEngine,
            ...(override.priorityEngine ?? {}),
        },
        myDayEnabled: override.myDayEnabled ?? base.myDayEnabled,
        myDayResetHour: override.myDayResetHour ?? base.myDayResetHour,
        myDayDefaultViewMode: override.myDayDefaultViewMode ?? base.myDayDefaultViewMode,
        myDayDefaultDuration: override.myDayDefaultDuration ?? base.myDayDefaultDuration,
        customFields: override.customFields ?? base.customFields,
        reminderSettings: {
            ...base.reminderSettings,
            ...(override.reminderSettings ?? {}),
        },
    };
}
