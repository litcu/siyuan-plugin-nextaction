# GTD 回顾功能 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 NextAction 插件新增 GTD 回顾功能，包含回顾指南面板（5个可折叠检查项）和单任务回顾（间隔+到期提醒）。

**架构：** 内核侧扩展 CacheManager 和 TaskService，新增 `getReviewData` 和 `markTaskReviewed` 两个 RPC；前端侧新增 ReviewView（上下分区：回顾指南+待回顾列表），修改 NavRail 新增回顾 Tab+badge，修改 TaskCard 新增回顾小图标，修改 TaskDetail 新增回顾字段。

**技术栈：** Svelte + TypeScript + 思源 RPC + siyuan.storage

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `src/shared/constants.ts` | 新增 ATTR_REVIEW_INTERVAL、ATTR_REVIEW_DATE、VIEW_REVIEW 常量 |
| 修改 | `src/shared/types.ts` | TaskCacheEntry 新增 reviewInterval/reviewDate 字段；新增 ReviewData 接口 |
| 修改 | `src/kernel/cache-manager.ts` | loadAll 解析新属性；buildEntryFromAttrs 由 TaskService 调用 |
| 修改 | `src/kernel/task-service.ts` | 新增 getReviewData/markTaskReviewed 方法；updateTask 处理 done 时推算 review-date；buildEntryFromAttrs 解析新字段；removeTask 清除新属性 |
| 修改 | `src/kernel/rpc-server.ts` | 注册 getReviewData 和 markTaskReviewed 两个 RPC |
| 修改 | `src/frontend/constants.ts` | 新增 VIEW_REVIEW 和 ViewType 联合类型 |
| 修改 | `src/frontend/kernel-bridge.ts` | 新增 getReviewData/markTaskReviewed 前端调用 |
| 修改 | `src/frontend/stores/task-store.ts` | 新增 deriveReviewDueCount；DEFAULT_FILTERS 增加 review 视图 |
| 修改 | `src/frontend/components/NavRail.svelte` | 新增回顾 Tab 入口 + badge 数字 |
| 修改 | `src/frontend/components/NextActionApp.svelte` | 新增回顾视图路由 |
| 修改 | `src/frontend/components/TaskDetail.svelte` | 新增回顾间隔和下次回顾日期编辑字段 |
| 修改 | `src/frontend/components/TaskCard.svelte` | 有 reviewInterval 的任务显示小日历图标 |
| 修改 | `src/i18n/en.json` | 英文文案 |
| 修改 | `src/i18n/zh-CN.json` | 中文文案 |
| 创建 | `src/frontend/components/ReviewView.svelte` | 回顾 Tab 主视图 |
| 创建 | `src/frontend/components/ReviewGuide.svelte` | 上半区：5个可折叠检查项 |
| 创建 | `src/frontend/components/ReviewDueList.svelte` | 下半区：待回顾任务列表 |

---

### 任务 1：共享层 — 常量与类型

**文件：**
- 修改：`src/shared/constants.ts`
- 修改：`src/shared/types.ts`

- [ ] **步骤 1：在 constants.ts 新增回顾相关常量**

在 `ATTR_TAGS` 行后新增：

```typescript
export const ATTR_REVIEW_INTERVAL = "custom-na-review-interval";
export const ATTR_REVIEW_DATE = "custom-na-review-date";
```

在文件末尾（`DAY_MINUTES` 之前）新增：

```typescript
export const REVIEW_INTERVAL_PRESETS = [7, 14, 30, 60, 90] as const;
```

- [ ] **步骤 2：在 types.ts 扩展 TaskCacheEntry**

在 `TaskCacheEntry` 接口的 `blockedReason` 字段后新增：

```typescript
    reviewInterval: number;      // 0 = 不回顾
    reviewDate: string;          // 空字符串 = 无，YYYY-MM-DD
```

在文件末尾（`export type` 行之前）新增 `ReviewData` 接口：

```typescript
export interface ReviewData {
    overdueTasks: TaskCacheEntry[];
    nextActions: TaskCacheEntry[];
    waitingTasks: TaskCacheEntry[];
    somedayTasks: TaskCacheEntry[];
    activeProjects: TaskCacheEntry[];
    reviewDueTasks: TaskCacheEntry[];
}
```

- [ ] **步骤 3：在 types.ts 的导出中确认 ReviewData 可用**

检查文件末尾的 `export type` 行，确认新增的 `ReviewData` 接口在同一个文件中定义即可，无需额外导出。

- [ ] **步骤 4：Commit**

```bash
git add src/shared/constants.ts src/shared/types.ts
git commit -m "feat(review): add review constants and types"
```

---

### 任务 2：内核侧 — CacheManager 解析新属性

**文件：**
- 修改：`src/kernel/cache-manager.ts`

- [ ] **步骤 1：在 cache-manager.ts 顶部 import 新增 ATTR 常量**

将第2行的 import 添加 `ATTR_REVIEW_INTERVAL, ATTR_REVIEW_DATE`：

```typescript
import { ATTR_PARENT, ATTR_STATUS, ATTR_PRIORITY, ATTR_DUE, ATTR_START, ATTR_CONTEXT, ATTR_TASK, ATTR_EFFORT, ATTR_IMPORTANCE, ATTR_DEPENDS, ATTR_DEP_MODE, ATTR_SEQUENTIAL, ATTR_REPEAT, ATTR_SORT, ATTR_COMPLETED, ATTR_NOTE, ATTR_CREATED, ATTR_TAGS, ATTR_REVIEW_INTERVAL, ATTR_REVIEW_DATE } from "../shared/constants";
```

- [ ] **步骤 2：在 loadAll 的 entry 构建中新增字段解析**

在 `loadAll` 方法中，entry 对象字面量的 `tags` 字段后、`blocked` 字段前，新增：

