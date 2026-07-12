import { writable, derived } from "svelte/store";
import type { TaskCacheEntry, TaskChangeNotification, MyDayState, PluginSettings } from "../../shared/types";
import { KernelBridge } from "../kernel-bridge";
import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY, VIEW_WAITING, VIEW_MY_DAY, VIEW_REVIEW } from "../constants";
import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
import type { FilterState } from "../utils/filter";
import { STATUS_LIST } from "../constants";
import { DEFAULT_SETTINGS } from "../../shared/settings";

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
        showCompleted: false,
        myDayState: null,
        settings: { ...DEFAULT_SETTINGS },
        reviewDueCount: 0,
    });

    let bridge: KernelBridge | null = null;
    let loadSeq = 0;
    let refreshAfterNotificationTimer: ReturnType<typeof setTimeout> | null = null;

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
            } catch (e: any) {
                console.error("[NextAction] loadTasks failed:", e);
                if (seq !== loadSeq) return;
                update((s) => ({ ...s, loading: false, error: e.message }));
            }
        },

        getFilteredTasks(viewId: string): TaskCacheEntry[] {
            let result: TaskCacheEntry[] = [];
            let currentState: TaskState | null = null;
            const unsub = subscribe((s) => { currentState = s; });
            unsub();

            if (!currentState) return result;

            const filter = currentState.filterByView[viewId] || DEFAULT_FILTER_STATE;
            const tasks = currentState.allTasks;

            result = applyFilters(tasks, filter);

            return result;
        },

        async loadDoneTasks(): Promise<TaskCacheEntry[]> {
            if (!bridge) return [];
            try {
                const tasks = await bridge.getAllTasks({ status: "done" });
                update(s => ({ ...s, completedTasks: tasks }));
                return tasks;
            } catch (e: any) {
                console.error("[NextAction] loadCompletedTasks failed:", e);
                return [];
            }
        },

        async toggleCompleted() {
            const currentState: TaskState = await new Promise((resolve) => {
                subscribe((s) => resolve(s))();
            });
            if (!currentState.showCompleted && currentState.completedTasks.length === 0) {
                // Derive completed tasks from allTasks instead of RPC
                const completed = currentState.allTasks.filter(t => t.status === "done");
                update(s => ({ ...s, completedTasks: completed }));
            }
            update(s => ({ ...s, showCompleted: !s.showCompleted }));
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
            update((s) => {
                const idx = s.allTasks.findIndex((t) => t.blockId === entry.blockId);
                const allTasks = [...s.allTasks];
                const wasDone = idx >= 0 && allTasks[idx].status === "done";
                const isDone = entry.status === "done";

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

                let completedTasks = s.completedTasks;
                if (s.showCompleted && wasDone !== isDone) {
                    completedTasks = allTasks.filter(t => t.status === "done");
                }

                return {
                    ...s,
                    allTasks,
                    completedTasks,
                    doneCount: deriveDoneCount(allTasks),
                    contexts: deriveContexts(allTasks),
                    tags: deriveTags(allTasks),
                    projectReminders: deriveProjectReminders(allTasks),
                    reviewDueCount: deriveReviewDueCount(allTasks),
                };
            });
        },

        applyRemove(blockId: string) {
            update((s) => {
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
                    update((s) => {
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
                } else {
                    bridge.getTask(blockId).then((entry) => {
                        if (!entry) return;
                        update((s) => {
                            const idx = s.allTasks.findIndex((t) => t.blockId === blockId);
                            const allTasks = [...s.allTasks];
                            const wasDone = idx >= 0 && allTasks[idx].status === "done";
                            const isDone = entry.status === "done";

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

                            const statusChanged = wasDone !== isDone;

                            let completedTasks = s.completedTasks;
                            if (s.showCompleted && statusChanged) {
                                completedTasks = allTasks.filter(t => t.status === "done");
                            }

                            return {
                                ...s,
                                allTasks,
                                completedTasks,
                                doneCount: deriveDoneCount(allTasks),
                                contexts: deriveContexts(allTasks),
                                tags: deriveTags(allTasks),
                                projectReminders: deriveProjectReminders(allTasks),
                                reviewDueCount: deriveReviewDueCount(allTasks),
                            };
                        });
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
