# Someday/Maybe 视图设计规格

## 概述

为 NextAction 插件新增"将来/也许"(Someday/Maybe)视图，实现 GTD 工作流中的 Someday/Maybe 列表管理。新增第 5 种任务状态 `someday`，在 NavRail 中新增独立 Tab，视图结构复用现有 NextActionView 模式。

## 核心决策

| 决策项 | 结论 |
|--------|------|
| someday 与 waiting 的关系 | 新增第 5 种状态 `someday`，与 waiting 并列 |
| 视图定位 | 轻量增强式：平铺列表 + 搜索/上下文/标签筛选，不支持项目分组和拖拽排序 |
| 导航位置 | 独立 Tab，在 Project 和 Statistics 之间，灯泡图标 |
| 激活方式 | SomedayView 中 TaskCard 上新增文字按钮"激活"，一键 someday → todo |
| 子任务展示 | 平铺所有 someday 任务，与 NextActionView 一致 |
| 激活按钮样式 | 文字"激活"，非图标，与现有 action-btn 基础样式一致 |

## 1. 数据模型变更

### 1.1 状态常量

`src/shared/constants.ts`:
- 新增 `STATUS_SOMEDAY = "someday"`
- `ALL_STATUSES` 新增 `"someday"` 作为第 5 项（在 `done` 之前）

`src/frontend/constants.ts`:
- `STATUS_LIST` 新增 `"someday"`
- 新增 `VIEW_SOMEDAY = "someday"`
- `ViewType` 联合类型新增 `typeof VIEW_SOMEDAY`

### 1.2 国际化

`src/i18n/en.json` 新增:
```json
"statusSomeday": "Someday/Maybe",
"markAsSomeday": "Mark as Someday/Maybe",
"someday": "Someday",
"activate": "Activate",
"noSomedayTasks": "No Someday/Maybe tasks"
```

`src/i18n/zh-CN.json` 新增:
```json
"statusSomeday": "将来/也许",
"markAsSomeday": "标记为将来/也许",
"someday": "将来/也许",
"activate": "激活",
"noSomedayTasks": "暂无将来/也许任务"
```

### 1.3 影响范围

| 组件 | 变更 |
|------|------|
| `StatusCheckbox.svelte` | 新增 `na-status-checkbox--someday` 样式类，`::after` 渲染问号 |
| `TaskCard.svelte` | 新增 `isSomeday` 响应式变量 + `na-task-card--someday` CSS 类 + 条件渲染"激活"按钮 |
| `priority-engine.ts` | `isNextActionCandidate()` 新增 `status === "someday"` 排除条件 |
| `task-store.ts` | 前端 `isNextActionCandidate` 同步新增排除条件 |
| `StatisticsView.svelte` | 状态分布图自动包含新状态 |
| `task-service.ts` | 无需修改，`ALL_STATUSES` 校验已自动包含 |

## 2. SomedayView 组件

### 2.1 文件

新建 `src/frontend/components/SomedayView.svelte`

### 2.2 结构

```
SomedayView.svelte
├── SearchFilterBar (showStatus=false, showPriority=false, sortOptions缩减)
├── NaEmpty (复用)
└── TaskCard × N (复用)
```

### 2.3 筛选逻辑

```typescript
$: filterState = $taskStore.filterByView[VIEW_SOMEDAY] || DEFAULT_FILTER_STATE;
$: somedayTasks = $taskStore.allTasks.filter(t => t.status === "someday");
$: filteredTasks = applyFilters(somedayTasks, filterState);
```

### 2.4 SearchFilterBar 差异

- `showStatus=false`：someday 视图内无意义
- `showPriority=false`：someday 任务不参与优先级筛选
- 排序选项仅"综合排序"和"重要性"，去掉"截止日期"和"手动优先级"
- 实现方式：给 SearchFilterBar 新增 `sortOptions` prop（可选），传入时覆盖默认值

### 2.5 "激活"按钮

- TaskCard actions 区域条件渲染：当 `task.status === "someday"` 时显示
- 位置：在"跳转到块"按钮左侧
- 点击后调用 `bridge.updateTask({ blockId: task.blockId, attrs: { status: "todo" } })`
- 更新 store：`taskStore.applyUpdate(updated)`
- 样式：文字"激活"，与现有 action-btn 一致

### 2.6 事件处理

与 NextActionView 完全一致，所有 props 由 NextActionApp 统一传入：
- `onEdit`
- `onStatusClick`
- `onContextMenu`
- `onSelectTask`
- `i18n`

## 3. 导航集成

### 3.1 NavRail

`navItems` 数组新增项，插入在 Project 和 Statistics 之间：
```typescript
{ view: VIEW_SOMEDAY, icon: "someday", label: i18n?.someday || "Someday" }
```

图标：灯泡 SVG，stroke 风格，与现有图标一致。

### 3.2 NextActionApp

- 新增 `import SomedayView`
- 视图渲染区域新增 `{:else if activeView === VIEW_SOMEDAY}` 分支
- 传入 props：`selectedTaskId`、`onSelectTask`、`onEdit`、`onStatusClick`、`onContextMenu`、`i18n`

### 3.3 taskStore

- `filterByView` 自然支持新视图 key（`"someday"`），无需额外修改

## 4. 内核层变更

### 4.1 priority-engine.ts

`isNextActionCandidate()` 新增：
```typescript
if (entry.status === "someday") return false;
```
与 `waiting` 排除条件同级，位于 `done` 排除之后。

### 4.2 其他内核模块

- `task-service.ts`：无需修改
- `CacheManager` / `SyncEngine`：无需修改
- `KernelBridge`：无需新增 RPC 方法，激活操作复用 `updateTask`

## 5. CSS 样式

### 5.1 CSS 变量

`src/index.scss` 新增：
```scss
--na-someday: #f9e2af;
--na-someday-bg: rgba(249, 226, 175, 0.08);
```

### 5.2 StatusCheckbox

```scss
.na-status-checkbox--someday {
  border-color: var(--na-someday);
  &::after {
    content: '?';
    position: absolute;
    top: -2px;
    left: 2px;
    font-size: 10px;
    font-weight: 700;
    color: var(--na-someday);
    line-height: 1;
  }
}
```

### 5.3 TaskCard

```scss
.na-task-card--someday {
  .na-task-card__title {
    color: var(--b3-theme-on-surface-light);
  }
}
.na-task-card__activate-btn {
  // 复用 action-btn 基础样式，文字"激活"
  font-size: 11px;
  color: var(--na-someday);
  &:hover {
    color: var(--na-someday);
    background: var(--na-someday-bg);
  }
}
```

### 5.4 NavRail

灯泡图标 SVG，活跃态颜色使用 `--na-someday`。

## 6. 不在范围内

- 项目分组视图（SomedayView 为平铺列表）
- 拖拽排序
- 自动回顾提醒
- 优先级和截止日期筛选
- 其他视图中"搁置到将来/也许"快捷按钮（使用右键菜单即可）
- SomedayView 内编辑弹窗特殊化（复用 TaskEditPopup）