```typescript
                reviewInterval: attrToNumber(attrs[ATTR_REVIEW_INTERVAL], 0),
                reviewDate: attrs[ATTR_REVIEW_DATE] || "",
```

- [ ] **步骤 3：Commit**

```bash
git add src/kernel/cache-manager.ts
git commit -m "feat(review): parse review-interval and review-date in CacheManager"
```

---

### 任务 3：内核侧 — TaskService 扩展

**文件：**
- 修改：`src/kernel/task-service.ts`

- [ ] **步骤 1：在 task-service.ts 顶部 import 新增常量和类型**

在现有 import 的 `ATTR_TAGS` 后添加 `ATTR_REVIEW_INTERVAL, ATTR_REVIEW_DATE`：

```typescript
    ATTR_TAGS,
    ATTR_REVIEW_INTERVAL,
    ATTR_REVIEW_DATE,
```

在 types import 行添加 `ReviewData`：

```typescript
import { TaskCacheEntry, StatisticsResult, StatisticsSummary, StatisticsDistribution, StatisticsContextItem, StatisticsProjectStatus, ReviewData } from "../shared/types";
```

- [ ] **步骤 2：修改 buildEntryFromAttrs 解析新字段**

在 `buildEntryFromAttrs` 方法中，entry 对象字面量的 `tags` 字段后、`blocked` 字段前，新增：

```typescript
            reviewInterval: attrToNumber(attrs[ATTR_REVIEW_INTERVAL], 0),
            reviewDate: attrs[ATTR_REVIEW_DATE] || "",
```

- [ ] **步骤 3：修改 removeTask 清除新属性**

在 `removeTask` 方法中，`clearAttrs` 对象的 `ATTR_TAGS` 行后新增：

```typescript
            clearAttrs[ATTR_REVIEW_INTERVAL] = "";
            clearAttrs[ATTR_REVIEW_DATE] = "";
```

- [ ] **步骤 4：在 updateTask 中处理 done 时自动推算 review-date**

在 `updateTask` 方法中，在处理 repeat 的逻辑块之后（`// 循环/重复任务` 块结束后），新增 review-date 推算逻辑：

```typescript
            // 回顾日期推算：status 变为 done 且有 review-interval 时，自动推算下次 review-date
            if (attrs[ATTR_STATUS] === "done" && updatedEntry && updatedEntry.reviewInterval > 0) {
                const today = new Date().toISOString().slice(0, 10);
                const nextReviewDate = this.addDays(today, updatedEntry.reviewInterval);
                await siyuanFetch("/api/attr/setBlockAttrs", {
                    id: blockId,
                    attrs: { [ATTR_REVIEW_DATE]: nextReviewDate },
                });
                const reviewAttrs = await siyuanFetch<Record<string, string>>("/api/attr/getBlockAttrs", { id: blockId });
                const reviewEntry = this.buildEntryFromAttrs(blockId, reviewAttrs, this.cacheManager.get(blockId)!);
                this.cacheManager.set(reviewEntry);
            }
```

- [ ] **步骤 5：新增 addDays 辅助方法**

在 TaskService 类的 `private async findParentListItem` 方法之前，新增：

```typescript
    private addDays(dateStr: string, days: number): string {
        const d = new Date(dateStr + "T00:00:00");
        d.setDate(d.getDate() + days);
        return d.toISOString().slice(0, 10);
    }
```

- [ ] **步骤 6：新增 getReviewData 方法**

在 TaskService 类的 `getStatistics` 方法之后，新增：

```typescript
    getReviewData(): ReviewData {
        this.checkReady();
        const allEntries = this.cacheManager.getAll();
        const todayStr = new Date().toISOString().slice(0, 10);
        const cache = this.cacheManager.getCache();

        const overdueTasks: TaskCacheEntry[] = [];
        const nextActions: TaskCacheEntry[] = [];
        const waitingTasks: TaskCacheEntry[] = [];
        const somedayTasks: TaskCacheEntry[] = [];
        const activeProjects: TaskCacheEntry[] = [];
        const reviewDueTasks: TaskCacheEntry[] = [];

        for (let i = 0; i < allEntries.length; i++) {
            const entry = allEntries[i];

            // 回顾到期：review-date <= 今天 且 review-interval > 0 且未完成
            if (entry.reviewInterval > 0 && entry.reviewDate && entry.reviewDate <= todayStr && entry.status !== "done") {
                reviewDueTasks.push(entry);
            }

            // 逾期：status≠done 且 due < 今天
            if (entry.status !== "done" && entry.due !== "" && entry.due < todayStr) {
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

            // 将来/也许
            if (entry.status === "someday") {
                somedayTasks.push(entry);
            }

            // 活跃项目
            if (entry.taskType === "2" && entry.status !== "done" && entry.childIds.some(id => {
                const child = cache[id];
                return child && child.status !== "done";
            })) {
                activeProjects.push(entry);
            }
        }

        return { overdueTasks, nextActions, waitingTasks, somedayTasks, activeProjects, reviewDueTasks };
    }
```

- [ ] **步骤 7：新增 markTaskReviewed 方法**

在 `getReviewData` 方法之后，新增：

```typescript
    async markTaskReviewed(blockIds: string[]): Promise<TaskCacheEntry[]> {
        this.checkReady();
        if (!blockIds || blockIds.length === 0) return [];

        const lock = await this.acquireWithTimeout();
        try {
            const results: TaskCacheEntry[] = [];
            const today = new Date().toISOString().slice(0, 10);

            for (const blockId of blockIds) {
                const entry = this.cacheManager.get(blockId);
                if (!entry || entry.reviewInterval <= 0) continue;

                const nextReviewDate = this.addDays(today, entry.reviewInterval);
                await siyuanFetch("/api/attr/setBlockAttrs", {
                    id: blockId,
                    attrs: { [ATTR_REVIEW_DATE]: nextReviewDate },
                });

                const finalAttrs = await siyuanFetch<Record<string, string>>("/api/attr/getBlockAttrs", { id: blockId });
                const updated = this.buildEntryFromAttrs(blockId, finalAttrs, entry);
                this.cacheManager.set(updated);
                results.push(updated);
            }

            this.syncEngine.broadcastChanges();
            return results;
        } finally {
            lock.release();
        }
    }
```

