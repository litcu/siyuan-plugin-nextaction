export type CreateTaskDestinationType = "inbox" | "daily_note" | "document" | "block";
export type CreateTaskFormat = "paragraph" | "list";

export const CREATE_TASK_DESTINATION_TYPES = ["inbox", "daily_note", "document", "block"] as const;
export const CREATE_TASK_FORMATS = ["paragraph", "list"] as const;

export interface CreateTaskDestination {
    type: CreateTaskDestinationType;
    format?: CreateTaskFormat;
    notebookId?: string;
    documentId?: string;
    parentBlockId?: string;
}

export interface CreateTaskInput {
    title: string;
    kind?: "task" | "project";
    destination?: CreateTaskDestination;
    properties?: Record<string, unknown>;
    addToMyDay?: boolean;
    schedule?: { start: number; end: number };
}

export interface CreateTaskResult {
    task: { id: string; title: string; [key: string]: unknown };
    destination: Record<string, unknown>;
    warnings: string[];
}

export interface TaskCreateTargetMemory {
    type: CreateTaskDestinationType;
    format: CreateTaskFormat;
    notebookId?: string;
    notebookName?: string;
    documentId?: string;
    documentTitle?: string;
    documentPath?: string;
    parentBlockId?: string;
    parentTitle?: string;
}

export interface TaskCreatePreset {
    id: string;
    name: string;
    target: TaskCreateTargetMemory;
}

export interface TaskCreationSettings {
    recentTargets: TaskCreateTargetMemory[];
    presets: TaskCreatePreset[];
}

export const DEFAULT_TASK_CREATION_SETTINGS: TaskCreationSettings = {
    recentTargets: [],
    presets: [],
};

export function mergeTaskCreationSettings(
    base: TaskCreationSettings,
    override?: Partial<TaskCreationSettings>,
): TaskCreationSettings {
    return {
        recentTargets: Array.isArray(override?.recentTargets)
            ? override!.recentTargets.slice(0, 3)
            : [...(base.recentTargets || [])].slice(0, 3),
        presets: Array.isArray(override?.presets)
            ? override!.presets.slice(0, 12)
            : [...(base.presets || [])].slice(0, 12),
    };
}

function isTargetMemory(value: unknown): value is TaskCreateTargetMemory {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const target = value as Partial<TaskCreateTargetMemory>;
    if (!(CREATE_TASK_DESTINATION_TYPES as readonly string[]).includes(String(target.type))) return false;
    if (!(CREATE_TASK_FORMATS as readonly string[]).includes(String(target.format))) return false;
    for (const key of ["notebookId", "notebookName", "documentId", "documentTitle", "documentPath", "parentBlockId", "parentTitle"] as const) {
        if (target[key] !== undefined && typeof target[key] !== "string") return false;
    }
    return true;
}

export function validateTaskCreationSettings(settings?: Partial<TaskCreationSettings>): string | null {
    if (!settings) return null;
    if (settings.recentTargets !== undefined) {
        if (!Array.isArray(settings.recentTargets) || settings.recentTargets.length > 3) return "taskCreationSettings.recentTargets must contain at most 3 items";
        if (settings.recentTargets.some(target => !isTargetMemory(target))) return "taskCreationSettings.recentTargets contains an invalid target";
    }
    if (settings.presets !== undefined) {
        if (!Array.isArray(settings.presets) || settings.presets.length > 12) return "taskCreationSettings.presets must contain at most 12 items";
        const ids = new Set<string>();
        for (const preset of settings.presets) {
            if (!preset || typeof preset !== "object" || typeof preset.id !== "string" || typeof preset.name !== "string" || !preset.name.trim() || !isTargetMemory(preset.target)) {
                return "taskCreationSettings.presets contains an invalid preset";
            }
            if (ids.has(preset.id)) return "taskCreationSettings.presets ids must be unique";
            ids.add(preset.id);
        }
    }
    return null;
}
