# NextAction 前端 UI 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现 NextAction 插件的完整前端 UI——Dock 任务面板（三视图）、任务卡片、编辑弹窗、上下文菜单、斜杠菜单、块标菜单、快捷键命令，以及前端状态管理和内核通信桥接。

**架构：** Svelte 4 组件 + writable store 状态管理。前端通过 `this.kernel.rpc.call/bind` 与内核通信。广播通知驱动增量更新。所有颜色使用思源 CSS 变量适配亮暗主题。

**技术栈：** Svelte 4, Vite 5, TypeScript 5, siyuan@1.2.2

**设计规格：** `docs/superpowers/specs/2026-07-02-nextaction-frontend-ui-design.md`

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/i18n/en.json` | 英文 i18n 键值（修改：扩展键值） |
| `src/i18n/zh-CN.json` | 中文 i18n 键值（修改：扩展键值） |
| `src/index.ts` | 前端插件入口（修改：注册顶栏、Dock、斜杠菜单、块标菜单、命令） |
| `src/index.scss` | 全局样式（修改：添加面板、卡片、筛选栏、编辑弹窗样式） |
| `src/frontend/kernel-bridge.ts` | 封装 `this.kernel.rpc.call` 的类型安全包装 |
| `src/frontend/constants.ts` | 前端常量（优先级颜色、视图类型、状态列表） |
| `src/frontend/stores/task-store.ts` | Svelte writable store，管理任务列表、筛选、视图状态 |
| `src/frontend/components/TaskPanel.svelte` | 任务面板主组件（Dock 面板内容，Tab 切换 + 视图渲染 + 底部操作栏） |
| `src/frontend/components/NextActionView.svelte` | Next Action 视图（调用 getNextActions，FilterBar + TaskCard 列表） |
| `src/frontend/components/AllTasksView.svelte` | 全部任务视图（调用 getAllTasks，支持排序和筛选） |
| `src/frontend/components/ProjectView.svelte` | 按项目视图（树形结构，可折叠） |
| `src/frontend/components/TaskCard.svelte` | 任务卡片组件（色点、面包屑、标题、元数据、交互） |
| `src/frontend/components/TaskEditPopup.svelte` | 任务编辑弹窗（Dialog + 500ms 防抖保存） |
| `src/frontend/components/task-context-menu.ts` | 右键上下文菜单工具函数（状态切换、优先级、移除） |
| `src/frontend/components/FilterBar.svelte` | 筛选栏（上下文 + 优先级下拉） |
| `src/frontend/components/PriorityDot.svelte` | 优先级色点组件（8px 圆点，可点击） |

---

### 任务 1：i18n 键值扩展

**文件：**
- 修改：`src/i18n/en.json`
- 修改：`src/i18n/zh-CN.json`

- [ ] **步骤 1：更新 `src/i18n/en.json`**

```json
{
    "pluginName": "NextAction",
    "topBarTip": "NextAction Task Manager",
    "nextAction": "Next Actions",
    "allTasks": "All Tasks",
    "byProject": "By Project",
    "statusTodo": "To Do",
    "statusDoing": "In Progress",
    "statusWaiting": "Waiting",
    "statusDone": "Done",
    "priorityCritical": "Critical",
    "priorityHigh": "High",
    "priorityMedium": "Medium",
    "priorityLow": "Low",
    "priorityNone": "None",
    "importance": "Importance",
    "effort": "Effort",
    "dueDate": "Due Date",
    "startDate": "Start Date",
    "context": "Context",
    "convertToTask": "Convert to Task",
    "createTask": "Create Task",
    "removeTask": "Remove Task",
    "recalcOrders": "Recalculate Priorities",
    "noTasks": "No tasks yet",
    "taskPanel": "Task Panel",
    "overdue": "Overdue",
    "jumpToBlock": "Jump to Block",
    "allContexts": "All Contexts",
    "allPriorities": "All Priorities",
    "allStatuses": "All Statuses",
    "markAsTodo": "Mark as To Do",
    "markAsDoing": "Mark as In Progress",
    "markAsWaiting": "Mark as Waiting",
    "markAsDone": "Mark as Done",
    "priority": "Priority",
    "status": "Status",
    "markComplete": "Mark Complete",
    "newTask": "New Task",
    "editTask": "Edit Task"
}
```

- [ ] **步骤 2：更新 `src/i18n/zh-CN.json`**

```json
{
    "pluginName": "今天干点啥",
    "topBarTip": "今天干点啥 任务管理",
    "nextAction": "下一步行动",
    "allTasks": "全部任务",
    "byProject": "按项目",
    "statusTodo": "待办",
    "statusDoing": "进行中",
    "statusWaiting": "等待",
    "statusDone": "已完成",
    "priorityCritical": "紧急",
    "priorityHigh": "高",
    "priorityMedium": "中",
    "priorityLow": "低",
    "priorityNone": "无",
    "importance": "重要性",
    "effort": "工作量",
    "dueDate": "截止日期",
    "startDate": "开始日期",
    "context": "上下文",
    "convertToTask": "转为任务",
    "createTask": "新建任务",
    "removeTask": "移除任务",
    "recalcOrders": "重新计算优先级",
    "noTasks": "暂无任务",
    "taskPanel": "任务面板",
    "overdue": "逾期",
    "jumpToBlock": "跳转到块",
    "allContexts": "所有上下文",
    "allPriorities": "所有优先级",
    "allStatuses": "所有状态",
    "markAsTodo": "标记为待办",
    "markAsDoing": "标记为进行中",
    "markAsWaiting": "标记为等待",
    "markAsDone": "标记为已完成",
    "priority": "优先级",
    "status": "状态",
    "markComplete": "标记完成",
    "newTask": "新建任务",
    "editTask": "编辑任务"
}
```

- [ ] **步骤 3：Commit**

```bash
git add src/i18n/en.json src/i18n/zh-CN.json
git commit -m "feat(i18n): expand i18n keys for frontend UI"
```

---

### 任务 2：前端常量与内核通信桥接

**文件：**
- 创建：`src/frontend/constants.ts`
- 创建：`src/frontend/kernel-bridge.ts`

- [ ] **步骤 1：创建 `src/frontend/constants.ts`**

```typescript
export const PRIORITY_COLORS: Record<string, string> = {
    critical: "var(--na-priority-critical, #e74c3c)",
    high: "var(--na-priority-high, #e67e22)",
    medium: "var(--na-priority-medium, #3498db)",
    low: "var(--na-priority-low, #95a5a6)",
    none: "transparent",
};