- [ ] **步骤 8：Commit**

```bash
git add src/kernel/task-service.ts
git commit -m "feat(review): add getReviewData and markTaskReviewed in TaskService"
```

---

### 任务 4：内核侧 — 注册 RPC 方法

**文件：**
- 修改：`src/kernel/rpc-server.ts`

- [ ] **步骤 1：在 rpc-server.ts 末尾的 `registerRpcMethods` 函数中，在最后一个 bind（`removeMyDaySchedule`）之后、函数闭合 `}` 之前，新增两个 RPC 注册**

```typescript
    siyuan.rpc.bind("getReviewData", async (..._params: any[]) => {
        try {
            return taskService.getReviewData();
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("markTaskReviewed", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockIds || !Array.isArray(p.blockIds) || p.blockIds.length === 0) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockIds is required and must be a non-empty array");
        }
        try {
            return await taskService.markTaskReviewed(p.blockIds);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });
```

注意：需要在文件顶部 import 中确认 `RPC_ERROR_INVALID_PARAMS` 已导入（已在第5行导入）。

- [ ] **步骤 2：Commit**

```bash
git add src/kernel/rpc-server.ts
git commit -m "feat(review): register getReviewData and markTaskReviewed RPC methods"
```

---

### 任务 5：前端侧 — KernelBridge + constants + store

**文件：**
- 修改：`src/frontend/constants.ts`
- 修改：`src/frontend/kernel-bridge.ts`
- 修改：`src/frontend/stores/task-store.ts`

- [ ] **步骤 1：在 frontend/constants.ts 新增 VIEW_REVIEW**

在 `VIEW_STATISTICS = "statistics"` 行后新增：

```typescript
export const VIEW_REVIEW = "review";
```

修改 `ViewType` 联合类型，在末尾添加 `| typeof VIEW_REVIEW`：

```typescript
export type ViewType = typeof VIEW_NEXT_ACTION | typeof VIEW_ALL_TASKS | typeof VIEW_BY_PROJECT | typeof VIEW_SOMEDAY | typeof VIEW_WAITING | typeof VIEW_MY_DAY | typeof VIEW_STATISTICS | typeof VIEW_REVIEW;
```

- [ ] **步骤 2：在 kernel-bridge.ts 新增回顾 RPC 调用**

在文件顶部 import 的 types 行添加 `ReviewData`：

```typescript
import type { TaskCacheEntry, TaskChangeNotification, StatisticsResult, PluginSettings, MyDayState, ReviewData } from "../shared/types";
```

在 `removeMyDaySchedule` 方法之后、`bindTasksChanged` 方法之前，新增：

```typescript
    async getReviewData(): Promise<ReviewData> {
        return this.call("getReviewData", {});
    }

    async markTaskReviewed(blockIds: string[]): Promise<TaskCacheEntry[]> {
        return this.call("markTaskReviewed", { blockIds });
    }
```

- [ ] **步骤 3：在 task-store.ts 新增 deriveReviewDueCount 和 store 字段**

在文件顶部 import 行添加 `VIEW_REVIEW`：

```typescript
import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY, VIEW_WAITING, VIEW_MY_DAY, VIEW_REVIEW } from "../constants";
```

在 `deriveProjectReminders` 函数之后，新增：

```typescript
function deriveReviewDueCount(allTasks: TaskCacheEntry[]): number {
    const todayStr = new Date().toISOString().slice(0, 10);
    let count = 0;
    for (const t of allTasks) {
        if (t.reviewInterval > 0 && t.reviewDate && t.reviewDate <= todayStr && t.status !== "done") {
            count++;
        }
    }
    return count;
}
```

在 `TaskState` 接口中，`settings` 字段后新增：

```typescript
    reviewDueCount: number;
```

在 `DEFAULT_FILTERS` 中新增 review 视图的默认过滤器：

```typescript
    [VIEW_REVIEW]: { ...DEFAULT_FILTER_STATE },
```

在 `createTaskStore` 的初始 state 中，`settings` 字段后新增：

```typescript
        reviewDueCount: 0,
```

在 `loadTasks` 方法中，`projectReminders` 派生行后新增：

```typescript
                    const reviewDueCount = deriveReviewDueCount(allTasks);
```

在 `update` 调用中，添加 `reviewDueCount` 到返回对象：

```typescript
                    update((s) => ({ ...s, allTasks, contexts, tags, loading: false, doneCount, projectReminders, reviewDueCount }));
```

在 `applyUpdate` 方法的返回对象中添加：

```typescript
                    reviewDueCount: deriveReviewDueCount(allTasks),
```

在 `applyRemove` 方法的返回对象中添加：

```typescript
                    reviewDueCount: deriveReviewDueCount(allTasks),
```

在 `applyChangeNotification` 方法的两处返回对象中添加：

```typescript
                                reviewDueCount: deriveReviewDueCount(allTasks),
```

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/constants.ts src/frontend/kernel-bridge.ts src/frontend/stores/task-store.ts
git commit -m "feat(review): add KernelBridge calls, VIEW_REVIEW constant, and reviewDueCount in store"
```

---

### 任务 6：前端侧 — NavRail 新增回顾 Tab + badge

**文件：**
- 修改：`src/frontend/components/NavRail.svelte`

- [ ] **步骤 1：在 NavRail.svelte 的 import 中添加 VIEW_REVIEW**

修改第2行的 import：

```typescript
import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY, VIEW_WAITING, VIEW_STATISTICS, VIEW_MY_DAY, VIEW_REVIEW } from "../constants";
```

- [ ] **步骤 2：在 allNavItems 数组中，VIEW_STATISTICS 项之后新增回顾项**

```typescript
    { view: VIEW_REVIEW, icon: "review", label: i18n?.review || "Review" },
