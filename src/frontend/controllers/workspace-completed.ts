import { get, writable } from "svelte/store";
import { DEFAULT_COMPLETED_PAGE_SIZE } from "../../shared/task-pagination";
import type { CompletedTasksPage, TaskCacheEntry } from "../../shared/types";

type Request = { page: number; pageSize: number; sortBy: string; sortAsc: boolean };

/** 已完成任务共享服务端数据，每个宿主独立保存浏览位置。 */
export function createWorkspaceCompleted(load: (request: Request) => Promise<CompletedTasksPage>) {
    const state = writable({
        completedTasks: [] as TaskCacheEntry[],
        completedTotal: 0,
        completedPage: 1,
        completedPageSize: DEFAULT_COMPLETED_PAGE_SIZE,
        completedSortBy: "completed",
        completedSortAsc: false,
        completedHasMore: false,
        completedLoading: false,
        completedError: null as string | null,
        showCompleted: false,
    });
    let sequence = 0;
    let disposed = false;
    let stale = true;
    async function loadPage(page = get(state).completedPage): Promise<TaskCacheEntry[]> {
        const request = get(state);
        const current = ++sequence;
        state.update((s) => ({ ...s, completedLoading: true, completedError: null }));
        try {
            const result = await load({
                page,
                pageSize: request.completedPageSize,
                sortBy: request.completedSortBy,
                sortAsc: request.completedSortAsc,
            });
            if (disposed || current !== sequence) return [];
            stale = false;
            state.update((s) => ({
                ...s,
                completedTasks: result.items,
                completedTotal: result.total,
                completedPage: result.page,
                completedPageSize: result.pageSize,
                completedHasMore: result.hasMore,
                completedLoading: false,
            }));
            return result.items;
        } catch (error) {
            if (!disposed && current === sequence)
                state.update((s) => ({
                    ...s,
                    completedLoading: false,
                    completedError: error instanceof Error ? error.message : String(error),
                }));
            return [];
        }
    }
    return {
        subscribe: state.subscribe,
        loadDoneTasks: () => loadPage(1),
        async toggleCompleted() {
            state.update((s) => ({ ...s, showCompleted: !s.showCompleted }));
            if (get(state).showCompleted && stale) await loadPage();
        },
        async setCompletedPage(page: number) {
            await loadPage(page);
        },
        async setCompletedSort(sortBy: string, sortAsc: boolean) {
            stale = true;
            state.update((s) => ({
                ...s,
                completedPage: 1,
                completedSortBy: sortBy,
                completedSortAsc: sortAsc,
                completedTasks: [],
            }));
            if (get(state).showCompleted) await loadPage();
        },
        async refresh() {
            stale = true;
            if (get(state).showCompleted) await loadPage();
        },
        dispose() {
            disposed = true;
            sequence++;
        },
    };
}
