# 搜索筛选重构 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将单选 FilterBar 替换为支持文本搜索 + 多选筛选 + 排序的 SearchFilterBar，筛选逻辑从内核迁移到前端

**架构：** 前端全量加载任务数据，用纯函数 applyFilters 做文本搜索+多维筛选+排序；各视图独立维护 FilterState；新建 NaFilterDropdown（多选）和 NaSortSelect（单选）两个 UI 组件

**技术栈：** Svelte 3 + TypeScript + SCSS（--na-* / --b3-* 变量）

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 创建 | `src/frontend/utils/filter.ts` | FilterState 类型定义、applyFilters 纯函数、sortTasksBy 排序函数 |
| 创建 | `src/frontend/ui/NaFilterDropdown.svelte` | 多选下拉筛选器组件（维度色边框、复选框、全选/清除） |
| 创建 | `src/frontend/ui/NaSortSelect.svelte` | 排序选择器组件（单选下拉、勾号标记当前项） |
| 创建 | `src/frontend/components/SearchFilterBar.svelte` | 搜索输入 + flex-wrap 筛选按钮行 + 内联下拉 |
| 修改 | `src/frontend/ui/tokens.scss` | 新增筛选维度主题色变量 |
| 修改 | `src/i18n/en.json` | 新增搜索/筛选/排序 i18n key |
| 修改 | `src/i18n/zh-CN.json` | 同上 |
| 修改 | `src/frontend/stores/task-store.ts` | filters→FilterState；新增 allTasks/filterByView；loadTasks 简化；新增 getFilteredTasks |
| 修改 | `src/frontend/kernel-bridge.ts` | getNextActions/getAllTasks 参数简化 |
| 修改 | `src/kernel/rpc-server.ts` | RPC 方法参数简化 |
| 修改 | `src/kernel/task-service.ts` | getNextActions/getAllTasks 移除服务端筛选 |
| 修改 | `src/frontend/components/NextActionView.svelte` | FilterBar → SearchFilterBar |
| 修改 | `src/frontend/components/AllTasksView.svelte` | FilterBar → SearchFilterBar |
| 修改 | `src/frontend/components/ProjectView.svelte` | 新增 SearchFilterBar |
| 修改 | `src/index.scss` | 删除旧 .na-filter-bar 样式，新增 SearchFilterBar 样式 |
| 删除 | `src/frontend/components/FilterBar.svelte` | 被 SearchFilterBar 替代 |

---

### 任务 1：创建 filter.ts 筛选工具模块

**文件：**
- 创建：`src/frontend/utils/filter.ts`

- [ ] **步骤 1：创建 filter.ts 文件，定义 FilterState 类型、DEFAULT_FILTER_STATE 常量、applyFilters 纯函数、sortTasksBy 排序函数**

```typescript
// src/frontend/utils/filter.ts
import type { TaskCacheEntry } from "../../shared/types";
import { PRIORITY_LIST } from "../constants";

export interface FilterState {
    searchText: string;
    contexts: string[];
    priorities: string[];
    statuses: string[];
    sortBy: string; // "order" | "due" | "importance" | "priority"
}

export const DEFAULT_FILTER_STATE: FilterState = {
    searchText: "",
    contexts: [],
    priorities: [],
    statuses: [],
    sortBy: "order",
};

export function applyFilters(tasks: TaskCacheEntry[], filters: FilterState): TaskCacheEntry[] {
    let result = tasks;

    // 1. Text search on title
    if (filters.searchText) {
        const q = filters.searchText.toLowerCase();
        result = result.filter(t => t.title.toLowerCase().includes(q));
    }

    // 2. Context filter (OR within dimension)
    if (filters.contexts.length > 0) {
        result = result.filter(t => {
            if (!t.context) return false;
            const taskContexts = t.context.split("|").map(c => c.trim());
            return taskContexts.some(c => filters.contexts.includes(c));
        });
    }

    // 3. Priority filter (OR within dimension)
    if (filters.priorities.length > 0) {
        result = result.filter(t => filters.priorities.includes(t.priority));
    }

    // 4. Status filter (OR within dimension)
    if (filters.statuses.length > 0) {
        result = result.filter(t => filters.statuses.includes(t.status));
    }

    // 5. Sort
    result = sortTasksBy(result, filters.sortBy);

    return result;
}

export function sortTasksBy(tasks: TaskCacheEntry[], sortBy: string): TaskCacheEntry[] {
    const arr = [...tasks];
    switch (sortBy) {
        case "due":
            arr.sort((a, b) => {
                if (!a.due && !b.due) return 0;
                if (!a.due) return 1;
                if (!b.due) return -1;
                return a.due.localeCompare(b.due);
            });
            break;
        case "importance":
            arr.sort((a, b) => b.importance - a.importance);
            break;
        case "priority":
            arr.sort((a, b) => {
                const pw = [5, 4, 3, 2, 1];
                const aIdx = PRIORITY_LIST.indexOf(a.priority as any);
                const bIdx = PRIORITY_LIST.indexOf(b.priority as any);
                return (pw[bIdx] || 0) - (pw[aIdx] || 0);
            });
            break;
        case "order":
        default:
            // Primary: order desc, then due asc, then importance desc, then blockId asc
            // Mirrors kernel sortTasks logic
            arr.sort((a, b) => {
                if (b.order !== a.order) return b.order - a.order;
                if (a.due && b.due) {
                    if (a.due !== b.due) return a.due.localeCompare(b.due);
                } else if (a.due) {
                    return -1;
                } else if (b.due) {
                    return 1;
                }
                if (b.importance !== a.importance) return b.importance - a.importance;
                return a.blockId.localeCompare(b.blockId);
            });
            break;
    }
    return arr;
}
```

- [ ] **步骤 2：验证构建通过**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build:app`
预期：构建成功，无类型错误

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/utils/filter.ts
git commit -m "feat: add FilterState type and applyFilters/sortTasksBy utility functions"
```

---

### 任务 2：添加 i18n keys 和 tokens

**文件：**
- 修改：`src/i18n/en.json`
- 修改：`src/i18n/zh-CN.json`
- 修改：`src/frontend/ui/tokens.scss`

- [ ] **步骤 1：在 en.json 末尾（`taskProperties` 行之后）添加新 key**

```json
    "searchPlaceholder": "Search tasks...",
    "sortBy": "Sort by",
    "sortByOrder": "Priority score",
    "sortByDue": "Due date",
    "sortByImportance": "Importance",
    "sortByPriority": "Manual priority",
    "selectAll": "Select all",
    "clearFilter": "Clear",
    "noResults": "No matching tasks"
```

- [ ] **步骤 2：在 zh-CN.json 末尾（`taskProperties` 行之后）添加新 key**

