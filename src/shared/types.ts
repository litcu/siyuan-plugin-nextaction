export interface TaskCacheEntry {
    blockId: string;
    parentId: string;
    status: string;
    priority: string;
    importance: number;
    effort: number;
    due: string;
    start: string;
    context: string;
    taskType: string;
    order: number;
    childIds: string[];
    title: string;
    depends: string;        // na-depends 原始值
    depMode: string;        // na-dep-mode，默认 "all"
    sequential: boolean;    // na-sequential === "1"
    repeat: string;         // na-repeat 原始值
    sort: number;           // na-sort 转数字，默认 -1（表示未设置）
    completed: string;      // na-completed 原始值
    note: string;           // na-note 原始值
    created: string;        // na-created 原始值 (YYYY-MM-DDTHH:mm:ss)
    tags: string;           // na-tags 原始值（管道符分隔）
    blocked: boolean;       // 由内核 isBlocked 计算
    blockedReason: string;  // "" | "dependency" | "sequential"
    reviewInterval: number;      // 0 = 不回顾
    reviewDate: string;          // 空字符串 = 无，YYYY-MM-DD
    reminder: string;            // na-reminder 原始值，空字符串 = 使用全局默认，"[]" = 禁用
    customFields: Record<string, string>;  // 自定义字段值 {key: value}
}

export interface ReminderRelative {
    type: "relative";
    minutes: number;
}

export interface ReminderAbsolute {
    type: "absolute";
    time: string;       // "YYYY-MM-DDTHH:mm"
}

export type ReminderItem = ReminderRelative | ReminderAbsolute;

export interface ReminderSummaryData {
    overdue: number;        // 已逾期任务数
    dueToday: number;       // 今日到期任务数
    startingToday: number;  // 今日开始任务数（start date 为今天）
    nextAction: number;     // 下一步行动任务数
    waiting: number;        // 等待中任务数
}

export interface ReminderEntry {
    blockId: string;
    title: string;
    triggerTime: number;     // 实际触发时间戳（ms）
    type: "due" | "review" | "absolute" | "summary";  // 截止提醒 or 回顾提醒 or 固定时间提醒 or 汇总
    minutesBefore: number;   // 提前了多少分钟（review 类型固定为 0）
    baseDateStr: string;     // 触发基准日期字符串（due 的日期 or reviewDate）
    dueTime: number;         // 截止时间戳（ms），用于计算实际剩余/逾期
    dismissed: boolean;       // 用户是否已处理
    summary?: ReminderSummaryData;  // type=summary 时的统计数据
}

export interface DismissedRecord {
    [dedupKey: string]: number;  // 去重键 → dismissed 时间戳
}

export interface TaskChangeNotification {
    changedBlockIds: string[];
    changeTypes: Record<string, "create" | "update" | "delete">;
}

export interface StatisticsSummary {
    total: number;
    open: number;              // 未完成任务数（status ≠ done）
    nextAction: number;        // 下一步行动候选数
    someday: number;           // 将来/也许任务数
    overdue: number;           // 逾期未完成任务数（due < today 且 status ≠ done）
    completedInPeriod: number;
    completionRate: number;    // 完成率 0-100
}

export interface StatisticsDistribution {
    key: string;
    count: number;
    percent: number;
}

export interface StatisticsContextItem {
    context: string;
    count: number;
}

export interface StatisticsProjectStatus {
    status: string;      // "inbox" | "todo" | "doing" | "waiting" | "someday" | "done"
    count: number;
    percent: number;
}

export interface StatisticsResult {
    summary: StatisticsSummary;
    statusDistribution: StatisticsDistribution[];
    priorityDistribution: StatisticsDistribution[];
    contextDistribution: StatisticsContextItem[];
    projectStatus: StatisticsProjectStatus[];
}

export interface MyDayTaskEntry {
    blockId: string;
    addedAt: number;
    scheduleStart: number | null;
    scheduleEnd: number | null;
    order: number;
}

export interface MyDayState {
    schema: 1;
    dayKey: string;
    tasks: MyDayTaskEntry[];
    updatedAt: number;
}

export interface ReviewData {
    overdueTasks: TaskCacheEntry[];
    nextActions: TaskCacheEntry[];
    inboxTasks: TaskCacheEntry[];
    waitingTasks: TaskCacheEntry[];
    somedayTasks: TaskCacheEntry[];
    activeProjects: TaskCacheEntry[];
    reviewDueTasks: TaskCacheEntry[];
}

export type { PluginSettings, PriorityEngineSettings } from "./settings";
