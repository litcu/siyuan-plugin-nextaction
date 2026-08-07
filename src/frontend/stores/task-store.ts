import { writable, derived } from "svelte/store";
import type { TaskCacheEntry, TaskChangeNotification, MyDayState, PluginSettings } from "../../shared/types";
import { KernelBridge } from "../kernel-bridge";
import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY, VIEW_WAITING, VIEW_MY_DAY, VIEW_REVIEW } from "../constants";
import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
import type { FilterState } from "../utils/filter";
import { STATUS_LIST } from "../constants";
import { DEFAULT_SETTINGS } from "../../shared/settings";
import { DEFAULT_COMPLETED_PAGE_SIZE } from "../../shared/task-pagination";

function deriveContexts(allTasks: TaskCacheEntry[]): string[] {
    const contextSet = new Set<string>();
    for (const t of allTasks) {
        if (t.context) {
            for (const c of t.context.split("|")) {
                const trimmed = c.trim();
                if (trimmed) contextSet.add(trimmed);
            }
        }
    }
    return Array.from(contextSet);
}

function deriveTags(allTasks: TaskCacheEntry[]): string[] {
    const tagSet = new Set<string>();
    for (const t of allTasks) {
        if (t.tags) {
            for (const tag of t.tags.split("|")) {
                const trimmed = tag.trim();
                if (trimmed) tagSet.add(trimmed);
            }
        }
    }
    return Array.from(tagSet);
}

function deriveDoneCount(allTasks: TaskCacheEntry[]): number {
    let count = 0;
    for (const t of allTasks) {
        if (t.status === "done") count++;
    }
    return count;
}

function deriveProjectReminders(allTasks: TaskCacheEntry[]): TaskCacheEntry[] {
    const taskMap = new Map<string, TaskCacheEntry>();
    for (const t of allTasks) {
        taskMap.set(t.blockId, t);
    }
    const reminders: TaskCacheEntry[] = [];
    for (const entry of allTasks) {
        if (entry.taskType !== "2") continue;
        if (entry.status === "done") continue;
        if (entry.childIds.length === 0) continue;
        const allDone = entry.childIds.every(id => {
            const child = taskMap.get(id);
            return child && child.status === "done";
        });
        if (allDone) reminders.push(entry);
    }
    return reminders;
}