```json
    "searchPlaceholder": "搜索任务...",
    "sortBy": "排序",
    "sortByOrder": "优先级分数",
    "sortByDue": "截止日期",
    "sortByImportance": "重要性",
    "sortByPriority": "手动优先级",
    "selectAll": "全选",
    "clearFilter": "清除",
    "noResults": "没有匹配的任务"
```

- [ ] **步骤 3：在 tokens.scss 的 `.nextaction { }` 块中，在 `--na-color-effort` 之后添加筛选维度颜色变量**

```scss
  // ===== 筛选维度色 =====
  --na-filter-context: var(--na-priority-medium);
  --na-filter-priority: var(--na-priority-high);
  --na-filter-status: var(--na-color-done);
  --na-filter-sort: var(--b3-theme-primary);
```

- [ ] **步骤 4：验证构建通过**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build:app`
预期：构建成功

- [ ] **步骤 5：Commit**

```bash
git add src/i18n/en.json src/i18n/zh-CN.json src/frontend/ui/tokens.scss
git commit -m "feat: add search/filter i18n keys and filter dimension color tokens"
```

---

### 任务 3：创建 NaFilterDropdown 组件

**文件：**
- 创建：`src/frontend/ui/NaFilterDropdown.svelte`

- [ ] **步骤 1：创建 NaFilterDropdown.svelte**

```svelte
<script lang="ts">
    import { onDestroy } from "svelte";

    export let label: string;
    export let options: { value: string; label: string; color?: string }[] = [];
    export let selected: string[] = [];
    export let i18n: any;
    export let onChange: (selected: string[]) => void;

    let open = false;
    let containerEl: HTMLElement;

    $: hasSelection = selected.length > 0;
    $: isAllSelected = options.length > 0 && selected.length === options.length;

    function toggle() {
        open = !open;
    }

    function closeOnOutsideClick(e: MouseEvent) {
        if (containerEl && !containerEl.contains(e.target as Node)) {
            open = false;
        }
    }

    function toggleOption(value: string) {
        if (selected.includes(value)) {
            onChange(selected.filter(v => v !== value));
        } else {
            onChange([...selected, value]);
        }
    }

    function selectAll() {
        onChange(options.map(o => o.value));
    }

    function clearAll() {
        onChange([]);
    }

    onDestroy(() => {});
</script>

<svelte:window on:click={closeOnOutsideClick} />

