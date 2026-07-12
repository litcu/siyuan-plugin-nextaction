# 标签页视图重设计 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将任务面板从侧边栏 Dock 迁移到自定义标签页，实现双栏布局（NavRail + 列表 + 详情面板）

**架构：** 用 `addTab` + `openTab({ custom })` 注册并打开自定义标签页，Svelte 根组件 NextActionApp 替代原 TaskPanel。左栏含 NavRail + TaskListPane，右栏 DetailPane 在选中任务时滑入展开。

**技术栈：** Svelte 4, 思源插件 API（addTab/openTab/addTopBar）, 现有 store/bridge 复用

---

## 文件结构

### 新建文件
| 文件 | 职责 |
|------|------|
| `src/frontend/components/NextActionApp.svelte` | 标签页根组件，三栏布局（NavRail + TaskListPane + DetailPane），管理选中任务状态 |
| `src/frontend/components/NavRail.svelte` | 左侧竖向导航栏，视图切换 + 重算按钮 |
| `src/frontend/components/TaskDetail.svelte` | 右栏详情编辑面板，替代 TaskEditPopup |

### 修改文件
| 文件 | 变更 |
|------|------|
| `src/index.ts` | 移除 addDock，添加 addTab + addTopBar，导入 openTab |
| `src/frontend/components/TaskCard.svelte` | 添加 selected prop 和选中态样式 |
| `src/frontend/components/NextActionView.svelte` | 传递 selectedTask / onSelectTask prop |
| `src/frontend/components/AllTasksView.svelte` | 传递 selectedTask / onSelectTask prop |
| `src/frontend/components/ProjectView.svelte` | 传递 selectedTask / onSelectTask prop |
| `src/frontend/components/FilterBar.svelte` | 添加搜索框，调整布局适配更宽空间 |
| `src/index.scss` | 添加 NavRail、DetailPane、TaskDetail 样式，更新 TaskCard 选中态，移除 TaskPanel/TaskEditPopup 旧样式 |

### 废弃文件（不删除，但不再被引用）
| 文件 | 原因 |
|------|------|
| `src/frontend/components/TaskPanel.svelte` | 被 NextActionApp 替代 |
| `src/frontend/components/TaskEditPopup.svelte` | 逻辑迁移到 TaskDetail |

### 不变更文件
| 文件 | 原因 |
|------|------|
| `src/frontend/stores/task-store.ts` | 数据层完全复用 |
| `src/frontend/kernel-bridge.ts` | 通信层完全复用 |
| `src/frontend/utils.ts` | 工具函数完全复用 |
| `src/frontend/constants.ts` | 常量完全复用 |
| `src/kernel/**` | 内核层完全复用 |
| `src/i18n/*.json` | 可能需要少量新增 key |

---

## 任务 1：修改插件入口（addTab + addTopBar + 移除 addDock）

**文件：**
- 修改：`src/index.ts`

- [ ] **步骤 1：移除 addDock 代码，替换为 addTab + addTopBar**

在 `src/index.ts` 中：

1. 在文件顶部导入中添加 `openTab`：
```typescript
import { Plugin, showMessage, getFrontend, Menu, openTab } from "siyuan";
```

2. 将 `const DOCK_TYPE = "nextaction_dock";` 替换为：
```typescript
const TAB_TYPE = "nextaction_tab";
```

3. 在 `onload()` 中，将整个 `this.addDock({...})` 块（约第 103-126 行）替换为：
```typescript
this.addTab({
    type: TAB_TYPE,
    init: (tab: any) => {
        const container = tab.element;
        container.classList.add("fn__flex");
        import("./frontend/components/NextActionApp.svelte").then(({ default: NextActionApp }) => {
            const app = new NextActionApp({
                target: container,
                props: {
                    bridge: this.bridge,
                    i18n: this.i18n,
                    tab,
                },
            });
            (tab as any)._naApp = app;
        });
    },
    destroy: (tab: any) => {
        const app = (tab as any)._naApp;
        if (app) app.$destroy();
    },
});

this.addTopBar({
    icon: "iconNextAction",
    title: this.i18n.taskPanel,
    callback: () => {
        openTab({
            app: this.app,
            custom: {
                id: this.name + TAB_TYPE,
                icon: "iconNextAction",
                title: this.i18n.pluginName || "NextAction",
            },
        });
    },
});
```

