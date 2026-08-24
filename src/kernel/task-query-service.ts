import type { TaskCacheEntry, StatisticsResult, StatisticsSummary, CompletedTasksPage } from "../shared/types";
import { paginateCompletedTasks, type CompletedTasksPageOptions } from "../shared/task-pagination";
import { assertBlockId } from "../shared/block-id";
import { isNextActionCandidate, sortTasks } from "./priority-engine";
import { isTaskDueOverdue } from "../shared/review";
import type { CacheManager } from "./cache-manager";
import type { TaskRuntimeState } from "./task-runtime-state";
import { buildProjectSummaries } from "../shared/project-domain";

export class TaskQueryService {
    constructor(
        private readonly cacheManager: CacheManager,
        private readonly runtime: TaskRuntimeState,
    ) {}

    // ---- Read operations ----

    getTask(blockId: string): TaskCacheEntry | null {
        blockId = assertBlockId(blockId);
        const entry = this.cacheManager.get(blockId);
        return entry || null;
    }

    getNextActions(): TaskCacheEntry[] {
        const allEntries = this.cacheManager.getAll();

        const cacheRecord: Record<string, TaskCacheEntry> = Object.create(null) as Record<string, TaskCacheEntry>;
        for (let i = 0; i < allEntries.length; i++) {
            cacheRecord[allEntries[i].blockId] = allEntries[i];
        }

        const candidates: TaskCacheEntry[] = [];
        for (let i = 0; i < allEntries.length; i++) {
            const entry = allEntries[i];
            if (!isNextActionCandidate(entry, cacheRecord)) continue;
            candidates.push(entry);
        }

        return sortTasks(candidates);
    }

    getAllTasks(filters?: { status?: string; sortBy?: string }): TaskCacheEntry[] {
        let entries = this.cacheManager.getAll();

        if (filters) {
            if (filters.status) {
                entries = entries.filter((e) => e.status === filters.status);
            }
        }

        // Sort
        if (filters && filters.sortBy) {
            switch (filters.sortBy) {
                case "order":
                    entries = sortTasks(entries);
                    break;
                case "due":
                    entries.sort((a, b) => {
                        if (!a.due && !b.due) return 0;
                        if (!a.due) return 1;
                        if (!b.due) return -1;
                        return a.due.localeCompare(b.due);
                    });
                    break;
                case "importance":
                    entries.sort((a, b) => b.importance - a.importance);
                    break;
                case "priority":
                    entries.sort((a, b) => {
                        const pw = [5, 4, 3, 2, 1];
                        const priorityOrder = ["critical", "high", "medium", "low", "veryLow"];
                        const aPriority = a.priority === "none" ? "veryLow" : a.priority;
                        const bPriority = b.priority === "none" ? "veryLow" : b.priority;
                        const aIdx = priorityOrder.indexOf(aPriority);
                        const bIdx = priorityOrder.indexOf(bPriority);
                        return (pw[bIdx] || 0) - (pw[aIdx] || 0);
                    });
                    break;
                default:
                    entries = sortTasks(entries);
            }
        } else {
            entries = sortTasks(entries);
        }

        return entries;
    }

    getCompletedTasksPage(options: CompletedTasksPageOptions = {}): CompletedTasksPage {
        return paginateCompletedTasks(this.cacheManager.getAll(), options);
    }

    getTasksByParent(parentBlockId: string): TaskCacheEntry[] {
        parentBlockId = assertBlockId(parentBlockId, "parentBlockId");
        return this.cacheManager.getByParent(parentBlockId);
    }

    getDoneTaskCount(): number {
        return this.cacheManager.getAll().filter((e) => e.status === "done").length;
    }

    getProjectReminders(): TaskCacheEntry[] {
        this.runtime.assertReady();
        const all = this.cacheManager.getAll();
        return buildProjectSummaries(all, {
            startPreviewDays: this.runtime.getSettings().priorityEngine.startPreviewDays,
        })
            .filter((summary) => summary.completionCandidate)
            .map((summary) => summary.project);
    }

    getContexts(): string[] {
        const allEntries = this.cacheManager.getAll();
        const contextSet: Record<string, boolean> = Object.create(null) as Record<string, boolean>;

        for (let i = 0; i < allEntries.length; i++) {
            const entry = allEntries[i];
            if (entry.context) {
                const parts = entry.context.split("|");
                for (let j = 0; j < parts.length; j++) {
                    const ctx = parts[j].trim();
                    if (ctx) {
                        contextSet[ctx] = true;
                    }
                }
            }
        }

        return Object.keys(contextSet);
    }

    getTags(): string[] {
        const allEntries = this.cacheManager.getAll();
        const tagSet: Record<string, boolean> = Object.create(null) as Record<string, boolean>;

        for (let i = 0; i < allEntries.length; i++) {
            const entry = allEntries[i];
            if (entry.tags) {
                const parts = entry.tags.split("|");
                for (let j = 0; j < parts.length; j++) {
                    const tag = parts[j].trim();
                    if (tag) {
                        tagSet[tag] = true;
                    }
                }
            }
        }

        return Object.keys(tagSet);
    }

