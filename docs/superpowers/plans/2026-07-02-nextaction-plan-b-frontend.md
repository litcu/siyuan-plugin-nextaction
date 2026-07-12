# NextAction MVP 计划B：前端UI

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**前提：** 计划A（内核插件）已完成，所有RPC方法可用并经过验证。

**目标：** 实现完整的用户界面——任务面板（三视图）、任务卡片、编辑弹窗、上下文菜单、斜杠菜单、块标菜单、快捷键命令，以及前端状态管理和内核通信桥接。

**架构：** Svelte 4 组件 + writable store 状态管理。前端通过 `this.kernel.rpc.call/bind` 与内核通信。广播通知驱动增量更新。

**技术栈：** Svelte 4, Vite 5, TypeScript 5, siyuan@1.2.2

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 前端插件入口（扩展计划A的最小入口，添加完整注册） |
| `src/frontend/kernel-bridge.ts` | 封装 this.kernel.rpc 调用的类型安全包装 |
| `src/frontend/constants.ts` | 前端常量（优先级颜色映射等） |
| `src/frontend/stores/task-store.ts` | Svelte writable store，管理任务列表、筛选、视图状态 |
| `src/frontend/components/TaskPanel.svelte` | 任务面板主组件（Dock面板内容） |
| `src/frontend/components/NextActionView.svelte` | Next Action视图 |
| `src/frontend/components/AllTasksView.svelte` | 全部任务视图 |
| `src/frontend/components/ProjectView.svelte` | 按项目视图（树形） |
| `src/frontend/components/TaskCard.svelte` | 任务卡片组件 |
| `src/frontend/components/TaskEditPopup.svelte` | 任务编辑弹窗 |
| `src/frontend/components/TaskContextMenu.svelte` | 右键上下文菜单 |
| `src/frontend/components/FilterBar.svelte` | 筛选栏 |
| `src/frontend/components/PriorityDot.svelte` | 优先级色点组件 |

---

### 任务 1：前端插件入口与内核通信桥接

**文件：**
- 创建：`src/frontend/kernel-bridge.ts`
- 创建：`src/frontend/constants.ts`
- 修改：`src/index.ts`

- [ ] **步骤 1：创建 src/frontend/constants.ts**

```typescript
export const PRIORITY_COLORS: Record<string, string> = {
    critical: "#e74c3c",
    high: "#e67e22",
    medium: "#3498db",
    low: "#95a5a6",
    none: "transparent",
};

export const VIEW_NEXT_ACTION = "nextAction";
export const VIEW_ALL_TASKS = "all";
export const VIEW_BY_PROJECT = "byProject";
export type ViewType = typeof VIEW_NEXT_ACTION | typeof VIEW_ALL_TASKS | typeof VIEW_BY_PROJECT;
```

- [ ] **步骤 2：创建 src/frontend/kernel-bridge.ts**

封装 `this.kernel.rpc` 调用，提供类型安全的接口：

```typescript
import { TaskCacheEntry, TaskChangeNotification } from "../shared/types";

export class KernelBridge {
    private plugin: any; // Plugin instance

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async call<T>(method: string, params?: object): Promise<T> {
        return await this.plugin.kernel.rpc.call[method](params);
    }

    async convertToTask(blockId: string): Promise<TaskCacheEntry> {
        return this.call("convertToTask", { blockId });
    }

    async removeTask(blockId: string): Promise<void> {
        return this.call("removeTask", { blockId });
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
        return this.call("recalcAllOrders", {});
    }

    async rebuildCache(): Promise<void> {
        return this.call("rebuildCache", {});
    }

    async getContexts(): Promise<string[]> {
        return this.call("getContexts", {});
    }

    onTasksChanged(handler: (notification: TaskChangeNotification) => void): void {
        this.plugin.kernel.rpc.bind("tasksChanged", (...params: any[]) => {
            handler(params[0] as TaskChangeNotification);
        });
    }

    onKernelStateChange(handler: (code: number) => void): void {
        this.plugin.eventBus.on("kernel-plugin-state-change", ({detail}: any) => {
            handler(detail.code);
        });
    }
}
```

- [ ] **步骤 3：修改 src/index.ts，注册顶栏按钮和Dock面板**