- [ ] **步骤 2：构建验证**

运行：`pnpm run build`

预期：构建成功（NextActionApp.svelte 尚未创建，此步会报错——这是预期的，下一步创建组件后解决）

- [ ] **步骤 3：Commit**

```bash
git add src/index.ts
git commit -m "refactor: replace addDock with addTab + addTopBar for custom tab"
```

---

## 任务 2：创建 NavRail 组件

**文件：**
- 创建：`src/frontend/components/NavRail.svelte`

- [ ] **步骤 1：编写 NavRail.svelte**

```svelte
<script lang="ts">
    import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT } from "../constants";

    export let activeView: string = VIEW_NEXT_ACTION;
    export let onSwitchView: (view: string) => void;
    export let onRecalc: () => void;
    export let i18n: any;

    const navItems = [
        { view: VIEW_NEXT_ACTION, icon: "⚡", label: i18n?.nextAction || "Next" },
        { view: VIEW_ALL_TASKS, icon: "📋", label: i18n?.allTasks || "All" },
        { view: VIEW_BY_PROJECT, icon: "📁", label: i18n?.byProject || "Project" },
    ];
</script>

<nav class="na-nav-rail">
    {#each navItems as item}
        <button
            class="na-nav-rail__item"
            class:active={activeView === item.view}
            on:click={() => onSwitchView(item.view)}
        >
            <span class="na-nav-rail__icon">{item.icon}</span>
            <span class="na-nav-rail__label">{item.label}</span>
        </button>
    {/each}
    <div class="na-nav-rail__spacer"></div>
    <button class="na-nav-rail__action" on:click={onRecalc} title={i18n?.recalcOrders || "Recalculate"}>
        ↻
    </button>
</nav>
```

- [ ] **步骤 2：Commit**

```bash
git add src/frontend/components/NavRail.svelte
git commit -m "feat: add NavRail component for vertical navigation"
```

---

## 任务 3：创建 TaskDetail 组件（替代 TaskEditPopup）

**文件：**
- 创建：`src/frontend/components/TaskDetail.svelte`

- [ ] **步骤 1：编写 TaskDetail.svelte**

从 TaskEditPopup.svelte 迁移逻辑，改为内嵌面板布局（两列网格），头部增加可编辑标题和关闭按钮。

