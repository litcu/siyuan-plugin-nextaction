import type { ToolDefinition } from "./mcp-tool-executor";
import {
    READ_MCP_TOOL_NAMES,
    WRITE_MCP_TOOL_NAMES,
    getMcpCapabilityEffects,
    type McpCapabilityEffects,
    type McpToolName,
} from "./mcp-utils";

export interface McpToolCatalogEntry extends ToolDefinition {
    name: McpToolName;
    write: boolean;
    effects: McpCapabilityEffects;
}

const ALL_MCP_TOOL_NAMES = [...READ_MCP_TOOL_NAMES, ...WRITE_MCP_TOOL_NAMES] as const;

/** The single runtime registry for all public MCP tool definitions. */
export class McpToolCatalog {
    private readonly entries: Record<McpToolName, McpToolCatalogEntry>;

    constructor(definitions: Record<McpToolName, ToolDefinition>) {
        this.entries = Object.fromEntries(ALL_MCP_TOOL_NAMES.map(name => {
            const definition = definitions[name];
            if (!definition) throw new Error(`Missing MCP tool definition: ${name}`);
            return [name, {
                ...definition,
                name,
                write: (WRITE_MCP_TOOL_NAMES as readonly string[]).includes(name),
                effects: getMcpCapabilityEffects(name),
            }];
        })) as Record<McpToolName, McpToolCatalogEntry>;
        const unexpected = Object.keys(definitions).filter(name => !(ALL_MCP_TOOL_NAMES as readonly string[]).includes(name));
        if (unexpected.length) throw new Error(`Unexpected MCP tool definitions: ${unexpected.join(", ")}`);
    }

    get(name: McpToolName): McpToolCatalogEntry {
        return this.entries[name];
    }

    list(): McpToolCatalogEntry[] {
        return ALL_MCP_TOOL_NAMES.map(name => this.entries[name]);
    }
}