```typescript
import { Plugin, showMessage, Menu, Dialog } from "siyuan";
import "./index.scss";
import { KernelBridge } from "./frontend/kernel-bridge";

const DOCK_TYPE = "nextaction_dock";

export default class NextActionPlugin extends Plugin {
    private bridge!: KernelBridge;
    private isMobile: boolean = false;

    onload() {
        this.isMobile = (this as any).getFrontend?.() === "mobile";

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
                // 后续任务中将用 Svelte 挂载组件
                dock.element.innerHTML = `<div class="nextaction fn__flex-1 fn__flex-column">Loading...</div>`;
            },
            destroy() {},
        });
    }

    onLayoutReady() {
        this.bridge = new KernelBridge(this);

        this.addTopBar({
            icon: "iconNextAction",
            title: this.i18n.topBarTip,
            position: "right",
            callback: () => {
                // 切换Dock面板
            },
        });

        this.eventBus.on("kernel-plugin-state-change", async ({detail}: any) => {
            if (detail.code === 2) {
                showMessage(`[NextAction] ${this.i18n.pluginName} ready`);
            }
        });
    }

    onunload() {}
}
```

- [ ] **步骤 4：构建验证**

```bash
pnpm run build
node scripts/make_dev_copy.js
```

在思源中重新加载，确认顶栏图标和Dock面板可见。

- [ ] **步骤 5：Commit**

```bash
git add src/frontend/ src/index.ts
git commit -m "feat: add kernel bridge, frontend constants, and plugin entry with topbar + dock"
```

---

### 任务 2：Svelte状态管理

**文件：**
- 创建：`src/frontend/stores/task-store.ts`

- [ ] **步骤 1：创建 src/frontend/stores/task-store.ts**

```typescript
import { writable, derived } from "svelte/store";
import { TaskCacheEntry, TaskChangeNotification } from "../../shared/types";
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
}

function createTaskStore() {
    const { subscribe, set, update } = writable<TaskState>({
        tasks: [],
        loading: false,
        error: null,
        activeView: VIEW_NEXT_ACTION,
        filters: {},
    });

    let bridge: KernelBridge | null = null;

    return {
        subscribe,
        setBridge(b: KernelBridge) {
            bridge = b;
        },
        async loadNextActions() {
            if (!bridge) return;
            update((s) => ({ ...s, loading: true, error: null }));
            try {
                const tasks = await bridge.getNextActions();
                update((s) => ({ ...s, tasks, loading: false }));
            } catch (e: any) {
                update((s) => ({ ...s, loading: false, error: e.message }));
            }
        },
        async loadAllTasks(filters?: any) {
            if (!bridge) return;
            update((s) => ({ ...s, loading: true, error: null }));
            try {
                const tasks = await bridge.getAllTasks(filters);
                update((s) => ({ ...s, tasks, loading: false }));
            } catch (e: any) {
                update((s) => ({ ...s, loading: false, error: e.message }));
            }
        },
        setActiveView(view: string) {
            update((s) => ({ ...s, activeView: view }));
        },
        setFilters(filters: any) {
            update((s) => ({ ...s, filters: { ...s.filters, ...filters } }));
        },
        applyChangeNotification(notification: TaskChangeNotification) {
            update((s) => {
                let tasks = [...s.tasks];
                for (const blockId of notification.changedBlockIds) {
                    const type = notification.changeTypes[blockId];
                    if (type === "delete") {
                        tasks = tasks.filter((t) => t.blockId !== blockId);
                    } else if (type === "create" || type === "update") {
                        const idx = tasks.findIndex((t) => t.blockId === blockId);
                        if (idx >= 0) {
                            // 更新时需要从内核获取最新数据
                            bridge?.getTask(blockId).then((entry) => {
                                if (entry) {
                                    update((prev) => {
                                        const updated = [...prev.tasks];
                                        const i = updated.findIndex((t) => t.blockId === blockId);
                                        if (i >= 0) updated[i] = entry;
                                        return { ...prev, tasks: updated };
                                    });
                                }
                            });
                        }
                    }
                }
                return { ...s, tasks };
            });
        },
    };
}

export const taskStore = createTaskStore();
```

- [ ] **步骤 2：Commit**

```bash
git add src/frontend/stores/
git commit -m "feat: add Svelte task store with view switching, filters, and change notification handling"
```

---

### 任务 3：基础Svelte组件