```svelte
<script lang="ts">
    import type { TaskCacheEntry } from "../../shared/types";
    import { KernelBridge } from "../kernel-bridge";
    import { PRIORITY_LIST, STATUS_LIST } from "../constants";
    import { onMount, onDestroy } from "svelte";
    import { jumpToBlock as jump, toI18nKey } from "../utils";

    export let task: TaskCacheEntry;
    export let bridge: KernelBridge;
    export let i18n: any;
    export let onSave: ((updatedEntry: TaskCacheEntry) => void) | undefined = undefined;
    export let onRemove: ((blockId: string) => void) | undefined = undefined;
    export let onClose: (() => void) | undefined = undefined;

    let title = task.title || "";
    let status = task.status || "todo";
    let priority = task.priority || "none";
    let importance = task.importance || 4;
    let effort = task.effort || 4;
    let due = task.due || "";
    let start = task.start || "";
    let contextInput = task.context ? task.context.replace(/\|/g, ", ") : "";

    let parentId = task.parentId || "";
    let parentTitle = "";
    let parentInput = "";
    let parentSearchResults: TaskCacheEntry[] = [];
    let parentDropdownOpen = false;
    let parentSearchTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    onMount(async () => {
        if (parentId) {
            try {
                const parent = await bridge.getTask(parentId);
                if (parent) {
                    parentTitle = parent.title || i18n?.untitled || "(untitled)";
                }
            } catch (e) {
                console.error("[NextAction] getTask for parent failed:", e);
            }
        }
    });

    async function searchParentTasks() {
        if (!parentInput.trim()) {
            parentSearchResults = [];
            parentDropdownOpen = false;
            return;
        }
        try {
            const allTasks = await bridge.getAllTasks();
            const query = parentInput.toLowerCase();
            parentSearchResults = allTasks
                .filter((t: TaskCacheEntry) =>
                    t.blockId !== task.blockId &&
                    t.title && t.title.toLowerCase().includes(query)
                )
                .slice(0, 8);
            parentDropdownOpen = parentSearchResults.length > 0;
        } catch (e) {
            console.error("[NextAction] searchParentTasks failed:", e);
            parentSearchResults = [];
            parentDropdownOpen = false;
        }
    }

    function onParentInputChange() {
        if (parentSearchTimer) clearTimeout(parentSearchTimer);
        parentSearchTimer = setTimeout(searchParentTasks, 300);
    }

    async function selectParent(selected: TaskCacheEntry) {
        parentId = selected.blockId;
        parentTitle = selected.title || i18n?.untitled || "(untitled)";
        parentInput = "";
        parentSearchResults = [];
        parentDropdownOpen = false;
        try {
            const updated = await bridge.updateTask(task.blockId, { "na-parent": selected.blockId });
            if (onSave) onSave(updated);
        } catch (e: any) {
            console.error("[NextAction] updateTask (parent) failed:", e);
        }
    }

    async function clearParent() {
        parentId = "";
        parentTitle = "";
        parentInput = "";
        parentSearchResults = [];
        parentDropdownOpen = false;
        try {
            const updated = await bridge.updateTask(task.blockId, { "na-parent": "" });
            if (onSave) onSave(updated);
        } catch (e: any) {
            console.error("[NextAction] updateTask (clear parent) failed:", e);
        }
    }

    function closeParentDropdown() {
        parentDropdownOpen = false;
    }

    function scheduleSave() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            try {
                const contexts = contextInput
                    .split(",")
                    .map((s: string) => s.trim())
                    .filter(Boolean)
                    .join("|");
                const updated = await bridge.updateTask(task.blockId, {
                    "na-status": status,
                    "na-priority": priority,
                    "na-importance": String(importance),
                    "na-effort": String(effort),
                    "na-due": due,
                    "na-start": start,
                    "na-context": contexts,
                });
                if (onSave) onSave(updated);
            } catch (e: any) {
                console.error("[NextAction] updateTask failed:", e);
            }
        }, 500);
    }

    function handleChange() {
        scheduleSave();
    }

    async function handleRemove() {
        if (!onRemove) return;
        try {
            await bridge.removeTask(task.blockId);
            onRemove(task.blockId);
            if (onClose) onClose();
        } catch (e: any) {
            console.error("[NextAction] removeTask failed:", e);
        }
    }

    onDestroy(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        if (parentSearchTimer) clearTimeout(parentSearchTimer);
    });
</script>

<svelte:window on:click={closeParentDropdown} />

<div class="na-detail">
    <div class="na-detail__header">
        <div class="na-detail__header-top">
            <input
                class="na-detail__title"
                type="text"
                bind:value={title}
                on:input={scheduleSave}
                placeholder={i18n?.untitled || "(untitled)"}
            />
            <button class="na-detail__close" on:click={onClose}>✕</button>
        </div>
        <div class="na-detail__header-meta">
            {i18n?.[toI18nKey("priority", priority)] || priority} · ⭐{importance} 📊{effort}
        </div>
    </div>

    <div class="na-detail__body">
        <div class="na-detail__field">
            <span class="na-detail__label">{i18n?.status || "Status"}</span>
            <div class="na-detail__value">
                <select bind:value={status} on:change={handleChange}>
                    {#each STATUS_LIST as s}
                        <option value={s}>{i18n?.[toI18nKey("status", s)] || s}</option>
                    {/each}
                </select>
            </div>
        </div>
        <div class="na-detail__field">
            <span class="na-detail__label">{i18n?.priority || "Priority"}</span>
            <div class="na-detail__value">
                <select bind:value={priority} on:change={handleChange}>
                    {#each PRIORITY_LIST as p}
                        <option value={p}>{i18n?.[toI18nKey("priority", p)] || p}</option>
                    {/each}
                </select>
            </div>
        </div>
        <div class="na-detail__field">
            <span class="na-detail__label">{i18n?.importance || "Importance"}</span>
            <div class="na-detail__value">
                <div class="na-detail__dots">
                    {#each Array(7) as _, i}
                        <span
                            class="na-detail__dot"
                            class:active={i < importance}
                            on:click={() => { importance = i + 1; handleChange(); }}
                        ></span>
                    {/each}
                </div>
            </div>
        </div>
        <div class="na-detail__field">
            <span class="na-detail__label">{i18n?.effort || "Effort"}</span>
            <div class="na-detail__value">
                <div class="na-detail__dots">
                    {#each Array(7) as _, i}
                        <span
                            class="na-detail__dot"
                            class:active={i < effort}
                            on:click={() => { effort = i + 1; handleChange(); }}
                        ></span>
                    {/each}
                </div>
            </div>
        </div>
        <div class="na-detail__field">
            <span class="na-detail__label">{i18n?.dueDate || "Due Date"}</span>
            <div class="na-detail__value">
                <input type="date" bind:value={due} on:change={handleChange} />
            </div>
        </div>
        <div class="na-detail__field">
            <span class="na-detail__label">{i18n?.startDate || "Start Date"}</span>
            <div class="na-detail__value">
                <input type="date" bind:value={start} on:change={handleChange} />
            </div>
        </div>
        <div class="na-detail__field">
            <span class="na-detail__label">{i18n?.context || "Context"}</span>
            <div class="na-detail__value">
                <input type="text" bind:value={contextInput} on:input={handleChange} placeholder="@office, @phone" />
            </div>
        </div>
        <div class="na-detail__field">
            <span class="na-detail__label">{i18n?.parentTask || "Parent"}</span>
            <div class="na-detail__value" on:click|stopPropagation>
                {#if parentId}
                    <span class="na-detail__parent-current">
                        {parentTitle}
                        <button class="na-detail__parent-clear" on:click={clearParent}>×</button>
                    </span>
                {:else}
                    <input
                        type="text"
                        bind:value={parentInput}
                        on:input={onParentInputChange}
                        placeholder={i18n?.searchParentTask || "Search parent task..."}
                    />
                    {#if parentDropdownOpen && parentSearchResults.length > 0}
                        <div class="na-detail__dropdown">
                            {#each parentSearchResults as item}
                                <div class="na-detail__dropdown-item" on:click={() => selectParent(item)}>
                                    {item.title || i18n?.untitled || "(untitled)"}
                                </div>
                            {/each}
                        </div>
                    {/if}
                {/if}
            </div>
        </div>
    </div>

    <div class="na-detail__footer">
        <a href="javascript:void(0)" class="na-detail__link" on:click|preventDefault={() => jump(task.blockId)}>
            ↗ {i18n?.jumpToBlock || "Jump to Block"}
        </a>
        <button class="na-detail__remove" on:click={handleRemove}>
            {i18n?.removeTask || "Remove Task"}
        </button>
    </div>
</div>
```

