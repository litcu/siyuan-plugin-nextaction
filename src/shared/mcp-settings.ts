export interface McpSettings {
    enabled: boolean;
    allowWrite: boolean;
}

export const DEFAULT_MCP_SETTINGS: McpSettings = {
    enabled: false,
    allowWrite: false,
};

export function mergeMcpSettings(base: McpSettings, override?: Partial<McpSettings>): McpSettings {
    return {
        enabled: override?.enabled ?? base.enabled,
        allowWrite: override?.allowWrite ?? base.allowWrite,
    };
}

export function validateMcpSettings(settings?: Partial<McpSettings>): string | null {
    if (!settings) return null;
    if (Object.keys(settings).some((key) => key !== "enabled" && key !== "allowWrite")) {
        return "mcpSettings contains unknown properties";
    }
    if (settings.enabled !== undefined && typeof settings.enabled !== "boolean") {
        return "mcpSettings.enabled must be boolean";
    }
    if (settings.allowWrite !== undefined && typeof settings.allowWrite !== "boolean") {
        return "mcpSettings.allowWrite must be boolean";
    }
    return null;
}