<div class="na-filter-dropdown" bind:this={containerEl}>
    <button
        class="na-filter-dropdown__trigger"
        class:na-filter-dropdown__trigger--active={hasSelection}
        on:click={toggle}
    >
        <span class="na-filter-dropdown__label">{label}</span>
        {#if hasSelection}
            <span class="na-filter-dropdown__count">{selected.length}</span>
        {/if}
        <svg class="na-filter-dropdown__arrow" viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M2.5 4.5l3.5 3.5 3.5-3.5" />
        </svg>
    </button>
    {#if open}
        <div class="na-filter-dropdown__panel">
            <div class="na-filter-dropdown__actions">
                <button class="na-filter-dropdown__action" on:click={selectAll} disabled={isAllSelected}>
                    {i18n?.selectAll || "Select all"}
                </button>
                <button class="na-filter-dropdown__action" on:click={clearAll} disabled={!hasSelection}>
                    {i18n?.clearFilter || "Clear"}
                </button>
            </div>
            {#each options as opt (opt.value)}
                <label class="na-filter-dropdown__option" on:click|stopPropagation={() => toggleOption(opt.value)}>
                    <span class="na-filter-dropdown__checkbox" class:na-filter-dropdown__checkbox--checked={selected.includes(opt.value)}>
                        {#if selected.includes(opt.value)}
                            <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M2 6l3 3 5-5" />
                            </svg>
                        {/if}
                    </span>
                    {#if opt.color}
                        <span class="na-filter-dropdown__dot" style="background: {opt.color}"></span>
                    {/if}
                    <span class="na-filter-dropdown__option-label">{opt.label}</span>
                </label>
            {/each}
        </div>
    {/if}
</div>

<style>
    .na-filter-dropdown {
        position: relative;
    }

    .na-filter-dropdown__trigger {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 26px;
        padding: 0 8px;
        font-size: 11px;
        font-weight: 500;
        color: var(--b3-theme-on-surface-secondary);
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: 6px;
        cursor: pointer;
        white-space: nowrap;
        transition: border-color 0.15s, color 0.15s, background 0.15s;

        &:hover {
            border-color: var(--b3-theme-primary-light);
            background: var(--b3-theme-surface-light);
        }
    }

    .na-filter-dropdown__trigger--active {
        border-color: var(--na-filter-active-color, var(--b3-theme-primary));
        color: var(--na-filter-active-color, var(--b3-theme-primary));
    }

    .na-filter-dropdown__label {
        line-height: 1;
    }

    .na-filter-dropdown__count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 14px;
        height: 14px;
        padding: 0 3px;
        font-size: 10px;
        font-weight: 600;
        border-radius: 9999px;
        background: var(--na-filter-active-color, var(--b3-theme-primary));
        color: #fff;
        line-height: 1;
    }

    .na-filter-dropdown__arrow {
        flex-shrink: 0;
        opacity: 0.6;
    }

    .na-filter-dropdown__panel {
        position: absolute;
        z-index: 20;
        top: calc(100% + 4px);
        left: 0;
        min-width: 160px;
        max-height: 240px;
        overflow-y: auto;
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        box-shadow: var(--na-shadow-md);
        padding: 4px 0;
    }

    .na-filter-dropdown__actions {
        display: flex;
        justify-content: space-between;
        padding: 4px 10px 6px;
        border-bottom: 1px solid var(--na-color-divider);
        margin-bottom: 2px;
    }

    .na-filter-dropdown__action {
        font-size: 10px;
        font-weight: 500;
        color: var(--b3-theme-primary);
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;

        &:disabled {
            color: var(--b3-theme-on-surface-light);
            cursor: default;
        }
    }

    .na-filter-dropdown__option {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        font-size: 11px;
        color: var(--b3-theme-on-background);
        cursor: pointer;
        transition: background 0.1s;

        &:hover {
            background: var(--b3-theme-surface-light);
        }
    }

    .na-filter-dropdown__checkbox {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        border: 1.5px solid var(--na-color-divider);
        border-radius: 3px;
        flex-shrink: 0;
        transition: background 0.15s, border-color 0.15s;

        svg {
            color: #fff;
        }
    }

    .na-filter-dropdown__checkbox--checked {
        background: var(--na-filter-active-color, var(--b3-theme-primary));
        border-color: var(--na-filter-active-color, var(--b3-theme-primary));
    }

    .na-filter-dropdown__dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .na-filter-dropdown__option-label {
        line-height: 1.2;
    }
</style>
```

- [ ] **步骤 2：验证构建通过**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build:app`
预期：构建成功

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/ui/NaFilterDropdown.svelte
git commit -m "feat: add NaFilterDropdown multi-select filter component"
```

---

### 任务 4：创建 NaSortSelect 组件

**文件：**
- 创建：`src/frontend/ui/NaSortSelect.svelte`

- [ ] **步骤 1：创建 NaSortSelect.svelte**

```svelte
<script lang="ts">
    import { onDestroy } from "svelte";

    export let options: { value: string; label: string }[] = [];
    export let selected: string = "order";
    export let i18n: any;
    export let onChange: (value: string) => void;

    let open = false;
    let containerEl: HTMLElement;

    $: currentLabel = options.find(o => o.value === selected)?.label || "";

    function toggle() {
        open = !open;
    }

    function closeOnOutsideClick(e: MouseEvent) {
        if (containerEl && !containerEl.contains(e.target as Node)) {
            open = false;
        }
    }

    function selectOption(value: string) {
        onChange(value);
        open = false;
    }
</script>

<svelte:window on:click={closeOnOutsideClick} />

<div class="na-sort-select" bind:this={containerEl}>
    <button class="na-sort-select__trigger" on:click={toggle}>
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M2 8l4 2 4-2" />
            <path d="M2 5l4-2 4 2" opacity="0.4" />
        </svg>
        <span class="na-sort-select__label">{currentLabel}</span>
    </button>
    {#if open}
        <div class="na-sort-select__panel">
            {#each options as opt (opt.value)}
                <div
                    class="na-sort-select__option"
                    class:na-sort-select__option--active={opt.value === selected}
                    on:click={() => selectOption(opt.value)}
                >
                    <span class="na-sort-select__option-label">{opt.label}</span>
                    {#if opt.value === selected}
                        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M2 6l3 3 5-5" />
                        </svg>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    .na-sort-select {
        position: relative;
    }

    .na-sort-select__trigger {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 26px;
        padding: 0 8px;
        font-size: 11px;
        font-weight: 500;
        color: var(--na-filter-sort, var(--b3-theme-primary));
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: 6px;
        cursor: pointer;
        white-space: nowrap;
        transition: border-color 0.15s, background 0.15s;

        &:hover {
            border-color: var(--na-filter-sort, var(--b3-theme-primary));
            background: var(--b3-theme-surface-light);
        }
    }

    .na-sort-select__label {
        line-height: 1;
    }

    .na-sort-select__panel {
        position: absolute;
        z-index: 20;
        top: calc(100% + 4px);
        right: 0;
        min-width: 140px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        box-shadow: var(--na-shadow-md);
        padding: 4px 0;
    }

    .na-sort-select__option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 6px 10px;
        font-size: 11px;
        color: var(--b3-theme-on-background);
        cursor: pointer;
        transition: background 0.1s;

        &:hover {
            background: var(--b3-theme-surface-light);
        }
    }

    .na-sort-select__option--active {
        color: var(--na-filter-sort, var(--b3-theme-primary));
        font-weight: 500;
        background: var(--b3-theme-primary-lightest, rgba(79, 195, 247, 0.08));

        svg {
            color: var(--na-filter-sort, var(--b3-theme-primary));
        }
    }

    .na-sort-select__option-label {
        line-height: 1.2;
    }
</style>
```

- [ ] **步骤 2：验证构建通过**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build:app`
预期：构建成功

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/ui/NaSortSelect.svelte
git commit -m "feat: add NaSortSelect single-select sort component"
```

---

### 任务 5：创建 SearchFilterBar 组件

**文件：**
- 创建：`src/frontend/components/SearchFilterBar.svelte`

- [ ] **步骤 1：创建 SearchFilterBar.svelte**

```svelte
<script lang="ts">
    import NaFilterDropdown from "../ui/NaFilterDropdown.svelte";
    import NaSortSelect from "../ui/NaSortSelect.svelte";
    import { PRIORITY_LIST, STATUS_LIST } from "../constants";
    import { PRIORITY_COLORS } from "../constants";
    import { toI18nKey } from "../utils";
    import type { FilterState } from "../utils/filter";

    export let contexts: string[] = [];
    export let filterState: FilterState;
    export let showStatus: boolean = false;
    export let i18n: any;
    export let onFilterChange: (state: FilterState) => void;

    let searchText = filterState.searchText;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    $: contextOptions = contexts.map(c => ({ value: c, label: c }));
    $: priorityOptions = PRIORITY_LIST.map(p => ({
        value: p,
        label: i18n?.[toI18nKey("priority", p)] || p,
        color: PRIORITY_COLORS[p] === "transparent" ? "" : PRIORITY_COLORS[p],
    }));
    $: statusOptions = STATUS_LIST.map(s => ({
        value: s,
        label: i18n?.[toI18nKey("status", s)] || s,
    }));
    $: sortOptions = [
        { value: "order", label: i18n?.sortByOrder || "Priority score" },
        { value: "due", label: i18n?.sortByDue || "Due date" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
        { value: "priority", label: i18n?.sortByPriority || "Manual priority" },
    ];

    function onSearchInput() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            onFilterChange({ ...filterState, searchText });
        }, 300);
    }

    function onContextChange(selected: string[]) {
        onFilterChange({ ...filterState, contexts: selected });
    }

    function onPriorityChange(selected: string[]) {
        onFilterChange({ ...filterState, priorities: selected });
    }

    function onStatusChange(selected: string[]) {
        onFilterChange({ ...filterState, statuses: selected });
    }

    function onSortChange(value: string) {
        onFilterChange({ ...filterState, sortBy: value });
    }
</script>

<div class="na-search-filter-bar">
    <input
        type="text"
        class="na-search-filter-bar__search"
        bind:value={searchText}
        on:input={onSearchInput}
        placeholder={i18n?.searchPlaceholder || "Search tasks..."}
    />
    <div class="na-search-filter-bar__filters">
        <div style="--na-filter-active-color: var(--na-filter-context)">
            <NaFilterDropdown
                label={i18n?.context || "Context"}
                options={contextOptions}
                selected={filterState.contexts}
                {i18n}
                onChange={onContextChange}
            />
        </div>
        <div style="--na-filter-active-color: var(--na-filter-priority)">
            <NaFilterDropdown
                label={i18n?.priority || "Priority"}
                options={priorityOptions}
                selected={filterState.priorities}
                {i18n}
                onChange={onPriorityChange}
            />
        </div>
        {#if showStatus}
            <div style="--na-filter-active-color: var(--na-filter-status)">
                <NaFilterDropdown
                    label={i18n?.status || "Status"}
                    options={statusOptions}
                    selected={filterState.statuses}
                    {i18n}
                    onChange={onStatusChange}
                />
            </div>
        {/if}
        <NaSortSelect
            options={sortOptions}
            selected={filterState.sortBy}
            {i18n}
            onChange={onSortChange}
        />
    </div>
</div>
```

- [ ] **步骤 2：验证构建通过**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build:app`
预期：构建成功

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/SearchFilterBar.svelte
git commit -m "feat: add SearchFilterBar component with search input and filter buttons"
```

---

### 任务 6：添加 SearchFilterBar 样式到 index.scss

**文件：**
- 修改：`src/index.scss`

- [ ] **步骤 1：将 `.na-filter-bar` 样式块（约 183-190 行）替换为 SearchFilterBar 样式**

删除：
```scss
// Filter bar
.na-filter-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--na-color-divider);
    background: var(--b3-theme-surface);
}
```

替换为：
```scss
// Search filter bar
.na-search-filter-bar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--na-color-divider);
    background: var(--b3-theme-surface);
}

.na-search-filter-bar__search {
    width: 100%;
    height: 28px;
    padding: 0 10px;
    font-size: 12px;
    color: var(--b3-theme-on-background);
    background: var(--b3-theme-background);
    border: 1px solid var(--na-color-divider);
    border-radius: 6px;
    outline: none;
    transition: border-color 0.15s;

    &::placeholder {
        color: var(--b3-theme-on-surface-light);
    }

    &:hover {
        border-color: var(--b3-theme-primary-light);
    }

    &:focus {
        border-color: var(--b3-theme-primary);
    }
}

.na-search-filter-bar__filters {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
}
```

- [ ] **步骤 2：验证构建通过**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build:app`
预期：构建成功

- [ ] **步骤 3：Commit**

```bash
git add src/index.scss
git commit -m "style: replace .na-filter-bar with .na-search-filter-bar styles"
```

---

### 任务 7：重构 task-store — 前端筛选

**文件：**
- 修改：`src/frontend/stores/task-store.ts`

这是最大的改动。需要：
1. `filters` → `filterByView`（三个视图独立 FilterState）
2. 新增 `allTasks` 字段
3. `loadTasks()` 不传筛选参数，获取全量数据
4. 新增 `getFilteredTasks(viewId)` 方法
5. 移除 `loadMoreTasks()`（前端筛选不需要分页）
6. `applyUpdate` / `applyChangeNotification` 同步更新 `allTasks`
7. 移除旧的 `setFilters` / `clearFilters`，替换为 `updateFilter`

- [ ] **步骤 1：重写 task-store.ts**

完整新内容：

```typescript
import { writable } from "svelte/store";
import type { TaskCacheEntry, TaskChangeNotification } from "../../shared/types";
import { KernelBridge } from "../kernel-bridge";
import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT } from "../constants";
import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
import type { FilterState } from "../utils/filter";

interface TaskState {
    allTasks: TaskCacheEntry[];
    loading: boolean;
    error: string | null;
    activeView: string;
    filterByView: Record<string, FilterState>;
    contexts: string[];
    doneCount: number;
    projectReminders: TaskCacheEntry[];
    completedTasks: TaskCacheEntry[];
    showCompleted: boolean;
}

const DEFAULT_FILTERS: Record<string, FilterState> = {
    [VIEW_NEXT_ACTION]: { ...DEFAULT_FILTER_STATE },
    [VIEW_ALL_TASKS]: { ...DEFAULT_FILTER_STATE },
    [VIEW_BY_PROJECT]: { ...DEFAULT_FILTER_STATE },
};

function createTaskStore() {
    const { subscribe, set, update } = writable<TaskState>({
        allTasks: [],
        loading: false,
        error: null,
        activeView: VIEW_NEXT_ACTION,
        filterByView: { ...DEFAULT_FILTERS },
        contexts: [],
        doneCount: 0,
        projectReminders: [],
        completedTasks: [],
        showCompleted: false,
    });

    let bridge: KernelBridge | null = null;
    let loadSeq = 0;

    return {
        subscribe,
        setBridge(b: KernelBridge) {
            bridge = b;
        },

        async loadTasks() {
            if (!bridge) return;
            const seq = ++loadSeq;
            const currentState: TaskState = await new Promise((resolve) => {
                subscribe((s) => resolve(s))();
            });
            const isFirstLoad = currentState.allTasks.length === 0;
            if (isFirstLoad) {
                update((s) => ({ ...s, loading: true, error: null }));
            }
            try {
                let incoming: TaskCacheEntry[];

                if (currentState.activeView === VIEW_NEXT_ACTION) {
                    // Next Action: kernel still does semantic filtering (exclude done/waiting/blocked/projects)
                    incoming = await bridge.getNextActions();
                } else {
                    // All Tasks / Project: fetch full dataset
                    incoming = await bridge.getAllTasks();
                }

                // Fetch done count for the badge
                let doneCount = currentState.doneCount;
                if (currentState.activeView !== VIEW_NEXT_ACTION) {
                    try {
                        const result = await bridge.getDoneTaskCount();
                        doneCount = result;
                    } catch (_e) { /* ignore */ }
                }

                const contexts = await bridge.getContexts();

                if (seq !== loadSeq) return;

                update((s) => ({ ...s, allTasks: incoming, contexts, loading: false, doneCount }));

                if (currentState.activeView === VIEW_NEXT_ACTION) {
                    this.loadProjectReminders();
                }
            } catch (e: any) {
                if (seq !== loadSeq) return;
                update((s) => ({ ...s, loading: false, error: e.message }));
            }
        },

        getFilteredTasks(viewId: string): TaskCacheEntry[] {
            let result: TaskCacheEntry[] = [];
            let currentState: TaskState | null = null;
            const unsub = subscribe((s) => { currentState = s; });
            unsub();

            if (!currentState) return result;

            const filter = currentState.filterByView[viewId] || DEFAULT_FILTER_STATE;
            const tasks = currentState.allTasks;

            if (viewId === VIEW_NEXT_ACTION) {
                result = applyFilters(tasks, filter);
            } else if (viewId === VIEW_ALL_TASKS) {
                result = applyFilters(tasks, filter);
            } else if (viewId === VIEW_BY_PROJECT) {
                result = applyFilters(tasks, filter);
            }

            return result;
        },

        async loadDoneTasks(): Promise<TaskCacheEntry[]> {
            if (!bridge) return [];
            try {
                const tasks = await bridge.getAllTasks({ status: "done" });
                update(s => ({ ...s, completedTasks: tasks }));
                return tasks;
            } catch (_e) {
                return [];
            }
        },

        async toggleCompleted() {
            const currentState: TaskState = await new Promise((resolve) => {
                subscribe((s) => resolve(s))();
            });
            if (!currentState.showCompleted && currentState.completedTasks.length === 0) {
                await this.loadDoneTasks();
            }
            update(s => ({ ...s, showCompleted: !s.showCompleted }));
        },

        async loadProjectReminders() {
            if (!bridge) return;
            try {
                const reminders = await bridge.getProjectReminders();
                update(s => ({ ...s, projectReminders: reminders }));
            } catch (e: any) {
                console.error("[NextAction] loadProjectReminders failed:", e);
            }
        },

        applyUpdate(entry: TaskCacheEntry) {
            update((s) => {
                const idx = s.allTasks.findIndex((t) => t.blockId === entry.blockId);
                const allTasks = [...s.allTasks];
                const wasDone = idx >= 0 && allTasks[idx].status === "done";
                const isDone = entry.status === "done";

                if (idx >= 0) {
                    allTasks[idx] = entry;
                } else {
                    allTasks.push(entry);
                }

                let doneCount = s.doneCount;
                if (!wasDone && isDone) doneCount++;
                else if (wasDone && !isDone) doneCount = Math.max(0, doneCount - 1);

                if (s.showCompleted && wasDone !== isDone) {
                    this.loadDoneTasks();
                }

                return { ...s, allTasks, doneCount };
            });
        },

        applyRemove(blockId: string) {
            update((s) => ({
                ...s,
                allTasks: s.allTasks.filter((t) => t.blockId !== blockId),
            }));
        },

        setActiveView(view: string) {
            update((s) => ({ ...s, activeView: view }));
        },

        updateFilter(viewId: string, partial: Partial<FilterState>) {
            update((s) => {
                const current = s.filterByView[viewId] || DEFAULT_FILTER_STATE;
                return {
                    ...s,
                    filterByView: {
                        ...s.filterByView,
                        [viewId]: { ...current, ...partial },
                    },
                };
            });
        },

        setFilterState(viewId: string, state: FilterState) {
            update((s) => ({
                ...s,
                filterByView: {
                    ...s.filterByView,
                    [viewId]: state,
                },
            }));
        },

        applyChangeNotification(notification: TaskChangeNotification) {
            if (!bridge) return;
            for (const blockId of notification.changedBlockIds) {
                const type = notification.changeTypes[blockId];
                if (type === "delete") {
                    update((s) => {
                        const deleted = s.allTasks.find(t => t.blockId === blockId);
                        let doneCount = s.doneCount;
                        if (deleted && deleted.status === "done") doneCount = Math.max(0, doneCount - 1);
                        return {
                            ...s,
                            allTasks: s.allTasks.filter((t) => t.blockId !== blockId),
                            doneCount,
                        };
                    });
                } else {
                    bridge.getTask(blockId).then((entry) => {
                        if (!entry) return;
                        update((s) => {
                            const idx = s.allTasks.findIndex((t) => t.blockId === blockId);
                            const allTasks = [...s.allTasks];
                            const wasDone = idx >= 0 && allTasks[idx].status === "done";
                            const isDone = entry.status === "done";

                            if (idx >= 0) {
                                allTasks[idx] = entry;
                            } else {
                                allTasks.push(entry);
                            }

                            let doneCount = s.doneCount;
                            if (!wasDone && isDone) doneCount++;
                            else if (wasDone && !isDone) doneCount = Math.max(0, doneCount - 1);

                            const statusChanged = wasDone !== isDone;

                            if (s.showCompleted && statusChanged) {
                                this.loadDoneTasks();
                            }

                            return { ...s, allTasks, doneCount };
                        });
                    });
                }
            }
        },
    };
}

export const taskStore = createTaskStore();
```

- [ ] **步骤 2：验证构建通过**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build:app`
预期：构建成功

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/stores/task-store.ts
git commit -m "refactor: task-store — frontend filtering with FilterState per view"
```

---

### 任务 8：简化 kernel-bridge RPC 参数

**文件：**
- 修改：`src/frontend/kernel-bridge.ts`

- [ ] **步骤 1：修改 getNextActions 和 getAllTasks 的参数签名**

将 `getNextActions` 方法（第 52-54 行）改为：
```typescript
async getNextActions(): Promise<TaskCacheEntry[]> {
    return this.call("getNextActions", {});
}
```

将 `getAllTasks` 方法（第 56-58 行）改为：
```typescript
async getAllTasks(filters?: { status?: string; sortBy?: string }): Promise<TaskCacheEntry[]> {
    return this.call("getAllTasks", filters || {});
}
```

保留 `status` 和 `sortBy` 参数，因为 `loadDoneTasks()` 仍用 `status: "done"` 获取已完成任务。其余参数（`context`、`excludeDone`、`limit`、`offset`）不再需要。

- [ ] **步骤 2：验证构建通过**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build:app`
预期：构建成功

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/kernel-bridge.ts
git commit -m "refactor: simplify kernel-bridge RPC params — remove server-side filter params"
```

---

### 任务 9：简化内核 RPC 和 task-service

**文件：**
- 修改：`src/kernel/rpc-server.ts`
- 修改：`src/kernel/task-service.ts`

- [ ] **步骤 1：修改 rpc-server.ts 中 getNextActions 绑定（第 72-84 行）**

将：
```typescript
siyuan.rpc.bind("getNextActions", async (...params: any[]) => {
    const p = params[0] || {};
    try {
        return taskService.getNextActions({
            context: p.context,
            priority: p.priority,
            limit: p.limit,
            offset: p.offset,
        });
    } catch (e: any) {
        return errorToRpcError(e);
    }
});
```

改为：
```typescript
siyuan.rpc.bind("getNextActions", async (..._params: any[]) => {
    try {
        return taskService.getNextActions();
    } catch (e: any) {
        return errorToRpcError(e);
    }
});
```

- [ ] **步骤 2：修改 rpc-server.ts 中 getAllTasks 绑定（第 86-100 行）**

将：
```typescript
siyuan.rpc.bind("getAllTasks", async (...params: any[]) => {
    const p = params[0] || {};
    try {
        return taskService.getAllTasks({
            status: p.status,
            context: p.context,
            sortBy: p.sortBy,
            limit: p.limit,
            offset: p.offset,
            excludeDone: p.excludeDone,
        });
    } catch (e: any) {
        return errorToRpcError(e);
    }
});
```

改为：
```typescript
siyuan.rpc.bind("getAllTasks", async (...params: any[]) => {
    const p = params[0] || {};
    try {
        return taskService.getAllTasks({
            status: p.status,
            sortBy: p.sortBy,
        });
    } catch (e: any) {
        return errorToRpcError(e);
    }
});
```

- [ ] **步骤 3：修改 task-service.ts 中 getNextActions 方法（第 697-747 行）**

将方法签名和逻辑简化为：
```typescript
getNextActions(): TaskCacheEntry[] {
    const allEntries = this.cacheManager.getAll();

    const cacheRecord: Record<string, TaskCacheEntry> = Object.create(null) as Record<string, TaskCacheEntry>;
    for (let i = 0; i < allEntries.length; i++) {
        cacheRecord[allEntries[i].blockId] = allEntries[i];
    }

    const candidates: TaskCacheEntry[] = [];
    for (let i = 0; i < allEntries.length; i++) {
        const entry = allEntries[i];
        if (!isNextActionCandidate(entry, cacheRecord)) continue;
        candidates.push(entry);
    }

    return sortTasks(candidates);
}
```

- [ ] **步骤 4：修改 task-service.ts 中 getAllTasks 方法（第 749-818 行）**

将方法签名和逻辑简化为：
```typescript
getAllTasks(filters?: {
    status?: string;
    sortBy?: string;
}): TaskCacheEntry[] {
    let entries = this.cacheManager.getAll();

    if (filters) {
        if (filters.status) {
            entries = entries.filter((e) => e.status === filters.status);
        }
    }

    // Sort
    if (filters && filters.sortBy) {
        switch (filters.sortBy) {
            case "order":
                entries = sortTasks(entries);
                break;
            case "due":
                entries.sort((a, b) => {
                    if (!a.due && !b.due) return 0;
                    if (!a.due) return 1;
                    if (!b.due) return -1;
                    return a.due.localeCompare(b.due);
                });
                break;
            case "importance":
                entries.sort((a, b) => b.importance - a.importance);
                break;
            case "priority":
                entries.sort((a, b) => {
                    const pw = [5, 4, 3, 2, 1];
                    const aIdx = ["critical", "high", "medium", "low", "none"].indexOf(a.priority);
                    const bIdx = ["critical", "high", "medium", "low", "none"].indexOf(b.priority);
                    return (pw[bIdx] || 0) - (pw[aIdx] || 0);
                });
                break;
            default:
                entries = sortTasks(entries);
        }
    } else {
        entries = sortTasks(entries);
    }

    return entries;
}
```

- [ ] **步骤 5：验证构建通过**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build`
预期：kernel + app 均构建成功

- [ ] **步骤 6：Commit**

```bash
git add src/kernel/rpc-server.ts src/kernel/task-service.ts
git commit -m "refactor: simplify kernel RPC — remove server-side filter/sort/pagination params"
```

---

### 任务 10：集成 NextActionView

**文件：**
- 修改：`src/frontend/components/NextActionView.svelte`

- [ ] **步骤 1：将 NextActionView.svelte 中 FilterBar 替换为 SearchFilterBar**

完整新内容：

```svelte
<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { VIEW_NEXT_ACTION } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import SearchFilterBar from "./SearchFilterBar.svelte";
    import type { TaskCacheEntry } from "../../shared/types";

    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;
    export let selectedTaskId: string = "";
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;

    $: filterState = $taskStore.filterByView[VIEW_NEXT_ACTION] || DEFAULT_FILTER_STATE;
    $: filteredTasks = applyFilters($taskStore.allTasks, filterState);

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_NEXT_ACTION, state);
    }