    getStatistics(period: "week" | "month" = "week"): StatisticsResult {
        const allEntries = this.cacheManager.getAll();
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

        // === Summary ===
        const tasks = allEntries.filter((e) => e.taskType !== "2");
        const total = tasks.length;
        const open = tasks.filter((e) => e.status !== "done").length;

        // 逾期未完成：有截止日且截止日 < 今天且未完成
        const overdue = tasks.filter((e) => isTaskDueOverdue(e, todayStr)).length;

        const doneCount = total - open;

        // 当前周期边界
        const periodStart = this.getPeriodStart(today, period);
        const periodEnd = this.getPeriodEnd(today, period);

        // 统计本周/月内完成的任务数：优先用 na-completed 时间戳，
        // 仅统计 status=done 的任务，避免历史完成记录干扰
        let completedInPeriod = 0;
        for (let i = 0; i < tasks.length; i++) {
            if (tasks[i].status !== "done") continue;
            const times = this.parseCompletedTimes(tasks[i].completed);
            const hasTimeInPeriod = times.some((t) => t >= periodStart && t <= periodEnd);
            if (hasTimeInPeriod) {
                completedInPeriod++;
            }
        }

        const completionRate = total > 0 ? Math.round((doneCount / total) * 100) : 0;

        // 下一步行动候选数 & 将来/也许任务数
        const nextAction = tasks.filter((e) => isNextActionCandidate(e, this.cacheManager.getCache())).length;
        const someday = tasks.filter((e) => e.status === "someday").length;

        const summary: StatisticsSummary = {
            total,
            open,
            nextAction,
            someday,
            overdue,
            completedInPeriod,
            completionRate,
        };

        // === Status Distribution ===
        const statusCounts: Record<string, number> = Object.create(null) as Record<string, number>;
        const statusOrder = ["inbox", "todo", "doing", "waiting", "someday", "done"];
        for (let i = 0; i < statusOrder.length; i++) statusCounts[statusOrder[i]] = 0;
        for (let i = 0; i < tasks.length; i++) {
            const s = tasks[i].status;
            if (statusCounts[s] !== undefined) statusCounts[s]++;
            else statusCounts[s] = 1;
        }
        const statusDistribution = statusOrder.map((s) => ({
            key: s,
            count: statusCounts[s] || 0,
            percent: total > 0 ? Math.round(((statusCounts[s] || 0) / total) * 100) / 100 : 0,
        }));

        // === Priority Distribution ===
        const priorityOrder = ["critical", "high", "medium", "low", "veryLow"];
        const priorityCounts: Record<string, number> = Object.create(null) as Record<string, number>;
        for (let i = 0; i < priorityOrder.length; i++) priorityCounts[priorityOrder[i]] = 0;
        for (let i = 0; i < tasks.length; i++) {
            const p = tasks[i].priority === "none" ? "veryLow" : tasks[i].priority;
            if (priorityCounts[p] !== undefined) priorityCounts[p]++;
            else priorityCounts[p] = 1;
        }
        const priorityDistribution = priorityOrder.map((p) => ({
            key: p,
            count: priorityCounts[p] || 0,
            percent: total > 0 ? Math.round(((priorityCounts[p] || 0) / total) * 100) / 100 : 0,
        }));

        // === Context Distribution ===
        const contextCounts: Record<string, number> = Object.create(null) as Record<string, number>;
        for (let i = 0; i < tasks.length; i++) {
            const ctx = tasks[i].context;
            if (!ctx) continue;
            const parts = ctx.split("|");
            for (let j = 0; j < parts.length; j++) {
                const c = parts[j].trim();
                if (c) {
                    if (contextCounts[c] !== undefined) contextCounts[c]++;
                    else contextCounts[c] = 1;
                }
            }
        }
        const contextDistribution = Object.keys(contextCounts)
            .map((c) => ({ context: c, count: contextCounts[c] }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8);

        // === Project Status Distribution ===
        const projectStatusCounts: Record<string, number> = Object.create(null) as Record<string, number>;
        const projectStatusOrder = ["inbox", "todo", "doing", "waiting", "done"];
        for (let i = 0; i < projectStatusOrder.length; i++) projectStatusCounts[projectStatusOrder[i]] = 0;
        let projectTotal = 0;
        for (let i = 0; i < allEntries.length; i++) {
            const entry = allEntries[i];
            if (entry.taskType !== "2") continue;
            projectTotal++;
            const s = entry.status;
            if (projectStatusCounts[s] !== undefined) projectStatusCounts[s]++;
            else projectStatusCounts[s] = 1;
        }
        const projectStatus = projectStatusOrder.map((s) => ({
            status: s,
            count: projectStatusCounts[s] || 0,
            percent: projectTotal > 0 ? Math.round(((projectStatusCounts[s] || 0) / projectTotal) * 100) / 100 : 0,
        }));

        return {
            summary,
            statusDistribution,
            priorityDistribution,
            contextDistribution,
            projectStatus,
        };
    }

    private parseCompletedTimes(completed: string): string[] {
        if (!completed) return [];
        const parts = completed.split("|");
        const valid: string[] = [];
        for (let i = 0; i < parts.length; i++) {
            const t = parts[i].trim();
            if (t && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(t)) {
                valid.push(t);
            }
        }
        return valid;
    }

    private getPeriodStart(date: Date, period: "week" | "month"): string {
        if (period === "week") {
            const d = new Date(date);
            const day = d.getUTCDay();
            const diff = day === 0 ? 6 : day - 1;
            d.setUTCDate(d.getUTCDate() - diff);
            d.setUTCHours(0, 0, 0, 0);
            return d.toISOString().slice(0, 19);
        } else {
            return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00`;
        }
    }

    private getPeriodEnd(date: Date, period: "week" | "month"): string {
        if (period === "week") {
            const d = new Date(date);
            const day = d.getUTCDay();
            const diff = day === 0 ? 0 : 7 - day;
            d.setUTCDate(d.getUTCDate() + diff);
            d.setUTCHours(23, 59, 59, 0);
            return d.toISOString().slice(0, 19);
        } else {
            const year = date.getUTCFullYear();
            const month = date.getUTCMonth();
            const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
            return `${year}-${String(month + 1).padStart(2, "0")}-${lastDay}T23:59:59`;
        }
    }
}
