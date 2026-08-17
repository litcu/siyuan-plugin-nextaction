import type * as kernel from "siyuan/kernel";
import type { PluginSettings } from "../shared/settings";
import type { CreateTaskInput } from "../shared/task-creation";
import type { SiyuanApiPort } from "./siyuan-api";
import type { TaskService } from "./task-service";
import { TaskCreationService } from "./task-creation-service";
import { TaskTargetResolver } from "./task-target-resolver";
import { McpCapabilityManager } from "./mcp-capability-manager";
import { McpToolExecutor, type McpStatus } from "./mcp-tool-executor";

/** Compatibility facade for the former combined MCP manager. */
export class McpToolManager {
    readonly targets: TaskTargetResolver;
    readonly creation: TaskCreationService;
    readonly executor: McpToolExecutor;
    readonly capabilities: McpCapabilityManager;

    constructor(
        siyuan: kernel.ISiyuan,
        taskService: TaskService,
        settings: PluginSettings,
        api: SiyuanApiPort,
        targets?: TaskTargetResolver,
        creation?: TaskCreationService,
    ) {
        this.targets = targets || new TaskTargetResolver(api, () => taskService.getSettings());
        this.creation =
            creation || new TaskCreationService(taskService, api, this.targets, () => taskService.getSettings());
        let statusProvider: () => McpStatus = () => ({
            supported: false,
            enabled: settings.mcpSettings.enabled,
            allowWrite: settings.mcpSettings.allowWrite,
            endpoint: "/mcp",
            tools: [],
            lastError: "",
        });
        this.executor = new McpToolExecutor(siyuan, taskService, settings, api, this.targets, this.creation, () =>
            statusProvider(),
        );
        this.capabilities = new McpCapabilityManager(siyuan, this.executor, settings);
        statusProvider = () => this.capabilities.getStatus();
    }

    getStatus() {
        return this.capabilities.getStatus();
    }
    validateSettings(settings: PluginSettings) {
        return this.targets.validateSettings(settings);
    }
    reconcile(settings: PluginSettings) {
        return this.capabilities.reconcile(settings);
    }
    unload() {
        return this.capabilities.unload();
    }
    listTargetNotebooks() {
        return this.targets.listNotebooks();
    }
    listTargetDocuments(notebookId: string, path = "/") {
        return this.targets.listDocuments(notebookId, path);
    }
    searchTargetDocuments(query: string) {
        return this.targets.searchDocuments(query);
    }
    resolveDocumentTarget(value: unknown) {
        return this.targets.resolveDocument(value);
    }
    resolveChildTarget(value: unknown) {
        return this.targets.resolveChildTarget(value);
    }
    createTaskForPlugin(input: CreateTaskInput) {
        return this.executor.createTaskForPlugin(input);
    }
    convertTaskForPlugin(input: Record<string, unknown>) {
        return this.executor.convertTaskForPlugin(input);
    }
}

export type {
    McpDocumentListItem,
    McpDocumentTarget,
    McpNotebookTarget,
    McpRegisteredToolStatus,
    McpStatus,
} from "./mcp-tool-executor";
