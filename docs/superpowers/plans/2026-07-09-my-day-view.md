# "我的一天"视图 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 NextAction 插件新增"我的一天"视图，用户可以从全局任务池挑选今天要专注的任务，并自动在跨天时清空规划。

**架构：** 内核侧新增 `MyDayManager` 管理每日任务篮的持久化状态（通过 `siyuan.storage` 读写 JSON 文件），注册 5 个 RPC 方法。前端侧新增 `MyDayView` 组件，从 store 合并 `MyDayState.tasks` + `taskStore.allTasks` 渲染任务列表，右键菜单增加"加入我的一天"/"从我的一天移除"操作。

**技术栈：** Svelte 组件、思源内核 RPC、`siyuan.storage` 持久化、Pointer 拖拽（复用 drag-handler）

---

## 文件结构

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| 创建 | `src/kernel/my-day-manager.ts` | 我的一天状态管理：加载/保存/跨天重置/增删/排序 |
| 创建 | `src/frontend/components/MyDayView.svelte` | 我的一天视图 UI 组件 |
| 修改 | `src/shared/types.ts` | 新增 `MyDayTaskEntry`、`MyDayState` 类型 |
| 修改 | `src/shared/constants.ts` | 新增 `MY_DAY_DATA_PATH` 常量 |
| 修改 | `src/shared/settings.ts` | 新增 `myDayResetHour` 设置项 |
| 修改 | `src/kernel/task-service.ts` | 注入 `MyDayManager`，代理我的一天 RPC 调用 |
| 修改 | `src/kernel/rpc-server.ts` | 注册 5 个新 RPC 方法 |
| 修改 | `src/kernel.ts` | 创建 `MyDayManager` 实例并传入 `TaskService` |
| 修改 | `src/frontend/constants.ts` | 新增 `VIEW_MY_DAY` |
| 修改 | `src/frontend/kernel-bridge.ts` | 新增 5 个 RPC 调用方法 |
| 修改 | `src/frontend/stores/task-store.ts` | 新增 `myDayState` + `DEFAULT_FILTERS` 条目 |
| 修改 | `src/frontend/components/NavRail.svelte` | 新增导航项 + 太阳图标 SVG |
| 修改 | `src/frontend/components/NextActionApp.svelte` | 新增视图分支 + 我的一天数据加载 |
| 修改 | `src/frontend/components/task-context-menu.ts` | 新增"加入我的一天"/"从我的一天移除"菜单项 |
| 修改 | `src/i18n/zh-CN.json` | 新增中文翻译 |
| 修改 | `src/i18n/en.json` | 新增英文翻译 |

---

### 任务 1：共享类型和常量

**文件：**
- 修改：`src/shared/types.ts`
- 修改：`src/shared/constants.ts`
- 修改：`src/shared/settings.ts`

- [ ] **步骤 1：在 `src/shared/types.ts` 末尾（`export type` 行之前）添加 My Day 类型**

```typescript
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
```

- [ ] **步骤 2：在 `src/shared/constants.ts` 末尾添加数据存储路径常量**

```typescript
export const MY_DAY_DATA_PATH = "my-day-v1.json";
export const DEFAULT_MY_DAY_RESET_HOUR = 5;
```

- [ ] **步骤 3：在 `src/shared/settings.ts` 的 `PluginSettings` 接口末尾添加设置项**

在 `PluginSettings` 接口中 `priorityEngine` 之后添加：

```typescript
    myDayResetHour: number;
```

在 `DEFAULT_SETTINGS` 对象中 `priorityEngine` 之后添加：

```typescript
    myDayResetHour: 5,
```

在 `validateSettings` 函数中 `return null` 之前添加校验：

```typescript
    if (settings.myDayResetHour !== undefined) {
        if (!Number.isInteger(settings.myDayResetHour) || settings.myDayResetHour < 0 || settings.myDayResetHour > 23) {
            return "myDayResetHour must be integer 0-23";
        }
    }
```

在 `mergeSettings` 函数中 `return` 对象里 `priorityEngine` 之后添加：

```typescript
        myDayResetHour: override.myDayResetHour ?? base.myDayResetHour,
```

