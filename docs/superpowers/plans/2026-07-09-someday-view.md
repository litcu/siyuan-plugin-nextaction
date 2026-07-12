# Someday/Maybe 视图 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 新增第 5 种任务状态 `someday` 和 SomedayView 视图，实现 GTD Someday/Maybe 列表管理，含快捷"激活"按钮。

**架构：** 新增 `someday` 状态常量，在内核 `isNextActionCandidate` 中排除 someday 任务，前端新增 `SomedayView.svelte` 组件（复用 SearchFilterBar + TaskCard + NaEmpty），NavRail 新增 Tab，TaskCard 条件渲染"激活"文字按钮。

**技术栈：** Svelte 3, SCSS (BEM + na- 前缀), 思源插件 API

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `src/shared/constants.ts` | 新增 `STATUS_SOMEDAY`，更新 `ALL_STATUSES` |
| 修改 | `src/frontend/constants.ts` | 新增 `STATUS_LIST` 项、`VIEW_SOMEDAY` 常量、`ViewType` |
| 修改 | `src/i18n/en.json` | 新增 someday 相关 i18n 键 |
| 修改 | `src/i18n/zh-CN.json` | 新增 someday 相关 i18n 键 |
| 修改 | `src/kernel/priority-engine.ts` | `isNextActionCandidate` 排除 someday |
| 修改 | `src/frontend/stores/task-store.ts` | 前端 `isNextActionCandidate` 排除 someday、`DEFAULT_FILTERS` 新增视图 |
| 修改 | `src/frontend/components/StatusCheckbox.svelte` | 新增 someday 状态类 |
| 修改 | `src/frontend/components/TaskCard.svelte` | 新增 `isSomeday` + 激活按钮 |
| 修改 | `src/frontend/components/NavRail.svelte` | 新增 Someday 导航项 |
| 修改 | `src/frontend/components/NextActionApp.svelte` | 新增 SomedayView 分支 |
| 修改 | `src/frontend/components/SearchFilterBar.svelte` | 新增 `showPriority` + `sortOptions` prop |
| 修改 | `src/frontend/ui/tokens.scss` | 新增 `--na-color-someday` 变量 |
| 修改 | `src/index.scss` | StatusCheckbox someday 样式、TaskCard someday 样式、编辑器 someday 样式、激活按钮样式 |
| 修改 | `src/frontend/utils.ts` | `showStatusMenu` 自动包含 someday（通过 STATUS_LIST） |
| 修改 | `src/frontend/components/task-context-menu.ts` | 右键菜单自动包含 someday（通过 STATUS_LIST） |
| 创建 | `src/frontend/components/SomedayView.svelte` | Someday 视图组件 |

---

### 任务 1：数据模型 — 常量与 i18n

**文件：**
- 修改：`src/shared/constants.ts:7-8`
- 修改：`src/frontend/constants.ts:18-24`
- 修改：`src/i18n/en.json`
- 修改：`src/i18n/zh-CN.json`

- [ ] **步骤 1：修改 `src/shared/constants.ts`**

在 `STATUS_WAITING` 和 `STATUS_DONE` 之间新增常量，更新数组：

```typescript
export const STATUS_SOMEDAY = "someday";
// ...
export const ALL_STATUSES = [STATUS_TODO, STATUS_DOING, STATUS_WAITING, STATUS_SOMEDAY, STATUS_DONE] as const;
```

- [ ] **步骤 2：修改 `src/frontend/constants.ts`**

更新 `STATUS_LIST`、新增视图常量和类型：

```typescript
export const VIEW_SOMEDAY = "someday";
// ...
export const STATUS_LIST = ["todo", "doing", "waiting", "someday", "done"] as const;
// ...
export type ViewType = typeof VIEW_NEXT_ACTION | typeof VIEW_ALL_TASKS | typeof VIEW_BY_PROJECT | typeof VIEW_SOMEDAY | typeof VIEW_STATISTICS;
```

- [ ] **步骤 3：修改 `src/i18n/en.json`**

在 `"statusDone"` 行之后新增：

```json
"statusSomeday": "Someday/Maybe",
"markAsSomeday": "Mark as Someday/Maybe",
"someday": "Someday",
"activate": "Activate",
"noSomedayTasks": "No Someday/Maybe tasks"
```

- [ ] **步骤 4：修改 `src/i18n/zh-CN.json`**

在 `"statusDone"` 行之后新增：

```json
"statusSomeday": "将来/也许",
"markAsSomeday": "标记为将来/也许",
"someday": "将来/也许",
"activate": "激活",
"noSomedayTasks": "暂无将来/也许任务"
```

- [ ] **步骤 5：Commit**

