import { TaskCacheEntry } from "../shared/types";
import { DEFAULT_PRIORITY_ENGINE, type PriorityEngineSettings } from "../shared/settings";

// === 运行时配置（可通过 updateSettings 更新）===
let config: PriorityEngineSettings = { ...DEFAULT_PRIORITY_ENGINE };

export function getPriorityConfig(): PriorityEngineSettings {
    return config;
}

export function updatePriorityConfig(newConfig: Partial<PriorityEngineSettings>): void {
    config = { ...config, ...newConfig };
}

const MS_PER_DAY = 86400000;

// === 截止日分数 ===
function calculateDueScore(dueDate: string): number {
    if (!dueDate) return config.noDueScore;

    let dueEnd: Date;
    if (dueDate.includes("T")) {
        // "YYYY-MM-DDTHH:mm" — exact time
        dueEnd = new Date(dueDate);
    } else {
        // "YYYY-MM-DD" — end of day
        dueEnd = new Date(dueDate);
        dueEnd.setHours(23, 59, 59, 999);
    }
    const diffDays = (dueEnd.getTime() - Date.now()) / MS_PER_DAY;

    if (diffDays <= 0) {
        return 100 + Math.min(config.overdueCap, Math.abs(diffDays) * config.overdueGrowth);
    }

    return config.overdueBase + (100 - config.overdueBase) * Math.exp(-diffDays / config.dueDecayTau);
}

// === 开始日期分数 ===
function calculateStartScore(startDate: string): number {
    if (!startDate) return 100;

    let startDay: Date;
    if (startDate.includes("T")) {
        // "YYYY-MM-DDTHH:mm" — exact time
        startDay = new Date(startDate);
    } else {
        // "YYYY-MM-DD" — start of day
        startDay = new Date(startDate);
        startDay.setHours(0, 0, 0, 0);
    }
    const diffDays = (startDay.getTime() - Date.now()) / MS_PER_DAY;

    if (diffDays <= 0) return 100;
    if (diffDays >= config.startHorizon) return config.minStartScore;

    const ratio = 1 - diffDays / config.startHorizon;
    return config.minStartScore + (100 - config.minStartScore) * ratio * ratio;
}

// === Effective Importance（合并 importance + priority）===
function getPriorityOffset(priority: string): number {
    switch (priority) {
        case "critical": return config.priorityOffsetCritical;
        case "high": return config.priorityOffsetHigh;
        case "medium": return config.priorityOffsetMedium;
        case "low": return config.priorityOffsetLow;
        case "none": return config.priorityOffsetNone;
        default: return 0;
    }
}

function calculateEffectiveImportance(importance: number, priority: string): number {
    const offset = getPriorityOffset(priority);
    return Math.max(0.5, Math.min(8.5, importance + offset));
}

// effectiveImportance 0.5-8.5, 中性=4
// 映射到分数: 0.5→10, 4→50, 8.5→90
function calculateImportanceScore(effectiveImportance: number): number {
    return 10 + (effectiveImportance - 0.5) / 8 * 80;
}

// === 努力惩罚（锚点在4，默认值中性）===
function calculateEffortPenalty(effort: number): number {
    return 1 + config.effortScale * (effort - 4);
}

export function calculateOrder(entry: TaskCacheEntry, cache?: Record<string, TaskCacheEntry>): number {
    // Someday and inbox tasks get minimal score so they sink to the bottom in comprehensive sort
    if (entry.status === "someday" || entry.status === "inbox") return 0;

    const dueScore = calculateDueScore(entry.due);
    const startScore = calculateStartScore(entry.start);
    const effectiveImp = calculateEffectiveImportance(entry.importance, entry.priority);
    const importanceScore = calculateImportanceScore(effectiveImp);
    const effortPenalty = calculateEffortPenalty(entry.effort);

    const baseScore = config.dueWeight * dueScore
        + config.startWeight * startScore
        + config.importanceWeight * importanceScore;

    const ownScore = baseScore / effortPenalty;

    if (entry.taskType === "2" && cache) {
        const maxChildOrder = entry.childIds
            .map(id => cache[id])
            .filter(c => c && c.status !== "done")
            .reduce((max, child) => Math.max(max, child.order), 0);
        return Math.max(ownScore, maxChildOrder);
    }

    return ownScore;
}

export function getBlockedReason(entry: TaskCacheEntry, cache: Record<string, TaskCacheEntry>): string {
    // 0. Inbox and someday tasks are considered blocked
    if (entry.status === "inbox") return "inbox";
    if (entry.status === "someday") return "someday";

    // 1. 子任务未完成
    const hasIncompleteChild = entry.childIds.some((id) => {
        const child = cache[id];
        return child && child.status !== "done";
    });
    if (hasIncompleteChild) return "children";

    // 2. 显式依赖
    if (entry.depends) {
        const depIds = entry.depends.split("|").filter(Boolean);
        const validDepIds: string[] = [];
        for (const depId of depIds) {
            if (!cache[depId]) {
                console.warn(`[NextAction] dependency references non-existent task: ${depId}`);
                continue;
            }
            validDepIds.push(depId);
        }
        if (validDepIds.length > 0) {
            if (entry.depMode === "any") {
                const allIncomplete = validDepIds.every(id => cache[id].status !== "done");
                if (allIncomplete) return "dependency";
            } else {
                const anyIncomplete = validDepIds.some(id => cache[id].status !== "done");
                if (anyIncomplete) return "dependency";
            }
        }
    }

    // 3. 顺序约束
    if (entry.parentId) {
        const parent = cache[entry.parentId];
        if (parent?.sequential) {
            const siblings = parent.childIds
                .map(id => cache[id])
                .filter(Boolean)
                .sort((a, b) => {
                    if (a.sort !== b.sort) return a.sort - b.sort;
                    return a.blockId.localeCompare(b.blockId);
                });
            const myIndex = siblings.findIndex(s => s.blockId === entry.blockId);
            if (myIndex > 0) {
                const hasIncompleteBefore = siblings.slice(0, myIndex).some(s => s.status !== "done");
                if (hasIncompleteBefore) return "sequential";
            }
        }
    }

    return "";
}

export function isBlocked(entry: TaskCacheEntry, cache: Record<string, TaskCacheEntry>): boolean {
    return getBlockedReason(entry, cache) !== "";
}

export function isNextActionCandidate(entry: TaskCacheEntry, cache: Record<string, TaskCacheEntry>): boolean {
    if (entry.status === "done") return false;
    if (entry.status === "waiting") return false;
    if (entry.status === "inbox") return false;
    if (entry.start) {
        // Extract the date portion and compare against today + previewDays
        const startDate = entry.start.slice(0, 10);
        const preview = config.startPreviewDays;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + preview);
        const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
        if (startDate > cutoffStr) return false;
    }
    if (entry.taskType === "2") return false;
    if (isBlocked(entry, cache)) return false;

    return true;
}

export function sortTasks(tasks: TaskCacheEntry[]): TaskCacheEntry[] {
    return tasks.sort((a, b) => {
        if (b.order !== a.order) return b.order - a.order;
        if (a.due && b.due) {
            if (a.due !== b.due) return a.due.localeCompare(b.due);
        } else if (a.due) {
            return -1;
        } else if (b.due) {
            return 1;
        }
        const aEffImp = calculateEffectiveImportance(a.importance, a.priority);
        const bEffImp = calculateEffectiveImportance(b.importance, b.priority);
        if (bEffImp !== aEffImp) return bEffImp - aEffImp;
        return a.blockId.localeCompare(b.blockId);
    });
}