- [ ] **步骤 4：构建验证**

运行：`pnpm run build`
预期：编译成功，无类型错误

- [ ] **步骤 5：Commit**

```bash
git add src/shared/types.ts src/shared/constants.ts src/shared/settings.ts
git commit -m "feat(my-day): add shared types, constants, and settings"
```

---

### 任务 2：内核 MyDayManager

**文件：**
- 创建：`src/kernel/my-day-manager.ts`

- [ ] **步骤 1：创建 `src/kernel/my-day-manager.ts`**

```typescript
import type { MyDayState, MyDayTaskEntry } from "../shared/types";
import { MY_DAY_DATA_PATH, DEFAULT_MY_DAY_RESET_HOUR } from "../shared/constants";
import type { PluginSettings } from "../shared/settings";
import { DEFAULT_SETTINGS } from "../shared/settings";

function resolveDayKey(now: Date, resetHour: number): string {
    const boundaryHour = Math.max(0, Math.min(23, resetHour));
    const effectiveDate = new Date(now);
    if (effectiveDate.getHours() < boundaryHour) {
        effectiveDate.setDate(effectiveDate.getDate() - 1);
    }
    const year = effectiveDate.getFullYear();
    const month = String(effectiveDate.getMonth() + 1).padStart(2, "0");
    const day = String(effectiveDate.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function createDefaultMyDayState(dayKey: string): MyDayState {
    return {
        schema: 1,
        dayKey,
        tasks: [],
        updatedAt: Date.now(),
    };
}

export class MyDayManager {
    private siyuan: any;
    private settings: PluginSettings;
    private state: MyDayState | null = null;

    constructor(siyuan: any, settings: PluginSettings) {
        this.siyuan = siyuan;
        this.settings = settings;
    }

    updateSettings(settings: PluginSettings): void {
        this.settings = settings;
    }

    private getResetHour(): number {
        return this.settings.myDayResetHour ?? DEFAULT_MY_DAY_RESET_HOUR;
    }

    async load(): Promise<MyDayState> {
        const currentDayKey = resolveDayKey(new Date(), this.getResetHour());
        try {
            const data = await this.siyuan.storage.get(MY_DAY_DATA_PATH);
            const raw = await data.text();
            if (raw && raw.trim()) {
                const parsed = JSON.parse(raw) as MyDayState;
                if (parsed.schema === 1 && parsed.dayKey === currentDayKey) {
                    this.state = parsed;
                    return this.state;
                }
            }
        } catch (_e) {
            // file does not exist or parse error — create fresh
        }
        this.state = createDefaultMyDayState(currentDayKey);
        await this.persist();
        return this.state;
    }

    async getState(): Promise<MyDayState> {
        if (!this.state) {
            return this.load();
        }
        const currentDayKey = resolveDayKey(new Date(), this.getResetHour());
        if (this.state.dayKey !== currentDayKey) {
            this.state = createDefaultMyDayState(currentDayKey);
            await this.persist();
        }
        return this.state;
    }

    private async persist(): Promise<void> {
        if (!this.state) return;
        this.state.updatedAt = Date.now();
        await this.siyuan.storage.put(MY_DAY_DATA_PATH, JSON.stringify(this.state));
    }

    async addTask(blockId: string): Promise<MyDayState> {
        const state = await this.getState();
        const existing = state.tasks.find(t => t.blockId === blockId);
        if (existing) return state;
        const maxOrder = state.tasks.length > 0
            ? Math.max(...state.tasks.map(t => t.order))
            : 0;
        const entry: MyDayTaskEntry = {
            blockId,
            addedAt: Date.now(),
            scheduleStart: null,
            scheduleEnd: null,
            order: maxOrder + 1,
        };
        state.tasks.push(entry);
        await this.persist();
        return state;
    }

    async removeTask(blockId: string): Promise<MyDayState> {
        const state = await this.getState();
        state.tasks = state.tasks.filter(t => t.blockId !== blockId);
        await this.persist();
        return state;
    }

    async reorderTask(blockId: string, afterId?: string): Promise<MyDayState> {
        const state = await this.getState();
        const idx = state.tasks.findIndex(t => t.blockId === blockId);
        if (idx === -1) return state;
        const [entry] = state.tasks.splice(idx, 1);
        if (afterId) {
            const afterIdx = state.tasks.findIndex(t => t.blockId === afterId);
            if (afterIdx >= 0) {
                state.tasks.splice(afterIdx + 1, 0, entry);
            } else {
                state.tasks.push(entry);
            }
        } else {
            state.tasks.unshift(entry);
        }
        state.tasks.forEach((t, i) => { t.order = i; });
        await this.persist();
        return state;
    }

    async setSchedule(blockId: string, start: number | null, end: number | null): Promise<MyDayState> {
        const state = await this.getState();
        const entry = state.tasks.find(t => t.blockId === blockId);
        if (!entry) return state;
        entry.scheduleStart = start;
        entry.scheduleEnd = end;
        await this.persist();
        return state;
    }
}
```