- [ ] **步骤 2：Commit**

```bash
git add src/frontend/components/TaskDetail.svelte
git commit -m "feat: add TaskDetail component replacing TaskEditPopup"
```

---

## 任务 4：修改 TaskCard 添加选中态

**文件：**
- 修改：`src/frontend/components/TaskCard.svelte`

- [ ] **步骤 1：给 TaskCard 添加 selected prop 和点击回调**

在 TaskCard.svelte 的 `<script>` 中添加：
```typescript
export let selected: boolean = false;
export let onSelect: ((task: TaskCacheEntry) => void) | undefined = undefined;
```

将最外层 `<div class="na-task-card" ...>` 修改为添加 `class:selected` 和 `on:click`：
```svelte
<div
    class="na-task-card"
    class:na-task-card--root={isRoot}
    class:na-task-card--child={!isRoot}
    class:overdue={isOverdue}
    class:na-task-card--done={isDone}
    class:na-task-card--waiting={isWaiting}
    class:selected={selected}
    on:click={() => { if (onSelect) onSelect(task); }}
    on:contextmenu|preventDefault={(e) => onContextMenu(task, e)}
>
```

注意：保留原有的 `on:click` 在 `na-task-card__body` 上的跳转行为——改为 `on:click|stopPropagation` 以便外层的 onSelect 先触发。将 `na-task-card__body` 上的 `on:click={() => onEdit(task)}` 改为 `on:click|stopPropagation={() => onEdit(task)}`。

