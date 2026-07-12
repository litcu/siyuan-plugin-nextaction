# Tier 3 统计功能设计

> 日期：2026-07-08
> 范围：v0.3.0 Tier 3
> 状态：已批准

## 1. 概述

为 NextAction 插件新增"统计"Tab，展示任务系统的整体健康状况。核心能力包括完成率、逾期率、周期完成数、状态/优先级/上下文分布、项目进度汇总、完成趋势折线图。

同时新增两个任务属性：`na-completed`（自动记录完成时间）和 `na-note`（用户可编辑的任务描述）。

## 2. 数据模型变更

### 2.1 新增属性

| 属性 | 存储格式 | 说明 |
|------|---------|------|
| `na-completed` | ISO 时间管道符分隔，如 `"2026-07-01T14:30:00\|2026-07-08T09:15:30"` | 任务完成时间记录，每次标记 done 追加，重新打开不清除 |
| `na-note` | 多行纯文本 | 任务描述/备注，用户可编辑 |

### 2.2 na-completed 语义

- **status → done 时**：内核在 `updateTask` 中自动追加当前 UTC 时间（格式 `YYYY-MM-DDTHH:mm:ss`）到 `na-completed`，用管道符分隔
- **status 从 done 改回其他状态时**：不清除 `na-completed`，保留历史记录
- **循环任务重复时**：完成→重置为 todo 时已追加一条完成记录，重复逻辑不变
- **读取最近完成时间**：`split("|").pop()`
- **统计完成次数**：`split("|").length`
- **时间精确到秒，统一 UTC，无时区**

### 2.3 TaskCacheEntry 扩展

```typescript
interface TaskCacheEntry {
    // ... 现有字段不变
    completed: string;   // na-completed 原始值
    note: string;        // na-note 原始值
}
```

### 2.4 na-note 前端集成

- TaskDetail 中新增多行文本输入（textarea），参与 500ms 防抖保存
- TaskCard 上不显示 note 内容，仅在详情面板可见

### 2.5 需同步更新的代码点

1. `src/shared/constants.ts` — 新增 `ATTR_COMPLETED = "custom-na-completed"` 和 `ATTR_NOTE = "custom-na-note"`
2. `src/shared/types.ts` — TaskCacheEntry 新增 `completed` 和 `note`
3. `cache-manager.ts` loadAll 中的行内构建 — 读取新属性
4. `task-service.ts` buildEntryFromAttrs — 读取新属性
5. `sync-engine.ts` buildEntryFromAttrs — 读取新属性
6. `task-service.ts` updateTask — status 变为 done 时自动追加当前 UTC 时间到 na-completed
7. `task-service.ts` removeTask — clearAttrs 加入 `na-completed` 和 `na-note`
8. `rpc-server.ts` — 注册 `getStatistics` RPC
9. `kernel-bridge.ts` — 新增 `getStatistics(period)` 方法

## 3. getStatistics RPC

### 3.1 接口签名

```
getStatistics({ period: "week" | "month" })
```

- `period` 决定趋势图的分组粒度和"当前周期"的定义
- 默认 `"week"`

### 3.2 返回结构

```typescript
interface StatisticsResult {
    summary: {
        total: number;             // 总任务数（含 done）
        done: number;              // 状态为 done 的任务数
        doneRate: number;          // 完成率 0-1，保留2位小数
        overdue: number;           // 当前逾期任务数（due < 今天 且 status ≠ done）
        overdueRate: number;       // 逾期率 0-1，逾期 / 有截止日期且未完成
        completedInPeriod: number; // 当前周期内完成的任务数
    };

    statusDistribution: Array<{
        status: string;    // "todo" | "doing" | "waiting" | "done"
        count: number;
        percent: number;   // 0-1
    }>;

    priorityDistribution: Array<{
        priority: string;  // "critical" | "high" | "medium" | "low" | "none"
        count: number;
        percent: number;
    }>;

    contextDistribution: Array<{
        context: string;   // "@office" 等
        count: number;
    }>;

    projectProgress: Array<{
        blockId: string;
        title: string;
        done: number;      // 已完成子任务数
        total: number;     // 子任务总数
        percent: number;   // 0-1
    }>;

    trend: Array<{
        label: string;     // "7/7" (周) 或 "7月" (月)
        count: number;     // 该周期内完成的任务数
    }>;
}
```

### 3.3 计算逻辑

**核心指标：**

- `total`：缓存中所有条目数
- `done`：status === "done" 的条目数
- `doneRate`：done / total，total 为 0 时返回 0
- `overdue`：due 非空且 due < 今天且 status ≠ done 的条目数
- `overdueRate`：overdue / (有截止日期且未完成的任务数)，分母为 0 时返回 0
- `completedInPeriod`：遍历所有任务的 `na-completed`，拆分管道符，筛选时间落在当前周期内的条目数

**分布：**

- `statusDistribution`：按状态分组计数，计算占比
- `priorityDistribution`：按优先级分组计数，计算占比
- `contextDistribution`：拆分管道符后按上下文分组计数，按数量降序排列
- `projectProgress`：只返回 taskType="2" 且 childIds 非空的项目，按完成率升序排列（最需关注的在前）

**趋势：**