- [ ] **步骤 2：构建验证**

运行：`pnpm run build:kernel`
预期：编译成功

- [ ] **步骤 3：Commit**

```bash
git add src/kernel/my-day-manager.ts
git commit -m "feat(my-day): add MyDayManager with storage, day-reset, CRUD"
```

---

### 任务 3：内核集成 — TaskService + RPC + 入口

**文件：**
- 修改：`src/kernel.ts`
- 修改：`src/kernel/task-service.ts`
- 修改：`src/kernel/rpc-server.ts`

- [ ] **步骤 1：在 `src/kernel.ts` 中创建 MyDayManager 并传入 TaskService**

在 import 区域添加：

```typescript
import { MyDayManager } from "./kernel/my-day-manager";
```

在 `onload` 方法中，`this.taskService = new TaskService(...)` 之前添加：

```typescript
const myDayManager = new MyDayManager(this.siyuan, { ...DEFAULT_SETTINGS });
```

修改 `TaskService` 构造调用，添加 `myDayManager` 参数：

```typescript
this.taskService = new TaskService(this.cacheManager, this.mutex, this.syncEngine, myDayManager);
```

在 `cacheManager.loadAll().then(...)` 的 then 回调中，`this.taskService.setIsReady(true)` 之前添加：

```typescript
await myDayManager.load();
```

- [ ] **步骤 2：修改 `src/kernel/task-service.ts`**

在 import 区域添加：

```typescript
import { MyDayManager } from "./my-day-manager";
```

在 `TaskService` 类中添加属性：

```typescript
    private myDayManager: MyDayManager;
```

修改构造函数签名为：

```typescript
    constructor(cacheManager: CacheManager, mutex: Mutex, syncEngine: SyncEngine, myDayManager: MyDayManager) {
```

在构造函数体内赋值：

```typescript
        this.myDayManager = myDayManager;
```

在 `updateSettings` 方法中，`return this.settings;` 之前添加：

```typescript
        this.myDayManager.updateSettings(this.settings);
```

在 `TaskService` 类末尾（`getStatistics` 方法之后）添加代理方法：

```typescript
    async getMyDay(): Promise<MyDayState> {
        this.checkReady();
        return this.myDayManager.getState();
    }

    async addTaskToMyDay(blockId: string): Promise<MyDayState> {
        this.checkReady();
        return this.myDayManager.addTask(blockId);
    }

    async removeTaskFromMyDay(blockId: string): Promise<MyDayState> {
        this.checkReady();
        return this.myDayManager.removeTask(blockId);
    }

    async reorderMyDayTask(blockId: string, afterId?: string): Promise<MyDayState> {
        this.checkReady();
        return this.myDayManager.reorderTask(blockId, afterId);
    }

    async setMyDaySchedule(blockId: string, start: number | null, end: number | null): Promise<MyDayState> {
        this.checkReady();
        return this.myDayManager.setSchedule(blockId, start, end);
    }
```

在文件顶部 import 区域添加（如果尚未存在）：

```typescript
import type { MyDayState } from "../shared/types";
```

- [ ] **步骤 3：在 `src/kernel/rpc-server.ts` 中注册新 RPC 方法**

在文件顶部 import 区域添加：

```typescript
import type { MyDayState } from "../shared/types";
```