export const VIEW_NEXT_ACTION = "nextAction";
export const VIEW_ALL_TASKS = "all";
export const VIEW_BY_PROJECT = "byProject";
export type ViewType = typeof VIEW_NEXT_ACTION | typeof VIEW_ALL_TASKS | typeof VIEW_BY_PROJECT;

export const STATUS_LIST = ["todo", "doing", "waiting", "done"] as const;
export const PRIORITY_LIST = ["critical", "high", "medium", "low", "none"] as const;
```

- [ ] **步骤 2：创建 `src/frontend/kernel-bridge.ts`**

SiYuan 的 `kernel.rpc.call` 使用 Proxy 动态调用，签名为 `call.methodName(params)`，params 可以是对象或数组。我们的 RPC 方法统一接收对象参数。注意 `call` 的返回值需要检查 `_rpcError`（内核使用 return-based 错误处理）。

```typescript
import type { TaskCacheEntry, TaskChangeNotification } from "../shared/types";

interface RpcError {
    code: number;
    message: string;
}

function hasRpcError(result: any): result is { _rpcError: RpcError } {
    return result && typeof result === "object" && result._rpcError;
}

export class KernelBridge {
    private plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    private async call<T>(method: string, params?: Record<string, any>): Promise<T> {
        const result = await this.plugin.kernel.rpc.call[method](params || {});
        if (hasRpcError(result)) {
            throw new Error(`RPC ${method}: ${result._rpcError.message} (code ${result._rpcError.code})`);
        }
        return result as T;
    }

    async convertToTask(blockId: string): Promise<TaskCacheEntry> {
        return this.call("convertToTask", { blockId });
    }

    async removeTask(blockId: string): Promise<void> {
        await this.call("removeTask", { blockId });
    }

    async updateTask(blockId: string, attrs: Record<string, string>): Promise<TaskCacheEntry> {
        return this.call("updateTask", { blockId, attrs });
    }

    async getTask(blockId: string): Promise<TaskCacheEntry | null> {
        return this.call("getTask", { blockId });
    }

    async getNextActions(filters?: { context?: string; priority?: string; limit?: number }): Promise<TaskCacheEntry[]> {
        return this.call("getNextActions", filters || {});
    }

    async getAllTasks(filters?: { status?: string; context?: string; sortBy?: string; limit?: number }): Promise<TaskCacheEntry[]> {
        return this.call("getAllTasks", filters || {});
    }

    async getTasksByParent(parentBlockId: string): Promise<TaskCacheEntry[]> {
        return this.call("getTasksByParent", { parentBlockId });
    }

    async createTask(params: { parentBlockId?: string; notebookId?: string; title: string; attrs?: Record<string, string> }): Promise<TaskCacheEntry> {
        return this.call("createTask", params);
    }

    async recalcAllOrders(): Promise<void> {
        await this.call("recalcAllOrders", {});
    }

    async rebuildCache(): Promise<void> {
        await this.call("rebuildCache", {});
    }

    async getContexts(): Promise<string[]> {
        return this.call("getContexts", {});
    }

    bindTasksChanged(handler: (notification: TaskChangeNotification) => void): void {
        this.plugin.kernel.rpc.bind("tasksChanged", (...params: any[]) => {
            handler(params[0] as TaskChangeNotification);
        });
    }

    unbindTasksChanged(handler: (...params: any[]) => void): void {
        this.plugin.kernel.rpc.unbind("tasksChanged", handler);
    }
}
```

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/constants.ts src/frontend/kernel-bridge.ts
git commit -m "feat: add frontend constants and kernel RPC bridge"
```

---

### 任务 3：Svelte 状态管理

**文件：**
- 创建：`src/frontend/stores/task-store.ts`

- [ ] **步骤 1：创建 `src/frontend/stores/task-store.ts`**

```typescript
import { writable, derived } from "svelte/store";
import type { TaskCacheEntry, TaskChangeNotification } from "../../shared/types";
import { KernelBridge } from "../kernel-bridge";
import { VIEW_NEXT_ACTION } from "../constants";

interface TaskState {
    tasks: TaskCacheEntry[];
    loading: boolean;
    error: string | null;
    activeView: string;
    filters: {
        context?: string;
        priority?: string;
        status?: string;
    };
    contexts: string[];
}

function createTaskStore() {
    const { subscribe, set, update } = writable<TaskState>({
        tasks: [],
        loading: false,
        error: null,
        activeView: VIEW_NEXT_ACTION,
        filters: {},
        contexts: [],
    });

    let bridge: KernelBridge | null = null;

    return {
        subscribe,
        setBridge(b: KernelBridge) {
            bridge = b;
        },
        async loadTasks() {
            if (!bridge) return;
            update((s) => ({ ...s, loading: true, error: null }));
            try {
                let tasks: TaskCacheEntry[];
                const state: TaskState = await new Promise((resolve) => {
                    subscribe((s) => resolve(s))();
                });
                if (state.activeView === VIEW_NEXT_ACTION) {
                    tasks = await bridge.getNextActions({
                        context: state.filters.context,
                        priority: state.filters.priority,
                    });
                } else {
                    tasks = await bridge.getAllTasks({
                        status: state.filters.status,
                        context: state.filters.context,
                    });
                }
                // Also refresh contexts list
                const contexts = await bridge.getContexts();
                update((s) => ({ ...s, tasks, contexts, loading: false }));
            } catch (e: any) {
                update((s) => ({ ...s, loading: false, error: e.message }));
            }
        },
        setActiveView(view: string) {
            update((s) => ({ ...s, activeView: view }));
        },
        setFilters(filters: Partial<TaskState["filters"]>) {
            update((s) => ({ ...s, filters: { ...s.filters, ...filters } }));
        },
        clearFilters() {
            update((s) => ({ ...s, filters: {} }));
        },
        applyChangeNotification(notification: TaskChangeNotification) {
            if (!bridge) return;
            for (const blockId of notification.changedBlockIds) {
                const type = notification.changeTypes[blockId];
                if (type === "delete") {
                    update((s) => ({
                        ...s,
                        tasks: s.tasks.filter((t) => t.blockId !== blockId),
                    }));
                } else {
                    // create or update: fetch latest data and refresh
                    bridge.getTask(blockId).then((entry) => {
                        if (!entry) return;
                        update((s) => {
                            const idx = s.tasks.findIndex((t) => t.blockId === blockId);
                            const tasks = [...s.tasks];
                            if (idx >= 0) {
                                tasks[idx] = entry;
                            } else {
                                tasks.push(entry);
                            }
                            return { ...s, tasks };
                        });
                    });
                }
            }
        },
    };
}

export const taskStore = createTaskStore();
```