</script>

<div class="na-view na-view--next-action">
    <SearchFilterBar
        contexts={$taskStore.contexts}
        filterState={filterState}
        showStatus={false}
        {i18n}
        onFilterChange={handleFilterChange}
    />
    {#if $taskStore.loading}
        <NaEmpty loading={true} />
    {:else if filteredTasks.length === 0}
        <NaEmpty text={$taskStore.error || i18n?.noResults || i18n?.noTasks || "No tasks yet"} />
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

            {#if $taskStore.projectReminders && $taskStore.projectReminders.length > 0}
                <div class="na-project-reminders">
                    <div class="na-project-reminders__header">{i18n?.projectReminders || "Projects to Close"}</div>
                    {#each $taskStore.projectReminders as project (project.blockId)}
                        <TaskCard
                            task={project}
                            {onEdit}
                            {onStatusClick}
                            {onContextMenu}
                            {i18n}
                        />
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
</div>
```

- [ ] **步骤 2：验证构建通过**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build:app`
预期：构建成功

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/NextActionView.svelte
git commit -m "feat: integrate SearchFilterBar into NextActionView"
```

---

### 任务 11：集成 AllTasksView

**文件：**
- 修改：`src/frontend/components/AllTasksView.svelte`

- [ ] **步骤 1：将 AllTasksView.svelte 中 FilterBar 替换为 SearchFilterBar，移除分页逻辑**

完整新内容：

```svelte
<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { VIEW_ALL_TASKS } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import SearchFilterBar from "./SearchFilterBar.svelte";
    import { createDragHandler } from "./drag-handler";
    import type { TaskCacheEntry } from "../../shared/types";

    export let bridge: any;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;
    export let selectedTaskId: string = "";
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;

    let dragHandler: ReturnType<typeof createDragHandler> | null = null;
    let listEl: HTMLElement | null = null;

    function initDragHandler() {
        if (dragHandler || !listEl || !bridge) return;
        dragHandler = createDragHandler({
            container: listEl,
            getCardElement: (blockId: string) => listEl!.querySelector(`[data-task-block-id="${blockId}"]`),
            onReorder: async (blockId, parentId, afterId) => {
                try {
                    const updated = await bridge.reorderTask(blockId, parentId === null ? "" : parentId, afterId ?? undefined);
                    taskStore.applyUpdate(updated);
                } catch (e: any) {
                    console.error("[NextAction] reorderTask failed:", e);
                }
            },
        });
    }

    $: if (listEl && bridge) initDragHandler();

    let collapsed: Record<string, boolean> = {};

    $: filterState = $taskStore.filterByView[VIEW_ALL_TASKS] || DEFAULT_FILTER_STATE;
    $: filteredTasks = applyFilters($taskStore.allTasks, filterState);

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_ALL_TASKS, state);
    }

    function toggleCollapse(blockId: string) {
        collapsed = Object.assign({}, collapsed, { [blockId]: !collapsed[blockId] });
    }

    function handleToggleCompleted() {
        taskStore.toggleCompleted();
    }

    function getIndentLevel(task: TaskCacheEntry, visibleIds: Set<string>, taskMap: Map<string, TaskCacheEntry>): number {
        let level = 0;
        let currentId = task.parentId;
        const visited = new Set<string>();
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            if (!visibleIds.has(currentId)) break;
            level++;
            const parent = taskMap.get(currentId);
            if (!parent) break;
            currentId = parent.parentId;
        }
        return level;
    }

    function groupByParent(tasks: TaskCacheEntry[]): TaskCacheEntry[] {
        const childrenMap = new Map<string, TaskCacheEntry[]>();
        const taskSet = new Set(tasks.map((t) => t.blockId));
        const roots: TaskCacheEntry[] = [];

        for (const t of tasks) {
            if (t.parentId && taskSet.has(t.parentId)) {
                const children = childrenMap.get(t.parentId) || [];
                children.push(t);
                childrenMap.set(t.parentId, children);
            } else {
                roots.push(t);
            }
        }

        roots.sort((a, b) => {
            if (a.sort !== b.sort) return a.sort - b.sort;
            return a.blockId.localeCompare(b.blockId);
        });

        for (const children of childrenMap.values()) {
            children.sort((a, b) => {
                if (a.sort !== b.sort) return a.sort - b.sort;
                return a.blockId.localeCompare(b.blockId);
            });
        }

        const result: TaskCacheEntry[] = [];
        const addSubtree = (parent: TaskCacheEntry) => {
            result.push(parent);
            const children = childrenMap.get(parent.blockId);
            if (!children) return;
            for (const child of children) {
                addSubtree(child);
            }
        };
        for (const root of roots) {
            addSubtree(root);
        }

        return result;
    }

    $: collapsedDep = collapsed;
    $: taskMap = new Map(filteredTasks.map((t: TaskCacheEntry) => [t.blockId, t]));
    $: groupedTasks = groupByParent(filteredTasks);

    $: viewData = (() => {
        const tasks = filteredTasks;
        const _c = collapsedDep;
        const hasChildrenSet = new Set<string>();
        const childCountMap: Record<string, number> = {};
        for (const t of tasks) {
            if (t.parentId) {
                hasChildrenSet.add(t.parentId);
                childCountMap[t.parentId] = (childCountMap[t.parentId] || 0) + 1;
            }
        }

        const hiddenSet = new Set<string>();
        for (const t of tasks) {
            let currentId = t.parentId;
            const visited = new Set<string>();
            while (currentId && !visited.has(currentId)) {
                visited.add(currentId);
                if (_c[currentId]) {
                    hiddenSet.add(t.blockId);
                    break;
                }
                const parent = taskMap.get(currentId);
                if (!parent) break;
                currentId = parent.parentId;
            }
        }

        return { hasChildrenSet, hiddenSet, childCountMap };
    })();

    $: activeIds = new Set(filteredTasks.map((t) => t.blockId));
    $: doneCount = $taskStore.doneCount;