在 `registerRpcMethods` 函数末尾（`getSettings` 方法注册之后，闭合大括号之前）添加：

```typescript
    siyuan.rpc.bind("getMyDay", async (..._params: any[]) => {
        try {
            return await taskService.getMyDay();
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("addTaskToMyDay", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId is required");
        }
        try {
            return await taskService.addTaskToMyDay(p.blockId);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("removeTaskFromMyDay", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId is required");
        }
        try {
            return await taskService.removeTaskFromMyDay(p.blockId);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("reorderMyDayTask", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId is required");
        }
        try {
            return await taskService.reorderMyDayTask(p.blockId, p.afterId ?? undefined);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });

    siyuan.rpc.bind("setMyDaySchedule", async (...params: any[]) => {
        const p = params[0] || {};
        if (!p.blockId) {
            return rpcError(RPC_ERROR_INVALID_PARAMS, "blockId is required");
        }
        try {
            return await taskService.setMyDaySchedule(p.blockId, p.start ?? null, p.end ?? null);
        } catch (e: any) {
            return errorToRpcError(e);
        }
    });
```

- [ ] **步骤 4：构建验证**

运行：`pnpm run build`
预期：两个 bundle 均编译成功

- [ ] **步骤 5：Commit**

```bash
git add src/kernel.ts src/kernel/task-service.ts src/kernel/rpc-server.ts
git commit -m "feat(my-day): integrate MyDayManager into TaskService and RPC"
```

---

### 任务 4：前端 KernelBridge + task-store

**文件：**
- 修改：`src/frontend/kernel-bridge.ts`
- 修改：`src/frontend/stores/task-store.ts`
- 修改：`src/frontend/constants.ts`

- [ ] **步骤 1：在 `src/frontend/constants.ts` 中添加视图常量**

在 `VIEW_WAITING` 之后添加：

```typescript
export const VIEW_MY_DAY = "myDay";
```

修改 `ViewType` 联合类型，在 `typeof VIEW_WAITING` 之后添加 `| typeof VIEW_MY_DAY`：

```typescript
export type ViewType = typeof VIEW_NEXT_ACTION | typeof VIEW_ALL_TASKS | typeof VIEW_BY_PROJECT | typeof VIEW_SOMEDAY | typeof VIEW_WAITING | typeof VIEW_MY_DAY | typeof VIEW_STATISTICS;
```

- [ ] **步骤 2：在 `src/frontend/kernel-bridge.ts` 中添加 RPC 调用方法**

在 import 区域修改类型导入，添加 `MyDayState`：

```typescript
import type { TaskCacheEntry, TaskChangeNotification, StatisticsResult, PluginSettings, MyDayState } from "../shared/types";
```

在 `KernelBridge` 类末尾（`getSettings` 方法之后，`bindTasksChanged` 之前）添加：

```typescript
    async getMyDay(): Promise<MyDayState> {
        return this.call("getMyDay", {});
    }

    async addTaskToMyDay(blockId: string): Promise<MyDayState> {
        return this.call("addTaskToMyDay", { blockId });
    }

    async removeTaskFromMyDay(blockId: string): Promise<MyDayState> {
        return this.call("removeTaskFromMyDay", { blockId });
    }

    async reorderMyDayTask(blockId: string, afterId?: string): Promise<MyDayState> {
        return this.call("reorderMyDayTask", { blockId, afterId: afterId ?? null });
    }

    async setMyDaySchedule(blockId: string, start: number | null, end: number | null): Promise<MyDayState> {
        return this.call("setMyDaySchedule", { blockId, start, end });
    }
```

- [ ] **步骤 3：修改 `src/frontend/stores/task-store.ts`**

在 import 区域添加 `VIEW_MY_DAY`：

```typescript
import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY, VIEW_WAITING, VIEW_MY_DAY } from "../constants";
```

在 import 区域添加 `MyDayState` 类型：

```typescript
import type { TaskCacheEntry, TaskChangeNotification, MyDayState } from "../../shared/types";
```

在 `TaskState` 接口中 `showCompleted` 之后添加：

```typescript
    myDayState: MyDayState | null;
```

