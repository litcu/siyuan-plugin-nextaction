# 统计功能实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 NextAction 插件新增统计 Tab，展示任务系统的完成率、逾期率、分布、项目进度和完成趋势。同时新增 na-completed（自动完成时间记录）和 na-note（任务备注）两个属性。

**架构：** 内核侧新增 `getStatistics` RPC，遍历内存缓存实时计算结构化统计结果。前端侧新增 `StatisticsView.svelte` 组件，含核心指标卡片、横条分布图、项目进度列表和 SVG 折线趋势图。na-completed 在 `updateTask` 中自动追加写入，na-note 通过 TaskDetail 防抖保存。

**技术栈：** TypeScript（内核 goja + 前端 Vite）、Svelte、内联 SVG、思源自定义属性

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/shared/constants.ts` | 修改 | 新增 ATTR_COMPLETED、ATTR_NOTE 常量 |
| `src/shared/types.ts` | 修改 | TaskCacheEntry 新增 completed、note 字段；新增 StatisticsResult 接口 |
| `src/kernel/cache-manager.ts` | 修改 | loadAll 中读取新属性 |
| `src/kernel/task-service.ts` | 修改 | buildEntryFromAttrs 读取新属性；updateTask 自动追加完成时间；removeTask 清除新属性；新增 getStatistics 方法 |
| `src/kernel/sync-engine.ts` | 修改 | buildEntryFromAttrs 读取新属性 |
| `src/kernel/rpc-server.ts` | 修改 | 注册 getStatistics RPC |
| `src/frontend/kernel-bridge.ts` | 修改 | 新增 getStatistics 方法 |
| `src/frontend/constants.ts` | 修改 | 新增 VIEW_STATISTICS 常量 |
| `src/frontend/components/StatisticsView.svelte` | 创建 | 统计 Tab 根组件 |
| `src/frontend/components/NextActionApp.svelte` | 修改 | 集成统计 Tab 和 StatisticsView |
| `src/frontend/components/NavRail.svelte` | 修改 | 新增统计导航按钮 |
| `src/frontend/components/TaskDetail.svelte` | 修改 | 新增备注 textarea 字段 |
| `src/i18n/zh-CN.json` | 修改 | 新增统计相关 i18n 键值 |
| `src/i18n/en.json` | 修改 | 新增统计相关 i18n 键值 |
| `src/index.scss` | 修改 | 新增统计面板样式 |

---

### 任务 1：内核数据模型 — 新增属性常量和类型

**文件：**
- 修改：`src/shared/constants.ts:38`（ATTR_SORT 之后）
- 修改：`src/shared/types.ts:1-22`

- [ ] **步骤 1：在 constants.ts 中新增两个属性常量**

在 `ATTR_SORT` 之后添加：

```typescript
export const ATTR_COMPLETED = "custom-na-completed";
export const ATTR_NOTE = "custom-na-note";
```

- [ ] **步骤 2：在 types.ts 中扩展 TaskCacheEntry**

在 `sort` 字段之后、`blocked` 字段之前添加：

```typescript
completed: string;   // na-completed 原始值
note: string;        // na-note 原始值
```

在 `types.ts` 文件末尾添加 StatisticsResult 接口（用于前端和内核共享类型）：

```typescript
export interface StatisticsSummary {
    total: number;
    done: number;
    doneRate: number;
    overdue: number;
    overdueRate: number;
    completedInPeriod: number;
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

export interface StatisticsProjectItem {
    blockId: string;
    title: string;
    done: number;
    total: number;
    percent: number;
}

export interface StatisticsTrendItem {
    label: string;
    count: number;
}

export interface StatisticsResult {
    summary: StatisticsSummary;
    statusDistribution: StatisticsDistribution[];
    priorityDistribution: StatisticsDistribution[];
    contextDistribution: StatisticsContextItem[];
    projectProgress: StatisticsProjectItem[];
    trend: StatisticsTrendItem[];
}
```

- [ ] **步骤 3：构建验证**

运行：`pnpm run build`

预期：编译通过，无类型错误

- [ ] **步骤 4：Commit**

```bash
git add src/shared/constants.ts src/shared/types.ts
git commit -m "feat: add na-completed/na-note attributes and StatisticsResult types"
```

---

### 任务 2：内核缓存 — 读取新属性

**文件：**
- 修改：`src/kernel/cache-manager.ts:1,63-84`
- 修改：`src/kernel/task-service.ts:1-27,923-955`
- 修改：`src/kernel/sync-engine.ts:1-22,206-252`

- [ ] **步骤 1：更新 cache-manager.ts 的 import 和 loadAll**

在文件顶部 import 中添加 `ATTR_COMPLETED`, `ATTR_NOTE`：

```typescript
import { ATTR_PARENT, ATTR_STATUS, ATTR_PRIORITY, ATTR_DUE, ATTR_START, ATTR_CONTEXT, ATTR_TASK, ATTR_EFFORT, ATTR_IMPORTANCE, ATTR_DEPENDS, ATTR_DEP_MODE, ATTR_SEQUENTIAL, ATTR_REPEAT, ATTR_SORT, ATTR_COMPLETED, ATTR_NOTE, DEFAULT_IMPORTANCE, DEFAULT_EFFORT } from "../shared/constants";
```

在 `loadAll` 方法中构建 entry 对象时（约第 63-84 行），在 `sort` 之后、`blocked` 之前添加：

```typescript
completed: attrs[ATTR_COMPLETED] || "",
note: attrs[ATTR_NOTE] || "",
```

- [ ] **步骤 2：更新 task-service.ts 的 import 和 buildEntryFromAttrs**

在文件顶部 import 中添加 `ATTR_COMPLETED`, `ATTR_NOTE`：

```typescript
import {
    ATTR_TASK,
    ATTR_STATUS,
    ATTR_PRIORITY,
    ATTR_IMPORTANCE,
    ATTR_EFFORT,
    ATTR_DUE,
    ATTR_START,
    ATTR_CONTEXT,
    ATTR_PARENT,
    ATTR_DEPENDS,
    ATTR_DEP_MODE,
    ATTR_SEQUENTIAL,
    ATTR_REPEAT,
    ATTR_SORT,
    ATTR_COMPLETED,
    ATTR_NOTE,
    // ... 其余不变
} from "../shared/constants";
```

在 `buildEntryFromAttrs` 方法中（约第 923-955 行），在 `sort` 之后、`blocked` 之前添加：

```typescript
completed: attrs[ATTR_COMPLETED] || "",
note: attrs[ATTR_NOTE] || "",
```

- [ ] **步骤 3：更新 sync-engine.ts 的 import 和 buildEntryFromAttrs**

在文件顶部 import 中添加 `ATTR_COMPLETED`, `ATTR_NOTE`：

```typescript
import {
    // ... 现有 import
    ATTR_COMPLETED,
    ATTR_NOTE,
    // ...
} from "../shared/constants";
```

在 `buildEntryFromAttrs` 方法中（约第 206-252 行），在 `sort` 之后、`blocked` 之前添加：

```typescript
completed: attrs[ATTR_COMPLETED] || "",
note: attrs[ATTR_NOTE] || "",
```

- [ ] **步骤 4：构建验证**

运行：`pnpm run build`

预期：编译通过

- [ ] **步骤 5：Commit**

```bash
git add src/kernel/cache-manager.ts src/kernel/task-service.ts src/kernel/sync-engine.ts
git commit -m "feat: read na-completed and na-note in cache/task-service/sync-engine"
```

---

### 任务 3：内核逻辑 — updateTask 自动追加完成时间 + removeTask 清除

**文件：**
- 修改：`src/kernel/task-service.ts:254-268,360-462`

- [ ] **步骤 1：在 updateTask 中自动追加 na-completed**

在 `updateTask` 方法中，`await siyuanFetch("/api/attr/setBlockAttrs", { id: blockId, attrs: attrs })` 之后（约第 382 行）、重新获取 fullAttrs 之前，插入完成时间追加逻辑：

```typescript
// 自动追加完成时间：status 变为 done 时
if (attrs[ATTR_STATUS] === "done") {
    const existingCompleted = existing?.completed || "";
    const now = new Date().toISOString().slice(0, 19); // YYYY-MM-DDTHH:mm:ss UTC
    const newCompleted = existingCompleted ? existingCompleted + "|" + now : now;
    await siyuanFetch("/api/attr/setBlockAttrs", {
        id: blockId,
        attrs: { [ATTR_COMPLETED]: newCompleted },
    });
}
```

注意：这段代码必须在 `setBlockAttrs` 写入用户提交的 attrs 之后、`getBlockAttrs` 重新获取之前执行，这样 finalAttrs 会包含最新的 na-completed 值。

- [ ] **步骤 2：在 removeTask 中清除新属性**

在 `removeTask` 方法的 clearAttrs 对象中（约第 254-268 行），在 `ATTR_SORT` 之后添加：

```typescript
clearAttrs[ATTR_COMPLETED] = "";
clearAttrs[ATTR_NOTE] = "";
```

- [ ] **步骤 3：构建验证**

运行：`pnpm run build`

预期：编译通过

- [ ] **步骤 4：Commit**

```bash
git add src/kernel/task-service.ts
git commit -m "feat: auto-append completion time on done; clear na-completed/na-note on remove"
```

---

### 任务 4：内核逻辑 — getStatistics 方法

**文件：**
- 修改：`src/kernel/task-service.ts`（新增方法）

- [ ] **步骤 1：在 TaskService 中实现 getStatistics 方法**

在 `getContexts` 方法之后、`detectDependencyCycle` 之前添加：

```typescript
getStatistics(period: "week" | "month" = "week"): StatisticsResult {
    const allEntries = this.cacheManager.getAll();
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    // === Summary ===
    const total = allEntries.length;
    const done = allEntries.filter(e => e.status === "done").length;
    const doneRate = total > 0 ? Math.round((done / total) * 100) / 100 : 0;

    const notDoneWithDue = allEntries.filter(e => e.status !== "done" && e.due !== "");
    const overdue = notDoneWithDue.filter(e => e.due < todayStr).length;
    const overdueRate = notDoneWithDue.length > 0 ? Math.round((overdue / notDoneWithDue.length) * 100) / 100 : 0;

    // 当前周期边界
    const periodStart = this.getPeriodStart(today, period);
    const periodEnd = this.getPeriodEnd(today, period);

    // 统计 na-completed 中落在当前周期的条目数
    let completedInPeriod = 0;
    for (let i = 0; i < allEntries.length; i++) {
        const times = this.parseCompletedTimes(allEntries[i].completed);
        for (let j = 0; j < times.length; j++) {
            if (times[j] >= periodStart && times[j] <= periodEnd) {
                completedInPeriod++;
            }
        }
    }

    const summary: StatisticsSummary = { total, done, doneRate, overdue, overdueRate, completedInPeriod };

    // === Status Distribution ===
    const statusCounts: Record<string, number> = Object.create(null) as Record<string, number>;
    const statusOrder = ["todo", "doing", "waiting", "done"];
    for (let i = 0; i < statusOrder.length; i++) statusCounts[statusOrder[i]] = 0;
    for (let i = 0; i < allEntries.length; i++) {
        const s = allEntries[i].status;
        if (statusCounts[s] !== undefined) statusCounts[s]++;
        else statusCounts[s] = 1;
    }
    const statusDistribution = statusOrder.map(s => ({
        key: s,
        count: statusCounts[s] || 0,
        percent: total > 0 ? Math.round(((statusCounts[s] || 0) / total) * 100) / 100 : 0,
    }));

    // === Priority Distribution ===
    const priorityOrder = ["critical", "high", "medium", "low", "none"];
    const priorityCounts: Record<string, number> = Object.create(null) as Record<string, number>;
    for (let i = 0; i < priorityOrder.length; i++) priorityCounts[priorityOrder[i]] = 0;
    for (let i = 0; i < allEntries.length; i++) {
        const p = allEntries[i].priority;
        if (priorityCounts[p] !== undefined) priorityCounts[p]++;
        else priorityCounts[p] = 1;
    }
    const priorityDistribution = priorityOrder.map(p => ({
        key: p,
        count: priorityCounts[p] || 0,
        percent: total > 0 ? Math.round(((priorityCounts[p] || 0) / total) * 100) / 100 : 0,
    }));

    // === Context Distribution ===
    const contextCounts: Record<string, number> = Object.create(null) as Record<string, number>;
    for (let i = 0; i < allEntries.length; i++) {
        const ctx = allEntries[i].context;
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
        .map(c => ({ context: c, count: contextCounts[c] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

    // === Project Progress ===
    const projectProgress: StatisticsProjectItem[] = [];
    for (let i = 0; i < allEntries.length; i++) {
        const entry = allEntries[i];
        if (entry.taskType !== "2" || entry.childIds.length === 0) continue;
        let projDone = 0;
        for (let j = 0; j < entry.childIds.length; j++) {
            const child = this.cacheManager.get(entry.childIds[j]);
            if (child && child.status === "done") projDone++;
        }
        const projTotal = entry.childIds.length;
        projectProgress.push({
            blockId: entry.blockId,
            title: entry.title,
            done: projDone,
            total: projTotal,
            percent: Math.round((projDone / projTotal) * 100) / 100,
        });
    }
    projectProgress.sort((a, b) => a.percent - b.percent);

    // === Trend (last 8 periods) ===
    const trend: StatisticsTrendItem[] = [];
    for (let i = 7; i >= 0; i--) {
        const periodDate = this.subtractPeriods(today, period, i);
        const start = this.getPeriodStart(periodDate, period);
        const end = this.getPeriodEnd(periodDate, period);
        let count = 0;
        for (let j = 0; j < allEntries.length; j++) {
            const times = this.parseCompletedTimes(allEntries[j].completed);
            for (let k = 0; k < times.length; k++) {
                if (times[k] >= start && times[k] <= end) count++;
            }
        }
        const label = period === "week"
            ? `${periodDate.getUTCMonth() + 1}/${periodDate.getUTCDate()}`
            : `${periodDate.getUTCMonth() + 1}月`;
        trend.push({ label, count });
    }

    return {
        summary,
        statusDistribution,
        priorityDistribution,
        contextDistribution,
        projectProgress,
        trend,
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
        const diff = day === 0 ? 6 : day - 1; // Monday = 0
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
        const diff = day === 0 ? 0 : 7 - day; // Sunday
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

private subtractPeriods(date: Date, period: "week" | "month", count: number): Date {
    const d = new Date(date);
    if (period === "week") {
        d.setUTCDate(d.getUTCDate() - count * 7);
    } else {
        d.setUTCMonth(d.getUTCMonth() - count);
    }
    return d;
}
```

同时在文件顶部 import 中添加 `StatisticsResult` 等类型：

```typescript
import { TaskCacheEntry, StatisticsResult, StatisticsSummary, StatisticsDistribution, StatisticsContextItem, StatisticsProjectItem, StatisticsTrendItem } from "../shared/types";
```

- [ ] **步骤 2：在 rpc-server.ts 中注册 getStatistics**

在 `reorderTask` 绑定之后添加：

```typescript
siyuan.rpc.bind("getStatistics", async (...params: any[]) => {
    const p = params[0] || {};
    try {
        return taskService.getStatistics(p.period || "week");
    } catch (e: any) {
        return errorToRpcError(e);
    }
});
```

- [ ] **步骤 3：在 kernel-bridge.ts 中新增 getStatistics 方法**

在 `convertToProject` 方法之后添加：

```typescript
async getStatistics(period: "week" | "month" = "week"): Promise<StatisticsResult> {
    return this.call("getStatistics", { period });
}
```

同时在文件顶部 import 中添加 `StatisticsResult`：

```typescript
import type { TaskCacheEntry, TaskChangeNotification, StatisticsResult } from "../shared/types";
```

- [ ] **步骤 4：构建验证**

运行：`pnpm run build`

预期：编译通过

- [ ] **步骤 5：Commit**

```bash
git add src/kernel/task-service.ts src/kernel/rpc-server.ts src/frontend/kernel-bridge.ts
git commit -m "feat: add getStatistics RPC with period-based trend calculation"
```

---

### 任务 5：前端基础 — 新增视图常量和 i18n

**文件：**
- 修改：`src/frontend/constants.ts:20-21`
- 修改：`src/i18n/zh-CN.json`
- 修改：`src/i18n/en.json`

- [ ] **步骤 1：在 constants.ts 中新增 VIEW_STATISTICS**

在 `VIEW_BY_PROJECT` 之后添加：

```typescript
export const VIEW_STATISTICS = "statistics";
export type ViewType = typeof VIEW_NEXT_ACTION | typeof VIEW_ALL_TASKS | typeof VIEW_BY_PROJECT | typeof VIEW_STATISTICS;
```

删除原有的 `ViewType` 行（第 21 行），用上面新行替换。

- [ ] **步骤 2：更新 zh-CN.json**

在文件末尾 `"noResults"` 之后，添加：

```json
,
"statistics": "统计",
"totalTasks": "总任务",
"completionRate": "完成率",
"overdueRate": "逾期率",
"overdueTasks": "逾期",
"completedInPeriod": "本{period}完成",
"thisWeek": "周",
"thisMonth": "月",
"statusDistribution": "状态分布",
"priorityDistribution": "优先级分布",
"contextDistribution": "上下文分布",
"projectProgress": "项目进度",
"completionTrend": "完成趋势",
"noProjectProgress": "暂无项目",
"noContextTasks": "暂无上下文",
"week": "周",
"month": "月",
"note": "备注",
"noData": "暂无数据"
```

- [ ] **步骤 3：更新 en.json**

在文件末尾 `"noResults"` 之后，添加：

```json
,
"statistics": "Statistics",
"totalTasks": "Total Tasks",
"completionRate": "Completion Rate",
"overdueRate": "Overdue Rate",
"overdueTasks": "Overdue",
"completedInPeriod": "Completed This {period}",
"thisWeek": "Week",
"thisMonth": "Month",
"statusDistribution": "Status Distribution",
"priorityDistribution": "Priority Distribution",
"contextDistribution": "Context Distribution",
"projectProgress": "Project Progress",
"completionTrend": "Completion Trend",
"noProjectProgress": "No projects yet",
"noContextTasks": "No contexts",
"week": "week",
"month": "month",
"note": "Note",
"noData": "No data"
```

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/constants.ts src/i18n/zh-CN.json src/i18n/en.json
git commit -m "feat: add VIEW_STATISTICS constant and statistics i18n keys"
```

---

### 任务 6：前端集成 — NavRail 和 NextActionApp 集成统计 Tab

**文件：**
- 修改：`src/frontend/components/NavRail.svelte`
- 修改：`src/frontend/components/NextActionApp.svelte`

- [ ] **步骤 1：更新 NavRail.svelte**

在 import 行中添加 `VIEW_STATISTICS`：

```typescript
import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_STATISTICS } from "../constants";
```

在 `navItems` 数组中，在 `VIEW_BY_PROJECT` 项之后添加：

```typescript
{ view: VIEW_STATISTICS, icon: "chart", label: i18n?.statistics || "Statistics" },
```

在模板中 `item.icon === "project"` 的 `{:else}` 之前，添加 `chart` 图标的条件分支：

```svelte
{:else if item.icon === "chart"}
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="10" width="3" height="7" rx="0.5"/>
        <rect x="8.5" y="5" width="3" height="12" rx="0.5"/>
        <rect x="14" y="8" width="3" height="9" rx="0.5"/>
    </svg>
```

- [ ] **步骤 2：更新 NextActionApp.svelte**

在 import 中添加 `VIEW_STATISTICS` 和 `StatisticsView`：

```typescript
import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_STATISTICS } from "../constants";
import StatisticsView from "./StatisticsView.svelte";
```

在模板中 `{:else}` (ProjectView) 之后、`{/if}` 之前，添加统计视图分支：

```svelte
{:else if activeView === VIEW_STATISTICS}
    <StatisticsView {bridge} {i18n} />
```

将原来 ProjectView 的 `{:else}` 改为 `{:else if activeView === VIEW_BY_PROJECT}`。

- [ ] **步骤 3：构建验证**

运行：`pnpm run build`

预期：StatisticsView 不存在所以会报错——这是预期的，任务 7 会创建该组件

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/components/NavRail.svelte src/frontend/components/NextActionApp.svelte
git commit -m "feat: integrate statistics tab in NavRail and NextActionApp"
```

---

### 任务 7：前端核心 — StatisticsView 组件

**文件：**
- 创建：`src/frontend/components/StatisticsView.svelte`

- [ ] **步骤 1：创建 StatisticsView.svelte**

```svelte
<script lang="ts">
    import type { StatisticsResult } from "../../shared/types";
    import { KernelBridge } from "../kernel-bridge";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";
    import NaProgressBar from "../ui/NaProgressBar.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import { PRIORITY_HEX_COLORS } from "../constants";
    import { onMount } from "svelte";

    export let bridge: KernelBridge;
    export let i18n: any;

    let period: string = "week";
    let stats: StatisticsResult | null = null;
    let loading: boolean = false;
    let error: string | null = null;

    const STATUS_COLORS: Record<string, string> = {
        todo: "var(--b3-theme-on-surface-light)",
        doing: "var(--na-color-doing)",
        waiting: "var(--na-color-waiting)",
        done: "var(--na-color-done)",
    };

    const STATUS_LABELS: Record<string, string> = {
        todo: "statusTodo",
        doing: "statusDoing",
        waiting: "statusWaiting",
        done: "statusDone",
    };

    const PRIORITY_LABELS: Record<string, string> = {
        critical: "priorityCritical",
        high: "priorityHigh",
        medium: "priorityMedium",
        low: "priorityLow",
        none: "priorityNone",
    };

    async function loadStats() {
        loading = true;
        error = null;
        try {
            stats = await bridge.getStatistics(period as "week" | "month");
        } catch (e: any) {
            error = e.message;
        } finally {
            loading = false;
        }
    }

    function handlePeriodChange(e: CustomEvent<string>) {
        period = e.detail;
        loadStats();
    }

    function formatPercent(val: number): string {
        return Math.round(val * 100) + "%";
    }

    function formatRateColor(val: number, type: "done" | "overdue"): string {
        if (type === "done") {
            if (val >= 0.7) return "var(--na-color-success)";
            if (val >= 0.4) return "var(--na-color-warning)";
            return "var(--na-color-error)";
        } else {
            if (val <= 0.1) return "var(--na-color-success)";
            if (val <= 0.3) return "var(--na-color-warning)";
            return "var(--na-color-error)";
        }
    }

    function periodLabel(): string {
        return period === "week"
            ? (i18n?.thisWeek || "Week")
            : (i18n?.thisMonth || "Month");
    }

    $: maxTrend = stats ? Math.max(...stats.trend.map(t => t.count), 1) : 1;

    onMount(() => {
        loadStats();
    });
</script>

<div class="na-statistics">
    <!-- Header with period switcher -->
    <div class="na-statistics__header">
        <span class="na-statistics__title">{i18n?.statistics || "Statistics"}</span>
        <NaSegmentControl
            options={[
                { value: "week", label: i18n?.thisWeek || "Week" },
                { value: "month", label: i18n?.thisMonth || "Month" },
            ]}
            bind:value={period}
            on:change={handlePeriodChange}
        />
    </div>

    {#if loading && !stats}
        <NaEmpty loading={true} />
    {:else if error}
        <NaEmpty text={error} />
    {:else if stats}
        <!-- Core metrics -->
        <div class="na-statistics__metrics">
            <div class="na-statistics__metric-card">
                <span class="na-statistics__metric-value" style="color: {formatRateColor(stats.summary.doneRate, 'done')}">
                    {formatPercent(stats.summary.doneRate)}
                </span>
                <span class="na-statistics__metric-label">{i18n?.completionRate || "Completion Rate"}</span>
            </div>
            <div class="na-statistics__metric-card">
                <span class="na-statistics__metric-value" style="color: {formatRateColor(stats.summary.overdueRate, 'overdue')}">
                    {formatPercent(stats.summary.overdueRate)}
                </span>
                <span class="na-statistics__metric-label">{i18n?.overdueRate || "Overdue Rate"}</span>
            </div>
            <div class="na-statistics__metric-card">
                <span class="na-statistics__metric-value">{stats.summary.completedInPeriod}</span>
                <span class="na-statistics__metric-label">{(i18n?.completedInPeriod || "Completed This {period}").replace("{period}", periodLabel())}</span>
            </div>
            <div class="na-statistics__metric-card">
                <span class="na-statistics__metric-value">{stats.summary.total}</span>
                <span class="na-statistics__metric-label">{i18n?.totalTasks || "Total Tasks"}</span>
            </div>
            <div class="na-statistics__metric-card">
                <span class="na-statistics__metric-value" style="color: var(--na-color-error)">{stats.summary.overdue}</span>
                <span class="na-statistics__metric-label">{i18n?.overdueTasks || "Overdue"}</span>
            </div>
        </div>

        <!-- Distributions -->
        <div class="na-statistics__distributions">
            <!-- Status distribution -->
            <div class="na-statistics__section">
                <span class="na-statistics__section-title">{i18n?.statusDistribution || "Status Distribution"}</span>
                {#each stats.statusDistribution as item}
                    <div class="na-statistics__bar-row">
                        <span class="na-statistics__bar-label">{i18n?.[STATUS_LABELS[item.key]] || item.key}</span>
                        <div class="na-statistics__bar-track">
                            <div class="na-statistics__bar-fill" style="width: {item.percent * 100}%; background: {STATUS_COLORS[item.key] || 'var(--b3-theme-primary)'}"></div>
                        </div>
                        <span class="na-statistics__bar-count">{item.count}</span>
                    </div>
                {/each}
            </div>

            <!-- Priority distribution -->
            <div class="na-statistics__section">
                <span class="na-statistics__section-title">{i18n?.priorityDistribution || "Priority Distribution"}</span>
                {#each stats.priorityDistribution as item}
                    <div class="na-statistics__bar-row">
                        <span class="na-statistics__bar-label">{i18n?.[PRIORITY_LABELS[item.key]] || item.key}</span>
                        <div class="na-statistics__bar-track">
                            <div class="na-statistics__bar-fill" style="width: {item.percent * 100}%; background: {PRIORITY_HEX_COLORS[item.key] || 'var(--b3-theme-primary)'}"></div>
                        </div>
                        <span class="na-statistics__bar-count">{item.count}</span>
                    </div>
                {/each}
            </div>

            <!-- Context distribution -->
            <div class="na-statistics__section">
                <span class="na-statistics__section-title">{i18n?.contextDistribution || "Context Distribution"}</span>
                {#if stats.contextDistribution.length === 0}
                    <span class="na-statistics__empty-text">{i18n?.noContextTasks || "No contexts"}</span>
                {:else}
                    {#each stats.contextDistribution as item}
                        <div class="na-statistics__list-row">
                            <span class="na-statistics__list-label">{item.context}</span>
                            <span class="na-statistics__list-count">{item.count}</span>
                        </div>
                    {/each}
                {/if}
            </div>

            <!-- Project progress -->
            <div class="na-statistics__section">
                <span class="na-statistics__section-title">{i18n?.projectProgress || "Project Progress"}</span>
                {#if stats.projectProgress.length === 0}
                    <span class="na-statistics__empty-text">{i18n?.noProjectProgress || "No projects yet"}</span>
                {:else}
                    {#each stats.projectProgress as item}
                        <div class="na-statistics__project-row">
                            <span class="na-statistics__project-title">{item.title || i18n?.untitled || "(untitled)"}</span>
                            <NaProgressBar percent={Math.round(item.percent * 100)} label="{item.done}/{item.total}" />
                        </div>
                    {/each}
                {/if}
            </div>
        </div>

        <!-- Trend chart -->
        <div class="na-statistics__trend">
            <span class="na-statistics__section-title">{i18n?.completionTrend || "Completion Trend"}</span>
            {#if stats.trend.every(t => t.count === 0)}
                <NaEmpty text={i18n?.noData || "No data"} />
            {:else}
                <svg class="na-statistics__chart" viewBox="0 0 320 120" preserveAspectRatio="xMidYMid meet">
                    {#each stats.trend as item, i}
                        {@const x = 20 + i * (280 / 7)}
                        {@const barHeight = (item.count / maxTrend) * 80}
                        {@const y = 90 - barHeight}
                        <!-- Bar -->
                        <rect x={x - 12} {y} width="24" height={barHeight} rx="3" fill="var(--b3-theme-primary)" opacity="0.25" />
                        <!-- Value on top -->
                        {#if item.count > 0}
                            <text x={x} y={y - 4} text-anchor="middle" fill="var(--b3-theme-on-surface)" font-size="9" font-weight="500">{item.count}</text>
                        {/if}
                        <!-- Label -->
                        <text x={x} y="108" text-anchor="middle" fill="var(--b3-theme-on-surface-light)" font-size="8">{item.label}</text>
                    {/each}
                    <!-- Trend line -->
                    <polyline
                        fill="none"
                        stroke="var(--b3-theme-primary)"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        points={stats.trend.map((item, i) => {
                            const x = 20 + i * (280 / 7);
                            const barHeight = (item.count / maxTrend) * 80;
                            return `${x},${90 - barHeight}`;
                        }).join(' ')}
                    />
                </svg>
            {/if}
        </div>
    {/if}
</div>

<style lang="scss">
    .na-statistics {
        padding: var(--na-space-lg);
        display: flex;
        flex-direction: column;
        gap: var(--na-space-lg);
        overflow-y: auto;
        height: 100%;
    }

    .na-statistics__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-bottom: var(--na-space-md);
        border-bottom: 1px solid var(--na-color-divider);
    }

    .na-statistics__title {
        font-size: var(--na-font-size-lg);
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }

    .na-statistics__metrics {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--na-space-md);
    }

    .na-statistics__metric-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--na-space-lg);
        background: var(--b3-theme-surface);
        border-radius: var(--na-radius-lg);
        border: 1px solid var(--na-color-divider);
        gap: var(--na-space-xs);
    }

    .na-statistics__metric-value {
        font-size: 20px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--b3-theme-on-surface);
    }

    .na-statistics__metric-label {
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface-light);
        text-align: center;
    }

    .na-statistics__distributions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--na-space-md);
    }

    .na-statistics__section {
        background: var(--b3-theme-surface);
        border-radius: var(--na-radius-lg);
        border: 1px solid var(--na-color-divider);
        padding: var(--na-space-md);
        display: flex;
        flex-direction: column;
        gap: var(--na-space-xs);
    }

    .na-statistics__section-title {
        font-size: var(--na-font-size-sm);
        font-weight: 600;
        color: var(--b3-theme-on-surface);
        margin-bottom: var(--na-space-xs);
    }

    .na-statistics__bar-row {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm);
        min-height: 18px;
    }

    .na-statistics__bar-label {
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface-light);
        width: 36px;
        flex-shrink: 0;
    }

    .na-statistics__bar-track {
        flex: 1;
        height: 6px;
        background: var(--b3-theme-surface-lighter);
        border-radius: 3px;
        overflow: hidden;
    }

    .na-statistics__bar-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.3s ease;
    }

    .na-statistics__bar-count {
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface-light);
        width: 20px;
        text-align: right;
        font-variant-numeric: tabular-nums;
    }

    .na-statistics__list-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--na-space-xxs) 0;
    }

    .na-statistics__list-label {
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface);
    }

    .na-statistics__list-count {
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface-light);
        font-variant-numeric: tabular-nums;
    }

