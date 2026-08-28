import type { ProjectBoardGroupBy } from "./project-board";

export const PROJECT_BOARD_PREFERENCES_VERSION = 1 as const;

export type ProjectBoardSortBy = "order" | "due" | "importance" | "priority" | `custom:${string}`;

export interface ProjectBoardPreference {
    groupBy: ProjectBoardGroupBy;
    sortBy: ProjectBoardSortBy;
    sortAsc: boolean;
    narrowColumnIndex: number;
}

export interface ProjectBoardPreferences {
    version: typeof PROJECT_BOARD_PREFERENCES_VERSION;
    projects: Record<string, ProjectBoardPreference>;
}

export const DEFAULT_PROJECT_BOARD_PREFERENCE: ProjectBoardPreference = {
    groupBy: "status",
    sortBy: "order",
    sortAsc: false,
    narrowColumnIndex: 0,
};

export function createDefaultProjectBoardPreferences(): ProjectBoardPreferences {
    return { version: PROJECT_BOARD_PREFERENCES_VERSION, projects: {} };
}

function isGroupBy(value: unknown): value is ProjectBoardGroupBy {
    return value === "status" || value === "stage" || value === "priority" || value === "importance";
}

function isSortBy(value: unknown): value is ProjectBoardSortBy {
    return (
        value === "order" ||
        value === "due" ||
        value === "importance" ||
        value === "priority" ||
        (typeof value === "string" && value.startsWith("custom:") && value.length > "custom:".length)
    );
}

function isPreference(value: unknown): value is ProjectBoardPreference {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const item = value as Record<string, unknown>;
    return (
        isGroupBy(item.groupBy) &&
        isSortBy(item.sortBy) &&
        typeof item.sortAsc === "boolean" &&
        Number.isInteger(item.narrowColumnIndex) &&
        (item.narrowColumnIndex as number) >= 0
    );
}

export function normalizeProjectBoardPreferences(value: unknown): ProjectBoardPreferences {
    if (!value || typeof value !== "object" || Array.isArray(value)) return createDefaultProjectBoardPreferences();
    const raw = value as Record<string, unknown>;
    if (raw.version !== PROJECT_BOARD_PREFERENCES_VERSION || !raw.projects || typeof raw.projects !== "object") {
        return createDefaultProjectBoardPreferences();
    }
    const projects: Record<string, ProjectBoardPreference> = {};
    for (const [projectId, preference] of Object.entries(raw.projects as Record<string, unknown>)) {
        if (!projectId || !isPreference(preference)) continue;
        projects[projectId] = { ...DEFAULT_PROJECT_BOARD_PREFERENCE, ...preference };
    }
    return { version: PROJECT_BOARD_PREFERENCES_VERSION, projects };
}

export function getProjectBoardPreference(
    preferences: ProjectBoardPreferences,
    projectId: string,
): ProjectBoardPreference {
    return { ...DEFAULT_PROJECT_BOARD_PREFERENCE, ...(preferences.projects[projectId] || {}) };
}

export function withProjectBoardPreference(
    preferences: ProjectBoardPreferences,
    projectId: string,
    preference: ProjectBoardPreference,
): ProjectBoardPreferences {
    return {
        version: PROJECT_BOARD_PREFERENCES_VERSION,
        projects: { ...preferences.projects, [projectId]: { ...DEFAULT_PROJECT_BOARD_PREFERENCE, ...preference } },
    };
}