在 `DEFAULT_FILTERS` 对象中添加条目：

```typescript
    [VIEW_MY_DAY]: { ...DEFAULT_FILTER_STATE },
```

在 `createTaskStore` 的 `writable` 初始值中添加：

```typescript
        myDayState: null,
```

在 `return` 对象中，`setBridge` 之后添加加载方法：

```typescript
        async loadMyDay() {
            if (!bridge) return;
            try {
                const myDayState = await bridge.getMyDay();
                update(s => ({ ...s, myDayState }));
            } catch (e: any) {
                console.error("[NextAction] loadMyDay failed:", e);
            }
        },

        applyMyDayUpdate(myDayState: MyDayState) {
            update(s => ({ ...s, myDayState }));
        },
```

- [ ] **步骤 4：构建验证**

运行：`pnpm run build:app`
预期：编译成功

- [ ] **步骤 5：Commit**

```bash
git add src/frontend/constants.ts src/frontend/kernel-bridge.ts src/frontend/stores/task-store.ts
git commit -m "feat(my-day): add frontend KernelBridge methods and store state"
```

---

### 任务 5：NavRail 导航 + NextActionApp 路由

**文件：**
- 修改：`src/frontend/components/NavRail.svelte`
- 修改：`src/frontend/components/NextActionApp.svelte`

- [ ] **步骤 1：修改 `NavRail.svelte`**

在 import 行添加 `VIEW_MY_DAY`：

```typescript
    import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY, VIEW_WAITING, VIEW_STATISTICS, VIEW_MY_DAY } from "../constants";
```

在 `navItems` 数组中，`VIEW_NEXT_ACTION` 条目之后插入新条目（排第二位）：

```typescript
        { view: VIEW_MY_DAY, icon: "myDay", label: i18n?.myDay || "My Day" },
```

在图标渲染的 `{#if}` 链中，`item.icon === "next"` 之后、`{:else if item.icon === "list"}` 之前添加：

```svelte
                {:else if item.icon === "myDay"}
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="10" cy="10" r="4"/>
                        <line x1="10" y1="2" x2="10" y2="3.5"/>
                        <line x1="10" y1="16.5" x2="10" y2="18"/>
                        <line x1="2" y1="10" x2="3.5" y2="10"/>
                        <line x1="16.5" y1="10" x2="18" y2="10"/>
                        <line x1="4.4" y1="4.4" x2="5.5" y2="5.5"/>
                        <line x1="14.5" y1="14.5" x2="15.6" y2="15.6"/>
                        <line x1="4.4" y1="15.6" x2="5.5" y2="14.5"/>
                        <line x1="14.5" y1="5.5" x2="15.6" y2="4.4"/>
                    </svg>
```

- [ ] **步骤 2：修改 `NextActionApp.svelte`**

在 import 区域添加 `VIEW_MY_DAY`：

```typescript
    import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY, VIEW_WAITING, VIEW_STATISTICS, VIEW_MY_DAY } from "../constants";
```

添加 MyDayView 组件导入：

```typescript
    import MyDayView from "./MyDayView.svelte";
```

在视图渲染的 `{:else if}` 链中，`VIEW_NEXT_ACTION` 分支之后、`{:else if activeView === VIEW_ALL_TASKS}` 之前添加：

```svelte
            {:else if activeView === VIEW_MY_DAY}
                <MyDayView
                    {bridge}
                    {selectedTaskId}
                    onSelectTask={handleSelectTask}
                    onEdit={handleEdit}
                    onStatusClick={handleStatusClick}
                    onContextMenu={handleContextMenu}
                    {i18n}
                />
```

- [ ] **步骤 3：构建验证**

运行：`pnpm run build:app`
预期：编译失败，因为 `MyDayView.svelte` 还不存在——这是预期的，下一步创建它

- [ ] **步骤 4：Commit（与任务 6 一起）**

此步骤的文件将与 MyDayView 组件一起提交。

---

### 任务 6：MyDayView 组件

**文件：**
- 创建：`src/frontend/components/MyDayView.svelte`

- [ ] **步骤 1：创建 `src/frontend/components/MyDayView.svelte`**