    .na-statistics__project-row {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-xxs);
        padding: var(--na-space-xs) 0;
    }

    .na-statistics__project-title {
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .na-statistics__empty-text {
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface-light);
        padding: var(--na-space-sm) 0;
    }

    .na-statistics__trend {
        background: var(--b3-theme-surface);
        border-radius: var(--na-radius-lg);
        border: 1px solid var(--na-color-divider);
        padding: var(--na-space-md);
    }

    .na-statistics__chart {
        width: 100%;
        height: auto;
    }

    @media (max-width: 400px) {
        .na-statistics__metrics {
            grid-template-columns: 1fr;
        }
        .na-statistics__distributions {
            grid-template-columns: 1fr;
        }
    }
</style>
```

- [ ] **步骤 2：构建验证**

运行：`pnpm run build`

预期：编译通过

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/StatisticsView.svelte
git commit -m "feat: add StatisticsView component with metrics, distributions, and trend chart"
```

---

### 任务 8：前端细节 — TaskDetail 新增备注字段

**文件：**
- 修改：`src/frontend/components/TaskDetail.svelte:27-28,179-192,248-308`

- [ ] **步骤 1：在 TaskDetail.svelte 的 script 中添加 note 状态变量**

在 `let start = task.due || "";` 之后（约第 27 行），添加：

