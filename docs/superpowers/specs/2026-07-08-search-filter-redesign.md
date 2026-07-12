# 搜索筛选重构设计

> 日期：2026-07-08
> 状态：已批准
> 分支：feat/search-filter

## 背景

当前筛选系统（FilterBar）存在以下问题：

1. 每个筛选维度只能单选一个值（如只能选一个优先级）
2. 没有文本搜索能力，无法按任务标题搜索
3. AllTasksView 的优先级筛选断裂——UI 有选项但未传到内核，选择后无效果
4. 内核 `getAllTasks` 支持 4 种排序（order/due/importance/priority），但前端未暴露
5. ProjectView 完全没有筛选功能
6. 各维度之间不是 AND 组合关系

## 需求决策

| 决策点 | 选择 |
|--------|------|
| 覆盖视图 | 三个视图统一（下一步行动 / 全部任务 / 按项目） |
| 搜索范围 | 仅标题 |
| 多选支持 | 所有维度多选，维度内 OR |
| 交叉维度 | AND 组合 |
| UI 交互 | 方案 B 内联下拉 + flex-wrap 自适应换行 |
| 下一步行动状态筛选 | 不显示（由视图语义自动决定） |
| 执行时机 | 即时生效 + 300ms 防抖 |
| 筛选持久化 | 会话内保留，关闭插件重置 |
| 组件方式 | 自建 Na* 组件，颜色优先使用思源 b3-* 变量 |

## 架构：前端筛选

**核心变更：从内核筛选改为前端筛选。**

理由：
- 内核已有全量缓存，但筛选维度组合（多选 × 多维度 × 文本搜索）让 RPC 参数爆炸
- 任务量通常几百到几千，前端 JS 过滤性能完全够用
- 搜索是纯字符串匹配，不需要内核参与
- 排序也可以前端做

**新数据流：**

```
视图挂载 / 内核广播变更
  → taskStore.loadTasks()（一次性加载全量）
  → taskStore.allTasks（全量数据，不随筛选变化）

用户筛选/搜索操作
  → SearchFilterBar 触发 onFilterChange(filters)
  → 视图组件用 filteredTasks = applyFilters(allTasks, filters)
  → 直接更新 UI，无 RPC 调用
```

## 筛选数据模型

```typescript
interface FilterState {
  searchText: string;       // 搜索框文本
  contexts: string[];       // 已选上下文列表（空 = 不限）
  priorities: string[];     // 已选优先级列表
  statuses: string[];       // 已选状态列表
  sortBy: string;           // "order" | "due" | "importance" | "priority"
}
```

### task-store 变更

```typescript
interface TaskState {
  allTasks: TaskCacheEntry[];         // 全量数据（新增）
  filterByView: {                     // 各视图独立筛选状态（新增）
    nextAction: FilterState;
    allTasks: FilterState;
    project: FilterState;
  };
  // 移除旧的 filters 字段
}
```

- `loadTasks()` 不再传递筛选参数给内核 RPC，获取全量数据存入 `allTasks`
- 新增 `getFilteredTasks(viewId: string): TaskCacheEntry[]`
- 各视图的筛选条件独立存储，会话内保留

### applyFilters 纯函数

```
输入: allTasks[] + filterState

1. 文本搜索: task.title.toLowerCase().includes(searchText.toLowerCase())
2. 上下文筛选: contexts.length === 0 ? 通过 : task.context 拆分 | 后任一命中 contexts
3. 优先级筛选: priorities.length === 0 ? 通过 : task.priority 在 priorities 中
4. 状态筛选: statuses.length === 0 ? 通过 : task.status 在 statuses 中
5. 以上 4 步 AND 组合
6. 排序: 按 sortBy 字段排序（order/due/importance/priority）
7. 返回过滤排序后的数组
```

- 下一步行动视图在 applyFilters 之前先 `isNextActionCandidate` 过滤
- 项目视图先按 taskType 分组

## UI 组件设计

### SearchFilterBar.svelte

替代 FilterBar.svelte。结构：

```
搜索输入框（文本搜索，300ms 防抖）
筛选按钮行（flex-wrap 自适应换行）
  ├── NaFilterDropdown — 上下文多选
  ├── NaFilterDropdown — 优先级多选
  ├── NaFilterDropdown — 状态多选（仅全部任务/项目视图）
  └── NaSortSelect — 排序选择（单选）
```

Props：

```typescript
export let contexts: string[] = [];           // 可选上下文列表
export let filterState: FilterState;          // 当前筛选状态
export let showStatus: boolean = false;       // 是否显示状态筛选
export let i18n: any;
export let onFilterChange: (state: FilterState) => void;
```

### NaFilterDropdown.svelte

多选下拉筛选器组件。

Props：