```svelte
<script lang="ts">
    import { onMount } from "svelte";
    import { taskStore } from "../stores/task-store";
    import { VIEW_MY_DAY } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import SearchFilterBar from "./SearchFilterBar.svelte";
    import type { TaskCacheEntry } from "../../shared/types";
    import type { KernelBridge } from "../kernel-bridge";

    export let bridge: KernelBridge;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;
    export let selectedTaskId: string = "";
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;

    $: filterState = $taskStore.filterByView[VIEW_MY_DAY] || DEFAULT_FILTER_STATE;

    $: myDayTasks = (() => {
        const state = $taskStore.myDayState;
        if (!state) return [];
        const taskMap = new Map<string, TaskCacheEntry>();
        for (const t of $taskStore.allTasks) {
            taskMap.set(t.blockId, t);
        }
        const result: TaskCacheEntry[] = [];
        for (const entry of state.tasks) {
            const task = taskMap.get(entry.blockId);
            if (task) result.push(task);
        }
        return result;
    })();

    $: filteredTasks = applyFilters(myDayTasks, filterState);

    const myDaySortOptions = [
        { value: "order", label: i18n?.sortByOrder || "Comprehensive" },
        { value: "due", label: i18n?.sortByDue || "Due date" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
    ];

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_MY_DAY, state);
    }

    onMount(() => {
        taskStore.loadMyDay();
    });
</script>

<div class="na-view na-view--myday">
    <div class="na-view__header">
        <div class="na-myday-title">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="var(--na-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="10" cy="10" r="4"/>
                <line x1="10" y1="2" x2="10" y2="3.5"/>
                <line x1="10" y1="16.5" x2="10" y2="18"/>
                <line x1="2" y1="10" x2="3.5" y2="10"/>
                <line x1="16.5" y1="10" x2="18" y2="10"/>
                <line x1="4.4" y1="4.4" x2="5.5" y2="5.5"/>
                <line x1="14.5" y1="14.5" x2="15.6" y2="15.6"/>
                <line x1="4.4" y1="15.6" x2="5.5" y2="14.5"/>
                <line x1="14.5" y1="5.5" x2="15.6" y2="4.4"/>
            </svg>
            <span class="na-myday-title__text">{i18n?.myDay || "My Day"}</span>
        </div>
    </div>
    <SearchFilterBar
        contexts={$taskStore.contexts}
        tags={$taskStore.tags}
        filterState={filterState}
        showStatus={true}
        showPriority={true}
        sortOptions={myDaySortOptions}
        {i18n}
        onFilterChange={handleFilterChange}
    />
    {#if $taskStore.loading}
        <NaEmpty loading={true} />
    {:else if filteredTasks.length === 0}
        <NaEmpty text={i18n?.noMyDayTasks || "No tasks planned for today. Right-click a task and choose 'Add to My Day'."} />
    {:else}
        <div class="na-view__list">
            {#each filteredTasks as task (task.blockId)}
                <TaskCard
                    {task}
                    selected={task.blockId === selectedTaskId}
                    onSelect={onSelectTask}
                    {onEdit}
                    {onStatusClick}
                    {onContextMenu}
                    {i18n}
                />
            {/each}
        </div>
    {/if}
</div>

<style lang="scss">
    .na-myday-title {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm, 6px);
        padding: var(--na-space-md, 8px) var(--na-space-lg, 12px);
    }

    .na-myday-title__text {
        font-size: var(--na-font-size-lg, 15px);
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }
</style>
```

- [ ] **步骤 2：构建验证**

运行：`pnpm run build`
预期：两个 bundle 均编译成功

- [ ] **步骤 3：Commit（与任务 5 的文件一起）**

```bash
git add src/frontend/components/NavRail.svelte src/frontend/components/NextActionApp.svelte src/frontend/components/MyDayView.svelte
git commit -m "feat(my-day): add MyDayView component, NavRail entry, and app routing"
```

---

### 任务 7：右键菜单扩展

**文件：**
- 修改：`src/frontend/components/task-context-menu.ts`

- [ ] **步骤 1：修改 `task-context-menu.ts`**

修改函数签名，增加 `currentView` 和 `onMyDayToggle` 参数：