**文件：**
- 创建：`src/frontend/components/PriorityDot.svelte`
- 创建：`src/frontend/components/TaskCard.svelte`
- 创建：`src/frontend/components/FilterBar.svelte`

- [ ] **步骤 1：创建 PriorityDot.svelte**

可点击的优先级色点组件，点击时标记任务完成：

```svelte
<script lang="ts">
    import { PRIORITY_COLORS } from "../constants";
    export let priority: string = "none";
    export let onclick: (() => void) | undefined = undefined;
    $: color = PRIORITY_COLORS[priority] || PRIORITY_COLORS.none;
</script>

<span
    class="na-priority-dot"
    style="background-color: {color}; border: 2px solid {color === 'transparent' ? '#ccc' : color}"
    on:click={onclick}
    title={onclick ? "Mark done" : priority}
></span>

<style>
    .na-priority-dot {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        cursor: pointer;
        flex-shrink: 0;
    }
</style>
```

- [ ] **步骤 2：创建 TaskCard.svelte**

任务卡片组件，显示优先级色点、标题、属性摘要，支持点击标题跳转、点击属性编辑、右键菜单：

```svelte
<script lang="ts">
    import TaskCacheEntry from "../../shared/types";
    import PriorityDot from "./PriorityDot.svelte";
    export let task: TaskCacheEntry;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onComplete: (blockId: string) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    import { openTab } from "siyuan";

    function handleClickTitle() {
        openTab({ app: (window as any).siYuanApp, doc: { id: task.blockId } });
    }
</script>

<div class="na-task-card" on:contextmenu|preventDefault={(e) => onContextMenu(task, e)}>
    <PriorityDot priority={task.priority} onclick={() => onComplete(task.blockId)} />
    <div class="na-task-card__body" on:click={() => onEdit(task)}>
        <div class="na-task-card__title" on:click|stopPropagation={handleClickTitle}>
            {task.blockId}
        </div>
        <div class="na-task-card__meta">
            {#if task.due}<span class="na-task-card__due">📅 {task.due}</span>{/if}
            {#if task.context}<span class="na-task-card__context">🏷 {task.context.replace(/\|/g, ', ')}</span>{/if}
            <span class="na-task-card__effort">📊 {task.effort}</span>
            <span class="na-task-card__importance">⭐ {task.importance}</span>
        </div>
    </div>
</div>
```

注意：任务标题需要从思源API获取块内容，不能仅显示blockId。后续需要通过 `getBlockKramdown` 或在 TaskCacheEntry 中增加 title 字段。此处先预留，待集成时完善。

- [ ] **步骤 3：创建 FilterBar.svelte**

筛选栏组件，提供上下文下拉和优先级下拉：

```svelte
<script lang="ts">
    export let contexts: string[] = [];
    export let selectedContext: string = "";
    export let selectedPriority: string = "";
    export let onFilterChange: (filters: any) => void;

    const priorities = ["", "critical", "high", "medium", "low", "none"];
</script>

<div class="na-filter-bar">
    <select bind:value={selectedContext} on:change={() => onFilterChange({ context: selectedContext, priority: selectedPriority })}>
        <option value="">All Contexts</option>
        {#each contexts as ctx}
            <option value={ctx}>{ctx}</option>
        {/each}
    </select>
    <select bind:value={selectedPriority} on:change={() => onFilterChange({ context: selectedContext, priority: selectedPriority })}>
        <option value="">All Priorities</option>
        {#each priorities.slice(1) as p}
            <option value={p}>{p}</option>
        {/each}
    </select>
</div>
```

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/components/PriorityDot.svelte src/frontend/components/TaskCard.svelte src/frontend/components/FilterBar.svelte
git commit -m "feat: add PriorityDot, TaskCard, and FilterBar Svelte components"
```

---

### 任务 4：三个视图组件

**文件：**
- 创建：`src/frontend/components/NextActionView.svelte`
- 创建：`src/frontend/components/AllTasksView.svelte`
- 创建：`src/frontend/components/ProjectView.svelte`

- [ ] **步骤 1：创建 NextActionView.svelte**

使用 TaskCard 列表展示 Next Action 任务，顶部 FilterBar，底部加载指示器：

- 调用 `taskStore.loadNextActions()` 加载数据
- 从 store 订阅 tasks 数组渲染 TaskCard 列表
- FilterBar 的 onFilterChange 带参数重新加载

- [ ] **步骤 2：创建 AllTasksView.svelte**

与 NextActionView 类似，但调用 `taskStore.loadAllTasks(filters)` 并支持按属性列头排序。

- [ ] **步骤 3：创建 ProjectView.svelte**

调用 `taskStore.loadAllTasks()` 获取全部任务，在前端按 parentId 组织成树形结构：
- 顶层：parentId 为空的任务
- 子级：parentId 指向父任务的子任务
- 折叠/展开控制

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/components/NextActionView.svelte src/frontend/components/AllTasksView.svelte src/frontend/components/ProjectView.svelte
git commit -m "feat: add three view components - NextAction, AllTasks, Project"
```

