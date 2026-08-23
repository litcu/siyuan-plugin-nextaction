import type { TaskCacheEntry, StatisticsResult, ReviewData, CompletedTasksPage, MyDayState } from "../shared/types";
import type { CompletedTasksPageOptions } from "../shared/task-pagination";
import type { PluginSettings } from "../shared/settings";
import type { CacheManager } from "./cache-manager";
import type { SiyuanApiPort } from "./siyuan-api";
import type { TaskRepository } from "./task-repository";
import { TaskRuntimeState } from "./task-runtime-state";
import { TaskQueryService } from "./task-query-service";
import { TaskCustomFieldService } from "./task-custom-field-service";
import { TaskReviewService } from "./task-review-service";
import { TaskRelationshipService } from "./task-relationship-service";
import { RepeatTaskService } from "./repeat-task-service";
import { TaskLifecycleService, type ConvertToTaskOptions, type MyDayTaskPort } from "./task-lifecycle-service";
import { TaskIdentityResolver } from "./task-identity-resolver";

export type { ConvertToTaskOptions, MyDayTaskPort } from "./task-lifecycle-service";

/** Stable task application facade used by RPC, AI, and MCP callers. */
export class TaskService {
    private readonly lifecycle: TaskLifecycleService;
    private readonly runtime: TaskRuntimeState;
    private readonly query: TaskQueryService;
    private readonly customFields: TaskCustomFieldService;
    private readonly review: TaskReviewService;
    private readonly relationships: TaskRelationshipService;
    private readonly repeat: RepeatTaskService;

    constructor(
        cacheManager: CacheManager,
        repository: TaskRepository,
        myDayManager: MyDayTaskPort,
        api: SiyuanApiPort,
        identities = new TaskIdentityResolver(api),
    ) {
        this.runtime = new TaskRuntimeState(repository, myDayManager);
        this.query = new TaskQueryService(cacheManager, this.runtime);
        this.customFields = new TaskCustomFieldService(cacheManager, repository, this.runtime);
        this.review = new TaskReviewService(cacheManager, repository, this.runtime);
        this.relationships = new TaskRelationshipService(cacheManager, repository, api, this.runtime, identities);
        this.repeat = new RepeatTaskService(cacheManager, repository, myDayManager, api, this.runtime);
        this.lifecycle = new TaskLifecycleService(
            cacheManager,
            repository,
            myDayManager,
            api,
            this.runtime,
            this.customFields,
            this.relationships,
            identities,
        );
    }

