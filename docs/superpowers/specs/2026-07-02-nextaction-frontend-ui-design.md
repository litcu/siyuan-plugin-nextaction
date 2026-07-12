# NextAction 前端 UI 设计规格

> 版本: v0.1.0 MVP
> 日期: 2026-07-02
> 前置: 内核插件（Plan A）已完成，所有 RPC 方法可用并验证通过

## 1. 视觉风格

极简内敛，贴近思源原生界面风格。全部颜色使用思源 CSS 变量，自动适配亮暗主题。

| 元素 | 暗色参考值 | 亮色参考值 | CSS 变量 |
|------|-----------|-----------|---------|
| 面板背景 | `#1e1e1e` | `#fff` | `var(--b3-theme-background)` |
| 卡片背景 | `#252525` | `#f7f7f7` | `var(--b3-theme-surface)` |
| 卡片 hover | `#2d2d2d` | `#f0f0f0` | `var(--b3-theme-surface-hover)` |
| 边框 | `#363636` | `#e0e0e0` | `var(--b3-border-color)` |
| 主文字 | `#d4d4d4` | `#222` | `var(--b3-theme-on-surface)` |
| 次要文字 | `#888` | `#999` | `var(--b3-theme-on-surface-secondary)` |
| 面包屑文字 | `#666` / `#888` | `#999` / `#666` | `var(--b3-theme-on-surface-tertiary)` |

## 2. 任务面板（Dock 面板）

位置：右下角 Dock，宽 300px。

### 2.1 顶部 Tab 栏

三个 Tab：下一步行动（默认）、全部任务、按项目。选中 Tab 有 `2px bottom border` 高亮色。

### 2.2 筛选栏

两个下拉：上下文筛选、优先级筛选。仅下一步行动视图和全部任务视图显示。

### 2.3 底部操作栏

- `+ 新建任务` 按钮
- `↻` 重新计算优先级按钮

## 3. 任务卡片

### 3.1 结构

```
┌─────────────────────────────────────┐
│▎ [●] 面包屑（仅子任务显示）          │
│▎     标题                           │
│▎     📅 日期  @上下文  ⭐重要性 📊工作量 │
└─────────────────────────────────────┘
```

- **左侧 3px 色条**：表示优先级（紧急=红、高=橙、中=蓝、低=灰、无=透明）
- **8px 圆点**：优先级对应颜色，可点击一键标记完成（status → done）
- **面包屑**：仅在有父任务时显示，位于标题上方
- **元数据**：单行 11px 文字，日期+上下文+重要性+工作量
- **卡片间距**：4px gap

### 3.2 优先级颜色

| 优先级 | 色值 | CSS 变量 |
|--------|------|---------|
| critical | `#e74c3c` | 自定义 `--na-priority-critical` |
| high | `#e67e22` | 自定义 `--na-priority-high` |
| medium | `#3498db` | 自定义 `--na-priority-medium` |
| low | `#95a5a6` | 自定义 `--na-priority-low` |
| none | 透明边框 | 自定义 `--na-priority-none` |

### 3.3 逾期卡片

逾期任务（due < 今天）卡片背景微红：暗色 `#2a1a1a`，亮色 `#fef2f2`。标题和日期文字变红。

### 3.4 父任务面包屑

智能截断规则：
- **1 层**：显示直接父 → `前端重构`
- **2 层**：全显示 → `Q3 产品发布 › 前端重构`
- **3 层+**：根 + 省略号 + 直接父 → `公司战略 › … › 前端重构`

分隔符使用 `›`（U+203A）。每段可点击跳转到对应块。面包屑文字 10px，比标题小两号，灰色。

### 3.5 交互

- **点击标题** → 跳转到对应块（调用 `openTab`）
- **点击属性区域**（面包屑、元数据行、空白处）→ 打开编辑弹窗
- **点击色点** → 一键标记完成（status → done）
- **右键卡片** → 上下文菜单
- **hover** → 卡片背景微变

## 4. 三个视图

### 4.1 下一步行动视图（默认）

调用 `getNextActions` RPC。按 na-order 降序排列。支持上下文和优先级筛选。已排除 done/waiting/未到开始日期/有未完成子任务的父任务。

### 4.2 全部任务视图

调用 `getAllTasks` RPC。支持按属性排序和上下文/优先级/状态筛选。