```

- [ ] **步骤 3：在 NavRail 的 SVG 图标条件渲染中，在 `chart` 图标之后新增 `review` 图标**

```svelte
                {:else if item.icon === "review"}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="10" cy="10" r="7"/>
                        <polyline points="7 10 9 12 13 8"/>
                    </svg>
```

- [ ] **步骤 4：在回顾按钮上添加 badge 数字**

在 NavRail 的 button 元素中，回顾项需要显示 badge。修改 NavRail 的 button 渲染部分，在每个 button 内部、图标 span 之后，添加条件渲染的 badge：

```svelte
            {#if item.icon === "review" && $taskStore.reviewDueCount > 0}
                <span class="na-nav-rail__badge">{$taskStore.reviewDueCount}</span>
            {/if}
```

- [ ] **步骤 5：添加 badge 样式**

在 NavRail 的 `<style>` 块中，`.na-nav-rail__item` 样式块之后新增：

```scss
    .na-nav-rail__badge {
        position: absolute;
        top: 2px;
        right: 2px;
        min-width: 14px;
        height: 14px;
        font-size: 9px;
        font-weight: 700;
        line-height: 14px;
        text-align: center;
        color: var(--b3-theme-on-primary);
        background: var(--na-color-error);
        border-radius: 7px;
        padding: 0 3px;
        font-variant-numeric: tabular-nums;
    }
```

同时给 `.na-nav-rail__item` 添加 `position: relative;`（如果还没有的话）。

- [ ] **步骤 6：Commit**

```bash
git add src/frontend/components/NavRail.svelte
git commit -m "feat(review): add review tab to NavRail with badge"
```

---

### 任务 7：前端侧 — NextActionApp 路由新增回顾视图

**文件：**
- 修改：`src/frontend/components/NextActionApp.svelte`

- [ ] **步骤 1：在 import 中添加 VIEW_REVIEW 和 ReviewView**

在 VIEW 常量 import 行添加 `VIEW_REVIEW`：

```typescript
import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY, VIEW_WAITING, VIEW_STATISTICS, VIEW_MY_DAY, VIEW_REVIEW } from "../constants";
```

在组件 import 区域添加：

```typescript
import ReviewView from "./ReviewView.svelte";
```

- [ ] **步骤 2：在模板中添加回顾视图分支**

在 `{:else if activeView === VIEW_STATISTICS}` 分支之后、`{/if}` 之前，新增：

```svelte
            {:else if activeView === VIEW_REVIEW}
                <ReviewView
                    {bridge}
                    {selectedTaskId}
                    onSelectTask={handleSelectTask}
                    onEdit={handleEdit}
                    onStatusClick={handleStatusClick}
                    onContextMenu={handleContextMenu}
                    {i18n}
                />
```

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/NextActionApp.svelte
git commit -m "feat(review): add ReviewView route to NextActionApp"
```

---

### 任务 8：前端侧 — ReviewView 主视图

**文件：**
- 创建：`src/frontend/components/ReviewView.svelte`

- [ ] **步骤 1：创建 ReviewView.svelte**

此组件是回顾 Tab 的主视图，上下分区：上半区是 ReviewGuide（5个可折叠检查项），下半区是 ReviewDueList（待回顾任务列表）。

```svelte
<script lang="ts">
    import type { TaskCacheEntry, ReviewData } from "../../shared/types";
    import { KernelBridge } from "../kernel-bridge";
    import ReviewGuide from "./ReviewGuide.svelte";
    import ReviewDueList from "./ReviewDueList.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import { onMount } from "svelte";

    export let bridge: KernelBridge;
    export let selectedTaskId: string;
    export let onSelectTask: (task: TaskCacheEntry) => void;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;

    let reviewData: ReviewData | null = null;
    let loading = false;
    let error: string | null = null;

    async function loadReviewData() {
        loading = true;
        error = null;
        try {
            reviewData = await bridge.getReviewData();
        } catch (e: any) {
            error = e.message;
        } finally {
            loading = false;
        }
    }

    async function handleMarkReviewed(blockIds: string[]) {
        try {
            const updated = await bridge.markTaskReviewed(blockIds);
            // Reload to refresh reviewDueTasks
            await loadReviewData();
        } catch (e: any) {
            console.error("[NextAction] markTaskReviewed failed:", e);
        }
    }

    onMount(() => {
        loadReviewData();
    });
</script>

<div class="na-review">
    <div class="na-review__header">
        <span class="na-review__title">{i18n?.review || "Review"}</span>
    </div>

    {#if loading && !reviewData}
        <NaEmpty loading={true} />
    {:else if error}
        <NaEmpty text={error} />
    {:else if reviewData}
        <div class="na-review__guide">
            <ReviewGuide {reviewData} {bridge} {i18n}
                {selectedTaskId}
                {onSelectTask}
                {onEdit}
                {onStatusClick}
                {onContextMenu}
            />
        </div>

        <div class="na-review__due">
            <ReviewDueList
                {reviewData}
                {bridge}
                {i18n}
                {selectedTaskId}
                {onSelectTask}
                {onEdit}
                {onStatusClick}
                {onContextMenu}
                onMarkReviewed={handleMarkReviewed}
            />
        </div>
    {/if}
</div>

<style lang="scss">
    .na-review {
        padding: var(--na-space-lg);
        display: flex;
        flex-direction: column;
        gap: var(--na-space-lg);
        overflow-y: auto;
    }

    .na-review__header {
        padding-bottom: var(--na-space-md);
        border-bottom: 1px solid var(--na-color-divider);
    }

    .na-review__title {
        font-size: var(--na-font-size-lg);
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }

    .na-review__guide {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-md);
    }

    .na-review__due {
        border-top: 1px solid var(--na-color-divider);
        padding-top: var(--na-space-lg);
    }
</style>
```

