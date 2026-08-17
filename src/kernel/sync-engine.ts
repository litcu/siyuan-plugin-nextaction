import type { TaskCacheEntry, TaskChangeNotification, TaskChangeSetV2, TaskSnapshotV2 } from "../shared/types";
import { BROADCAST_DEBOUNCE_MS } from "../shared/constants";
import type { SiyuanApiPort } from "./siyuan-api";

type TaskChangeType = "create" | "update" | "delete";

export interface TaskSyncStateSource {
    get(blockId: string): TaskCacheEntry | undefined;
    getAll(): TaskCacheEntry[];
}

export interface TaskChangePublisher {
    addPendingChange(blockId: string, type: TaskChangeType): void;
    broadcastChanges(): void;
}

function createStreamId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function cloneTask(entry: TaskCacheEntry): TaskCacheEntry {
    return {
        ...entry,
        childIds: [...entry.childIds],
        customFields: { ...entry.customFields },
    };
}

export class SyncEngine implements TaskChangePublisher {
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingChanges: Record<string, TaskChangeType>;
    private pendingFromRevision: number | null = null;
    private readonly streamId = createStreamId();
    private revision = 0;

    constructor(
        private readonly api: SiyuanApiPort,
        private readonly stateSource?: TaskSyncStateSource,
    ) {
        this.pendingChanges = Object.create(null) as Record<string, TaskChangeType>;
    }

    stop(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.pendingChanges = Object.create(null) as Record<string, TaskChangeType>;
        this.pendingFromRevision = null;
    }

    addPendingChange(blockId: string, type: TaskChangeType): void {
        const current = this.pendingChanges[blockId];
        if (type === "delete") {
            this.pendingChanges[blockId] = "delete";
        } else if (current === "delete") {
            // V2 resolves delete/recreate from the final cache at flush time.
        } else if (type === "create") {
            this.pendingChanges[blockId] = "create";
        } else {
            this.pendingChanges[blockId] = current || "update";
        }
    }

    broadcastChanges(): void {
        if (Object.keys(this.pendingChanges).length === 0) return;

        if (this.pendingFromRevision === null) this.pendingFromRevision = this.revision;
        this.revision++;
        if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.flushChanges(), BROADCAST_DEBOUNCE_MS);
    }

    getTaskSnapshotV2(): TaskSnapshotV2 {
        return {
            schema: 2,
            streamId: this.streamId,
            revision: this.revision,
            tasks: (this.stateSource?.getAll() || []).map(cloneTask),
        };
    }

    broadcastReset(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.pendingChanges = Object.create(null) as Record<string, TaskChangeType>;
        this.pendingFromRevision = null;
        this.revision++;
        const notification: TaskChangeSetV2 = {
            schema: 2,
            type: "reset",
            streamId: this.streamId,
            revision: this.revision,
        };
        this.safeBroadcast("tasksChangedV2", notification);
    }

    private flushChanges(): void {
        this.debounceTimer = null;
        const changedIds = Object.keys(this.pendingChanges);
        if (changedIds.length === 0 || this.pendingFromRevision === null) return;

        const pendingChanges = this.pendingChanges;
        const fromRevision = this.pendingFromRevision;
        this.pendingChanges = Object.create(null) as Record<string, TaskChangeType>;
        this.pendingFromRevision = null;

        const changeTypes = Object.create(null) as Record<string, TaskChangeType>;
        for (const blockId of changedIds) changeTypes[blockId] = pendingChanges[blockId];
        const legacyNotification: TaskChangeNotification = { changedBlockIds: changedIds, changeTypes };
        this.safeBroadcast("tasksChanged", legacyNotification);

        if (!this.stateSource) return;
        const upserts: TaskCacheEntry[] = [];
        const deletedBlockIds: string[] = [];
        for (const blockId of changedIds) {
            const entry = this.stateSource.get(blockId);
            if (entry) upserts.push(cloneTask(entry));
            else deletedBlockIds.push(blockId);
        }
        const notification: TaskChangeSetV2 = {
            schema: 2,
            type: "delta",
            streamId: this.streamId,
            fromRevision,
            revision: this.revision,
            upserts,
            deletedBlockIds,
        };
        this.safeBroadcast("tasksChangedV2", notification);
    }

    private safeBroadcast(
        name: "tasksChanged" | "tasksChangedV2",
        payload: TaskChangeNotification | TaskChangeSetV2,
    ): void {
        const operation = name === "tasksChanged" ? "broadcastChanges" : "tasksChangedV2";
        try {
            const broadcast = this.api.broadcast(name, payload);
            if (broadcast) {
                void broadcast.catch((error: unknown) => {
                    void this.api.log("error", `${operation} error: ${String(error)}`);
                });
            }
        } catch (error: unknown) {
            void this.api.log("error", `${operation} error: ${String(error)}`);
        }
    }
}