</script>

<div class="na-view na-view--all-tasks">
    <SearchFilterBar
        contexts={$taskStore.contexts}
        filterState={filterState}
        showStatus={true}
        {i18n}
        onFilterChange={handleFilterChange}
    />
    {#if $taskStore.loading && filteredTasks.length === 0}
        <NaEmpty loading={true} />
    {:else if filteredTasks.length === 0 && doneCount === 0}
        <NaEmpty text={$taskStore.error || i18n?.noResults || i18n?.noTasks || "No tasks yet"} />
    {:else}
        <div class="na-view__list" bind:this={listEl}>
            {#each groupedTasks as task (task.blockId)}
                {#if !viewData.hiddenSet.has(task.blockId)}
                    {@const indent = getIndentLevel(task, activeIds, taskMap)}
                    {@const hasChildren = viewData.hasChildrenSet.has(task.blockId)}
                    {@const childCount = viewData.childCountMap[task.blockId] || 0}
                    <div class="na-all-tasks__item" data-task-block-id={task.blockId}
                         class:na-all-tasks__item--root={indent === 0} style="--indent: {indent}"
                         on:pointerdown={(e) => dragHandler?.onPointerDown(e, task.blockId)}>
                        <TaskCard
                            {task}
                            selected={task.blockId === selectedTaskId}
                            onSelect={onSelectTask}
                            {hasChildren}
                            isCollapsed={!!collapsed[task.blockId]}
                            {childCount}
                            onToggleCollapse={() => toggleCollapse(task.blockId)}
                            isRoot={indent === 0}
                            {onEdit}
                            {onStatusClick}
                            {onContextMenu}
                            {i18n}
                        />
                    </div>
                {/if}
            {/each}

            <!-- Completed section -->
            {#if doneCount > 0}
                <div class="na-all-tasks__divider"></div>
                <span class="na-all-tasks__completed-toggle" on:click={handleToggleCompleted}>
                    {$taskStore.showCompleted ? "▾" : "▸"} {i18n?.completedTasks || "Completed tasks"}
                    <span class="na-all-tasks__completed-count">({doneCount})</span>
                </span>
                {#if $taskStore.showCompleted}
                    {#each $taskStore.completedTasks as task (task.blockId)}
                        {@const hasChildren = false}
                        {@const childCount = 0}
                        <div class="na-all-tasks__item na-all-tasks__item--root" style="--indent: 0">
                            <TaskCard
                                {task}
                                selected={task.blockId === selectedTaskId}
                                onSelect={onSelectTask}
                                {hasChildren}
                                isCollapsed={false}
                                {childCount}
                                onToggleCollapse={() => {}}
                                isRoot={true}
                                {onEdit}
                                {onStatusClick}
                                {onContextMenu}
                                {i18n}
                            />
                        </div>
                    {/each}
                {/if}
            {/if}
        </div>
    {/if}
</div>
```

注意：移除了 `loadMore` 按钮和 `loadMoreTasks` 调用，因为前端筛选不再分页。

- [ ] **步骤 2：验证构建通过**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build:app`
预期：构建成功

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/AllTasksView.svelte
git commit -m "feat: integrate SearchFilterBar into AllTasksView, remove pagination"
```

---

### 任务 12：集成 ProjectView

**文件：**
- 修改：`src/frontend/components/ProjectView.svelte`

- [ ] **步骤 1：在 ProjectView 中添加 SearchFilterBar**

完整新内容：

```svelte
<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { VIEW_BY_PROJECT } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaProgressBar from "../ui/NaProgressBar.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import SearchFilterBar from "./SearchFilterBar.svelte";
    import type { TaskCacheEntry } from "../../shared/types";

    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;
    export let selectedTaskId: string = "";
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;

    let collapsedIds: Set<string> = new Set();

    $: filterState = $taskStore.filterByView[VIEW_BY_PROJECT] || DEFAULT_FILTER_STATE;
    $: filteredTasks = applyFilters($taskStore.allTasks, filterState);
    $: projects = filteredTasks.filter(t => t.taskType === "2" && t.status !== "done");
    $: childrenByParent = buildChildrenMap(filteredTasks);

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_BY_PROJECT, state);
    }

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

    function getProjectProgress(project: TaskCacheEntry): { done: number; total: number; percent: number } {
        const children = project.childIds
            .map(id => filteredTasks.find(t => t.blockId === id))
            .filter(Boolean) as TaskCacheEntry[];
        const done = children.filter(c => c.status === "done").length;
        const total = children.length;
        return { done, total, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
    }
</script>

<div class="na-view na-view--project">
    <SearchFilterBar
        contexts={$taskStore.contexts}
        filterState={filterState}
        showStatus={true}
        {i18n}
        onFilterChange={handleFilterChange}
    />
    {#if $taskStore.loading && projects.length === 0}
        <NaEmpty loading={true} />
    {:else if projects.length === 0}
        <NaEmpty text={$taskStore.error || i18n?.noResults || i18n?.noProjects || "No projects yet"} />
    {:else}
        <div class="na-view__list">
            {#each projects as project (project.blockId)}
                {@const children = (childrenByParent.get(project.blockId) || []).sort((a, b) => a.sort - b.sort)}
                {@const progress = getProjectProgress(project)}
                <div class="na-project-item">
                    <div class="na-project-item__header" on:click={() => toggleCollapse(project.blockId)}>
                        <TaskCard
                            task={project}
                            selected={project.blockId === selectedTaskId}
                            onSelect={onSelectTask}
                            {onEdit}
                            {onStatusClick}
                            {onContextMenu}
                            {i18n}
                        />
                        <NaProgressBar
                            percent={progress.percent}
                            label="{progress.done}/{progress.total} {i18n?.completedTasks || 'completed'}"
                        />
                    </div>
                    {#if !collapsedIds.has(project.blockId) && children.length > 0}
                        <div class="na-project-item__children">
                            {#each children as child (child.blockId)}
                                <TaskCard
                                    task={child}
                                    selected={child.blockId === selectedTaskId}
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
            {/each}
        </div>
    {/if}
</div>
```

- [ ] **步骤 2：验证构建通过**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build:app`
预期：构建成功

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/ProjectView.svelte
git commit -m "feat: add SearchFilterBar to ProjectView"
```

---

### 任务 13：删除旧 FilterBar 并全量构建验证

**文件：**
- 删除：`src/frontend/components/FilterBar.svelte`

- [ ] **步骤 1：删除 FilterBar.svelte**

```bash
rm src/frontend/components/FilterBar.svelte
```

- [ ] **步骤 2：确认没有其他文件引用 FilterBar**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && grep -r "FilterBar" src/frontend/ --include="*.svelte" --include="*.ts"`
预期：无结果（所有引用已在前面任务中替换）

- [ ] **步骤 3：全量构建验证**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build`
预期：kernel + app 均构建成功，无报错

- [ ] **步骤 4：Commit**

```bash
git add -A
git commit -m "chore: delete old FilterBar.svelte — replaced by SearchFilterBar"
```

---

### 任务 14：修复 TaskPanel 中的视图切换逻辑

**文件：**
- 修改：`src/frontend/components/TaskPanel.svelte`（如有）

TaskPanel 负责视图切换时调用 `taskStore.loadTasks()`。需要确认：
1. 切换视图时仍调用 `loadTasks()` 获取正确数据
2. 如果 TaskPanel 引用了旧的 `$taskStore.tasks`，需要改为从 `allTasks` + 筛选获取

- [ ] **步骤 1：检查 TaskPanel.svelte 是否引用了旧的 `$taskStore.tasks` 或 `loadMoreTasks`**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && grep -n "taskStore\." src/frontend/components/TaskPanel.svelte`
根据输出决定是否需要修改。如果只调用了 `loadTasks()` 和 `setActiveView()`，则无需修改。

- [ ] **步骤 2：如需修改，更新 TaskPanel 中对 store 的引用**

将 `$taskStore.tasks` 替换为 `$taskStore.allTasks`（如果有）。将 `loadMoreTasks` 调用移除（如果有）。

- [ ] **步骤 3：验证构建通过**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build`
预期：构建成功

- [ ] **步骤 4：Commit（如有改动）**

```bash
git add src/frontend/components/TaskPanel.svelte
git commit -m "fix: update TaskPanel to use allTasks and remove pagination refs"
```

---

## 自检

### 1. 规格覆盖度

| 规格需求 | 对应任务 |
|----------|----------|
| 文本搜索（仅标题） | 任务 5 (SearchFilterBar) + 任务 1 (applyFilters) |
| 所有维度多选 | 任务 3 (NaFilterDropdown) + 任务 5 (SearchFilterBar) |
| 维度内 OR、维度间 AND | 任务 1 (applyFilters) |
| 三个视图统一 | 任务 10, 11, 12 |
| 下一步行动无状态筛选 | 任务 10 (showStatus=false) |
| 排序选择 | 任务 4 (NaSortSelect) + 任务 5 (SearchFilterBar) |
| 即时 + 300ms 防抖 | 任务 5 (onSearchInput debounce) |
| 会话内持久化 | 任务 7 (filterByView 存在 store 中) |
| 前端筛选 | 任务 1 (applyFilters) + 任务 7 (task-store) |
| 内核 RPC 简化 | 任务 8 (kernel-bridge) + 任务 9 (rpc-server + task-service) |
| 自建 Na* 组件 | 任务 3, 4, 5 |
| 颜色使用 b3-* | 任务 3, 4, 6 (CSS 变量) |
| 删除 FilterBar | 任务 13 |
| i18n keys | 任务 2 |
| 筛选维度色 | 任务 2 (tokens) + 任务 3, 4 (组件) |

### 2. 占位符扫描

- 无 "TBD"、"TODO"、"后续实现" 等
- 所有步骤都有完整代码
- 没有引用未定义类型

### 3. 类型一致性

- `FilterState` 定义在任务 1 (`src/frontend/utils/filter.ts`)，在任务 5, 7, 10, 11, 12 中使用
- `DEFAULT_FILTER_STATE` 定义在任务 1，在任务 7, 10, 11, 12 中使用
- `applyFilters` 定义在任务 1，在任务 10, 11, 12 中使用
- `taskStore.setFilterState` 定义在任务 7，在任务 10, 11, 12 中使用
- `taskStore.allTasks` 定义在任务 7，在任务 10, 11, 12 中使用
- `VIEW_NEXT_ACTION` / `VIEW_ALL_TASKS` / `VIEW_BY_PROJECT` 定义在 `src/frontend/constants.ts`（已存在）
- `NaFilterDropdown` 创建于任务 3，在任务 5 中使用
- `NaSortSelect` 创建于任务 4，在任务 5 中使用
