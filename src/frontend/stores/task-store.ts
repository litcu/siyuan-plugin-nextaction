import { writable, derived } from "svelte/store";
import type { TaskCacheEntry, TaskChangeNotification, MyDayState, PluginSettings } from "../../shared/types";
import { type KernelBridge } from "../kernel-bridge";
import { STATUS_LIST, VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY, VIEW_WAITING, VIEW_MY_DAY, VIEW_REVIEW } from "../constants";
import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
import type { FilterState } from "../utils/filter";
import { DEFAULT_SETTINGS } from "../../shared/settings";
import { DEFAULT_COMPLETED_PAGE_SIZE } from "../../shared/task-pagination";
import {
    buildTaskCollection,
    isTaskChangeSetV2,
    isTaskSnapshotV2,
    reduceTaskChanges,
} from "./task-sync-reducer";

interface TaskState {
    allTasks: TaskCacheEntry[];
    loading: boolean;
    error: string | null;
    activeView: string;
    filterByView: Record<string, FilterState>;
    contexts: string[];
    tags: string[];
    doneCount: number;
    projectReminders: TaskCacheEntry[];
    completedTasks: TaskCacheEntry[];
    completedTotal: number;
    completedPage: number;
    completedPageSize: number;
    completedSortBy: string;
    completedSortAsc: boolean;
    completedHasMore: boolean;
    completedLoading: boolean;
    completedError: string | null;
    showCompleted: boolean;
    myDayState: MyDayState | null;
    settings: PluginSettings;
    reviewDueCount: number;
}

const ALL_TASKS_DEFAULT_STATUSES = STATUS_LIST.filter(s => s !== "inbox" && s !== "done");

const DEFAULT_FILTERS: Record<string, FilterState> = {
    [VIEW_NEXT_ACTION]: { ...DEFAULT_FILTER_STATE },
    [VIEW_ALL_TASKS]: { ...DEFAULT_FILTER_STATE, statuses: [...ALL_TASKS_DEFAULT_STATUSES] },
    [VIEW_BY_PROJECT]: { ...DEFAULT_FILTER_STATE },
    [VIEW_SOMEDAY]: { ...DEFAULT_FILTER_STATE },
    [VIEW_WAITING]: { ...DEFAULT_FILTER_STATE },
    [VIEW_MY_DAY]: { ...DEFAULT_FILTER_STATE },
    [VIEW_REVIEW]: { ...DEFAULT_FILTER_STATE },
};