```typescript
let note = task.note || "";
```

在 `scheduleSave` 函数中，在 `attrs` 对象里（约第 181-192 行）添加：

```typescript
"na-note": note,
```

- [ ] **步骤 2：在 TaskDetail.svelte 的模板中添加备注输入**

在 `<!-- Repeat toggle -->` 区域之前（约第 373 行之前），添加：

```svelte
<!-- Note -->
<div class="na-detail__field">
    <span class="na-detail__label">{i18n?.note || "Note"}</span>
    <div class="na-detail__value">
        <textarea class="na-textarea" bind:value={note} on:input={handleChange} rows="3" placeholder={i18n?.note || "Note"}></textarea>
    </div>
</div>
```

- [ ] **步骤 3：构建验证**

运行：`pnpm run build`

预期：编译通过

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/components/TaskDetail.svelte
git commit -m "feat: add note (na-note) textarea field to TaskDetail"
```

---

### 任务 9：样式收尾 — textarea 和统计面板全局样式

**文件：**
- 修改：`src/index.scss`

- [ ] **步骤 1：在 index.scss 中添加 textarea 和统计面板相关样式**

在文件末尾（或 `NaNav Rail` 样式块之后）添加：

```scss
// Textarea (TaskDetail note field)
.na-textarea {
    width: 100%;
    padding: var(--na-space-sm) var(--na-space-md);
    font-size: var(--na-font-size-md);
    font-family: inherit;
    color: var(--b3-theme-on-surface);
    background: var(--b3-theme-surface-light);
    border: 1px solid var(--na-color-divider);
    border-radius: var(--na-radius-md);
    resize: vertical;
    min-height: 60px;
    line-height: 1.4;
    outline: none;
    transition: border-color 0.15s ease;

    &:focus {
        border-color: var(--b3-theme-primary);
    }

    &::placeholder {
        color: var(--b3-theme-on-surface-light);
        opacity: 0.5;
    }
}
```

- [ ] **步骤 2：构建验证**

运行：`pnpm run build`

预期：编译通过

- [ ] **步骤 3：Commit**

```bash
git add src/index.scss
git commit -m "style: add textarea base styles for na-note field"
```

---

### 任务 10：端到端验证

**文件：** 无新增修改

- [ ] **步骤 1：完整构建**

运行：`pnpm run build`

预期：全部编译通过，无错误

- [ ] **步骤 2：部署到思源**

运行：`pnpm run release`

预期：构建产物部署到思源插件目录

- [ ] **步骤 3：功能验证清单**

在思源中手动验证以下功能：

1. 转为任务 → 标记完成 → 检查 na-completed 属性是否自动写入
2. 重新打开已完成任务 → 检查 na-completed 是否保留
3. 再次完成 → 检查 na-completed 是否追加第二条时间
4. 打开任务详情 → 检查备注 textarea 是否可见 → 输入文字 → 检查 500ms 防抖保存
5. 切换到统计 Tab → 检查核心指标、分布图、趋势图渲染
6. 切换周/月 → 检查数据刷新
7. 检查空数据场景（新建笔记本无任务时）

- [ ] **步骤 4：Commit（如有修复）**

如有任何修复，commit 后继续。
