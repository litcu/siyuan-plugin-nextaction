import type * as kernel from "siyuan/kernel";
import { setSiyuan } from "./kernel/utils";
import { Mutex } from "./kernel/mutex";
import { CacheManager } from "./kernel/cache-manager";
import { SyncEngine } from "./kernel/sync-engine";
import { TaskService } from "./kernel/task-service";
import { TaskRepository } from "./kernel/task-repository";
import { registerRpcMethods } from "./kernel/rpc-server";
import { MyDayManager } from "./kernel/my-day-manager";
import { DEFAULT_SETTINGS, mergeSettings, validateSettings, type PluginSettings } from "./shared/settings";
import { McpToolManager } from "./kernel/mcp-tool-manager";
import { AiProposalService } from "./kernel/ai-proposal-service";
import type { ReviewData } from "./shared/types";
import { ProductionSiyuanApi } from "./kernel/siyuan-api";
import { RpcContractError } from "./shared/rpc-methods";

class NextActionKernelPlugin {
    private readonly siyuan: kernel.ISiyuan = siyuan;
    private cacheManager!: CacheManager;
    private mutex!: Mutex;
    private syncEngine!: SyncEngine;
    private taskService!: TaskService;
    private mcpToolManager!: McpToolManager;
    private isReady = false;

    constructor() {
        this.siyuan.plugin.lifecycle.onload = this.onload.bind(this);
        this.siyuan.plugin.lifecycle.onrunning = this.onrunning.bind(this);
        this.siyuan.plugin.lifecycle.onunload = this.onunload.bind(this);
    }

    private async onload(): Promise<void> {
        const { logger, plugin } = this.siyuan;
        await logger.info("onload: NextAction kernel plugin loaded");

        setSiyuan(this.siyuan);
        const api = new ProductionSiyuanApi(this.siyuan);
        this.mutex = new Mutex();
        this.cacheManager = new CacheManager(api);
        this.syncEngine = new SyncEngine(api);
        const myDayManager = new MyDayManager(this.siyuan, { ...DEFAULT_SETTINGS });
        const taskRepository = new TaskRepository(api, this.cacheManager, this.mutex, this.syncEngine, DEFAULT_SETTINGS);
        this.taskService = new TaskService(this.cacheManager, taskRepository, myDayManager, api);
        const loadedSettings = await this.loadSettings();
        try {
            this.taskService.updateSettings(loadedSettings);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            await logger.warn("onload: saved settings invalid, using defaults: " + message);
            this.taskService.updateSettings(DEFAULT_SETTINGS);
        }
        this.mcpToolManager = new McpToolManager(this.siyuan, this.taskService, this.taskService.getSettings(), api);
        const aiProposalService = new AiProposalService(
            this.taskService,
            this.mcpToolManager.createTaskForPlugin.bind(this.mcpToolManager),
            this.mcpToolManager.convertTaskForPlugin.bind(this.mcpToolManager),
        );

        registerRpcMethods(this.taskService, {
            updateSettings: this.updateSettings.bind(this),
            completeReview: this.completeReview.bind(this),
            getMcpStatus: () => this.mcpToolManager.getStatus(),
            listMcpTargetNotebooks: () => this.mcpToolManager.listTargetNotebooks(),
            listMcpTargetDocuments: (notebookId, path) => this.mcpToolManager.listTargetDocuments(notebookId, path),
            searchMcpTargetDocuments: (query) => this.mcpToolManager.searchTargetDocuments(query),
            resolveMcpDocumentTarget: (value) => this.mcpToolManager.resolveDocumentTarget(value),
            resolveChildTarget: (value) => this.mcpToolManager.resolveChildTarget(value),
            createTask: (input) => this.mcpToolManager.createTaskForPlugin(input),
            aiProposalService,
        });
        await this.mcpToolManager.reconcile(this.taskService.getSettings());

        void this.taskService.loadCache().then(async () => {
            const mismatches = await this.cacheManager.verifyIntegrity();
            if (mismatches > 0) {
                await logger.warn("onload: cache integrity check found " + mismatches + " mismatches, rebuilding...");
                await this.taskService.rebuildCache();
            }
            this.isReady = true;
            await myDayManager.load();
            this.taskService.setIsReady(true);
            await logger.info("onload: cache loaded, task service ready");
        }).catch(async (error: unknown) => {
            await logger.error("onload: failed to load cache: " + String(error));
        });
    }

    private async onrunning(): Promise<void> {
        const { logger } = this.siyuan;
        await logger.info("onrunning: kernel plugin running");
    }

    private async onunload(): Promise<void> {
        const { logger } = this.siyuan;
        this.syncEngine.stop();
        this.isReady = false;
        this.taskService.setIsReady(false);
        await this.mcpToolManager?.unload();
        await logger.info("onunload: NextAction kernel plugin unloaded");
    }

    private async loadSettings(): Promise<PluginSettings> {
        try {
            const data = await this.siyuan.storage.get("settings.json");
            const saved = await data.json() as Partial<PluginSettings>;
            if (saved && typeof saved === "object") return mergeSettings(DEFAULT_SETTINGS, saved);
        } catch (_error) {
            // First run or unreadable legacy settings: use defaults.
        }
        return mergeSettings(DEFAULT_SETTINGS, {});
    }

    private async updateSettings(partial: Partial<PluginSettings>): Promise<PluginSettings> {
        const current = this.taskService.getSettings();
        const next = mergeSettings(current, partial);
        const validationError = validateSettings(next);
        if (validationError) throw new RpcContractError(validationError);
        await this.mcpToolManager.validateSettings(next);
        await this.siyuan.storage.put("settings.json", JSON.stringify(next));
        const applied = this.taskService.updateSettings(next);
        await this.mcpToolManager.reconcile(applied);
        return applied;
    }

    private async completeReview(): Promise<ReviewData> {
        const applied = await this.updateSettings({ lastReviewAt: new Date().toISOString() });
        return this.taskService.getReviewData();
    }
}

new NextActionKernelPlugin();
