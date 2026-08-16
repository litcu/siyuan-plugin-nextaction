import type * as kernel from "siyuan/kernel";
import type { PluginSettings } from "../shared/settings";
import { getErrorMessage } from "./mcp-tool-error";
import type {
    McpRegisteredToolStatus,
    McpStatus,
    McpToolExecutor,
} from "./mcp-tool-executor";
import {
    getDesiredMcpToolNames,
    type McpToolName,
} from "./mcp-utils";

export class McpCapabilityManager {
    private settings: PluginSettings;
    private readonly registered = new Map<string, McpRegisteredToolStatus>();
    private lastError = "";

    constructor(
        private readonly siyuan: kernel.ISiyuan,
        private readonly executor: McpToolExecutor,
        settings: PluginSettings,
    ) {
        this.settings = settings;
    }

    isSupported(): boolean {
        return typeof this.siyuan.agent?.registerCapability === "function";
    }

    getStatus(): McpStatus {
        return {
            supported: this.isSupported(),
            enabled: this.settings.mcpSettings.enabled,
            allowWrite: this.settings.mcpSettings.allowWrite,
            endpoint: "/mcp",
            tools: Array.from(this.registered.values()),
            lastError: this.lastError,
        };
    }

    async reconcile(settings: PluginSettings): Promise<void> {
        this.settings = settings;
        this.executor.updateSettings(settings);
        this.lastError = "";
        const agentApi = this.siyuan.agent;
        if (!this.isSupported()) {
            this.lastError = "siyuan.agent is unavailable in this SiYuan version";
            return;
        }

        const desired = new Set<string>(getDesiredMcpToolNames(
            settings.mcpSettings.enabled,
            settings.mcpSettings.allowWrite,
        ));
        for (const name of Array.from(this.registered.keys())) {
            if (desired.has(name)) continue;
            try {
                await agentApi.unregisterCapability(name);
                this.registered.delete(name);
            } catch (error: unknown) {
                this.lastError = getErrorMessage(error);
                await this.siyuan.logger.warn(`MCP tool unregister failed [${name}]: ${this.lastError}`);
            }
        }

        const catalog = this.executor.getCatalog();
        for (const name of desired) {
            if (this.registered.has(name)) continue;
            const toolName = name as McpToolName;
            const definition = catalog.get(toolName);
            try {
                const result = await agentApi.registerCapability(
                    name,
                    {
                        title: definition.title,
                        description: definition.description,
                        inputSchema: { ...definition.inputSchema, type: "object" as const },
                        outputSchema: { type: "object" },
                        effects: definition.effects,
                    },
                    this.executor.createHandler(toolName),
                );
                this.registered.set(name, {
                    localName: name,
                    fullName: result.name,
                    title: definition.title,
                    source: "plugin",
                    write: definition.write,
                });
            } catch (error: unknown) {
                this.lastError = getErrorMessage(error);
                await this.siyuan.logger.error(`MCP tool registration failed [${name}]: ${this.lastError}`);
            }
        }
    }

    async unload(): Promise<void> {
        if (!this.isSupported()) return;
        const agentApi = this.siyuan.agent;
        for (const name of Array.from(this.registered.keys())) {
            try {
                await agentApi.unregisterCapability(name);
            } catch (error: unknown) {
                await this.siyuan.logger.warn(`MCP tool unregister failed [${name}]: ${getErrorMessage(error)}`);
            }
        }
        this.registered.clear();
    }
}
