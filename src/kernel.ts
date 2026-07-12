import type * as kernel from "siyuan/kernel";
import { setSiyuan } from "./kernel/utils";
import { Mutex } from "./kernel/mutex";
import { CacheManager } from "./kernel/cache-manager";
import { SyncEngine } from "./kernel/sync-engine";
import { TaskService } from "./kernel/task-service";
import { registerRpcMethods } from "./kernel/rpc-server";
import { MyDayManager } from "./kernel/my-day-manager";
import { DEFAULT_SETTINGS } from "./shared/settings";

class NextActionKernelPlugin {
    private readonly siyuan: kernel.ISiyuan = siyuan;
    private cacheManager!: CacheManager;
    private mutex!: Mutex;
    private syncEngine!: SyncEngine;
    private taskService!: TaskService;
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
        this.mutex = new Mutex();
        this.cacheManager = new CacheManager();
        this.syncEngine = new SyncEngine();
        const myDayManager = new MyDayManager(this.siyuan, { ...DEFAULT_SETTINGS });
        this.taskService = new TaskService(this.cacheManager, this.mutex, this.syncEngine, myDayManager);

        registerRpcMethods(this.taskService);

        this.cacheManager.loadAll().then(async () => {
            const mismatches = await this.cacheManager.verifyIntegrity();
            if (mismatches > 0) {
                logger.warn("onload: cache integrity check found " + mismatches + " mismatches, rebuilding...");
                await this.cacheManager.rebuild();
            }
            this.isReady = true;
            await myDayManager.load();
            this.taskService.setIsReady(true);
            logger.info("onload: cache loaded, task service ready");
        }).catch((e: any) => {
            logger.error("onload: failed to load cache: " + String(e));
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
        await logger.info("onunload: NextAction kernel plugin unloaded");
    }
}

new NextActionKernelPlugin();