---

### 任务 5：任务编辑弹窗与上下文菜单

**文件：**
- 创建：`src/frontend/components/TaskEditPopup.svelte`
- 创建：`src/frontend/components/TaskContextMenu.svelte`

- [ ] **步骤 1：创建 TaskEditPopup.svelte**

使用思源 `Dialog` 组件包裹 Svelte 渲染的任务编辑表单：

字段：状态下拉、优先级下拉、重要性7圆点、工作量7圆点、截止日期选择器、开始日期选择器、上下文多选标签输入。

每个字段变化后500ms防抖调用 `bridge.updateTask()`。

- [ ] **步骤 2：创建 TaskContextMenu.svelte**

使用思源 `Menu` 组件：

- 标记为待办/进行中/等待/完成
- 优先级子菜单
- 移除任务

每个操作调用 `bridge.updateTask()` 或 `bridge.removeTask()`。

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/TaskEditPopup.svelte src/frontend/components/TaskContextMenu.svelte
git commit -m "feat: add task edit popup with debounced save and context menu"
```

---

### 任务 6：任务面板主组件与插件注册

**文件：**
- 创建：`src/frontend/components/TaskPanel.svelte`
- 修改：`src/index.ts`

- [ ] **步骤 1：创建 TaskPanel.svelte**

主面板组件，包含：
- 顶部视图Tab切换（Next Action / 全部 / 按项目）
- 当前视图组件渲染
- 底部操作栏："新建任务"按钮 + "重新计算优先级"按钮

- [ ] **步骤 2：修改 src/index.ts 完善插件注册**

在 `onload` 中添加：
- 斜杠菜单项：`protyleSlash` 注册"转为任务"和"新建任务"
- 块标菜单：`eventBus.on("click-blockicon")` 添加任务操作项
- 快捷键命令：`addCommand` 注册转为任务、新建任务、打开面板、重新计算优先级

在 `onLayoutReady` 中：
- 初始化 KernelBridge 和 taskStore
- 注册广播监听 `kernel.rpc.bind("tasksChanged")`
- 首次加载数据

在 Dock 面板的 `init` 回调中挂载 TaskPanel Svelte 组件。

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/TaskPanel.svelte src/index.ts
git commit -m "feat: add TaskPanel main component, slash menu, block icon menu, and commands"
```

---

### 任务 7：样式与收尾

**文件：**
- 修改：`src/index.scss`
- 修改：各组件样式

- [ ] **步骤 1：编写全局样式**

在 `src/index.scss` 中添加：
- `.na-task-card` 卡片样式
- `.na-priority-dot` 色点样式
- `.na-filter-bar` 筛选栏样式
- 视图Tab切换样式
- 编辑弹窗表单样式

使用思源笔记的 CSS 变量（`var(--b3-*)`）保持视觉一致性。

- [ ] **步骤 2：全流程端到端测试**

1. 点击顶栏按钮打开任务面板
2. 在文档中写一段文字，通过斜杠菜单"转为任务"
3. 在面板中查看该任务出现在 Next Action 视图
4. 点击任务卡片属性区域打开编辑弹窗，修改优先级和截止日期
5. 验证排序自动更新
6. 点击优先级色点一键完成，任务从 Next Action 消失
7. 右键菜单改状态、改优先级、移除任务
8. 切换到"全部任务"视图和"按项目"视图
9. 在编辑器中直接修改块属性，5秒后面板自动刷新

- [ ] **步骤 3：Commit**

```bash
git add -A
git commit -m "feat: complete frontend UI with styling, all views, and end-to-end integration"
```