- [ ] **步骤 2：Commit**

```bash
git add src/frontend/components/ReviewView.svelte
git commit -m "feat(review): create ReviewView main component"
```

---

### 任务 9：前端侧 — ReviewGuide 可折叠检查项组件

**文件：**
- 创建：`src/frontend/components/ReviewGuide.svelte`

- [ ] **步骤 1：创建 ReviewGuide.svelte**

5个可折叠的检查项卡片，每项显示步骤名和任务数量，展开后内联显示任务列表。

```svelte
<script lang="ts">
    import type { TaskCacheEntry, ReviewData } from "../../shared/types";
    import { KernelBridge } from "../kernel-bridge";
    import TaskCard from "./TaskCard.svelte";

    export let reviewData: ReviewData;
    export let bridge: KernelBridge;
    export let i18n: any;
    export let selectedTaskId: string;
    export let onSelectTask: (task: TaskCacheEntry) => void;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;

    const checklistItems = [
        { key: "overdue", label: i18n?.reviewOverdue || "Overdue Tasks", icon: "overdue" },
        { key: "nextActions", label: i18n?.reviewNextActions || "Next Actions", icon: "next" },
        { key: "waiting", label: i18n?.reviewWaiting || "Waiting Tasks", icon: "waiting" },
        { key: "someday", label: i18n?.reviewSomeday || "Someday / Maybe", icon: "someday" },
        { key: "projects", label: i18n?.reviewProjects || "Project Progress", icon: "project" },
    ];

    let expandedKey: string | null = null;

    function toggleExpand(key: string) {
        expandedKey = expandedKey === key ? null : key;
    }

    function getTasks(key: string): TaskCacheEntry[] {
        switch (key) {
            case "overdue": return reviewData.overdueTasks;
            case "nextActions": return reviewData.nextActions;
            case "waiting": return reviewData.waitingTasks;
            case "someday": return reviewData.somedayTasks;
            case "projects": return reviewData.activeProjects;
            default: return [];
        }
    }

</script>

<div class="na-review-guide">
    <span class="na-review-guide__title">{i18n?.reviewGuideTitle || "Review Checklist"}</span>

    {#each checklistItems as item}
        {@const tasks = getTasks(item.key)}
        {@const count = tasks.length}
        <div class="na-review-guide__card" class:expanded={expandedKey === item.key}>
            <button class="na-review-guide__card-header" on:click={() => toggleExpand(item.key)}>
                <span class="na-review-guide__card-icon">
                    {#if item.icon === "overdue"}
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><polyline points="8 4.5 8 8 10.5 9.5"/></svg>
                    {:else if item.icon === "next"}
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2L8 8L4 8"/><path d="M8 8L12 8"/><path d="M8 8L8 14"/></svg>
                    {:else if item.icon === "waiting"}
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><polyline points="8 4 8 8 11 10"/></svg>
                    {:else if item.icon === "someday"}
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1a4.5 4.5 0 0 0-2.7 8.1V11h5.4V9.1A4.5 4.5 0 0 0 8 1z"/><line x1="5.5" y1="13" x2="10.5" y2="13"/></svg>
                    {:else}
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h4l1.5 1.5H14v8H2z"/></svg>
                    {/if}
                </span>
                <span class="na-review-guide__card-label">{item.label}</span>
                <span class="na-review-guide__card-count">{count}</span>
                <span class="na-review-guide__card-chevron" class:rotated={expandedKey === item.key}>
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg>
                </span>
            </button>

            {#if expandedKey === item.key}
                <div class="na-review-guide__card-body">
                    {#if count === 0}
                        <div class="na-review-guide__empty">{i18n?.reviewNoTasks || "No tasks"}</div>
                    {:else}
                        {#each tasks as task}
                            <TaskCard
                                {task}
                                {selectedTaskId}
                                onSelect={onSelectTask}
                                onEdit={onEdit}
                                onStatusClick={onStatusClick}
                                onContextMenu={onContextMenu}
                                {i18n}
                            />
                        {/each}
                    {/if}
                </div>
            {/if}
        </div>
    {/each}
</div>

<style lang="scss">
    .na-review-guide {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-sm);
    }

    .na-review-guide__title {
        font-size: var(--na-font-size-md);
        font-weight: 600;
        color: var(--b3-theme-on-surface);
        margin-bottom: var(--na-space-xs);
    }

    .na-review-guide__card {
        background: var(--b3-theme-surface);
        border-radius: var(--na-radius-lg);
        border: 1px solid var(--na-color-divider);
        overflow: hidden;
    }

    .na-review-guide__card-header {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm);
        width: 100%;
        padding: var(--na-space-sm) var(--na-space-md);
        background: none;
        border: none;
        cursor: pointer;
        color: var(--b3-theme-on-surface);
        font-size: var(--na-font-size-md);
        text-align: left;
    }

    .na-review-guide__card-header:hover {
        background: var(--b3-theme-surface-lighter);
    }

    .na-review-guide__card-icon {
        display: flex;
        align-items: center;
        color: var(--b3-theme-on-surface-secondary);
    }

    .na-review-guide__card-label {
        flex: 1;
        font-weight: 500;
    }

    .na-review-guide__card-count {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-light);
        font-variant-numeric: tabular-nums;
        background: var(--b3-theme-surface-lighter);
        border-radius: 8px;
        padding: 1px 6px;
    }

    .na-review-guide__card-chevron {
        display: flex;
        align-items: center;
        color: var(--b3-theme-on-surface-light);
        transition: transform 0.2s ease;
    }

    .na-review-guide__card-chevron.rotated {
        transform: rotate(180deg);
    }

    .na-review-guide__card-body {
        padding: 0 var(--na-space-md) var(--na-space-sm);
        display: flex;
        flex-direction: column;
        gap: var(--na-space-xs);
    }

    .na-review-guide__empty {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-light);
        padding: var(--na-space-sm) 0;
    }
</style>
```