- 取最近 8 个周期（周=最近8周，月=最近8月）
- 每个周期统计 na-completed 中落在该时段的条目数
- 周期边界：周=自然周（周一到周日），月=自然月（1号到月末），统一 UTC
- 周标签格式："M/D"（如 "7/7"），月标签格式："M月"（如 "7月"）

### 3.4 计算时机

前端切换到统计 Tab 时调用 `getStatistics`，内核实时遍历缓存计算。无需额外缓存。

## 4. 前端 UI 设计

### 4.1 面板结构

统计 Tab 作为第四个 Tab（下一步行动 / 全部任务 / 项目视图 / 统计），替换内容区域，NavRail 保持不变。

```
┌─────────────────────────────┐
│  核心指标区（顶部）           │
│  ┌──────┐ ┌──────┐ ┌──────┐ │
│  │完成率 │ │逾期率 │ │本周期│ │
│  │ 68%  │ │ 12%  │ │ 5个  │ │
│  └──────┘ └──────┘ └──────┘ │
│  ┌──────┐ ┌──────┐          │
│  │总任务 │ │逾期数 │          │
│  │  25  │ │  3   │          │
│  └──────┘ └──────┘          │
├─────────────────────────────┤
│  分布区（中间）               │
│  ┌──────────┐ ┌──────────┐  │
│  │ 状态分布  │ │ 优先级分布│  │
│  │ (横条图)  │ │ (横条图)  │  │
│  └──────────┘ └──────────┘  │
│  ┌──────────┐ ┌──────────┐  │
│  │ 上下文分布│ │ 项目进度  │  │
│  │ (列表)   │ │ (进度条)  │  │
│  └──────────┘ └──────────┘  │
├─────────────────────────────┤
│  趋势区（底部）               │
│  ┌──────────────────────┐   │
│  │    SVG 折线图         │   │
│  │  近8周/月完成趋势     │   │
│  └──────────────────────┘   │
└─────────────────────────────┘
```

### 4.2 核心指标区

- 5 个指标卡片，2 列网格
- 每张卡片：大号数字 + 小号标签文字
- 完成率高=绿色调，逾期率高=红色调
- 本周期完成数旁边显示周期切换控件（NaSegmentControl：周/月）

### 4.3 分布区

- 2×2 网格布局
- **状态分布**：横条图，每条长度按占比，颜色用状态色
- **优先级分布**：横条图，颜色用优先级色
- **上下文分布**：简洁列表，每行显示上下文名 + 数量，按数量降序，最多显示前 8 个
- **项目进度**：每行显示项目标题 + NaProgressBar + "3/5" 文字，按完成率升序，最多显示前 6 个

### 4.4 趋势区

- SVG 折线图，宽度撑满面板
- X 轴：8 个周期标签
- Y 轴：完成数量，自动刻度
- 折线下方填充半透明色
- 当前周期高亮标记（最后一个点）
- 无数据时显示空状态提示

### 4.5 周期切换

- 核心指标区右上角放 NaSegmentControl（周/月）
- 切换时重新调用 `getStatistics({ period })` 并刷新整个面板

### 4.6 响应式

- 面板宽度不足时，核心指标区和分布区从 2 列退化为 1 列

### 4.7 组件拆分

```
StatisticsView.svelte（Tab 内容根组件）
├── NaSegmentControl（周/月切换）
├── 统计核心指标区（内联渲染）
├── 统计分布区
│   ├── 横条图 × 2（状态、优先级）— 内联 SVG
│   ├── 上下文分布列表
│   └── 项目进度列表（复用 NaProgressBar）
└── 趋势折线图（内联 SVG）
```

## 5. i18n 键值

| 键名 | en | zh-CN |
|------|-----|-------|
| statistics | Statistics | 统计 |
| totalTasks | Total Tasks | 总任务 |
| completionRate | Completion Rate | 完成率 |
| overdueRate | Overdue Rate | 逾期率 |
| overdueTasks | Overdue | 逾期 |
| completedInPeriod | Completed This {period} | 本{period}完成 |
| thisWeek | Week | 周 |
| thisMonth | Month | 月 |
| statusDistribution | Status Distribution | 状态分布 |
| priorityDistribution | Priority Distribution | 优先级分布 |
| contextDistribution | Context Distribution | 上下文分布 |
| projectProgress | Project Progress | 项目进度 |
| completionTrend | Completion Trend | 完成趋势 |
| noProjectProgress | No projects yet | 暂无项目 |
| noContextTasks | No contexts | 暂无上下文 |
| week | week | 周 |
| month | month | 月 |
| note | Note | 备注 |

## 6. 边界情况

1. **空数据** — 无任务时核心指标全部显示 0，分布区显示空状态提示，趋势折线图显示"暂无数据"
2. **na-completed 被手动篡改** — 解析时 try-catch，无效时间条目跳过不计入统计，不崩溃
3. **循环任务的多次完成** — 天然支持，na-completed 每次完成追加一条，统计时按时间归属到对应周期
4. **任务无截止日期** — 不计入逾期，逾期率分母是"有截止日期且未完成的任务数"
5. **projectProgress 为空** — 没有 taskType="2" 的项目时显示空状态
6. **上下文去重** — 一个任务有多个上下文时，该任务在每个上下文中各计一次
7. **面板宽度不足** — 核心指标区和分布区从 2 列退化为 1 列
8. **现有任务无 na-completed** — 升级兼容，统计时视为从未完成过，完成趋势中历史周期数据为 0