- [ ] **步骤 2：Commit**

```bash
git add src/frontend/stores/task-store.ts
git commit -m "feat: add Svelte task store with view switching, filters, and change notifications"
```

---

### 任务 4：基础 Svelte 组件

**文件：**
- 创建：`src/frontend/components/PriorityDot.svelte`
- 创建：`src/frontend/components/FilterBar.svelte`
- 创建：`src/frontend/components/TaskCard.svelte`

- [ ] **步骤 1：创建 `src/frontend/components/PriorityDot.svelte`**

```svelte
<script lang="ts">
    import { PRIORITY_COLORS } from "../constants";
    export let priority: string = "none";
    export let onclick: (() => void) | undefined = undefined;
    $: color = PRIORITY_COLORS[priority] || PRIORITY_COLORS.none;
    $: borderColor = priority === "none" ? "var(--b3-theme-on-surface-tertiary, #666)" : color;
</script>

<span
    class="na-priority-dot"
    style="background-color: {color}; border-color: {borderColor}"
    on:click={onclick}
    title={onclick ? "Mark done" : priority}
></span>

<style>
    .na-priority-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        border: 1.5px solid transparent;
        cursor: pointer;
        flex-shrink: 0;
    }
</style>
```

- [ ] **步骤 2：创建 `src/frontend/components/FilterBar.svelte`**

```svelte
<script lang="ts">
    import { PRIORITY_LIST } from "../constants";
    export let contexts: string[] = [];
    export let selectedContext: string = "";
    export let selectedPriority: string = "";
    export let showStatus: boolean = false;
    export let selectedStatus: string = "";
    export let onFilterChange: (filters: any) => void;
</script>

<div class="na-filter-bar">
    <select
        bind:value={selectedContext}
        on:change={() => onFilterChange({ context: selectedContext, priority: selectedPriority, status: selectedStatus })}
    >
        <option value="">{$t ? $t("allContexts") : "All Contexts"}</option>
        {#each contexts as ctx}
            <option value={ctx}>{ctx}</option>
        {/each}
    </select>
    <select
        bind:value={selectedPriority}
        on:change={() => onFilterChange({ context: selectedContext, priority: selectedPriority, status: selectedStatus })}
    >
        <option value="">{$t ? $t("allPriorities") : "All Priorities"}</option>
        {#each PRIORITY_LIST as p}
            <option value={p}>{p}</option>
        {/each}
    </select>
    {#if showStatus}
        <select
            bind:value={selectedStatus}
            on:change={() => onFilterChange({ context: selectedContext, priority: selectedPriority, status: selectedStatus })}
        >
            <option value="">{$t ? $t("allStatuses") : "All Statuses"}</option>
            <option value="todo">{$t ? $t("statusTodo") : "To Do"}</option>
            <option value="doing">{$t ? $t("statusDoing") : "In Progress"}</option>
            <option value="waiting">{$t ? $t("statusWaiting") : "Waiting"}</option>
            <option value="done">{$t ? $t("statusDone") : "Done"}</option>
        </select>
    {/if}
</div>
```

注意：`$t` 是 i18n 函数，将在插件入口中通过 Svelte context 注入。MVP 阶段如果 context 注入还没准备好，先用 fallback 文字。后续任务 6 中统一处理。

- [ ] **步骤 3：创建 `src/frontend/components/TaskCard.svelte`**

```svelte
<script lang="ts">
    import type { TaskCacheEntry } from "../../shared/types";
    import PriorityDot from "./PriorityDot.svelte";
    import { openTab } from "siyuan";

    export let task: TaskCacheEntry;
    export let allTasks: TaskCacheEntry[] = [];
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onComplete: (blockId: string) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;

    $: isOverdue = task.due && new Date(task.due) < new Date(new Date().toISOString().slice(0, 10));

    function buildBreadcrumb(task: TaskCacheEntry, allTasks: TaskCacheEntry[]): string[] {
        const chain: string[] = [];
        const taskMap = new Map<string, TaskCacheEntry>();
        for (const t of allTasks) {
            taskMap.set(t.blockId, t);
        }
        let current = task;
        const visited = new Set<string>();
        while (current.parentId && !visited.has(current.parentId)) {
            visited.add(current.parentId);
            const parent = taskMap.get(current.parentId);
            if (!parent) break;
            chain.unshift(parent.title || parent.blockId);
            current = parent;
        }
        // Smart truncation: 1-2 layers full, 3+ show first + ... + last
        if (chain.length <= 2) return chain;
        return [chain[0], "...", chain[chain.length - 1]];
    }

    $: breadcrumb = task.parentId ? buildBreadcrumb(task, allTasks) : [];

    const PRIORITY_CSS_COLORS: Record<string, string> = {
        critical: "var(--na-priority-critical, #e74c3c)",
        high: "var(--na-priority-high, #e67e22)",
        medium: "var(--na-priority-medium, #3498db)",
        low: "var(--na-priority-low, #95a5a6)",
        none: "transparent",
    };
    $: priorityBarColor = PRIORITY_CSS_COLORS[task.priority] || "transparent";
</script>

<div
    class="na-task-card"
    class:overdue={isOverdue}
    on:contextmenu|preventDefault={(e) => onContextMenu(task, e)}
>
    <div class="na-task-card__color-bar" style="background-color: {priorityBarColor}"></div>
    <div class="na-task-card__content">
        <PriorityDot priority={task.priority} onclick={() => onComplete(task.blockId)} />
        <div class="na-task-card__body" on:click={() => onEdit(task)}>
            {#if breadcrumb.length > 0}
                <div class="na-task-card__breadcrumb">
                    {#each breadcrumb as segment, i}
                        {#if i > 0}<span class="na-task-card__separator">›</span>{/if}
                        <span class="na-task-card__breadcrumb-segment">{segment}</span>
                    {/each}
                </div>
            {/if}
            <div class="na-task-card__title" on:click|stopPropagation={() => openTab({ app: (window as any).siYuanApp, doc: { id: task.blockId } })}>
                {task.title || task.blockId}
            </div>
            <div class="na-task-card__meta">
                {#if task.due}
                    <span class="na-task-card__due" class:overdue={isOverdue}>📅 {task.due}</span>
                {/if}
                {#if task.context}
                    <span class="na-task-card__context">{task.context.replace(/\|/g, ', ')}</span>
                {/if}
                <span class="na-task-card__stats">⭐{task.importance} 📊{task.effort}</span>
            </div>
        </div>
    </div>
</div>
```