function localDateStr(): string {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function deriveReviewDueCount(allTasks: TaskCacheEntry[]): number {
    const todayStr = localDateStr();
    let count = 0;
    for (const t of allTasks) {
        if (t.reviewInterval > 0 && t.reviewDate && t.reviewDate <= todayStr && t.status !== "done") {
            count++;
        }
    }
    return count;
}

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

function createTaskStore() {
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
    let refreshAfterNotificationTimer: ReturnType<typeof setTimeout> | null = null;
    let completedReloadTimer: ReturnType<typeof setTimeout> | null = null;

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

        async loadTasks() {
            if (!bridge) return;
            const seq = ++loadSeq;
            const currentState: TaskState = await new Promise((resolve) => {
                subscribe((s) => resolve(s))();
            });
            const isFirstLoad = currentState.allTasks.length === 0;
            if (isFirstLoad) {
                update((s) => ({ ...s, loading: true, error: null }));
            }
            try {
                // Always load full dataset — Next Action filtering is done locally
                // using the `blocked` field computed by the kernel.
                const allTasks = await bridge.getAllTasks();
                const doneCount = deriveDoneCount(allTasks);
                const contexts = deriveContexts(allTasks);
                const tags = deriveTags(allTasks);
                const projectReminders = deriveProjectReminders(allTasks);
                const reviewDueCount = deriveReviewDueCount(allTasks);

                if (seq !== loadSeq) return;

                update((s) => ({ ...s, allTasks, contexts, tags, loading: false, doneCount, projectReminders, reviewDueCount }));
                if (getCurrentState().showCompleted) invalidateCompletedPage(true);
            } catch (e: any) {
                console.error("[NextAction] loadTasks failed:", e);
                if (seq !== loadSeq) return;
                update((s) => ({ ...s, loading: false, error: e.message }));
            }
        },

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
            let completedEntryChanged = false;
            update((s) => {
                const idx = s.allTasks.findIndex((t) => t.blockId === entry.blockId);
                const allTasks = [...s.allTasks];
                const wasDone = idx >= 0 && allTasks[idx].status === "done";
                const isDone = entry.status === "done";
                completedEntryChanged = wasDone || isDone;

                if (idx >= 0) {
                    // Maintain childIds: if parentId changed, update old parent and new parent
                    const oldEntry = allTasks[idx];
                    if (oldEntry.parentId !== entry.parentId) {
                        // Remove from old parent's childIds
                        if (oldEntry.parentId) {
                            const oldParent = allTasks.find(t => t.blockId === oldEntry.parentId);
                            if (oldParent) {
                                oldParent.childIds = oldParent.childIds.filter(id => id !== entry.blockId);
                            }
                        }
                        // Add to new parent's childIds
                        if (entry.parentId) {
                            const newParent = allTasks.find(t => t.blockId === entry.parentId);
                            if (newParent && !newParent.childIds.includes(entry.blockId)) {
                                newParent.childIds = [...newParent.childIds, entry.blockId];
                            }
                        }
                    }
                    allTasks[idx] = entry;
                } else {
                    allTasks.push(entry);
                }

                return {
                    ...s,
                    allTasks,
                    doneCount: deriveDoneCount(allTasks),
                    contexts: deriveContexts(allTasks),
                    tags: deriveTags(allTasks),
                    projectReminders: deriveProjectReminders(allTasks),
                    reviewDueCount: deriveReviewDueCount(allTasks),
                };
            });
            if (completedEntryChanged) invalidateCompletedPage(true);
        },

        applyRemove(blockId: string) {
            let removedCompletedTask = false;
            update((s) => {
                removedCompletedTask = s.allTasks.some((task) => task.blockId === blockId && task.status === "done");
                const allTasks = s.allTasks.filter((t) => t.blockId !== blockId);
                return {
                    ...s,
                    allTasks,
                    doneCount: deriveDoneCount(allTasks),
                    contexts: deriveContexts(allTasks),
                    tags: deriveTags(allTasks),
                    projectReminders: deriveProjectReminders(allTasks),
                    reviewDueCount: deriveReviewDueCount(allTasks),
                };
            });
            if (removedCompletedTask) invalidateCompletedPage(true);
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
            if (!bridge) return;
            for (const blockId of notification.changedBlockIds) {
                const type = notification.changeTypes[blockId];
                if (type === "delete") {
                    let removedCompletedTask = false;
                    update((s) => {
                        removedCompletedTask = s.allTasks.some((task) => task.blockId === blockId && task.status === "done");
                        let allTasks = s.allTasks.filter((t) => t.blockId !== blockId);
                        // Clean up dangling childIds references to the deleted blockId
                        allTasks = allTasks.map(t => {
                            if (t.childIds && t.childIds.includes(blockId)) {
                                return { ...t, childIds: t.childIds.filter(id => id !== blockId) };
                            }
                            return t;
                        });
                        return {
                            ...s,
                            allTasks,
                            doneCount: deriveDoneCount(allTasks),
                            contexts: deriveContexts(allTasks),
                            tags: deriveTags(allTasks),
                            projectReminders: deriveProjectReminders(allTasks),
                            reviewDueCount: deriveReviewDueCount(allTasks),
                        };
                    });
                    if (removedCompletedTask) invalidateCompletedPage(true);
                } else {
                    bridge.getTask(blockId).then((entry) => {
                        if (!entry) return;
                        let completedEntryChanged = false;
                        update((s) => {
                            const idx = s.allTasks.findIndex((t) => t.blockId === blockId);
                            const allTasks = [...s.allTasks];
                            const wasDone = idx >= 0 && allTasks[idx].status === "done";
                            const isDone = entry.status === "done";
                            completedEntryChanged = wasDone || isDone;

                            if (idx >= 0) {
                                const oldEntry = allTasks[idx];
                                // Maintain childIds when parentId changes
                                if (oldEntry.parentId !== entry.parentId) {
                                    if (oldEntry.parentId) {
                                        const oldParent = allTasks.find(t => t.blockId === oldEntry.parentId);
                                        if (oldParent) {
                                            oldParent.childIds = oldParent.childIds.filter(id => id !== entry.blockId);
                                        }
                                    }
                                    if (entry.parentId) {
                                        const newParent = allTasks.find(t => t.blockId === entry.parentId);
                                        if (newParent && !newParent.childIds.includes(entry.blockId)) {
                                            newParent.childIds = [...newParent.childIds, entry.blockId];
                                        }
                                    }
                                }
                                allTasks[idx] = entry;
                            } else {
                                allTasks.push(entry);
                            }

                            return {
                                ...s,
                                allTasks,
                                doneCount: deriveDoneCount(allTasks),
                                contexts: deriveContexts(allTasks),
                                tags: deriveTags(allTasks),
                                projectReminders: deriveProjectReminders(allTasks),
                                reviewDueCount: deriveReviewDueCount(allTasks),
                            };
                        });
                        if (completedEntryChanged) invalidateCompletedPage(true);
                    });
                }
            }

            // Schedule a debounced full refresh. Incremental updates only patch
            // the directly changed entries, but status changes can indirectly
            // affect other tasks' `blocked` state (e.g. completing a dependency
            // unblocks dependents). The full refresh corrects any stale `blocked`
            // values and also fixes parent childIds that may be out of sync.
            if (refreshAfterNotificationTimer) clearTimeout(refreshAfterNotificationTimer);
            refreshAfterNotificationTimer = setTimeout(() => {
                refreshAfterNotificationTimer = null;
                this.loadTasks();
            }, 2000);
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