```typescript
interface ContextMenuCallbacks {
    onUpdated: (updatedEntry: TaskCacheEntry) => void;
    onRemoved: (blockId: string) => void;
    onMyDayToggle?: (blockId: string, inMyDay: boolean) => void;
}

export function showTaskContextMenu(
    task: TaskCacheEntry,
    event: MouseEvent,
    bridge: KernelBridge,
    i18n: any,
    callbacks: ContextMenuCallbacks,
    currentView?: string,
    inMyDay?: boolean,
): void {
```

在 "Remove Task" 菜单项之前（`menu.addSeparator();` 之后、`menu.addItem({ icon: "iconTrashcan"...` 之前），添加：

```typescript
    if (callbacks.onMyDayToggle) {
        const isInMyDay = inMyDay ?? false;
        menu.addItem({
            icon: isInMyDay ? "iconClose" : "iconBookmark",
            label: isInMyDay
                ? (i18n?.removeFromMyDay || "Remove from My Day")
                : (i18n?.addToMyDay || "Add to My Day"),
            click: async () => {
                callbacks.onMyDayToggle!(task.blockId, isInMyDay);
            },
        });

        menu.addSeparator();
    }
```

- [ ] **步骤 2：修改 `NextActionApp.svelte` 中的 `handleContextMenu` 方法**

在 `handleContextMenu` 函数中，需要判断任务是否在"我的一天"中，并传入新参数：

```typescript
    function handleContextMenu(task: TaskCacheEntry, event: MouseEvent) {
        const inMyDay = $taskStore.myDayState?.tasks.some(t => t.blockId === task.blockId) ?? false;
        showTaskContextMenu(task, event, bridge, i18n, {
            onUpdated: (updated) => {
                taskStore.applyUpdate(updated);
                if (selectedTask && selectedTask.blockId === updated.blockId) {
                    selectedTask = updated;
                }
            },
            onRemoved: (blockId) => {
                taskStore.applyRemove(blockId);
                if (selectedTask && selectedTask.blockId === blockId) {
                    selectedTask = null;
                }
            },
            onMyDayToggle: async (blockId, isInMyDay) => {
                try {
                    let myDayState;
                    if (isInMyDay) {
                        myDayState = await bridge.removeTaskFromMyDay(blockId);
                    } else {
                        myDayState = await bridge.addTaskToMyDay(blockId);
                    }
                    taskStore.applyMyDayUpdate(myDayState);
                } catch (e: any) {
                    console.error("[NextAction] myDay toggle failed:", e);
                }
            },
        }, activeView, inMyDay);
    }
```

注意：`NextActionApp.svelte` 中需要确保 `taskStore` 的 `myDayState` 是响应式可访问的。由于 `$taskStore` 已在组件中通过 `import { taskStore } from "../stores/task-store"` 使用，需要添加：

```typescript
    import { taskStore } from "../stores/task-store";
```

（如果尚未导入的话——当前代码中没有直接导入 taskStore，需要添加。）

同时还需要在组件的 `<script>` 区域确保 `activeView` 变量在 `handleContextMenu` 函数内可访问——它已经是模块级变量，可以直接使用。

- [ ] **步骤 3：构建验证**

运行：`pnpm run build`
预期：编译成功

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/components/task-context-menu.ts src/frontend/components/NextActionApp.svelte
git commit -m "feat(my-day): add Add/Remove from My Day to context menu"
```

---

### 任务 8：i18n 翻译

**文件：**
- 修改：`src/i18n/zh-CN.json`
- 修改：`src/i18n/en.json`

- [ ] **步骤 1：在 `src/i18n/zh-CN.json` 中添加翻译**

在文件末尾 `"rebuildCacheDesc"` 行之后添加（注意在上一行末尾添加逗号）：

```json
    "myDay": "我的一天",
    "noMyDayTasks": "今天还没有规划，右键任务选择「加入我的一天」",
    "addToMyDay": "加入我的一天",
    "removeFromMyDay": "从我的一天移除",
    "myDayResetHour": "每日重置时间",
    "myDayResetHourDesc": "在此时间之前仍属于前一天（0-23）"