注意：CSS 样式将在任务 7 中统一编写。组件先用 class 名称约定，不写 `<style>` 块（因为大部分样式需要使用思源 CSS 变量，统一放在 index.scss 中管理更合理）。

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/components/PriorityDot.svelte src/frontend/components/FilterBar.svelte src/frontend/components/TaskCard.svelte
git commit -m "feat: add PriorityDot, FilterBar, and TaskCard Svelte components"
```

---

### 任务 5：三个视图组件

**文件：**
- 创建：`src/frontend/components/NextActionView.svelte`
- 创建：`src/frontend/components/AllTasksView.svelte`
- 创建：`src/frontend/components/ProjectView.svelte`

- [ ] **步骤 1：创建 `src/frontend/components/NextActionView.svelte`**

```svelte
<script lang="ts">
    import { onMount } from "svelte";
    import { taskStore } from "../stores/task-store";
    import TaskCard from "./TaskCard.svelte";
    import FilterBar from "./FilterBar.svelte";
    import type { TaskCacheEntry } from "../../shared/types";

    export let onEdit: (task: TaskCacheEntry) => void;
    export let onComplete: (blockId: string) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;

    let selectedContext = "";
    let selectedPriority = "";

    function handleFilterChange(filters: any) {
        selectedContext = filters.context;
        selectedPriority = filters.priority;
        taskStore.setFilters(filters);
        taskStore.loadTasks();
    }
</script>