- [ ] **步骤 2：Commit**

```bash
git add src/frontend/components/ReviewGuide.svelte
git commit -m "feat(review): create ReviewGuide collapsible checklist component"
```

---

### 任务 10：前端侧 — ReviewDueList 待回顾任务列表

**文件：**
- 创建：`src/frontend/components/ReviewDueList.svelte`

- [ ] **步骤 1：创建 ReviewDueList.svelte**

下半区，聚合"回顾到期"和"逾期任务"两个分组，支持批量"已回顾"按钮。

```svelte
<script lang="ts">
    import type { TaskCacheEntry, ReviewData } from "../../shared/types";
    import { KernelBridge } from "../kernel-bridge";
    import TaskCard from "./TaskCard.svelte";

    export let reviewData: ReviewData;
    export let bridge: KernelBridge;
    export let i18n: any;
    export let selectedTaskId: string;
    export let onSelectTask: (task: TaskCacheEntry) => void;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onMarkReviewed: (blockIds: string[]) => void;

    let reviewDueExpanded = true;
    let overdueExpanded = true;

    $: reviewDueTasks = reviewData.reviewDueTasks;
    $: overdueTasks = reviewData.overdueTasks;
    $: hasReviewDue = reviewDueTasks.length > 0;
    $: hasOverdue = overdueTasks.length > 0;
    $: hasAny = hasReviewDue || hasOverdue;

    function handleMarkAllReviewed() {
        const blockIds = reviewDueTasks.map(t => t.blockId);
        if (blockIds.length > 0) {
            onMarkReviewed(blockIds);
        }
    }

    function handleMarkSingleReviewed(blockId: string) {
        onMarkReviewed([blockId]);
    }
</script>

<div class="na-review-due">
    <span class="na-review-due__title">{i18n?.reviewDueTitle || "Tasks to Review"}</span>

    {#if !hasAny}
        <div class="na-review-due__empty">{i18n?.reviewDueEmpty || "All caught up!"}</div>
    {:else}
        {#if hasReviewDue}
            <div class="na-review-due__group">
                <button class="na-review-due__group-header" on:click={() => reviewDueExpanded = !reviewDueExpanded}>
                    <span class="na-review-due__group-label">{i18n?.reviewDueGroup || "Review Due"}</span>
                    <span class="na-review-due__group-count">{reviewDueTasks.length}</span>
                    <span class="na-review-due__group-chevron" class:rotated={reviewDueExpanded}>
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg>
                    </span>
                </button>
                {#if reviewDueExpanded}
                    <div class="na-review-due__group-actions">
                        <button class="na-review-due__mark-all" on:click={handleMarkAllReviewed}>
                            {i18n?.reviewMarkAllReviewed || "Mark all reviewed"}
                        </button>
                    </div>
                    <div class="na-review-due__group-body">
                        {#each reviewDueTasks as task}
                            <div class="na-review-due__task-row">
                                <TaskCard
                                    {task}
                                    {selectedTaskId}
                                    onSelect={onSelectTask}
                                    onEdit={onEdit}
                                    onStatusClick={onStatusClick}
                                    onContextMenu={onContextMenu}
                                    {i18n}
                                />
                                <button class="na-review-due__mark-btn" on:click|stopPropagation={() => handleMarkSingleReviewed(task.blockId)}>
                                    {i18n?.reviewMarkReviewed || "Reviewed"}
                                </button>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}

        {#if hasOverdue}
            <div class="na-review-due__group">
                <button class="na-review-due__group-header" on:click={() => overdueExpanded = !overdueExpanded}>
                    <span class="na-review-due__group-label">{i18n?.reviewOverdueGroup || "Overdue"}</span>
                    <span class="na-review-due__group-count">{overdueTasks.length}</span>
                    <span class="na-review-due__group-chevron" class:rotated={overdueExpanded}>
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"/></svg>
                    </span>
                </button>
                {#if overdueExpanded}
                    <div class="na-review-due__group-body">
                        {#each overdueTasks as task}
                            <TaskCard
                                {task}
                                {selectedTaskId}
                                onSelect={onSelectTask}
                                onEdit={onEdit}
                                onStatusClick={onStatusClick}
                                onContextMenu={onContextMenu}
                                {i18n}
                            />
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
    {/if}
</div>

<style lang="scss">
    .na-review-due {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-md);
    }

    .na-review-due__title {
        font-size: var(--na-font-size-md);
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }

    .na-review-due__empty {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-light);
        padding: var(--na-space-lg) 0;
        text-align: center;
    }

    .na-review-due__group {
        display: flex;
        flex-direction: column;
        background: var(--b3-theme-surface);
        border-radius: var(--na-radius-lg);
        border: 1px solid var(--na-color-divider);
        overflow: hidden;
    }

    .na-review-due__group-header {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm);
        width: 100%;
        padding: var(--na-space-sm) var(--na-space-md);
        background: none;
        border: none;
        cursor: pointer;
        color: var(--b3-theme-on-surface);
    }

    .na-review-due__group-header:hover {
        background: var(--b3-theme-surface-lighter);
    }

    .na-review-due__group-label {
        flex: 1;
        font-size: var(--na-font-size-md);
        font-weight: 500;
        text-align: left;
    }

    .na-review-due__group-count {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface-light);
        font-variant-numeric: tabular-nums;
        background: var(--b3-theme-surface-lighter);
        border-radius: 8px;
        padding: 1px 6px;
    }

    .na-review-due__group-chevron {
        display: flex;
        align-items: center;
        color: var(--b3-theme-on-surface-light);
        transition: transform 0.2s ease;
    }

    .na-review-due__group-chevron.rotated {
        transform: rotate(180deg);
    }

    .na-review-due__group-actions {
        padding: 0 var(--na-space-md);
        padding-bottom: var(--na-space-xs);
    }

    .na-review-due__mark-all {
        font-size: var(--na-font-size-sm);
        color: var(--na-color-done);
        background: none;
        border: none;
        cursor: pointer;
        padding: var(--na-space-xxs) 0;
    }

    .na-review-due__mark-all:hover {
        text-decoration: underline;
    }

    .na-review-due__group-body {
        padding: 0 var(--na-space-md) var(--na-space-sm);
        display: flex;
        flex-direction: column;
        gap: var(--na-space-xs);
    }

    .na-review-due__task-row {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm);
    }

    .na-review-due__task-row > :global(.na-task-card) {
        flex: 1;
        min-width: 0;
    }

    .na-review-due__mark-btn {
        font-size: var(--na-font-size-sm);
        color: var(--na-color-done);
        background: none;
        border: 1px solid var(--na-color-done);
        border-radius: var(--na-radius-sm);
        cursor: pointer;
        padding: 2px 8px;
        white-space: nowrap;
        flex-shrink: 0;
    }

    .na-review-due__mark-btn:hover {
        background: var(--na-color-done);
        color: var(--b3-theme-on-primary);
    }
</style>
```