- [ ] **步骤 2：Commit**

```bash
git add src/frontend/components/TaskCard.svelte
git commit -m "feat: add selected prop and onSelect callback to TaskCard"
```

---

## 任务 5：修改视图组件传递 selectedTask / onSelectTask

**文件：**
- 修改：`src/frontend/components/NextActionView.svelte`
- 修改：`src/frontend/components/AllTasksView.svelte`
- 修改：`src/frontend/components/ProjectView.svelte`

- [ ] **步骤 1：NextActionView 添加 props 并传递给 TaskCard**

在 `<script>` 中添加：
```typescript
export let selectedTaskId: string = "";
export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;
```

在 TaskCard 上添加：
```svelte
<TaskCard
    {task}
    selected={task.blockId === selectedTaskId}
    onSelect={onSelectTask}
    {onEdit}
    {onStatusClick}
    {onContextMenu}
    {i18n}
/>
```

- [ ] **步骤 2：AllTasksView 同样处理**

添加相同的 props，并在两处 TaskCard（active 和 completed 区域）上都传递 `selected` 和 `onSelect`。

- [ ] **步骤 3：ProjectView 同样处理**

添加相同的 props，在根任务和子任务两处 TaskCard 上都传递。

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/components/NextActionView.svelte src/frontend/components/AllTasksView.svelte src/frontend/components/ProjectView.svelte
git commit -m "feat: pass selectedTaskId and onSelectTask through view components"
```

---

## 任务 6：创建 NextActionApp 根组件

**文件：**
- 创建：`src/frontend/components/NextActionApp.svelte`

这是核心组件，整合三栏布局、选中状态管理、视图切换。

- [ ] **步骤 1：编写 NextActionApp.svelte**

```svelte
<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { KernelBridge } from "../kernel-bridge";
    import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT } from "../constants";
    import NavRail from "./NavRail.svelte";
    import NextActionView from "./NextActionView.svelte";
    import AllTasksView from "./AllTasksView.svelte";
    import ProjectView from "./ProjectView.svelte";
    import FilterBar from "./FilterBar.svelte";
    import TaskDetail from "./TaskDetail.svelte";
    import { showTaskContextMenu } from "./task-context-menu";
    import { showStatusMenu } from "../utils";
    import type { TaskCacheEntry } from "../../shared/types";
    import { onMount, onDestroy } from "svelte";

    export let bridge: KernelBridge;
    export let i18n: any;
    export let tab: any;

    let activeView: string = VIEW_NEXT_ACTION;
    let selectedTask: TaskCacheEntry | null = null;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    let panelElement: HTMLElement;
    let cleanupFocusIn: (() => void) | null = null;

    onMount(() => {
        refreshTimer = setInterval(() => {
            if (panelElement && panelElement.offsetParent !== null) {
                taskStore.loadTasks();
            }
        }, 30000);

        const handleFocusIn = () => {
            taskStore.loadTasks();
        };
        panelElement?.addEventListener("focusin", handleFocusIn);
        cleanupFocusIn = () => {
            panelElement?.removeEventListener("focusin", handleFocusIn);
        };
    });

    onDestroy(() => {
        if (refreshTimer) clearInterval(refreshTimer);
        if (cleanupFocusIn) cleanupFocusIn();
    });

    function switchView(view: string) {
        activeView = view;
        selectedTask = null;
        taskStore.setActiveView(view);
        taskStore.loadTasks();
    }

    function handleSelectTask(task: TaskCacheEntry) {
        if (selectedTask && selectedTask.blockId === task.blockId) {
            selectedTask = null;
        } else {
            selectedTask = task;
        }
    }

    function handleEdit(task: TaskCacheEntry) {
        selectedTask = task;
    }

    function handleDetailClose() {
        selectedTask = null;
    }

    function handleDetailSave(updated: TaskCacheEntry) {
        taskStore.applyUpdate(updated);
        if (selectedTask && selectedTask.blockId === updated.blockId) {
            selectedTask = updated;
        }
    }

    function handleDetailRemove(blockId: string) {
        taskStore.applyRemove(blockId);
        selectedTask = null;
    }

    function handleContextMenu(task: TaskCacheEntry, event: MouseEvent) {
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
        });
    }

    async function handleStatusClick(task: TaskCacheEntry, event: MouseEvent) {
        const updated = await showStatusMenu(task, event, bridge, i18n);
        taskStore.applyUpdate(updated);
        if (selectedTask && selectedTask.blockId === updated.blockId) {
            selectedTask = updated;
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

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape" && selectedTask) {
            selectedTask = null;
        }
    }

    $: selectedTaskId = selectedTask ? selectedTask.blockId : "";
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="na-app" bind:this={panelElement}>
    <NavRail {activeView} onSwitchView={switchView} onRecalc={handleRecalc} {i18n} />

    <div class="na-app__center">
        <div class="na-app__filter">
            <FilterBar
                contexts={$taskStore.contexts}
                selectedContext=""
                selectedPriority=""
                {i18n}
                onFilterChange={(filters) => {
                    taskStore.setFilters(filters);
                    taskStore.loadTasks();
                }}
            />
        </div>

        <div class="na-app__list">
            {#if activeView === VIEW_NEXT_ACTION}
                <NextActionView
                    {selectedTaskId}
                    onSelectTask={handleSelectTask}
                    onEdit={handleEdit}
                    onStatusClick={handleStatusClick}
                    onContextMenu={handleContextMenu}
                    {i18n}
                />
            {:else if activeView === VIEW_ALL_TASKS}
                <AllTasksView
                    {selectedTaskId}
                    onSelectTask={handleSelectTask}
                    onEdit={handleEdit}
                    onStatusClick={handleStatusClick}
                    onContextMenu={handleContextMenu}
                    {i18n}
                />
            {:else}
                <ProjectView
                    {selectedTaskId}
                    onSelectTask={handleSelectTask}
                    onEdit={handleEdit}
                    onStatusClick={handleStatusClick}
                    onContextMenu={handleContextMenu}
                    {i18n}
                />
            {/if}
        </div>
    </div>

    <div class="na-app__detail-pane" class:open={selectedTask !== null}>
        {#if selectedTask}
            <div class="na-app__detail-inner">
                <TaskDetail
                    task={selectedTask}
                    {bridge}
                    {i18n}
                    onSave={handleDetailSave}
                    onRemove={handleDetailRemove}
                    onClose={handleDetailClose}
                />
            </div>
        {/if}
    </div>
</div>
```

- [ ] **步骤 2：构建验证**

运行：`pnpm run build`

预期：构建成功，无编译错误

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/NextActionApp.svelte
git commit -m "feat: add NextActionApp root component with three-column layout"
```

---

## 任务 7：更新样式

**文件：**
- 修改：`src/index.scss`

- [ ] **步骤 1：添加新组件样式，更新 TaskCard 选中态**

在 `src/index.scss` 中，在现有的 `.nextaction` 变量块之后，替换 `.na-panel` 及其子样式，添加新的样式。具体变更：

1. **移除** `.na-panel`、`.na-panel__tabs`、`.na-panel__tab`、`.na-panel__content`、`.na-panel__bottom`、`.na-panel__btn` 相关样式
2. **添加** NavRail 样式
3. **添加** NextActionApp 布局样式
4. **添加** DetailPane 滑入动画样式
5. **添加** TaskDetail 面板样式
6. **添加** TaskCard 选中态样式
7. **移除** `.na-edit-popup` 及其子样式（被 TaskDetail 替代）
8. **保留** 所有其他样式（TaskCard、FilterBar、StatusCheckbox、编辑器伪元素等）

新增样式块：

```scss
// App layout
.na-app {
    height: 100%;
    display: flex;
    background: var(--b3-theme-background);
    color: var(--b3-theme-on-surface);
}

.na-app__center {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
}

.na-app__filter {
    flex-shrink: 0;
}

.na-app__list {
    flex: 1;
    overflow-y: auto;
}

.na-app__detail-pane {
    width: 0;
    overflow: hidden;
    border-left: 1px solid var(--b3-border-color);
    background: var(--b3-theme-surface);
    transition: width 200ms ease;
    flex-shrink: 0;
}

.na-app__detail-pane.open {
    width: 420px;
}

.na-app__detail-inner {
    width: 420px;
    min-width: 420px;
    display: flex;
    flex-direction: column;
    height: 100%;
}

// NavRail
.na-nav-rail {
    width: 48px;
    background: var(--b3-theme-surface);
    border-right: 1px solid var(--b3-border-color);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 0;
    flex-shrink: 0;
}

.na-nav-rail__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 8px 0;
    cursor: pointer;
    position: relative;
    color: var(--b3-theme-on-surface-secondary);
    transition: color 0.15s;
    border: none;
    background: none;

    &:hover {
        color: var(--b3-theme-on-surface);
    }

    &.active {
        color: var(--b3-theme-primary);

        &::before {
            content: "";
            position: absolute;
            left: 0;
            top: 6px;
            bottom: 6px;
            width: 3px;
            background: var(--b3-theme-primary);
            border-radius: 0 2px 2px 0;
        }
    }
}

.na-nav-rail__icon {
    font-size: 18px;
    line-height: 1;
}

.na-nav-rail__label {
    font-size: 9px;
    margin-top: 3px;
    white-space: nowrap;
}

.na-nav-rail__spacer {
    flex: 1;
}

.na-nav-rail__action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    border: none;
    background: none;
    color: var(--b3-theme-on-surface-secondary);
    cursor: pointer;
    font-size: 16px;
    margin-bottom: 4px;

    &:hover {
        background: var(--b3-theme-surface-hover, rgba(255, 255, 255, 0.05));
        color: var(--b3-theme-on-surface);
    }
}

// TaskDetail panel
.na-detail {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.na-detail__header {
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--b3-border-color);
}

.na-detail__header-top {
    display: flex;
    align-items: center;
    gap: 10px;
}

.na-detail__title {
    flex: 1;
    font-size: 18px;
    font-weight: 600;
    line-height: 1.4;
    min-width: 0;
    background: none;
    border: none;
    border-bottom: 1px solid transparent;
    color: var(--b3-theme-on-surface);
    outline: none;
    padding: 2px 0;

    &:focus {
        border-bottom-color: var(--b3-theme-primary);
    }
}

.na-detail__close {
    background: none;
    border: none;
    color: var(--b3-theme-on-surface-secondary);
    cursor: pointer;
    font-size: 18px;
    padding: 4px;
    line-height: 1;
    border-radius: 4px;

    &:hover {
        background: var(--b3-theme-surface-hover, rgba(255, 255, 255, 0.05));
        color: var(--b3-theme-on-surface);
    }
}

.na-detail__header-meta {
    font-size: 12px;
    color: var(--b3-theme-on-surface-secondary);
    margin-top: 8px;
}

.na-detail__body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
}

.na-detail__field {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 6px 12px;
    align-items: center;
    margin-bottom: 14px;
}

.na-detail__label {
    font-size: 12px;
    color: var(--b3-theme-on-surface-secondary);
    text-align: right;
}

.na-detail__value {
    select,
    input[type="date"],
    input[type="text"] {
        width: 100%;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        padding: 6px 10px;
        color: var(--b3-theme-on-surface);
        font-size: 13px;
        outline: none;

        &:focus {
            border-color: var(--b3-theme-primary);
        }
    }
}

.na-detail__dots {
    display: flex;
    gap: 6px;
}

.na-detail__dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1.5px solid var(--b3-border-color);
    background: transparent;
    cursor: pointer;

    &.active {
        background: var(--b3-theme-primary);
        border-color: var(--b3-theme-primary);
    }

    &:hover {
        opacity: 0.75;
    }
}

.na-detail__parent-current {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--b3-theme-on-surface);
    background: var(--b3-theme-background);
    border: 1px solid var(--b3-border-color);
    border-radius: 6px;
    padding: 6px 10px;
    width: 100%;
    box-sizing: border-box;
}

.na-detail__parent-clear {
    background: none;
    border: none;
    color: var(--b3-theme-on-surface-secondary);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
    flex-shrink: 0;

    &:hover {
        color: var(--na-priority-critical);
    }
}

.na-detail__dropdown {
    position: absolute;
    z-index: 10;
    background: var(--b3-theme-surface);
    border: 1px solid var(--b3-border-color);
    border-radius: 6px;
    max-height: 200px;
    overflow-y: auto;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    width: calc(100% - 92px);
}

.na-detail__dropdown-item {
    padding: 8px 10px;
    font-size: 13px;
    color: var(--b3-theme-on-surface);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
        background: var(--b3-theme-surface-hover, rgba(0, 0, 0, 0.05));
    }
}

.na-detail__footer {
    padding: 12px 20px;
    border-top: 1px solid var(--b3-border-color);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.na-detail__link {
    font-size: 12px;
    color: var(--b3-theme-primary);
    cursor: pointer;
    text-decoration: none;

    &:hover {
        text-decoration: underline;
    }
}

.na-detail__remove {
    font-size: 12px;
    color: var(--na-priority-critical);
    cursor: pointer;
    background: none;
    border: none;
    padding: 4px 8px;
    border-radius: 4px;

    &:hover {
        background: rgba(231, 76, 60, 0.1);
    }
}

// TaskCard selected state (add to existing .na-task-card rules)
.na-task-card.selected {
    background: rgba(53, 131, 235, 0.08);
    border-left-color: var(--b3-theme-primary);
}
```

同时移除以下旧样式块（它们已不被引用）：
- `.na-panel` 及所有子选择器
- `.na-panel__*`
- `.na-edit-popup` 及所有子选择器
- `.na-edit-popup__*`

- [ ] **步骤 2：Commit**

```bash
git add src/index.scss
git commit -m "style: add NavRail, DetailPane, TaskDetail styles; remove obsolete panel/popup styles"
```

---

## 任务 8：构建验证和手动测试

**文件：** 无代码变更

- [ ] **步骤 1：完整构建**

运行：`pnpm run build`

预期：kernel.js 和 dist/index.js 均构建成功

- [ ] **步骤 2：部署到思源**

运行：`pnpm run deploy`

- [ ] **步骤 3：手动测试检查项**

1. 点击思源顶部栏的 NextAction 图标 → 打开自定义标签页
2. 标签页显示三栏布局：左侧 NavRail、中间任务列表、右侧详情面板（初始收起）
3. 点击 NavRail 导航项切换视图（下一步/全部/项目）
4. 点击任务卡片 → 右侧详情面板滑入展开，显示 TaskDetail
5. 在 TaskDetail 中修改字段 → 500ms 防抖后自动保存
6. 点击已选中任务或按 Esc → 详情面板滑出收起
7. 右键任务卡片 → 上下文菜单正常工作
8. 点击状态复选框 → 状态选择菜单正常弹出
9. 旧侧边栏入口不再出现

- [ ] **步骤 4：Commit（如有修复）**

---

## 任务 9：清理不再被引用的代码

**文件：**
- 确认：`src/frontend/components/TaskPanel.svelte` 和 `src/frontend/components/TaskEditPopup.svelte` 不再被任何文件导入

- [ ] **步骤 1：检查引用**

运行：`grep -r "TaskPanel\|TaskEditPopup" src/ --include="*.ts" --include="*.svelte"`

预期：无匹配结果（TaskPanel 和 TaskEditPopup 不再被任何活跃代码导入）

- [ ] **步骤 2：删除废弃文件**

```bash
rm src/frontend/components/TaskPanel.svelte
rm src/frontend/components/TaskEditPopup.svelte
```

- [ ] **步骤 3：构建验证**

运行：`pnpm run build`

预期：构建成功

- [ ] **步骤 4：Commit**

```bash
git add -A
git commit -m "chore: remove obsolete TaskPanel and TaskEditPopup components"
```