### 4.3 按项目视图

调用 `getAllTasks` RPC。前端按 parentId 组织成树形结构。顶层为 parentId 为空的任务，子任务缩进展示。支持折叠/展开。

## 5. 任务编辑弹窗

使用思源 `Dialog` 组件。每个字段变化后 500ms 防抖调用 `updateTask` RPC。

| 字段 | 控件 | 默认值 |
|------|------|--------|
| 状态 | 下拉选择（待办/进行中/等待/已完成） | todo |
| 优先级 | 下拉选择（紧急/高/中/低/无） | none |
| 重要性 | 7 圆点可点击 | 4 |
| 工作量 | 7 圆点可点击 | 4 |
| 截止日期 | 日期选择器 | 空 |
| 开始日期 | 日期选择器 | 空 |
| 上下文 | 多选标签输入（候选列表来自 `getContexts`） | 空 |

弹窗内提供"跳转到块"链接。

## 6. 右键上下文菜单

使用思源 `Menu` 组件：

- 标记为待办
- 标记为进行中
- 标记为等待
- 标记为已完成
- ──分隔线──
- 优先级子菜单：紧急/高/中/低/无
- ──分隔线──
- 移除任务

每个操作调用 `updateTask` 或 `removeTask` RPC。

## 7. 插件注册

### 7.1 顶栏按钮

点击切换 Dock 面板显示/隐藏。

### 7.2 Dock 面板

在 `addDock` 的 `init` 回调中挂载 Svelte `TaskPanel` 组件。

### 7.3 斜杠菜单

- "转为任务" → 调用 `convertToTask` RPC
- "新建任务" → 打开创建对话框

### 7.4 块标菜单

`eventBus.on("click-blockicon")` 中添加任务操作项：转为任务、移除任务。

### 7.5 快捷键命令

- 转为任务
- 新建任务
- 打开任务面板
- 重新计算优先级

## 8. 状态管理

Svelte writable store，结构如下：

```typescript
interface TaskState {
    tasks: TaskCacheEntry[];
    loading: boolean;
    error: string | null;
    activeView: "nextAction" | "all" | "byProject";
    filters: {
        context?: string;
        priority?: string;
        status?: string;
    };
}
```

更新策略：
- 广播增量更新（`kernel.rpc.bind("tasksChanged")`）
- 视图切换时主动请求
- 内核重连时全量刷新（`kernel-plugin-state-change` code=2）

## 9. 内核通信桥接

`KernelBridge` 封装 `this.kernel.rpc.call`，提供类型安全接口。调用方可传 `na-*` 短键，内核自动转换为 `custom-na-*`。

## 10. 国际化

需要重新创建 `src/i18n/en.json` 和 `src/i18n/zh-CN.json`（之前被误删）。关键键值：

| 键名 | en | zh-CN |
|------|-----|-------|
| pluginName | NextAction | 今天干点啥 |
| topBarTip | NextAction Task Manager | 今天干点啥 任务管理 |
| nextAction | Next Actions | 下一步行动 |
| allTasks | All Tasks | 全部任务 |
| byProject | By Project | 按项目 |
| statusTodo | To Do | 待办 |
| statusDoing | In Progress | 进行中 |
| statusWaiting | Waiting | 等待 |
| statusDone | Done | 已完成 |
| priorityCritical | Critical | 紧急 |
| priorityHigh | High | 高 |
| priorityMedium | Medium | 中 |
| priorityLow | Low | 低 |
| priorityNone | None | 无 |
| importance | Importance | 重要性 |
| effort | Effort | 工作量 |
| dueDate | Due Date | 截止日期 |
| startDate | Start Date | 开始日期 |
| context | Context | 上下文 |
| convertToTask | Convert to Task | 转为任务 |
| createTask | Create Task | 新建任务 |
| removeTask | Remove Task | 移除任务 |
| recalcOrders | Recalculate Priorities | 重新计算优先级 |
| noTasks | No tasks yet | 暂无任务 |
| taskPanel | Task Panel | 任务面板 |
| overDue | Overdue | 逾期 |
| jumpToBlock | Jump to Block | 跳转到块 |
| allContexts | All Contexts | 所有上下文 |
| allPriorities | All Priorities | 所有优先级 |
| allStatuses | All Statuses | 所有状态 |
