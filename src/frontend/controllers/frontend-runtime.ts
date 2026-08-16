import type { Plugin } from "siyuan";
import NotificationHost from "../components/NotificationHost.svelte";
import { initAiFeatureService } from "../ai/ai-feature-service";
import { KernelBridge } from "../kernel-bridge";
import { notifyInfo } from "../notify";
import { destroyReminderStore, initReminderStore } from "../stores/reminder-store";
import { taskStore } from "../stores/task-store";
import type { MyDayState, TaskChangeNotification } from "../../shared/types";

export class FrontendRuntime {
    private bridge?: KernelBridge;
    private notificationHost?: NotificationHost;
    private disposed = false;
    private readonly tasksChangedHandler = (...params: unknown[]) => {
        taskStore.applyChangeNotification(params[0] as TaskChangeNotification);
    };
    private readonly myDayChangedHandler = (...params: unknown[]) => {
        taskStore.applyMyDayUpdate(params[0] as MyDayState);
    };
    private readonly kernelStateHandler = async (event: unknown) => {
        const detail = (event as { detail?: { code?: number } })?.detail;
        if (detail?.code !== 2) return;
        notifyInfo(`${this.plugin.i18n.pluginName} ready`);
        await this.loadTaskStoreState();
    };

    constructor(
        private readonly plugin: Plugin,
        private readonly getCurrentDocumentId: () => string,
    ) {}

    start(): KernelBridge {
        if (this.bridge) return this.bridge;
        this.disposed = false;
        const bridge = new KernelBridge(this.plugin);
        this.bridge = bridge;
        taskStore.setBridge(bridge);
        initAiFeatureService({ bridge, i18n: this.plugin.i18n, getCurrentDocumentId: this.getCurrentDocumentId });
        void initReminderStore(this.plugin);
        this.notificationHost = new NotificationHost({ target: document.body, props: { i18n: this.plugin.i18n } });
        this.plugin.eventBus.on("kernel-plugin-state-change", this.kernelStateHandler);
        this.plugin.kernel.rpc.bind("tasksChanged", this.tasksChangedHandler);
        this.plugin.kernel.rpc.bind("myDayChanged", this.myDayChangedHandler);
        void this.loadTaskStoreState();
        return bridge;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.bridge) {
            this.plugin.kernel.rpc.unbind("tasksChanged", this.tasksChangedHandler);
            this.plugin.kernel.rpc.unbind("myDayChanged", this.myDayChangedHandler);
        }
        this.plugin.eventBus.off("kernel-plugin-state-change", this.kernelStateHandler);
        destroyReminderStore();
        this.notificationHost?.$destroy();
        this.notificationHost = undefined;
        this.bridge = undefined;
    }

    private async loadTaskStoreState(): Promise<void> {
        await taskStore.loadSettings();
        await taskStore.loadTasks();
    }
}
