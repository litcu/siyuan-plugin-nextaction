# Waiting For 视图设计文档

日期：2026-07-09

## 概述

新增 Waiting For（等待中）独立视图，补全 GTD 五大核心列表。当前 `waiting` 状态已存在但无聚焦浏览入口，等于 GTD 流程缺了一条腿。实现模式与 Someday 视图完全对称。

## 设计决策

### 1. NavRail 位置

Waiting For 紧跟 Someday，形成"GTD 非活跃任务"分组。最终顺序：

```
下一步行动 → 全部任务 → 项目 → 将来/也许 → 等待中 → 统计
```

### 2. 不新增属性

不新增 `na-waiting-for` 属性。用户可在 `na-note` 备注中自行记录等待原因。视图只做筛选和展示，与 Someday 视图完全对称。

### 3. 排序

复用 Someday 视图的排序选项：

- 综合排序（order，默认）
- 重要性（importance）

综合排序中 waiting 任务正常参与优先级计算（不沉底），按分数自然排列。

### 4. 一键恢复按钮

不添加。用户点击 StatusCheckbox 弹出状态菜单选择 todo 即可，与 waiting 在其他视图中的操作方式一致。

### 5. 视觉表现

Waiting 任务保持正常 TaskCard 样式，不加 blocked 半透明效果。"等待中"不是"被阻塞"，是 GTD 合法状态。

### 6. NavRail 图标

时钟图标（圆形 + 指针），表达"等待时间"语义。

### 7. 主题色

复用已有 `--na-color-waiting` CSS token，不新增颜色。

### 8. 备注图标（通用改动）

所有视图的 TaskCard 上，当任务有 `na-note` 内容时，在 meta 区域显示一个备注图标。鼠标悬浮后以 tooltip 显示备注内容。此改动惠及所有视图，不限于 Waiting For。

## 组件变更清单

### 新增文件

1. **`src/frontend/components/WaitingView.svelte`** — 独立视图组件
   - 结构与 SomedayView 对称
   - 筛选条件：`$taskStore.allTasks.filter(t => t.status === "waiting")`
   - SearchFilterBar 配置：`showStatus=false, showPriority=false`，排序选项同 Someday
   - 空状态文案：i18n `noWaitingTasks`

### 修改文件

2. **`src/frontend/constants.ts`**
   - 新增 `VIEW_WAITING = "waiting"` 常量
   - `ViewType` 联合类型新增 `typeof VIEW_WAITING`

3. **`src/frontend/components/NavRail.svelte`**
   - navItems 数组中 Someday 和 Statistics 之间插入 Waiting For 项
   - 图标：时钟 SVG（圆形 + 指针）
   - label：`i18n?.waiting || "Waiting"`

4. **`src/frontend/components/NextActionApp.svelte`**
   - import WaitingView
   - 新增 `{:else if activeView === VIEW_WAITING}` 分支渲染 WaitingView
   - 传递与 SomedayView 相同的事件回调

5. **`src/frontend/stores/task-store.ts`**
   - import VIEW_WAITING
   - DEFAULT_FILTERS 新增 `[VIEW_WAITING]: { ...DEFAULT_FILTER_STATE }` 条目

6. **`src/frontend/components/TaskCard.svelte`**（通用备注图标）
   - meta 区域新增备注图标：当 `task.note` 非空时显示小图标
   - 使用 NaTooltip 组件实现悬浮提示，内容为 note 文本

7. **`src/i18n/zh-CN.json`** + **`src/i18n/en.json`**
   - 新增 key：
     - `waiting`: "等待中" / "Waiting"
     - `noWaitingTasks`: "暂无等待中的任务" / "No waiting tasks"
   - 备注 tooltip 无需新增 i18n key（内容直接取 task.note）

## WaitingView 组件结构

```
WaitingView.svelte
├── SearchFilterBar (showStatus=false, showPriority=false, sortOptions=[综合, 重要性])
├── NaEmpty (loading / 空状态)
└── TaskCard × N (waiting 任务列表)
```

数据流：

```
$taskStore.allTasks
  → .filter(t => t.status === "waiting")
  → applyFilters(waitingTasks, filterState)
  → TaskCard 列表
```

## 备注图标设计

- 位置：TaskCard meta 区域，在上下文、标签等元素之后
- 图标：小记事本 SVG（12×12，与其他 meta 图标一致）
- 交互：鼠标悬浮显示 NaTooltip，内容为 `task.note` 文本（纯文本，不解析 Markdown）
- 条件：`task.note` 非空时才渲染
- 样式：颜色 `var(--b3-theme-on-surface-light)`，与其他 meta 图标一致

## 不做的事

- 不新增 `na-waiting-for` 属性
- 不添加"恢复"一键按钮
- 不给 waiting 任务加 blocked 样式
- 不修改优先级引擎（waiting 任务正常计算 order，不沉底）
- 不修改 `getBlockedReason`（waiting 不被视为阻塞原因）