```

- [ ] **步骤 2：在 `src/i18n/en.json` 中添加翻译**

在文件末尾 `"rebuildCacheDesc"` 行之后添加（注意在上一行末尾添加逗号）：

```json
    "myDay": "My Day",
    "noMyDayTasks": "No tasks planned for today. Right-click a task and choose 'Add to My Day'.",
    "addToMyDay": "Add to My Day",
    "removeFromMyDay": "Remove from My Day",
    "myDayResetHour": "Daily Reset Hour",
    "myDayResetHourDesc": "Before this hour still counts as the previous day (0-23)"
```

- [ ] **步骤 3：构建验证**

运行：`pnpm run build`
预期：编译成功

- [ ] **步骤 4：Commit**

```bash
git add src/i18n/zh-CN.json src/i18n/en.json
git commit -m "feat(my-day): add i18n translations for My Day view"
```

---

### 任务 9：端到端验证

**文件：** 无新增

- [ ] **步骤 1：完整构建**

运行：`pnpm run build`
预期：kernel.js + dist/index.js 均生成成功，无 TypeScript 错误

- [ ] **步骤 2：部署到思源**

运行：`pnpm run release`
预期：文件复制到思源插件目录

- [ ] **步骤 3：手动功能验证**

在思源中验证以下场景：

1. 点击左侧 NavRail 第二个图标（太阳），切换到"我的一天"视图
2. 空状态正确显示引导文字
3. 切换到其他视图（如"全部任务"），右键任务，菜单中出现"加入我的一天"
4. 点击"加入我的一天"，切回"我的一天"视图，任务出现在列表中
5. 在"我的一天"视图右键任务，菜单中出现"从我的一天移除"
6. 点击"从我的一天移除"，任务从列表消失
7. 修改思源 `storage/my-day-v1.json` 中的 `dayKey` 为昨天的日期，刷新页面，验证列表被清空

- [ ] **步骤 4：最终 Commit（如有修复）**

如果验证中发现问题并修复，提交修复：

```bash
git add -A
git commit -m "fix(my-day): address issues found during e2e verification"
```

---

## 自检

### 1. 规格覆盖度

| 需求 | 任务 |
|------|------|
| 新增"我的一天"Tab | 任务 5（NavRail + NextActionApp） |
| 每日任务篮 | 任务 6（MyDayView 组件） |
| 添加任务（右键菜单） | 任务 7（上下文菜单扩展） |
| 移除任务 | 任务 7（上下文菜单扩展） |
| 自动清空（跨天检测） | 任务 2（MyDayManager.resolveDayKey + getState） |
| 简单排序 | 任务 2（reorderTask）+ 任务 4（store + bridge） |
| 数据持久化 | 任务 2（siyuan.storage） |
| i18n | 任务 8 |

覆盖完整，无遗漏。

### 2. 占位符扫描

- 无"待定"、"TODO"、"后续实现"等占位符
- 所有步骤均包含完整代码
- 无"类似任务 N"的引用

### 3. 类型一致性

- `MyDayTaskEntry.blockId` — 类型 `string`，与 `TaskCacheEntry.blockId` 一致
- `MyDayState` — 在 `types.ts` 中定义，在 `my-day-manager.ts`、`task-service.ts`、`kernel-bridge.ts`、`task-store.ts`、`MyDayView.svelte` 中一致使用
- `MY_DAY_DATA_PATH` — 在 `constants.ts` 中定义，在 `my-day-manager.ts` 中使用
- `VIEW_MY_DAY` — 在 `constants.ts` 中定义，在 `NavRail.svelte`、`NextActionApp.svelte`、`task-store.ts`、`MyDayView.svelte` 中一致使用
- `myDayResetHour` — 在 `settings.ts` 中添加到 `PluginSettings`，在 `MyDayManager` 中通过 `settings.myDayResetHour` 访问
- RPC 方法名（`getMyDay`、`addTaskToMyDay`、`removeTaskFromMyDay`、`reorderMyDayTask`、`setMyDaySchedule`）在 `rpc-server.ts`、`kernel-bridge.ts`、`task-service.ts`、`my-day-manager.ts` 中完全一致
