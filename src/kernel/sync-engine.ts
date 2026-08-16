import { type TaskChangeNotification } from "../shared/types";
import { BROADCAST_DEBOUNCE_MS } from "../shared/constants";
import type { SiyuanApiPort } from "./siyuan-api";

export interface TaskChangePublisher {
    addPendingChange(blockId: string, type: "create" | "update" | "delete"): void;
    broadcastChanges(): void;
}

export class SyncEngine {
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingChanges: Record<string, "create" | "update" | "delete">;

    constructor(private readonly api: SiyuanApiPort) {
        this.pendingChanges = Object.create(null) as Record<string, "create" | "update" | "delete">;
    }

    stop(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    addPendingChange(blockId: string, type: "create" | "update" | "delete"): void {
        // "delete" always wins; "create" < "update"
        const current = this.pendingChanges[blockId];
        if (type === "delete") {
            this.pendingChanges[blockId] = "delete";
        } else if (current === "delete") {
            // keep delete
        } else if (type === "create") {
            this.pendingChanges[blockId] = "create";
        } else {
            // update
            this.pendingChanges[blockId] = current || "update";
        }
    }

    broadcastChanges(): void {
        const keys = Object.keys(this.pendingChanges);
        if (keys.length === 0) return;

        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            const changedIds = Object.keys(this.pendingChanges);
            if (changedIds.length === 0) return;

            const changeTypes: Record<string, "create" | "update" | "delete"> = Object.create(null) as Record<string, "create" | "update" | "delete">;
            for (let i = 0; i < changedIds.length; i++) {
                changeTypes[changedIds[i]] = this.pendingChanges[changedIds[i]];
            }

            // Clear pending changes
            this.pendingChanges = Object.create(null) as Record<string, "create" | "update" | "delete">;

            const notification: TaskChangeNotification = {
                changedBlockIds: changedIds,
                changeTypes: changeTypes,
            };

            try {
                const broadcast = this.api.broadcast("tasksChanged", notification);
                if (broadcast) {
                    void broadcast.catch((error: unknown) => {
                        void this.api.log("error", "broadcastChanges error: " + String(error));
                    });
                }
            } catch (error: unknown) {
                void this.api.log("error", "broadcastChanges error: " + String(error));
            }
        }, BROADCAST_DEBOUNCE_MS);
    }
}