    setIsReady(value: boolean): void {
        this.runtime.setReady(value);
    }
    assertReady(): void {
        this.runtime.assertReady();
    }
    convertToTask(
        blockId: string,
        cleanTitle?: string,
        taskType = "1",
        options: ConvertToTaskOptions = {},
    ): Promise<TaskCacheEntry> {
        return this.lifecycle.convertToTask(blockId, cleanTitle, taskType, options);
    }
    convertToTaskWithChildren(
        blockId: string,
        cleanTitle?: string,
        taskType = "1",
    ): Promise<{ converted: number; skipped: number }> {
        return this.lifecycle.convertToTaskWithChildren(blockId, cleanTitle, taskType);
    }
    removeTask(blockId: string): Promise<void> {
        return this.lifecycle.removeTask(blockId);
    }
    updateTask(blockId: string, attrs: Record<string, string>): Promise<TaskCacheEntry> {
        return this.lifecycle.updateTask(blockId, attrs);
    }
    updateTaskTitle(blockId: string, title: string): Promise<TaskCacheEntry> {
        return this.lifecycle.updateTaskTitle(blockId, title);
    }
    setRepeatRule(blockId: string, rule: unknown): Promise<TaskCacheEntry> {
        return this.repeat.setRepeatRule(blockId, rule);
    }
    skipRepeatOccurrence(blockId: string): Promise<TaskCacheEntry> {
        return this.repeat.skipRepeatOccurrence(blockId);
    }
    setRepeatPaused(blockId: string, paused: boolean): Promise<TaskCacheEntry> {
        return this.repeat.setRepeatPaused(blockId, paused);
    }
    recalcAllOrders(): Promise<void> {
        return this.relationships.recalcAllOrders();
    }
    rebuildParentRelationships(): Promise<number> {
        return this.relationships.rebuildParentRelationships();
    }
    reorderTask(blockId: string, parentId?: string, afterId?: string): Promise<TaskCacheEntry> {
        return this.relationships.reorderTask(blockId, parentId, afterId);
    }
    getTask(blockId: string): TaskCacheEntry | null {
        return this.query.getTask(blockId);
    }
    getNextActions(): TaskCacheEntry[] {
        return this.query.getNextActions();
    }
    getAllTasks(filters?: { status?: string; sortBy?: string }): TaskCacheEntry[] {
        return this.query.getAllTasks(filters);
    }
    getCompletedTasksPage(options: CompletedTasksPageOptions = {}): CompletedTasksPage {
        return this.query.getCompletedTasksPage(options);
    }
    getTasksByParent(parentBlockId: string): TaskCacheEntry[] {
        return this.query.getTasksByParent(parentBlockId);
    }
    getDoneTaskCount(): number {
        return this.query.getDoneTaskCount();
    }
    getProjectReminders(): TaskCacheEntry[] {
        return this.query.getProjectReminders();
    }
    rebuildCache(): Promise<void> {
        return this.lifecycle.rebuildCache();
    }
    loadCache(): Promise<void> {
        return this.lifecycle.loadCache();
    }
    getContexts(): string[] {
        return this.query.getContexts();
    }
    getTags(): string[] {
        return this.query.getTags();
    }
    updateSettings(settings: Partial<PluginSettings>): PluginSettings {
        return this.runtime.updateSettings(settings);
    }
    getSettings(): PluginSettings {
        return this.runtime.getSettings();
    }
    getCustomFieldDiagnostics(): {
        fields: Array<{ fieldId: string; key: string; status: string; count: number }>;
        orphans: Array<{ key: string; count: number; sampleBlockIds: string[] }>;
    } {
        return this.customFields.getCustomFieldDiagnostics();
    }
    purgeCustomField(fieldId: string): Promise<{ cleared: number; failedBlockIds: string[] }> {
        return this.customFields.purgeCustomField(fieldId);
    }
    purgeOrphanCustomField(key: string): Promise<{ cleared: number; failedBlockIds: string[] }> {
        return this.customFields.purgeOrphanCustomField(key);
    }
    getStatistics(period: "week" | "month" = "week"): StatisticsResult {
        return this.query.getStatistics(period);
    }
    getReviewData(): ReviewData {
        return this.review.getReviewData();
    }
    markTaskReviewed(blockIds: string[]): Promise<TaskCacheEntry[]> {
        return this.review.markTaskReviewed(blockIds);
    }
    getMyDay(): Promise<MyDayState> {
        return this.lifecycle.getMyDay();
    }
    addTaskToMyDay(blockId: string): Promise<MyDayState> {
        return this.lifecycle.addTaskToMyDay(blockId);
    }
    removeTaskFromMyDay(blockId: string): Promise<MyDayState> {
        return this.lifecycle.removeTaskFromMyDay(blockId);
    }
    reorderMyDayTask(blockId: string, afterId?: string): Promise<MyDayState> {
        return this.lifecycle.reorderMyDayTask(blockId, afterId);
    }
    setMyDaySchedule(blockId: string, start: number | null, end: number | null): Promise<MyDayState> {
        return this.lifecycle.setMyDaySchedule(blockId, start, end);
    }
    removeMyDaySchedule(blockId: string): Promise<MyDayState> {
        return this.lifecycle.removeMyDaySchedule(blockId);
    }
}