- [ ] **步骤 2：Commit**

```bash
git add src/frontend/components/ReviewDueList.svelte
git commit -m "feat(review): create ReviewDueList component with batch mark reviewed"
```

---

### 任务 11：前端侧 — TaskDetail 新增回顾字段

**文件：**
- 修改：`src/frontend/components/TaskDetail.svelte`

- [ ] **步骤 1：在 TaskDetail 的字段编辑区域，找到现有字段（如 repeat 或 note 字段）的渲染位置，在其之后新增回顾间隔和下次回顾日期两个编辑区域**

需要在 TaskDetail 的模板中，找到类似 `na-repeat` 或 `na-note` 字段的编辑区块之后，新增回顾相关字段。具体插入位置：在 `na-note`（备注）字段之后。

**回顾间隔字段**：使用一个 select + 自定义输入的组合。由于项目已有 NaSearchSelect 组件，但回顾间隔只需简单的数字选择，使用原生 select + 条件输入更简洁：

```svelte
    <!-- Review Interval -->
    <div class="na-detail__field">
        <label class="na-detail__label">{i18n?.reviewInterval || "Review Interval"}</label>
        <div class="na-detail__review-interval">
            <select class="na-detail__select" bind:value={reviewIntervalMode} on:change={handleReviewIntervalChange}>
                <option value="0">{i18n?.reviewIntervalNone || "None"}</option>
                <option value="7">7 {i18n?.days || "days"}</option>
                <option value="14">14 {i18n?.days || "days"}</option>
                <option value="30">30 {i18n?.days || "days"}</option>
                <option value="60">60 {i18n?.days || "days"}</option>
                <option value="90">90 {i18n?.days || "days"}</option>
                <option value="custom">{i18n?.reviewIntervalCustom || "Custom"}</option>
            </select>
            {#if reviewIntervalMode === "custom"}
                <input
                    type="number"
                    class="na-detail__input"
                    min="1"
                    max="365"
                    bind:value={reviewIntervalCustom}
                    on:change={handleReviewIntervalCustomChange}
                    placeholder={i18n?.reviewIntervalDays || "Days"}
                />
            {/if}
        </div>
    </div>

    <!-- Next Review Date -->
    <div class="na-detail__field">
        <label class="na-detail__label">{i18n?.reviewDate || "Next Review"}</label>
        <NaDatePicker
            value={task.reviewDate}
            on:change={(e) => handleFieldChange('na-review-date', e.detail || '')}
        />
    </div>
```

- [ ] **步骤 2：在 TaskDetail 的 script 中添加回顾间隔的状态变量和处理函数**

在 script 区域的现有变量声明处新增：

```typescript
    let reviewIntervalMode: string = "0";
    let reviewIntervalCustom: string = "";

    $: {
        const interval = task?.reviewInterval || 0;
        if (interval === 0) {
            reviewIntervalMode = "0";
        } else if ([7, 14, 30, 60, 90].includes(interval)) {
            reviewIntervalMode = String(interval);
        } else {
            reviewIntervalMode = "custom";
            reviewIntervalCustom = String(interval);
        }
    }

    function handleReviewIntervalChange() {
        if (reviewIntervalMode === "0") {
            handleFieldChange("na-review-interval", "");
            handleFieldChange("na-review-date", "");
        } else if (reviewIntervalMode === "custom") {
            // Don't save yet, wait for custom input
        } else {
            const days = parseInt(reviewIntervalMode);
            handleFieldChange("na-review-interval", String(days));
            // Auto-set first review-date if not already set
            if (!task.reviewDate) {
                const today = new Date().toISOString().slice(0, 10);
                const next = addDaysToDate(today, days);
                handleFieldChange("na-review-date", next);
            }
        }
    }

    function handleReviewIntervalCustomChange() {
        const days = parseInt(reviewIntervalCustom);
        if (days > 0 && days <= 365) {
            handleFieldChange("na-review-interval", String(days));
            if (!task.reviewDate) {
                const today = new Date().toISOString().slice(0, 10);
                const next = addDaysToDate(today, days);
                handleFieldChange("na-review-date", next);
            }
        }
    }

    function addDaysToDate(dateStr: string, days: number): string {
        const d = new Date(dateStr + "T00:00:00");
        d.setDate(d.getDate() + days);
        return d.toISOString().slice(0, 10);
    }
```

注意：`handleFieldChange` 是 TaskDetail 中已有的防抖保存函数，直接复用。需要确认该函数支持 `na-review-interval` 和 `na-review-date` 键（它会自动归一化 `na-*` 为 `custom-na-*`）。