export function createTaskStore() {
    const { subscribe, set, update } = writable<TaskState>({
        allTasks: [],
        loading: false,
        error: null,
        activeView: VIEW_NEXT_ACTION,
        filterByView: { ...DEFAULT_FILTERS },
        contexts: [],
        tags: [],
        doneCount: 0,
        projectReminders: [],
        completedTasks: [],
        completedTotal: 0,
        completedPage: 1,
        completedPageSize: DEFAULT_COMPLETED_PAGE_SIZE,
        completedSortBy: "completed",
        completedSortAsc: false,
        completedHasMore: false,
        completedLoading: false,
        completedError: null,
        showCompleted: false,
        myDayState: null,
        settings: { ...DEFAULT_SETTINGS },
        reviewDueCount: 0,
    });

    let bridge: KernelBridge | null = null;
    let loadSeq = 0;
    let completedLoadSeq = 0;
    let v1RefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let completedReloadTimer: ReturnType<typeof setTimeout> | null = null;
    let syncMode: "unknown" | "v1" | "v2" = "unknown";
    let syncStreamId = "";
    let syncRevision = 0;
    let handshakeInProgress = false;
    let queuedV1Notifications: TaskChangeNotification[] = [];
    let queuedV2Notifications: unknown[] = [];
    let v1NotificationChain = Promise.resolve();

    function getCurrentState(): TaskState {
        let currentState!: TaskState;
        subscribe((state) => { currentState = state; })();
        return currentState;
    }

    async function loadCompletedPage(
        requestedPage?: number,
        requestedSortBy?: string,
        requestedSortAsc?: boolean,
    ): Promise<TaskCacheEntry[]> {
        if (!bridge) return [];
        const currentState = getCurrentState();
        const page = requestedPage ?? currentState.completedPage;
        const sortBy = requestedSortBy ?? currentState.completedSortBy;
        const sortAsc = requestedSortAsc ?? currentState.completedSortAsc;
        const seq = ++completedLoadSeq;

        update((state) => ({
            ...state,
            completedLoading: true,
            completedError: null,
            completedSortBy: sortBy,
            completedSortAsc: sortAsc,
        }));

        try {
            const result = await bridge.getCompletedTasksPage({
                page,
                pageSize: currentState.completedPageSize,
                sortBy,
                sortAsc,
            });
            if (seq !== completedLoadSeq) return [];
            update((state) => ({
                ...state,
                completedTasks: result.items,
                completedTotal: result.total,
                completedPage: result.page,
                completedPageSize: result.pageSize,
                completedHasMore: result.hasMore,
                completedLoading: false,
                completedError: null,
            }));
            return result.items;
        } catch (error: any) {
            console.error("[NextAction] loadCompletedTasks failed:", error);
            if (seq !== completedLoadSeq) return [];
            update((state) => ({
                ...state,
                completedLoading: false,
                completedError: error?.message || String(error),
            }));
            return [];
        }
    }

    function invalidateCompletedPage(reloadIfOpen: boolean): void {
        completedLoadSeq++;
        const currentState = getCurrentState();
        update((state) => ({
            ...state,
            completedTasks: [],
            completedTotal: state.doneCount,
            completedHasMore: false,
            completedLoading: false,
            completedError: null,
        }));
        if (!reloadIfOpen || !currentState.showCompleted) return;
        if (completedReloadTimer) clearTimeout(completedReloadTimer);
        completedReloadTimer = setTimeout(() => {
            completedReloadTimer = null;
            void loadCompletedPage(currentState.completedPage);
        }, 0);
    }

    function commitTaskChanges(upserts: TaskCacheEntry[], deletedBlockIds: string[]): void {
        let completedChanged = false;
        update((state) => {
            const reduction = reduceTaskChanges(state, { upserts, deletedBlockIds });
            completedChanged = reduction.completedChanged;
            return { ...state, ...reduction.collection, loading: false, error: null };
        });
        if (completedChanged) invalidateCompletedPage(true);
    }

    function scheduleV1Refresh(): void {
        if (v1RefreshTimer) clearTimeout(v1RefreshTimer);
        v1RefreshTimer = setTimeout(() => {
            v1RefreshTimer = null;
            void loadTasks();
        }, 2000);
    }

    async function applyV1Notification(notification: TaskChangeNotification): Promise<void> {
        if (!bridge) return;
        const deletedBlockIds = notification.changedBlockIds.filter(blockId => notification.changeTypes[blockId] === "delete");
        const upsertIds = notification.changedBlockIds.filter(blockId => notification.changeTypes[blockId] !== "delete");
        const entries = await Promise.all(upsertIds.map(blockId => bridge!.getTask(blockId)));
        commitTaskChanges(entries.filter((entry): entry is TaskCacheEntry => Boolean(entry)), deletedBlockIds);
        scheduleV1Refresh();
    }

    function requestV2Recovery(): void {
        if (syncMode === "v1") syncMode = "unknown";
        void loadTasks();
    }

    function applyV2Notification(value: unknown): void {
        if (!isTaskChangeSetV2(value)) {
            requestV2Recovery();
            return;
        }
        const notification = value;
        if (notification.streamId !== syncStreamId) {
            requestV2Recovery();
            return;
        }
        if (notification.revision <= syncRevision) return;
        if (notification.type === "reset" || notification.fromRevision !== syncRevision) {
            requestV2Recovery();
            return;
        }
        try {
            commitTaskChanges(notification.upserts, notification.deletedBlockIds);
            syncRevision = notification.revision;
        } catch (error: unknown) {
            console.error("[NextAction] apply V2 task changes failed:", error);
            requestV2Recovery();
        }
    }

    async function loadTasks(): Promise<void> {
        if (!bridge) return;
        const seq = ++loadSeq;
        const currentState = getCurrentState();
        if (currentState.allTasks.length === 0) {
            update(state => ({ ...state, loading: true, error: null }));
        }
        handshakeInProgress = true;

        try {
            if (syncMode !== "v1") {
                let rawSnapshot: unknown;
                try {
                    rawSnapshot = await bridge.getTaskSnapshotV2();
                } catch (error: unknown) {
                    if (syncMode === "v2") throw error;
                    syncMode = "v1";
                }

                if (rawSnapshot !== undefined) {
                    if (!isTaskSnapshotV2(rawSnapshot)) {
                        rawSnapshot = await bridge.getTaskSnapshotV2();
                    }
                    if (!isTaskSnapshotV2(rawSnapshot)) throw new Error("Invalid task snapshot V2 payload");
                    if (seq !== loadSeq) return;

                    const collection = buildTaskCollection(rawSnapshot.tasks);
                    syncMode = "v2";
                    syncStreamId = rawSnapshot.streamId;
                    syncRevision = rawSnapshot.revision;
                    update(state => ({ ...state, ...collection, loading: false, error: null }));
                    handshakeInProgress = false;
                    queuedV1Notifications = [];
                    const queued = queuedV2Notifications;
                    queuedV2Notifications = [];
                    for (const notification of queued) applyV2Notification(notification);
                    if (getCurrentState().showCompleted) invalidateCompletedPage(true);
                    return;
                }
            }

            const allTasks = await bridge.getAllTasks();
            if (seq !== loadSeq) return;
            const collection = buildTaskCollection(allTasks);
            syncMode = "v1";
            update(state => ({ ...state, ...collection, loading: false, error: null }));
            handshakeInProgress = false;
            queuedV2Notifications = [];
            const queued = queuedV1Notifications;
            queuedV1Notifications = [];
            for (const notification of queued) {
                v1NotificationChain = v1NotificationChain.then(() => applyV1Notification(notification));
            }
            if (getCurrentState().showCompleted) invalidateCompletedPage(true);
        } catch (error: unknown) {
            console.error("[NextAction] loadTasks failed:", error);
            if (seq !== loadSeq) return;
            const message = error instanceof Error ? error.message : String(error);
            update(state => ({ ...state, loading: false, error: message }));
        } finally {
            if (seq === loadSeq) handshakeInProgress = false;
        }
    }

    return {
        subscribe,
        setBridge(b: KernelBridge) {
            bridge = b;
        },

        async loadMyDay() {
            if (!bridge) return;
            try {
                const myDayState = await bridge.getMyDay();
                update(s => ({ ...s, myDayState }));
            } catch (e: any) {
                console.error("[NextAction] loadMyDay failed:", e);
            }
        },

        async loadSettings() {
            if (!bridge) return;
            try {
                const settings = await bridge.getSettings();
                update(s => ({ ...s, settings }));
            } catch (e: any) {
                console.error("[NextAction] loadSettings failed:", e);
            }
        },

        applySettingsUpdate(settings: PluginSettings) {
            update(s => ({ ...s, settings }));
        },

        applyMyDayUpdate(myDayState: MyDayState) {
            update(s => ({ ...s, myDayState }));
        },

        loadTasks,

        getFilteredTasks(viewId: string): TaskCacheEntry[] {
            const currentState = getCurrentState();
            const filter = currentState.filterByView[viewId] || DEFAULT_FILTER_STATE;
            const tasks = currentState.allTasks;
            return applyFilters(tasks, filter, currentState.settings.customFields);
        },

        async loadDoneTasks(): Promise<TaskCacheEntry[]> {
            return loadCompletedPage(1);
        },

        async toggleCompleted() {
            const currentState = getCurrentState();
            const opening = !currentState.showCompleted;
            update((state) => ({ ...state, showCompleted: opening }));
            if (opening && currentState.completedTasks.length === 0) {
                await loadCompletedPage(currentState.completedPage);
            }
        },

        async setCompletedPage(page: number): Promise<void> {
            await loadCompletedPage(page);
        },

        async setCompletedSort(sortBy: string, sortAsc: boolean): Promise<void> {
            update((state) => ({
                ...state,
                completedTasks: [],
                completedPage: 1,
                completedSortBy: sortBy,
                completedSortAsc: sortAsc,
            }));
            if (getCurrentState().showCompleted) await loadCompletedPage(1, sortBy, sortAsc);
        },

        async loadProjectReminders() {
            if (!bridge) return;
            try {
                const reminders = await bridge.getProjectReminders();
                update(s => ({ ...s, projectReminders: reminders }));
            } catch (e: any) {
                console.error("[NextAction] loadProjectReminders failed:", e);
            }
        },

        applyUpdate(entry: TaskCacheEntry) {
            commitTaskChanges([entry], []);
        },

        applyRemove(blockId: string) {
            commitTaskChanges([], [blockId]);
        },

        setActiveView(view: string) {
            update((s) => ({ ...s, activeView: view }));
        },

        updateFilter(viewId: string, partial: Partial<FilterState>) {
            update((s) => {
                const current = s.filterByView[viewId] || DEFAULT_FILTER_STATE;
                return {
                    ...s,
                    filterByView: {
                        ...s.filterByView,
                        [viewId]: { ...current, ...partial },
                    },
                };
            });
        },

        setFilterState(viewId: string, state: FilterState) {
            update((s) => ({
                ...s,
                filterByView: {
                    ...s.filterByView,
                    [viewId]: state,
                },
            }));
        },

        applyChangeNotification(notification: TaskChangeNotification) {
            if (syncMode === "v2") return;
            if (handshakeInProgress || syncMode === "unknown") {
                queuedV1Notifications.push(notification);
                return;
            }
            v1NotificationChain = v1NotificationChain.then(() => applyV1Notification(notification));
        },

        applyChangeSetV2(notification: unknown) {
            if (handshakeInProgress || syncMode === "unknown") {
                queuedV2Notifications.push(notification);
                if (!handshakeInProgress) void loadTasks();
                return;
            }
            if (syncMode === "v1") {
                queuedV2Notifications.push(notification);
                requestV2Recovery();
                return;
            }
            applyV2Notification(notification);
        },

        resetSync() {
            syncMode = "unknown";
            syncStreamId = "";
            syncRevision = 0;
            queuedV1Notifications = [];
            queuedV2Notifications = [];
            if (v1RefreshTimer) {
                clearTimeout(v1RefreshTimer);
                v1RefreshTimer = null;
            }
        },

        disposeSync() {
            loadSeq++;
            handshakeInProgress = false;
            queuedV1Notifications = [];
            queuedV2Notifications = [];
            if (v1RefreshTimer) clearTimeout(v1RefreshTimer);
            if (completedReloadTimer) clearTimeout(completedReloadTimer);
            v1RefreshTimer = null;
            completedReloadTimer = null;
        },
    };
}

export const taskStore = createTaskStore();

/** Shared read-only index used by task cards and detail views. */
export const taskById = derived(taskStore, ($state) => {
    const index = new Map<string, TaskCacheEntry>();
    for (const task of $state.allTasks) index.set(task.blockId, task);
    return index;
});

/** Derived: tasks that have a due or reviewDate — used by reminder scanner to avoid full traversal */
export const tasksWithDueOrReview = derived(taskStore, ($state) => {
    return $state.allTasks.filter(t => {
        if (t.status === "done") return false;
        if (t.due && t.status !== "someday") return true;
        if (t.reviewDate) return true;
        // Include tasks with absolute reminders even if no due/reviewDate
        if (t.reminder) {
            try {
                const parsed = JSON.parse(t.reminder);
                if (Array.isArray(parsed) && parsed.some((i: any) => i && i.type === "absolute")) {
                    return true;
                }
            } catch { /* ignore */ }
        }
        return false;
    });
});

/** Writable: count of pending (undismissed) reminders — used by NavRail badge */
export const pendingReminderCount = writable(0);
