import { getContext, setContext, onDestroy } from "svelte";
import { createWorkspaceCompleted } from "./controllers/workspace-completed";
import type { KernelBridge } from "./kernel-bridge";
import { derived } from "svelte/store";
import type { TaskCacheEntry } from "../shared/types";
import type { App } from "siyuan";
import { taskStore } from "./stores/task-store";
import { createWorkspaceSession, type WorkspaceSession } from "./controllers/workspace-session";

export type WorkspaceHost = "desktop-tab" | "desktop-dock" | "mobile-dock";
export interface WorkspaceContext {
    host: WorkspaceHost;
    compact: boolean;
    touch: boolean;
    app?: App;
    session: WorkspaceSession;
    completed: ReturnType<typeof createWorkspaceCompleted>;
    openTask?: (task: TaskCacheEntry) => void;
    openSchedule?: (task: TaskCacheEntry) => void;
}
const WORKSPACE = Symbol("nextaction-workspace");
export function provideWorkspace(host: WorkspaceHost, bridge: KernelBridge, app?: App): WorkspaceContext {
    const completed = createWorkspaceCompleted((request) => bridge.getCompletedTasksPage(request));
    let previousTasks: TaskCacheEntry[] | undefined;
    let previousCount = -1;
    const unsubscribe = taskStore.subscribe((state) => {
        if (previousTasks !== state.allTasks || previousCount !== state.doneCount) {
            previousTasks = state.allTasks;
            previousCount = state.doneCount;
            void completed.refresh();
        }
    });
    onDestroy(() => {
        unsubscribe();
        completed.dispose();
    });
    return setContext(WORKSPACE, {
        host,
        compact: host !== "desktop-tab",
        touch: host === "mobile-dock",
        app,
        session: createWorkspaceSession(),
        completed,
    });
}
export function useWorkspace(): WorkspaceContext | undefined {
    return getContext<WorkspaceContext | undefined>(WORKSPACE);
}
export function useWorkspaceTasks(): typeof taskStore {
    const workspace = useWorkspace();
    if (!workspace) return taskStore;
    const scoped = derived([taskStore, workspace.session, workspace.completed], ([tasks, session, completed]) => ({
        ...tasks,
        ...completed,
        activeView: session.activeView,
        filterByView: session.filterByView,
    }));
    return {
        ...taskStore,
        ...workspace.completed,
        subscribe: scoped.subscribe,
        setFilterState: workspace.session.setFilterState,
    };
}