```typescript
export let label: string;                     // 维度名称（如"上下文"）
export let options: { value: string; label: string; color?: string }[];
export let selected: string[] = [];           // 已选值列表
export let i18n: any;
export let onChange: (selected: string[]) => void;
```

UI 规格：
- **未选状态**：灰色边框（--na-color-divider）+ 灰色文字（--b3-theme-on-surface-secondary）+ 箭头图标
- **已选状态**：维度主题色边框 + 主题色文字 + 计数徽章（如"2"）+ 箭头图标
- **下拉面板**：圆角 8px（--na-radius-md），微阴影（--na-shadow-md），点击外部关闭
- **多选复选框**：未选=空心方框（1.5px 边框），已选=实心填充+勾号，选中行有浅色背景
- **优先级色点**：每个优先级选项前显示对应颜色的色点（与 TaskCard 一致）
- **底部操作**：「全选」「清除」两个文字链接
- **维度颜色**：上下文=蓝（--na-priority-medium），优先级=橙（--na-priority-high），状态=绿（--na-color-done）

### NaSortSelect.svelte

排序选择器组件（单选下拉）。

Props：

```typescript
export let options: { value: string; label: string }[];
export let selected: string = "order";        // 默认按优先级分数排序
export let i18n: any;
export let onChange: (value: string) => void;
```

UI 规格：
- **按钮**：排序图标（向下箭头 SVG）+ 当前排序名称
- **下拉面板**：与 NaFilterDropdown 风格一致，但单选——选中项高亮底色+勾号
- **颜色**：使用 --b3-theme-primary

## 各视图集成

### NextActionView

```
SearchFilterBar
  搜索框 ✓
  上下文筛选 ✓
  优先级筛选 ✓
  状态筛选 ✗（不显示，由视图语义决定）
  排序 ✓
```

### AllTasksView

```
SearchFilterBar
  搜索框 ✓
  上下文筛选 ✓
  优先级筛选 ✓
  状态筛选 ✓
  排序 ✓
```

### ProjectView

```
SearchFilterBar（新增，当前无筛选）
  搜索框 ✓
  上下文筛选 ✓
  优先级筛选 ✓
  状态筛选 ✓
  排序 ✓
```

## 内核 RPC 简化

### getNextActions

移除 context、priority、limit、offset 参数。保留语义过滤（排除 done/waiting/被阻塞/未到开始日期/项目类型）。返回全量下一步行动候选。

### getAllTasks

移除 status、context、excludeDone、limit、offset 参数。保留 sortBy 参数。返回全量任务（由前端自行过滤已完成任务）。

### 无需新增 RPC 方法

前端筛选不需要新增内核接口。

## 新增 i18n Key

| Key | EN | ZH |
|-----|----|----|
| searchPlaceholder | Search tasks... | 搜索任务... |
| sortBy | Sort by | 排序 |
| sortByOrder | Priority score | 优先级分数 |
| sortByDue | Due date | 截止日期 |
| sortByImportance | Importance | 重要性 |
| sortByPriority | Manual priority | 手动优先级 |
| selectAll | Select all | 全选 |
| clearFilter | Clear | 清除 |
| noResults | No matching tasks | 没有匹配的任务 |

## 文件变更清单

### 新增

| 文件 | 说明 |
|------|------|
| `src/frontend/ui/NaFilterDropdown.svelte` | 多选下拉筛选器 |
| `src/frontend/ui/NaSortSelect.svelte` | 排序选择器 |
| `src/frontend/components/SearchFilterBar.svelte` | 搜索筛选栏 |
| `src/frontend/utils/filter.ts` | FilterState 类型 + applyFilters 纯函数 |

### 删除

| 文件 | 说明 |
|------|------|
| `src/frontend/components/FilterBar.svelte` | 被 SearchFilterBar 替代 |

### 修改

| 文件 | 变更内容 |
|------|----------|
| `src/frontend/stores/task-store.ts` | filters → FilterState；新增 allTasks、filterByView；loadTasks() 简化；新增 getFilteredTasks() |
| `src/frontend/components/NextActionView.svelte` | FilterBar → SearchFilterBar；筛选状态迁移到 store |
| `src/frontend/components/AllTasksView.svelte` | FilterBar → SearchFilterBar；筛选状态迁移到 store |
| `src/frontend/components/ProjectView.svelte` | 新增 SearchFilterBar |
| `src/frontend/kernel-bridge.ts` | getAllTasks / getNextActions 参数简化 |
| `src/kernel/rpc-server.ts` | RPC 方法参数简化 |
| `src/kernel/task-service.ts` | getNextActions / getAllTasks 移除服务端筛选 |
| `src/i18n/en.json` | 新增搜索/筛选 i18n key |
| `src/i18n/zh-CN.json` | 同上 |
| `src/frontend/ui/tokens.scss` | 新增筛选维度主题色变量 |
| `src/index.scss` | 删除旧 FilterBar 样式，新增 SearchFilterBar 样式 |