```bash
git add src/shared/constants.ts src/frontend/constants.ts src/i18n/en.json src/i18n/zh-CN.json
git commit -m "feat: add someday status constants and i18n keys"
```

---

### 任务 2：内核层 — 优先级引擎排除 someday

**文件：**
- 修改：`src/kernel/priority-engine.ts:155-163`

- [ ] **步骤 1：修改 `isNextActionCandidate`**

在 `entry.status === "waiting"` 排除行之后新增：

```typescript
if (entry.status === "someday") return false;
```

完整函数变为：

```typescript
export function isNextActionCandidate(entry: TaskCacheEntry, cache: Record<string, TaskCacheEntry>): boolean {
    if (entry.status === "done") return false;
    if (entry.status === "waiting") return false;
    if (entry.status === "someday") return false;
    if (entry.start && entry.start > new Date().toISOString().slice(0, 10)) return false;
    if (entry.taskType === "2") return false;
    if (isBlocked(entry, cache)) return false;

    return true;
}
```

- [ ] **步骤 2：Commit**

```bash
git add src/kernel/priority-engine.ts
git commit -m "feat: exclude someday tasks from next action candidates"
```

---

### 任务 3：前端 store — 排除 someday + 默认筛选器

**文件：**
- 修改：`src/frontend/stores/task-store.ts:4,61-68,84-88`

- [ ] **步骤 1：更新 import**

在第 4 行将 `VIEW_SOMEDAY` 加入 import：

```typescript
import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY } from "../constants";
```

- [ ] **步骤 2：更新前端 `isNextActionCandidate`**

在 `entry.status === "waiting"` 之后新增：

```typescript
if (entry.status === "someday") return false;
```

- [ ] **步骤 3：更新 `DEFAULT_FILTERS`**

新增 someday 视图的默认筛选器：

