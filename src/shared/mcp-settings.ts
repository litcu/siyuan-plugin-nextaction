export type McpCreateTarget = "inbox" | "daily_note";

export interface McpSettings {
    enabled: boolean;
    allowWrite: boolean;
    defaultCreateTarget: McpCreateTarget;
    inboxDocumentId: string;
    dailyNoteNotebookId: string;
}

export const DEFAULT_MCP_SETTINGS: McpSettings = {
    enabled: false,
    allowWrite: false,
    defaultCreateTarget: "inbox",
    inboxDocumentId: "",
    dailyNoteNotebookId: "",
};

export function mergeMcpSettings(base: McpSettings, override?: Partial<McpSettings>): McpSettings {
    return {
        ...base,
        ...(override || {}),
    };
}

export function validateMcpSettings(settings?: Partial<McpSettings>): string | null {
    if (!settings) return null;
    if (settings.enabled !== undefined && typeof settings.enabled !== "boolean") {
        return "mcpSettings.enabled must be boolean";
    }
    if (settings.allowWrite !== undefined && typeof settings.allowWrite !== "boolean") {
        return "mcpSettings.allowWrite must be boolean";
    }
    if (settings.defaultCreateTarget !== undefined
        && settings.defaultCreateTarget !== "inbox"
        && settings.defaultCreateTarget !== "daily_note") {
        return "mcpSettings.defaultCreateTarget must be 'inbox' or 'daily_note'";
    }
    if (settings.inboxDocumentId !== undefined && typeof settings.inboxDocumentId !== "string") {
        return "mcpSettings.inboxDocumentId must be string";
    }
    if (settings.dailyNoteNotebookId !== undefined && typeof settings.dailyNoteNotebookId !== "string") {
        return "mcpSettings.dailyNoteNotebookId must be string";
    }
    return null;
}

