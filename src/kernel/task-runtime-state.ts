import { DEFAULT_SETTINGS, mergeSettings, validateSettings, type PluginSettings } from "../shared/settings";
import { RpcContractError } from "../shared/rpc-methods";
import { RPC_ERROR_NOT_READY } from "../shared/constants";
import { updatePriorityConfig } from "./priority-engine";
import type { TaskRepository } from "./task-repository";
import type { MyDayTaskPort } from "./task-lifecycle-service";

function notReadyError(): Error & { code: number } {
    const error = new Error("Task service is not ready") as Error & { code: number };
    error.code = RPC_ERROR_NOT_READY;
    return error;
}

/** Shared readiness and configuration state for the task application services. */
export class TaskRuntimeState {
    private ready = false;
    private settings: PluginSettings = { ...DEFAULT_SETTINGS };

    constructor(
        private readonly repository: TaskRepository,
        private readonly myDayManager: MyDayTaskPort,
    ) {}

    setReady(value: boolean): void {
        this.ready = value;
    }

    assertReady(): void {
        if (!this.ready) throw notReadyError();
    }

    updateSettings(partial: Partial<PluginSettings>): PluginSettings {
        const normalized: Partial<PluginSettings> = {
            ...partial,
            customFieldSchemaVersion: 2,
            customFields: partial.customFields ? mergeSettings(DEFAULT_SETTINGS, partial).customFields : partial.customFields,
        };
        const error = validateSettings(normalized);
        if (error) throw new RpcContractError(error);
        this.settings = mergeSettings(this.settings, normalized);
        if (partial.priorityEngine) updatePriorityConfig(partial.priorityEngine);
        this.repository.updateSettings(this.settings);
        this.myDayManager.updateSettings(this.settings);
        return this.settings;
    }

    getSettings(): PluginSettings {
        return this.settings;
    }
}