<div class="na-view na-view--next-action">
    <FilterBar
        contexts={$taskStore.contexts}
        {selectedContext}
        {selectedPriority}
        onFilterChange={handleFilterChange}
    />
    {#if $taskStore.loading}
        <div class="na-view__loading">Loading...</div>
    {:else if $taskStore.tasks.length === 0}
        <div class="na-view__empty">{$taskStore.error || "No tasks yet"}</div>
    {:else}
        <div class="na-view__list">
            {#each $taskStore.tasks as task (task.blockId)}
                <TaskCard
                    {task}
                    allTasks={$taskStore.tasks}
                    {onEdit}
                    {onComplete}
                    {onContextMenu}
                />
            {/each}
        </div>
    {/if}
</div>
```

- [ ] **步骤 2：创建 `src/frontend/components/AllTasksView.svelte`**

```svelte
<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import TaskCard from "./TaskCard.svelte";
    import FilterBar from "./FilterBar.svelte";
    import type { TaskCacheEntry } from "../../shared/types";

    export let onEdit: (task: TaskCacheEntry) => void;
    export let onComplete: (blockId: string) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;

    let selectedContext = "";
    let selectedPriority = "";
    let selectedStatus = "";

    function handleFilterChange(filters: any) {
        selectedContext = filters.context;
        selectedPriority = filters.priority;
        selectedStatus = filters.status;
        taskStore.setFilters(filters);
        taskStore.loadTasks();
    }
</script>

<div class="na-view na-view--all-tasks">
    <FilterBar
        contexts={$taskStore.contexts}
        {selectedContext}
        {selectedPriority}
        {selectedStatus}
        showStatus={true}
        onFilterChange={handleFilterChange}
    />
    {#if $taskStore.loading}
        <div class="na-view__loading">Loading...</div>
    {:else if $taskStore.tasks.length === 0}
        <div class="na-view__empty">{$taskStore.error || "No tasks yet"}</div>
    {:else}
        <div class="na-view__list">
            {#each $taskStore.tasks as task (task.blockId)}
                <TaskCard
                    {task}
                    allTasks={$taskStore.tasks}
                    onEdit={handleEdit}
                    onComplete={handleComplete}
                    onContextMenu={handleContextMenu}
                />
            {/each}
        </div>
    {/if}
</div>
```

- [ ] **步骤 3：创建 `src/frontend/components/ProjectView.svelte`**

```svelte
<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import TaskCard from "./TaskCard.svelte";
    import type { TaskCacheEntry } from "../../shared/types";

    export let onEdit: (task: TaskCacheEntry) => void;
    export let onComplete: (blockId: string) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;

    let collapsedIds: Set<string> = new Set();

    $: topTasks = $taskStore.tasks.filter((t) => !t.parentId);
    $: childrenByParent = buildChildrenMap($taskStore.tasks);

    function buildChildrenMap(tasks: TaskCacheEntry[]): Map<string, TaskCacheEntry[]> {
        const map = new Map<string, TaskCacheEntry[]>();
        for (const t of tasks) {
            if (!t.parentId) continue;
            const children = map.get(t.parentId) || [];
            children.push(t);
            map.set(t.parentId, children);
        }
        return map;
    }

    function toggleCollapse(blockId: string) {
        const next = new Set(collapsedIds);
        if (next.has(blockId)) {
            next.delete(blockId);
        } else {
            next.add(blockId);
        }
        collapsedIds = next;
    }
</script>

<div class="na-view na-view--project">
    {#if $taskStore.loading}
        <div class="na-view__loading">Loading...</div>
    {:else if topTasks.length === 0}
        <div class="na-view__empty">{$taskStore.error || "No tasks yet"}</div>
    {:else}
        <div class="na-view__list">
            {#each topTasks as task (task.blockId)}
                {@const children = childrenByParent.get(task.blockId) || []}
                <div class="na-project-item">
                    <div class="na-project-item__header" on:click={() => toggleCollapse(task.blockId)}>
                        <span class="na-project-item__toggle">{collapsedIds.has(task.blockId) ? "▸" : "▾"}</span>
                    </div>
                    <TaskCard
                        {task}
                        allTasks={$taskStore.tasks}
                        {onEdit}
                        {onComplete}
                        {onContextMenu}
                    />
                    {#if !collapsedIds.has(task.blockId) && children.length > 0}
                        <div class="na-project-item__children">
                            {#each children as child (child.blockId)}
                                <TaskCard
                                    task={child}
                                    allTasks={$taskStore.tasks}
                                    {onEdit}
                                    {onComplete}
                                    {onContextMenu}
                                />
                            {/each}
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</div>
```

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/components/NextActionView.svelte src/frontend/components/AllTasksView.svelte src/frontend/components/ProjectView.svelte
git commit -m "feat: add three view components - NextAction, AllTasks, Project"
```

---

### 任务 6：编辑弹窗与上下文菜单

**文件：**
- 创建：`src/frontend/components/TaskEditPopup.svelte`
- 创建：`src/frontend/components/task-context-menu.ts`

- [ ] **步骤 1：创建 `src/frontend/components/TaskEditPopup.svelte`**

使用思源 `Dialog` 组件包裹 Svelte 渲染的编辑表单。每个字段变化后 500ms 防抖调用 `bridge.updateTask()`。

```svelte
<script lang="ts">
    import { Dialog, openTab } from "siyuan";
    import type { TaskCacheEntry } from "../../shared/types";
    import { KernelBridge } from "../kernel-bridge";
    import { PRIORITY_LIST, STATUS_LIST } from "../constants";
    import { onMount, onDestroy } from "svelte";

    export let task: TaskCacheEntry;
    export let bridge: KernelBridge;
    export let i18n: any;

    let status = task.status || "todo";
    let priority = task.priority || "none";
    let importance = task.importance || 4;
    let effort = task.effort || 4;
    let due = task.due || "";
    let start = task.start || "";
    let contextInput = task.context ? task.context.replace(/\|/g, ", ") : "";

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleSave() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            try {
                const contexts = contextInput
                    .split(",")
                    .map((s: string) => s.trim())
                    .filter(Boolean)
                    .join("|");
                await bridge.updateTask(task.blockId, {
                    "na-status": status,
                    "na-priority": priority,
                    "na-importance": String(importance),
                    "na-effort": String(effort),
                    "na-due": due,
                    "na-start": start,
                    "na-context": contexts,
                });
            } catch (e: any) {
                console.error("[NextAction] updateTask failed:", e);
            }
        }, 500);
    }

    function handleChange() {
        scheduleSave();
    }

    onDestroy(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
    });
</script>

<div class="na-edit-popup">
    <div class="na-edit-popup__row">
        <label>{i18n?.status || "Status"}</label>
        <select bind:value={status} on:change={handleChange}>
            {#each STATUS_LIST as s}
                <option value={s}>{i18n?.["status" + s.charAt(0).toUpperCase() + s.slice(1)] || s}</option>
            {/each}
        </select>
    </div>
    <div class="na-edit-popup__row">
        <label>{i18n?.priority || "Priority"}</label>
        <select bind:value={priority} on:change={handleChange}>
            {#each PRIORITY_LIST as p}
                <option value={p}>{i18n?.["priority" + p.charAt(0).toUpperCase() + p.slice(1)] || p}</option>
            {/each}
        </select>
    </div>
    <div class="na-edit-popup__row">
        <label>{i18n?.importance || "Importance"}</label>
        <div class="na-edit-popup__dots">
            {#each Array(7) as _, i}
                <span
                    class="na-edit-popup__dot"
                    class:active={i < importance}
                    on:click={() => { importance = i + 1; handleChange(); }}
                ></span>
            {/each}
        </div>
    </div>
    <div class="na-edit-popup__row">
        <label>{i18n?.effort || "Effort"}</label>
        <div class="na-edit-popup__dots">
            {#each Array(7) as _, i}
                <span
                    class="na-edit-popup__dot"
                    class:active={i < effort}
                    on:click={() => { effort = i + 1; handleChange(); }}
                ></span>
            {/each}
        </div>
    </div>
    <div class="na-edit-popup__row">
        <label>{i18n?.dueDate || "Due Date"}</label>
        <input type="date" bind:value={due} on:change={handleChange} />
    </div>
    <div class="na-edit-popup__row">
        <label>{i18n?.startDate || "Start Date"}</label>
        <input type="date" bind:value={start} on:change={handleChange} />
    </div>
    <div class="na-edit-popup__row">
        <label>{i18n?.context || "Context"}</label>
        <input type="text" bind:value={contextInput} on:input={handleChange} placeholder="@office, @phone" />
    </div>
    <div class="na-edit-popup__link">
        <a href="javascript:void(0)" on:click={() => openTab({ app: (window as any).siYuanApp, doc: { id: task.blockId } })}>
            {i18n?.jumpToBlock || "Jump to Block"}
        </a>
    </div>
</div>
```

注意：`TaskEditPopup.svelte` 只负责渲染编辑表单。Dialog 的创建和 Svelte 挂载由 `TaskPanel.svelte` 中的 `handleEdit` 函数负责——创建 `Dialog`，在其 `content` 中提供一个挂载点 `<div id="na-edit-mount">`，然后使用 Svelte 的 `new TaskEditPopup({ target, props })` 挂载到该元素。

- [ ] **步骤 2：创建 `src/frontend/components/TaskContextMenu.svelte`**

上下文菜单不作为 Svelte 组件，而是作为工具函数使用思源 `Menu` API。

```typescript
// src/frontend/components/task-context-menu.ts
import { Menu } from "siyuan";
import type { TaskCacheEntry } from "../../shared/types";
import { KernelBridge } from "../kernel-bridge";
import { STATUS_LIST, PRIORITY_LIST } from "../constants";

export function showTaskContextMenu(
    task: TaskCacheEntry,
    event: MouseEvent,
    bridge: KernelBridge,
    i18n: any,
    onUpdated: () => void
): void {
    const menu = new Menu("na-task-context");

    // Status items
    for (const s of STATUS_LIST) {
        const i18nKey = "status" + s.charAt(0).toUpperCase() + s.slice(1);
        menu.addItem({
            icon: s === task.status ? "iconSelect" : "",
            label: i18n?.[i18nKey] || s,
            click: async () => {
                await bridge.updateTask(task.blockId, { "na-status": s });
                onUpdated();
            },
        });
    }

    menu.addSeparator();

    // Priority submenu
    menu.addItem({
        icon: "iconSort",
        label: i18n?.priority || "Priority",
        type: "submenu",
        submenu: PRIORITY_LIST.map((p) => ({
            icon: p === task.priority ? "iconSelect" : "",
            label: i18n?.["priority" + p.charAt(0).toUpperCase() + p.slice(1)] || p,
            click: async () => {
                await bridge.updateTask(task.blockId, { "na-priority": p });
                onUpdated();
            },
        })),
    });

    menu.addSeparator();

    // Remove task
    menu.addItem({
        icon: "iconTrashcan",
        label: i18n?.removeTask || "Remove Task",
        click: async () => {
            await bridge.removeTask(task.blockId);
            onUpdated();
        },
    });

    menu.open({ x: event.clientX, y: event.clientY });
}
```

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/TaskEditPopup.svelte src/frontend/components/task-context-menu.ts
git commit -m "feat: add task edit popup with debounced save and context menu"
```

---

### 任务 7：任务面板主组件与插件入口

**文件：**
- 创建：`src/frontend/components/TaskPanel.svelte`
- 修改：`src/index.ts`
- 修改：`src/index.scss`

- [ ] **步骤 1：创建 `src/frontend/components/TaskPanel.svelte`**

```svelte
<script lang="ts">
    import { onMount } from "svelte";
    import { taskStore } from "../stores/task-store";
    import { KernelBridge } from "../kernel-bridge";
    import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT } from "../constants";
    import NextActionView from "./NextActionView.svelte";
    import AllTasksView from "./AllTasksView.svelte";
    import ProjectView from "./ProjectView.svelte";
    import { showTaskContextMenu } from "./task-context-menu";
    import { Dialog } from "siyuan";
    import TaskEditPopup from "./TaskEditPopup.svelte";

    export let bridge: KernelBridge;
    export let i18n: any;

    let activeView: string = VIEW_NEXT_ACTION;

    function switchView(view: string) {
        activeView = view;
        taskStore.setActiveView(view);
        taskStore.loadTasks();
    }

    function handleEdit(task: any) {
        const dialog = new Dialog({
            title: i18n?.editTask || "Edit Task",
            content: `<div class="nextaction"><div id="na-edit-mount"></div></div>`,
            width: "400px",
        });
        const mountEl = dialog.element.querySelector("#na-edit-mount");
        if (mountEl) {
            new TaskEditPopup({
                target: mountEl,
                props: { task, bridge, i18n },
            });
        }
    }

    function handleContextMenu(task: any, event: MouseEvent) {
        showTaskContextMenu(task, event, bridge, i18n, () => taskStore.loadTasks());
    }

    async function handleComplete(blockId: string) {
        try {
            await bridge.updateTask(blockId, { "na-status": "done" });
            taskStore.loadTasks();
        } catch (e: any) {
            console.error("[NextAction] markComplete failed:", e);
        }
    }

    async function handleNewTask() {
        const title = prompt(i18n?.newTask || "New Task");
        if (!title) return;
        try {
            await bridge.createTask({ title });
            taskStore.loadTasks();
        } catch (e: any) {
            console.error("[NextAction] createTask failed:", e);
        }
    }

    async function handleRecalc() {
        try {
            await bridge.recalcAllOrders();
            taskStore.loadTasks();
        } catch (e: any) {
            console.error("[NextAction] recalcAllOrders failed:", e);
        }
    }
</script>

<div class="na-panel fn__flex fn__flex-column">
    <!-- Tab bar -->
    <div class="na-panel__tabs">
        <button class="na-panel__tab" class:active={activeView === VIEW_NEXT_ACTION} on:click={() => switchView(VIEW_NEXT_ACTION)}>
            {i18n?.nextAction || "Next Actions"}
        </button>
        <button class="na-panel__tab" class:active={activeView === VIEW_ALL_TASKS} on:click={() => switchView(VIEW_ALL_TASKS)}>
            {i18n?.allTasks || "All Tasks"}
        </button>
        <button class="na-panel__tab" class:active={activeView === VIEW_BY_PROJECT} on:click={() => switchView(VIEW_BY_PROJECT)}>
            {i18n?.byProject || "By Project"}
        </button>
    </div>

    <!-- View content -->
    <div class="na-panel__content fn__flex-1">
        {#if activeView === VIEW_NEXT_ACTION}
            <NextActionView onEdit={handleEdit} onComplete={handleComplete} onContextMenu={handleContextMenu} />
        {:else if activeView === VIEW_ALL_TASKS}
            <AllTasksView onEdit={handleEdit} onComplete={handleComplete} onContextMenu={handleContextMenu} />
        {:else}
            <ProjectView onEdit={handleEdit} onComplete={handleComplete} onContextMenu={handleContextMenu} />
        {/if}
    </div>

    <!-- Bottom bar -->
    <div class="na-panel__bottom">
        <button class="na-panel__btn" on:click={handleNewTask}>+ {i18n?.newTask || "New Task"}</button>
        <button class="na-panel__btn na-panel__btn--icon" on:click={handleRecalc} title={i18n?.recalcOrders || "Recalculate"}>↻</button>
    </div>
</div>
```

- [ ] **步骤 2：修改 `src/index.ts`，注册顶栏按钮、Dock 面板、斜杠菜单、块标菜单、快捷键命令**

```typescript
import { Plugin, showMessage, Menu, Dialog, openTab, getFrontend } from "siyuan";
import "./index.scss";
import { KernelBridge } from "./frontend/kernel-bridge";
import { taskStore } from "./frontend/stores/task-store";
import { showTaskContextMenu } from "./frontend/components/task-context-menu";

const DOCK_TYPE = "nextaction_dock";

export default class NextActionPlugin extends Plugin {
    private bridge!: KernelBridge;
    private isMobile: boolean = false;
    private tasksChangedHandler: ((...params: any[]) => void) | null = null;
    private blockIconHandler: (({detail}: any) => void) | null = null;

    onload() {
        this.isMobile = getFrontend() === "mobile" || getFrontend() === "browser-mobile";

        this.addIcons(`<symbol id="iconNextAction" viewBox="0 0 32 32">
    <path d="M16 2L4 8v8c0 7.7 5.1 14.9 12 16 6.9-1.1 12-8.3 12-16V8L16 2zm0 4l8 4v6c0 5.8-3.4 11.2-8 12.8-4.6-1.6-8-7-8-12.8v-6l8-4zm-1 6v6h2v-6h-2zm0 8v2h2v-2h-2z"/>
</symbol>`);

        this.addDock({
            config: {
                position: "RightBottom",
                size: { width: 300, height: 0 },
                icon: "iconNextAction",
                title: this.i18n.taskPanel,
            },
            data: {},
            type: DOCK_TYPE,
            init: (dock: any) => {
                const container = dock.element;
                container.classList.add("fn__flex-1", "fn__flex-column");
                // Import and mount Svelte TaskPanel
                import("./frontend/components/TaskPanel.svelte").then(({ default: TaskPanel }) => {
                    const panel = new TaskPanel({
                        target: container,
                        props: {
                            bridge: this.bridge,
                            i18n: this.i18n,
                        },
                    });
                });
            },
            destroy() {},
        });

        // Slash menu items
        this.protyleSlash = [
            {
                filter: ["转为任务", "convert to task", "zrw"],
                html: `<div class="b3-list-item__first"><span class="b3-list-item__text">${this.i18n.convertToTask}</span></div>`,
                id: "convertToTask",
                callback: async (protyle: any) => {
                    const blockId = protyle.block.rootID;
                    try {
                        await this.bridge.convertToTask(blockId);
                        showMessage(`[NextAction] ${this.i18n.convertToTask} ✓`);
                        taskStore.loadTasks();
                    } catch (e: any) {
                        showMessage(`[NextAction] Error: ${e.message}`);
                    }
                },
            },
            {
                filter: ["新建任务", "create task", "xjrw"],
                html: `<div class="b3-list-item__first"><span class="b3-list-item__text">${this.i18n.createTask}</span></div>`,
                id: "createTask",
                callback: async (protyle: any) => {
                    const title = prompt(this.i18n.createTask);
                    if (!title) return;
                    try {
                        await this.bridge.createTask({ title });
                        taskStore.loadTasks();
                    } catch (e: any) {
                        showMessage(`[NextAction] Error: ${e.message}`);
                    }
                },
            },
        ];
    }

    onLayoutReady() {
        this.bridge = new KernelBridge(this);
        taskStore.setBridge(this.bridge);

        // Top bar button
        this.addTopBar({
            icon: "iconNextAction",
            title: this.i18n.topBarTip,
            position: "right",
            callback: () => {
                // Toggle dock panel visibility
                const dockTab = this.getDockByType(DOCK_TYPE);
                if (dockTab) {
                    dockTab.toggle();
                }
            },
        });

        // Block icon menu
        this.blockIconHandler = ({ detail }: any) => {
            detail.menu.addItem({
                icon: "iconNextAction",
                label: this.i18n.convertToTask,
                click: async () => {
                    for (const blockElement of detail.blockElements) {
                        const blockId = blockElement.dataset.nodeId;
                        if (blockId) {
                            try {
                                await this.bridge.convertToTask(blockId);
                            } catch (e: any) {
                                showMessage(`[NextAction] Error: ${e.message}`);
                            }
                        }
                    }
                    taskStore.loadTasks();
                },
            });
        };
        this.eventBus.on("click-blockicon", this.blockIconHandler);

        // Kernel state change listener
        this.eventBus.on("kernel-plugin-state-change", async ({ detail }: any) => {
            if (detail.code === 2) {
                showMessage(`[NextAction] ${this.i18n.pluginName} ready`);
                taskStore.loadTasks();
            }
        });

        // Bind kernel broadcast for task changes
        this.tasksChangedHandler = (notification: any) => {
            taskStore.applyChangeNotification(notification);
        };
        this.kernel.rpc.bind("tasksChanged", this.tasksChangedHandler);

        // Initial load
        taskStore.loadTasks();

        // Commands
        this.addCommand({
            langKey: "convertToTask",
            hotkey: "",
            callback: () => {
                const editor = this.getEditor();
                if (editor) {
                    const blockId = editor.protyle.block.rootID;
                    this.bridge.convertToTask(blockId).then(() => {
                        taskStore.loadTasks();
                    }).catch((e: any) => {
                        showMessage(`[NextAction] Error: ${e.message}`);
                    });
                }
            },
        });

        this.addCommand({
            langKey: "createTask",
            hotkey: "",
            callback: () => {
                const title = prompt(this.i18n.createTask);
                if (!title) return;
                this.bridge.createTask({ title }).then(() => {
                    taskStore.loadTasks();
                }).catch((e: any) => {
                    showMessage(`[NextAction] Error: ${e.message}`);
                });
            },
        });

        this.addCommand({
            langKey: "recalcOrders",
            hotkey: "",
            callback: () => {
                this.bridge.recalcAllOrders().then(() => {
                    taskStore.loadTasks();
                    showMessage(`[NextAction] ${this.i18n.recalcOrders} ✓`);
                }).catch((e: any) => {
                    showMessage(`[NextAction] Error: ${e.message}`);
                });
            },
        });
    }

    onunload() {
        if (this.tasksChangedHandler) {
            this.kernel.rpc.unbind("tasksChanged", this.tasksChangedHandler);
        }
        if (this.blockIconHandler) {
            this.eventBus.off("click-blockicon", this.blockIconHandler);
        }
    }
}
```

- [ ] **步骤 3：更新 `src/index.scss`，添加完整的面板、卡片、筛选栏、编辑弹窗样式**

```scss
.nextaction {
    font-family: var(--b3-font-family);

    // Priority custom properties
    --na-priority-critical: #e74c3c;
    --na-priority-high: #e67e22;
    --na-priority-medium: #3498db;
    --na-priority-low: #95a5a6;
    --na-priority-none: transparent;

    // Overdue colors
    --na-overdue-bg: #2a1a1a;
    --na-overdue-text: var(--na-priority-critical);
}

@media (prefers-color-scheme: light) {
    .nextaction {
        --na-overdue-bg: #fef2f2;
    }
}

// Panel
.na-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--b3-theme-background);
    color: var(--b3-theme-on-surface);
}

.na-panel__tabs {
    display: flex;
    border-bottom: 1px solid var(--b3-border-color);
    background: var(--b3-theme-surface);
}

.na-panel__tab {
    flex: 1;
    text-align: center;
    padding: 6px 0;
    font-size: 12px;
    color: var(--b3-theme-on-surface-secondary);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;

    &.active {
        color: var(--b3-theme-primary);
        border-bottom-color: var(--b3-theme-primary);
    }
}

.na-panel__content {
    flex: 1;
    overflow-y: auto;
}

.na-panel__bottom {
    display: flex;
    gap: 6px;
    padding: 6px 8px;
    border-top: 1px solid var(--b3-border-color);
    background: var(--b3-theme-surface);
}

.na-panel__btn {
    flex: 1;
    padding: 4px 0;
    font-size: 11px;
    background: var(--b3-theme-surface);
    color: var(--b3-theme-on-surface);
    border: 1px solid var(--b3-border-color);
    border-radius: 3px;
    cursor: pointer;

    &--icon {
        flex: 0;
        padding: 4px 8px;
    }
}

// View
.na-view__list {
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.na-view__loading,
.na-view__empty {
    padding: 20px 8px;
    text-align: center;
    color: var(--b3-theme-on-surface-secondary);
    font-size: 12px;
}

// Filter bar
.na-filter-bar {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--b3-border-color);
    background: var(--b3-theme-surface);

    select {
        flex: 1;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 3px;
        padding: 2px 4px;
        font-size: 11px;
        outline: none;
    }
}

// Task card
.na-task-card {
    display: flex;
    align-items: flex-start;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--b3-theme-surface);
    cursor: pointer;
    border-left: 3px solid transparent;

    &:hover {
        background: var(--b3-theme-surface-hover, rgba(255, 255, 255, 0.05));
    }

    &.overdue {
        background: var(--na-overdue-bg);

        .na-task-card__due,
        .na-task-card__title {
            color: var(--na-overdue-text);
        }
    }
}

.na-task-card__color-bar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    border-radius: 4px 0 0 4px;
}

.na-task-card__content {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    position: relative;
}

.na-task-card__body {
    flex: 1;
    min-width: 0;
}

.na-task-card__breadcrumb {
    font-size: 10px;
    color: var(--b3-theme-on-surface-tertiary, #666);
    margin-bottom: 2px;
    display: flex;
    align-items: center;
    gap: 3px;
    flex-wrap: wrap;
}

.na-task-card__separator {
    color: var(--b3-theme-on-surface-tertiary, #555);
}

.na-task-card__breadcrumb-segment {
    cursor: pointer;
    &:hover {
        color: var(--b3-theme-primary);
    }
}

.na-task-card__title {
    font-size: 13px;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;

    &:hover {
        color: var(--b3-theme-primary);
    }
}

.na-task-card__meta {
    font-size: 11px;
    color: var(--b3-theme-on-surface-secondary);
    margin-top: 2px;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
}

.na-task-card__due.overdue {
    color: var(--na-priority-critical);
    font-weight: 500;
}

.na-task-card__context {
    color: var(--b3-theme-on-surface-secondary);
}

.na-task-card__stats {
    color: var(--b3-theme-on-surface-tertiary);
}

// Priority dot (global override for non-Svelte usage)
.na-priority-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1.5px solid transparent;
    cursor: pointer;
    flex-shrink: 0;
}

// Project view
.na-project-item {
    display: flex;
    flex-direction: column;
}

.na-project-item__header {
    display: none; // toggle is embedded in card interaction
}

.na-project-item__children {
    margin-left: 16px;
    padding-left: 8px;
    border-left: 1px solid var(--b3-border-color);
}

.na-project-item__toggle {
    cursor: pointer;
    font-size: 11px;
    color: var(--b3-theme-on-surface-secondary);
    margin-right: 4px;
}

// Edit popup
.na-edit-popup {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.na-edit-popup__row {
    display: flex;
    align-items: center;
    gap: 8px;

    label {
        width: 60px;
        font-size: 12px;
        color: var(--b3-theme-on-surface-secondary);
        flex-shrink: 0;
    }

    select,
    input[type="date"],
    input[type="text"] {
        flex: 1;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 3px;
        padding: 4px 6px;
        font-size: 12px;
        outline: none;
    }
}

.na-edit-popup__dots {
    display: flex;
    gap: 4px;
}

.na-edit-popup__dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid var(--b3-border-color);
    cursor: pointer;
    background: transparent;

    &.active {
        background: var(--b3-theme-primary);
        border-color: var(--b3-theme-primary);
    }

    &:hover {
        opacity: 0.8;
    }
}

.na-edit-popup__link {
    text-align: right;

    a {
        font-size: 12px;
        color: var(--b3-theme-primary);
        text-decoration: none;

        &:hover {
            text-decoration: underline;
        }
    }
}
```

- [ ] **步骤 4：构建验证**

```bash
pnpm run build
node scripts/make_dev_copy.js
```

在思源 Test 工作空间中重新加载插件，确认顶栏图标可见、Dock 面板可展开、任务列表可渲染。

- [ ] **步骤 5：Commit**

```bash
git add src/frontend/components/TaskPanel.svelte src/index.ts src/index.scss
git commit -m "feat: add TaskPanel main component, plugin entry, slash menu, block icon menu, commands, and styles"
```

---

### 任务 8：端到端集成验证

**文件：**
- 无新文件

- [ ] **步骤 1：手动测试流程**

1. 点击顶栏按钮打开任务面板 → Dock 面板应展开
2. 在文档中写一段文字，通过斜杠菜单输入 `/zrw` → "转为任务"
3. 面板 Next Action 视图中应出现该任务
4. 点击任务标题 → 应跳转到对应块
5. 点击任务属性区域 → 应打开编辑弹窗
6. 修改优先级和截止日期 → 500ms 后自动保存
7. 右键任务卡片 → 上下文菜单（状态、优先级、移除）
8. 点击优先级色点 → 任务标记为完成，从 Next Action 消失
9. 切换到"全部任务"视图和"按项目"视图
10. 在编辑器中直接修改块属性 → 5 秒后面板自动刷新

- [ ] **步骤 2：修复集成中发现的问题**

根据测试结果修复 bug，每次修复单独 commit。

- [ ] **步骤 3：最终 Commit**

```bash
git add -A
git commit -m "fix: resolve integration issues from end-to-end testing"
```