- [ ] **步骤 3：添加回顾间隔组合输入的样式**

在 TaskDetail 的 `<style>` 块中新增：

```scss
    .na-detail__review-interval {
        display: flex;
        gap: var(--na-space-sm);
        align-items: center;
    }

    .na-detail__review-interval .na-detail__select {
        flex: 1;
    }

    .na-detail__review-interval .na-detail__input {
        width: 60px;
    }
```

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/components/TaskDetail.svelte
git commit -m "feat(review): add review interval and review date fields to TaskDetail"
```

---

### 任务 12：前端侧 — TaskCard 新增回顾小图标

**文件：**
- 修改：`src/frontend/components/TaskCard.svelte`

- [ ] **步骤 1：在 TaskCard 的标记区域（如 repeat 图标或 context 标签附近），新增回顾小图标**

找到 TaskCard 中显示 repeat 图标或 badges 的位置。在已有的图标区域中（例如 repeat 循环图标旁边），新增条件渲染的回顾日历图标：

```svelte
    {#if task.reviewInterval > 0}
        <span class="na-task-card__review-icon" title="{i18n?.reviewIntervalTooltip || 'Review every'} {task.reviewInterval} {i18n?.days || 'days'}">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="3" width="12" height="11" rx="1.5"/>
                <line x1="2" y1="6.5" x2="14" y2="6.5"/>
                <line x1="5.5" y1="1.5" x2="5.5" y2="4"/>
                <line x1="10.5" y1="1.5" x2="10.5" y2="4"/>
            </svg>
        </span>
    {/if}
```

- [ ] **步骤 2：添加回顾图标样式**

在 TaskCard 的 `<style>` 块中新增：

```scss
    .na-task-card__review-icon {
        display: inline-flex;
        align-items: center;
        color: var(--b3-theme-on-surface-light);
        flex-shrink: 0;
    }
```

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/TaskCard.svelte
git commit -m "feat(review): add review calendar icon to TaskCard"
```

---

### 任务 13：i18n 国际化文案

**文件：**
- 修改：`src/i18n/en.json`
- 修改：`src/i18n/zh-CN.json`

- [ ] **步骤 1：在 en.json 中新增回顾相关文案**

在 JSON 对象中新增以下 key（与现有 key 同级）：

```json
    "review": "Review",
    "reviewGuideTitle": "Review Checklist",
    "reviewOverdue": "Overdue Tasks",
    "reviewNextActions": "Next Actions",
    "reviewWaiting": "Waiting Tasks",
    "reviewSomeday": "Someday / Maybe",
    "reviewProjects": "Project Progress",
    "reviewNoTasks": "No tasks",
    "reviewDueTitle": "Tasks to Review",
    "reviewDueEmpty": "All caught up!",
    "reviewDueGroup": "Review Due",
    "reviewOverdueGroup": "Overdue",
    "reviewMarkAllReviewed": "Mark all reviewed",
    "reviewMarkReviewed": "Reviewed",
    "reviewInterval": "Review Interval",
    "reviewIntervalNone": "None",
    "reviewIntervalCustom": "Custom",
    "reviewIntervalDays": "Days",
    "reviewIntervalTooltip": "Review every",
    "reviewDate": "Next Review",
    "days": "days"
```

- [ ] **步骤 2：在 zh-CN.json 中新增回顾相关文案**

在 JSON 对象中新增以下 key：

```json
    "review": "回顾",
    "reviewGuideTitle": "回顾检查清单",
    "reviewOverdue": "检查逾期任务",
    "reviewNextActions": "审视下一步行动",
    "reviewWaiting": "检查等待中的任务",
    "reviewSomeday": "审视将来/也许",
    "reviewProjects": "检查项目进度",
    "reviewNoTasks": "暂无任务",
    "reviewDueTitle": "待回顾任务",
    "reviewDueEmpty": "全部处理完毕！",
    "reviewDueGroup": "回顾到期",
    "reviewOverdueGroup": "逾期任务",
    "reviewMarkAllReviewed": "全部标记已回顾",
    "reviewMarkReviewed": "已回顾",
    "reviewInterval": "回顾间隔",
    "reviewIntervalNone": "无",
    "reviewIntervalCustom": "自定义",
    "reviewIntervalDays": "天",
    "reviewIntervalTooltip": "每",
    "reviewDate": "下次回顾",
    "days": "天"
```

- [ ] **步骤 3：Commit**

```bash
git add src/i18n/en.json src/i18n/zh-CN.json
git commit -m "feat(review): add i18n strings for review feature"
```

---

### 任务 14：构建验证与集成测试

**文件：** 无新文件

- [ ] **步骤 1：运行生产构建确认无编译错误**

```bash
pnpm run build
```

预期：构建成功，无 TypeScript 错误，无 Svelte 编译错误

- [ ] **步骤 2：运行 dev 模式确认热更新正常**

```bash
pnpm run dev
```

预期：kernel.js 和 index.js 均正常编译，无运行时错误

- [ ] **步骤 3：部署到思源并手动验证核心流程**

```bash
pnpm run release
```

在思源中验证：
1. NavRail 出现回顾 Tab，badge 数字显示正确
2. 点击回顾 Tab，回顾指南面板5个检查项可折叠展开
3. 下半区显示"回顾到期"和"逾期任务"分组
4. 打开 TaskDetail，可设置回顾间隔和下次回顾日期
5. 点击"已回顾"按钮后任务从列表消失，下次回顾日期正确推算
6. "全部标记已回顾"批量操作正常
7. TaskCard 上有回顾小图标
8. 完成有回顾间隔的任务后，下次回顾日期自动推算

- [ ] **步骤 4：Commit 构建验证通过的最终状态**

```bash
git add -A
git commit -m "feat(review): complete review feature implementation"
```