```typescript
const DEFAULT_FILTERS: Record<string, FilterState> = {
    [VIEW_NEXT_ACTION]: { ...DEFAULT_FILTER_STATE },
    [VIEW_ALL_TASKS]: { ...DEFAULT_FILTER_STATE },
    [VIEW_BY_PROJECT]: { ...DEFAULT_FILTER_STATE },
    [VIEW_SOMEDAY]: { ...DEFAULT_FILTER_STATE },
};
```

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/stores/task-store.ts
git commit -m "feat: exclude someday from next action in frontend store"
```

---

### 任务 4：CSS — someday 颜色 token + StatusCheckbox + TaskCard + 编辑器样式

**文件：**
- 修改：`src/frontend/ui/tokens.scss:8-20`
- 修改：`src/index.scss:470-495,782-822`

- [ ] **步骤 1：修改 `src/frontend/ui/tokens.scss`**

在 `:root` 的 `--na-color-done` 行后新增：

```scss
--na-color-someday: var(--b3-card-info-color, #f9e2af);
```

在 `.nextaction` 的 `--na-color-done` 行后新增：

```scss
--na-color-someday: var(--b3-card-info-color, #f9e2af);
```

- [ ] **步骤 2：修改 `src/index.scss` — StatusCheckbox someday 样式**

在 `&--waiting` 块之后、`&--done` 块之前（约第 475 行后）新增：

```scss
// Someday: golden border with question mark
&--someday {
    border-color: var(--na-color-someday);

    &::after {
        content: "?";
        color: var(--na-color-someday);
        font-size: 10px;
        font-weight: 700;
        line-height: 1;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
    }
}
```

- [ ] **步骤 3：修改 `src/index.scss` — 编辑器 protyle someday 样式**

在 `[custom-na-status="waiting"]::before` 块之后、`[custom-na-status="done"]::before` 块之前（约第 811 行后）新增：

```scss
&[custom-na-status="someday"]::before {
    border-color: var(--na-color-someday);
}
```

- [ ] **步骤 4：修改 `src/index.scss` — TaskCard someday 激活按钮样式**

在 `.na-task-card__action-btn` 块之后（约第 418 行后）新增：

```scss
.na-task-card__activate-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    border: none;
    background: none;
    color: var(--na-color-someday);
    cursor: pointer;
    border-radius: 6px;
    padding: 0 6px;
    flex-shrink: 0;
    font-size: var(--na-font-size-sm, 11px);
    transition: color 0.15s, background 0.15s;

    &:hover {
        background: rgba(249, 226, 175, 0.08);
    }

    &:active {
        transform: scale(0.9);
    }
}
```

- [ ] **步骤 5：Commit**

```bash
git add src/frontend/ui/tokens.scss src/index.scss
git commit -m "feat: add someday CSS tokens, StatusCheckbox, protyle, and activate button styles"
```

---

### 任务 5：StatusCheckbox 组件 — 新增 someday 状态类

**文件：**
- 修改：`src/frontend/components/StatusCheckbox.svelte:8-11`

- [ ] **步骤 1：新增 someday 类绑定**

将 `<span>` 标签的类绑定改为：

```svelte
<span
    class="na-status-checkbox"
    class:na-status-checkbox--doing={status === "doing"}
    class:na-status-checkbox--waiting={status === "waiting"}
    class:na-status-checkbox--someday={status === "someday"}
    class:na-status-checkbox--done={status === "done"}
    on:click|stopPropagation={(e) => { if (onclick) onclick(e); }}
    on:pointerdown|stopPropagation
></span>
```

- [ ] **步骤 2：Commit**

```bash
git add src/frontend/components/StatusCheckbox.svelte
git commit -m "feat: add someday status class to StatusCheckbox"
```

---

### 任务 6：TaskCard 组件 — someday 样式 + 激活按钮

**文件：**
- 修改：`src/frontend/components/TaskCard.svelte`

- [ ] **步骤 1：新增 `isSomeday` 响应式变量**

在 `$: isWaiting = task.status === "waiting";` 行（第 33 行）之后新增：

```typescript
$: isSomeday = task.status === "someday";
```

- [ ] **步骤 2：新增 CSS 类绑定**

在 `class:na-task-card--waiting={isWaiting}` 行之后新增：

```svelte
class:na-task-card--someday={isSomeday}
```

- [ ] **步骤 3：新增"激活"按钮**

在 `<div class="na-task-card__actions">` 内部，现有按钮之前（即 `{#if hasChildren}` 之前，约第 132 行处），新增：

```svelte
{#if isSomeday}
    <button
        class="na-task-card__activate-btn"
        on:click|stopPropagation={() => {
            if (onActivate) onActivate(task);
        }}
        title={i18n?.activate || "Activate"}
    >
        {i18n?.activate || "激活"}
    </button>
{/if}
```

- [ ] **步骤 4：新增 `onActivate` prop**

在 props 区域（约第 8-18 行）新增：

```typescript
export let onActivate: ((task: TaskCacheEntry) => void) | undefined = undefined;
```

- [ ] **步骤 5：Commit**

```bash
git add src/frontend/components/TaskCard.svelte
git commit -m "feat: add someday style and activate button to TaskCard"
```

---

### 任务 7：SearchFilterBar — 新增 `showPriority` 和 `sortOptions` props

**文件：**
- 修改：`src/frontend/components/SearchFilterBar.svelte`

- [ ] **步骤 1：新增 props**

在 `export let showStatus: boolean = false;` 之后新增：

```typescript
export let showPriority: boolean = true;
export let sortOptions: { value: string; label: string }[] | undefined = undefined;
```

- [ ] **步骤 2：使用 `sortOptions` prop 覆盖默认值**

将 `$: sortOptions = [...]` 改为：

```typescript
$: computedSortOptions = sortOptions || [
    { value: "order", label: i18n?.sortByOrder || "Priority score" },
    { value: "due", label: i18n?.sortByDue || "Due date" },
    { value: "importance", label: i18n?.sortByImportance || "Importance" },
    { value: "priority", label: i18n?.sortByPriority || "Manual priority" },
];
```

- [ ] **步骤 3：更新模板中的引用**

将 `<NaSortSelect options={sortOptions}` 改为 `<NaSortSelect options={computedSortOptions}`。

- [ ] **步骤 4：条件渲染优先级下拉**

将优先级下拉的 `<div style="--na-filter-active-color: var(--na-filter-priority)">` 整块用 `{#if showPriority}...{/if}` 包裹：

```svelte
{#if showPriority}
    <div style="--na-filter-active-color: var(--na-filter-priority)">
        <NaFilterDropdown
            label={i18n?.priority || "Priority"}
            options={priorityOptions}
            selected={filterState.priorities}
            {i18n}
            onChange={onPriorityChange}
        />
    </div>
{/if}
```

- [ ] **步骤 5：Commit**

```bash
git add src/frontend/components/SearchFilterBar.svelte
git commit -m "feat: add showPriority and sortOptions props to SearchFilterBar"
```

---

### 任务 8：SomedayView 组件

**文件：**
- 创建：`src/frontend/components/SomedayView.svelte`

- [ ] **步骤 1：创建 SomedayView.svelte**

```svelte
<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { VIEW_SOMEDAY } from "../constants";
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

    $: filterState = $taskStore.filterByView[VIEW_SOMEDAY] || DEFAULT_FILTER_STATE;
    $: somedayTasks = $taskStore.allTasks.filter(t => t.status === "someday");
    $: filteredTasks = applyFilters(somedayTasks, filterState);

    const somedaySortOptions = [
        { value: "order", label: i18n?.sortByOrder || "Comprehensive" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
    ];

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_SOMEDAY, state);
    }

    async function handleActivate(task: TaskCacheEntry) {
        try {
            const updated = await bridge.updateTask(task.blockId, { "na-status": "todo" });
            taskStore.applyUpdate(updated);
        } catch (e: any) {
            console.error("[NextAction] activate task failed:", e);
        }
    }
</script>

<div class="na-view na-view--someday">
    <SearchFilterBar
        contexts={$taskStore.contexts}
        tags={$taskStore.tags}
        filterState={filterState}
        showStatus={false}
        showPriority={false}
        sortOptions={somedaySortOptions}
        {i18n}
        onFilterChange={handleFilterChange}
    />
    {#if $taskStore.loading}
        <NaEmpty loading={true} />
    {:else if filteredTasks.length === 0}
        <NaEmpty text={$taskStore.error || i18n?.noSomedayTasks || "No Someday/Maybe tasks"} />
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
                    onActivate={handleActivate}
                    {i18n}
                />
            {/each}
        </div>
    {/if}
</div>
```

- [ ] **步骤 2：Commit**

```bash
git add src/frontend/components/SomedayView.svelte
git commit -m "feat: create SomedayView component"
```

---

### 任务 9：NavRail — 新增 Someday 导航项

**文件：**
- 修改：`src/frontend/components/NavRail.svelte:9-14`

- [ ] **步骤 1：新增 Someday 导航项**

在 `navItems` 数组中，在 `VIEW_BY_PROJECT` 项之后、`VIEW_STATISTICS` 项之前新增：

```typescript
{ view: VIEW_SOMEDAY, icon: "someday", label: i18n?.someday || "Someday" },
```

- [ ] **步骤 2：更新 import**

在 import 行中加入 `VIEW_SOMEDAY`：

```typescript
import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY, VIEW_STATISTICS } from "../constants";
```

- [ ] **步骤 3：新增灯泡 SVG 图标**

在模板的 `{#if item.icon === "chart"}` 之前新增：

```svelte
{:else if item.icon === "someday"}
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 2a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9z"/>
        <line x1="7" y1="15.5" x2="13" y2="15.5"/>
        <line x1="8" y1="17.5" x2="12" y2="17.5"/>
    </svg>
```

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/components/NavRail.svelte
git commit -m "feat: add Someday nav item to NavRail"
```

---

### 任务 10：NextActionApp — 集成 SomedayView

**文件：**
- 修改：`src/frontend/components/NextActionApp.svelte`

- [ ] **步骤 1：更新 import**

在 import 行中加入 `VIEW_SOMEDAY` 和 `SomedayView`：

```typescript
import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY, VIEW_STATISTICS } from "../constants";
```

```typescript
import SomedayView from "./SomedayView.svelte";
```

- [ ] **步骤 2：新增视图渲染分支**

在 `{:else if activeView === VIEW_BY_PROJECT}` 的结束 `{/if}` 之前、`{:else if activeView === VIEW_STATISTICS}` 之前新增：

```svelte
{:else if activeView === VIEW_SOMEDAY}
    <SomedayView
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
git commit -m "feat: integrate SomedayView into NextActionApp"
```

---

### 任务 11：构建验证

- [ ] **步骤 1：运行生产构建**

```bash
pnpm run build
```

预期：构建成功，无 TypeScript 错误，`dist/index.js` 和 `kernel.js` 生成。

- [ ] **步骤 2：检查构建产物**

确认 `kernel.js` 中包含 someday 排除逻辑，`dist/index.js` 中包含 SomedayView 和 NavRail 新项。

- [ ] **步骤 3：部署并手动测试**

```bash
pnpm run release
```

在思源中验证：
1. NavRail 出现"将来/也许"Tab，灯泡图标
2. 点击进入 SomedayView，无 someday 任务时显示空状态
3. 右键任意任务 → 状态菜单中出现"将来/也许"选项
4. 标记任务为"将来/也许"后，该任务从 NextAction 视图消失
5. 在 SomedayView 中看到该任务，StatusCheckbox 显示问号
6. 点击"激活"按钮，任务变回 todo，从 SomedayView 消失，出现在 NextAction
7. 编辑器中 someday 任务的圆圈边框为金色
8. 统计视图中状态分布图包含"将来/也许"

- [ ] **步骤 4：最终 Commit**

```bash
git add -A
git commit -m "feat: complete Someday/Maybe view implementation"
```
