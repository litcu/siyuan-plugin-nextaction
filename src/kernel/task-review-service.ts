import type { TaskCacheEntry, ReviewData } from "../shared/types";
import { ATTR_REVIEW_DATE } from "../shared/constants";
import { assertBlockId } from "../shared/block-id";
import { isNextActionCandidate } from "./priority-engine";
import { isTaskDueOverdue, isTaskReviewDue } from "../shared/review";
import type { CacheManager } from "./cache-manager";
import type { TaskRepository } from "./task-repository";
import type { TaskRuntimeState } from "./task-runtime-state";
import { addLocalDays } from "./task-date-utils";
import { buildProjectSummaries } from "../shared/project-domain";

export class TaskReviewService {
    constructor(
        private readonly cacheManager: CacheManager,
        private readonly repository: TaskRepository,
        private readonly runtime: TaskRuntimeState,
    ) {}

    getReviewData(): ReviewData {
        this.runtime.assertReady();
        const allEntries = this.cacheManager.getAll();
        const td = new Date();
        const todayStr = `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, "0")}-${String(td.getDate()).padStart(2, "0")}`;
        const cache = this.cacheManager.getCache();
        const projectSummaries = buildProjectSummaries(allEntries, {
            today: todayStr,
            startPreviewDays: this.runtime.getSettings().priorityEngine.startPreviewDays,
        });
        const activeProjectIds = new Set(
            projectSummaries
                .filter((summary) => summary.project.status !== "done" && (!summary.empty || summary.risks.length > 0))
                .map((summary) => summary.project.blockId),
        );

        const overdueTasks: TaskCacheEntry[] = [];
        const nextActions: TaskCacheEntry[] = [];
        const inboxTasks: TaskCacheEntry[] = [];
        const waitingTasks: TaskCacheEntry[] = [];
        const somedayTasks: TaskCacheEntry[] = [];
        const activeProjects: TaskCacheEntry[] = [];
        const reviewDueTasks: TaskCacheEntry[] = [];

        for (let i = 0; i < allEntries.length; i++) {
            const entry = allEntries[i];

            // 回顾到期
            if (isTaskReviewDue(entry, todayStr)) {
                reviewDueTasks.push(entry);
            }

            // 逾期
            if (isTaskDueOverdue(entry, todayStr)) {
                overdueTasks.push(entry);
            }

            // 下一步行动
            if (isNextActionCandidate(entry, cache)) {
                nextActions.push(entry);
            }

            // 等待中
            if (entry.status === "waiting") {
                waitingTasks.push(entry);
            }

            // 收集箱
            if (entry.status === "inbox") {
                inboxTasks.push(entry);
            }

            // 将来/也许
            if (entry.status === "someday") {
                somedayTasks.push(entry);
            }

            // 活跃项目
            if (activeProjectIds.has(entry.blockId)) {
                activeProjects.push(entry);
            }
        }

        return {
            lastReviewAt: this.runtime.getSettings().lastReviewAt,
            overdueTasks,
            nextActions,
            inboxTasks,
            waitingTasks,
            somedayTasks,
            activeProjects,
            reviewDueTasks,
        };
    }

    async markTaskReviewed(blockIds: string[]): Promise<TaskCacheEntry[]> {
        this.runtime.assertReady();
        if (!blockIds || blockIds.length === 0) return [];
        blockIds = blockIds.map((blockId, index) => assertBlockId(blockId, `blockIds[${index}]`));

        return this.repository.withConfirmedChanges(async (changes) => {
            const results: TaskCacheEntry[] = [];
            const td4 = new Date();
            const today = `${td4.getFullYear()}-${String(td4.getMonth() + 1).padStart(2, "0")}-${String(td4.getDate()).padStart(2, "0")}`;

            for (const blockId of blockIds) {
                const entry = this.cacheManager.get(blockId);
                if (!entry || entry.reviewInterval <= 0) continue;

                const nextReviewDate = addLocalDays(today, entry.reviewInterval);
                const updated = await changes.upsertAttrs({
                    blockId,
                    attrs: { [ATTR_REVIEW_DATE]: nextReviewDate },
                    existing: entry,
                });
                results.push(updated);
            }

            return results;
        });
    }
}
