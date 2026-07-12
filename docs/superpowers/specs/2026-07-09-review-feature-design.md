# GTD 回顾功能设计

## 概述

为 NextAction 插件新增 GTD 回顾（Weekly Review）功能，包含两个核心能力：

1. **回顾指南面板** — 5个可折叠的检查项，引导用户逐项审视各列表，一站式操作无需跳转
2. **单任务回顾** — 为任意任务设定回顾间隔，到期自动出现在回顾列表

回顾作为 NavRail 独立 Tab，上下分区布局：上半区为回顾指南面板，下半区为待回顾任务列表。

## 数据模型

### 新增任务属性

| 属性 | SiYuan IAL | 类型 | 默认值 | 说明 |
|------|-----------|------|--------|------|
| `na-review-interval` | `custom-na-review-interval` | 数字（天数） | 空（0） | 为空或0表示不参与单任务回顾；>0表示每N天回顾一次 |
| `na-review-date` | `custom-na-review-date` | 日期字符串（YYYY-MM-DD） | 空 | 下次回顾日期。可由系统自动推算，也可手动设置 |

### 属性常量

`shared/constants.ts` 新增：
- `ATTR_REVIEW_INTERVAL = "custom-na-review-interval"`
- `ATTR_REVIEW_DATE = "custom-na-review-date"`

### TaskCacheEntry 扩展

```typescript
// 新增字段
reviewInterval: number;  // 0 = 不回顾
reviewDate: string;      // 空字符串 = 无
```

### 完成回顾时的推算逻辑

硬编码为"从完成日算"模式（不设设置项），逻辑简洁：

1. 用户点击"已回顾"按钮
2. `review-date = 今天 + interval天`
3. 调用 `updateTask` 写入新的 review-date
4. 如果 `na-review-interval` 为空但 `na-review-date` 有值，视为手动设定的固定日期，不自动推算

### done 任务的回顾处理

当任务 status 变为 done 时，如果 `review-interval > 0`，自动推算下次 review-date（与 repeat 逻辑一致），而非清空回顾属性。这样任务重新变为 todo 时，回顾机制仍然有效。

## 视图布局

回顾 Tab 作为 NavRail 第8个入口，整体上下分区。

### 上半区 — 回顾指南面板

5个可折叠的检查项卡片，始终可见，无"开始/结束回顾"流程控制。每项显示步骤名和任务数量，展开后内联显示任务列表，支持右键菜单快速操作。

| # | 检查项 | 数据来源 | 展开后的操作 |
|---|--------|---------|------------|
| 1 | 检查逾期任务 | status≠done 且 due < 今天 | 逾期任务列表，右键菜单快速改状态/优先级 |
| 2 | 审视下一步行动 | isNextActionCandidate 为 true 的任务 | 下一步行动列表，可快速标记完成或改状态 |
| 3 | 检查等待中的任务 | status=waiting | 等待任务列表，可快速激活（改状态为todo） |
| 4 | 审视将来/也许 | status=someday | 将来任务列表，可快速激活（改状态为todo+设start） |
| 5 | 检查项目进度 | taskType="2" 且有未完成子任务 | 项目列表含进度条，可展开看子任务 |

交互要点：
- 无步骤状态管理（无"已完成/已跳过"标记）
- 无"开始回顾/结束回顾"流程
- 每个检查项独立折叠/展开，用户自由浏览
- 默认全部折叠，只显示步骤名和任务数量

### 下半区 — 待回顾任务

始终可见。聚合以下任务：

1. **回顾到期**：`review-date ≤ 今天` 且 `review-interval > 0` 且 `status ≠ done`
2. **逾期任务**：status≠done 且 due < 今天

列表按分组标签区分来源，每组可折叠。任务卡片复用现有 TaskCard 组件，支持右键菜单。回顾到期组的任务卡片右侧有"已回顾"按钮，点击后推算下次 review-date，任务从列表中消失。

**批量操作**：回顾到期组顶部有"全部标记已回顾"按钮，一次处理所有到期任务。

### NavRail 回顾入口

回顾图标显示 badge 数字（到期回顾任务数），用户在任何视图都能看到有待回顾任务。

### TaskCard 回顾标识

在其他视图的 TaskCard 上，如果任务有 review-interval > 0，显示一个小图标（如小日历图标），提升可发现性。

## 内核侧改动

### 新增 RPC 方法

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `getReviewData` | `{}` | `ReviewData` | 一次返回所有回顾聚合数据 |
| `markTaskReviewed` | `{ blockIds: string[] }` | `TaskCacheEntry[]` | 推算并更新 review-date，支持批量 |

### ReviewData 结构

```typescript
interface ReviewData {
  overdueTasks: TaskCacheEntry[];
  nextActions: TaskCacheEntry[];
  waitingTasks: TaskCacheEntry[];
  somedayTasks: TaskCacheEntry[];
  activeProjects: TaskCacheEntry[];
  reviewDueTasks: TaskCacheEntry[];
}
```

所有数据从内存缓存过滤组装，无需额外 SQL 查询。`reviewDueTasks` 排除 `status === "done"` 的任务。

### CacheManager 扩展

- `loadAll` 时读取 `custom-na-review-interval` 和 `custom-na-review-date`，填入 TaskCacheEntry 新字段
- `review-interval` 归一化为数字（空或0表示不回顾）
- `review-date` 保持日期字符串

### TaskService 扩展

- `markTaskReviewed`：对每个 blockId，读取 review-interval，推算 `review-date = 今天 + interval`，调用 `updateTask` 写入。支持批量（blockIds 数组）
- `updateTask`：当 status 变为 done 且 review-interval > 0 时，自动推算下次 review-date

## 前端侧改动

### 新增文件

| 文件 | 说明 |
|------|------|
| `ReviewView.svelte` | 回顾 Tab 主视图，上下分区布局 |
| `ReviewGuide.svelte` | 上半区：5个可折叠检查项 |
| `ReviewDueList.svelte` | 下半区：待回顾任务列表 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `constants.ts` | 新增 `VIEW_REVIEW = "review"` 和 ViewType 联合类型 |
| `NavRail.svelte` | 新增回顾 Tab 入口（图标：勾选圆圈）+ badge 数字 |
| `NextActionApp.svelte` | 新增回顾视图的路由分支，引入 ReviewView |
| `TaskDetail.svelte` | 新增 review-interval 和 review-date 两个编辑字段 |
| `TaskCard.svelte` | 有 review-interval 的任务显示小日历图标 |
| `kernel-bridge.ts` | 新增 `getReviewData()`、`markTaskReviewed(blockIds: string[])` |
| `task-store.ts` | 新增 `deriveReviewDueCount` 派生函数（供 NavRail badge 使用） |
| `i18n/en.json` + `i18n/zh-CN.json` | 新增回顾相关的所有文案 |

### TaskDetail 中的回顾字段

- **回顾间隔**：NaSearchSelect 下拉，预设选项 7/14/30/60/90 天，支持自定义输入天数
- **下次回顾日期**：NaDatePicker，可手动设置。设了间隔但没设日期时，内核在首次标记"已回顾"时自动推算

## i18n 文案（待实现时补全）

涉及回顾Tab标题、5个检查项名称、按钮文案、空状态提示、TaskCard回顾图标tooltip等。中英文各约15-20条新key。
