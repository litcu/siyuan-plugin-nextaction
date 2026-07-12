# "我的一天"时间排期功能设计规格

## 一、功能概述

为"我的一天"视图增加时间排期能力。用户可将未排期任务拖到垂直时间线上安排日程，支持拖拽移动、拖拽调整时长、拖回取消排期，以及点击弹出操作菜单。时间线从 `myDayResetHour` 开始显示，带当前时间指示线，重叠任务泳道并排。

## 二、布局

**双模式视图**：列表模式（保留现有）和时间线模式（新增），顶部切换按钮，默认时间线模式。

**时间线模式布局 — 左右分栏**：

```
┌─────────────────────────────────────────────┐
│  ☀ 我的一天          [列表] [时间线]         │
├──────────────┬──────────────────────────────┤
│  未排期任务   │  时间线                       │
│  (220px固定)  │  (flex:1)                    │
│              │                               │
│  ┌────────┐  │  8:00 ─────────────────────  │
│  │● 任务1 │  │  8:30 ─────────────────────  │
│  └────────┘  │  9:00 ┌──────────────┐      │
│  ┌────────┐  │       │ 完成项目报告  │      │
│  │● 任务2 │  │  9:30 │ 9:00-10:00   │      │
│  └────────┘  │ 10:00 └──────────────┘      │
│  ┌────────┐  │  ── 当前时间红线 ──          │
│  │● 任务3 │  │ 10:30 ┌──────────────┐      │
│  └────────┘  │       │ 回复客户邮件  │      │
│              │ 11:00 │ 10:30-11:00  │      │
│              │       └──────────────┘      │
│              │  ...                         │
└──────────────┴──────────────────────────────┘
```

**响应式窄屏（宽度 < 阈值时）**：上下排列，未排期面板在时间线上方，高度压缩为 120px 左右可滚动。

**列表模式**：保持现有的 SearchFilterBar + TaskCard 扁平列表，不变。

## 三、数据模型变更

### 3.1 MyDayTaskEntry 字段语义变更

```typescript
export interface MyDayTaskEntry {
    blockId: string;
    addedAt: number;
    scheduleStart: number | null;  // 一天内分钟数 (0-1440)，null=未排期
    scheduleEnd: number | null;    // 一天内分钟数 (0-1440)，null=未排期
    order: number;
}
```

- `scheduleStart`：从 resetHour 起算的分钟偏移。例如 resetHour=5 时，5:00=0, 6:00=60, 9:00=240
- `scheduleEnd`：同上。必须 > scheduleStart，最短 15 分钟，最长 720 分钟（12 小时）
- `null`：未排期，任务显示在左侧未排期面板
- 前端展示时间时换算回实际时钟时间：`displayHour = Math.floor((scheduleStart + resetHour * 60) / 60) % 24`

### 3.2 迁移

当前所有 `scheduleStart`/`scheduleEnd` 均为 `null`，无数据迁移问题。`MyDayState.schema` 保持为 1。

### 3.3 新增常量

```typescript
// src/shared/constants.ts 新增
export const TIMELINE_SLOT_MINUTES = 30;      // 时间线刻度间隔
export const DRAG_SNAP_MINUTES = 15;           // 拖拽吸附精度
export const DEFAULT_SCHEDULE_DURATION = 60;   // 默认排期时长（分钟）
export const MIN_SCHEDULE_DURATION = 15;       // 最短排期时长
export const MAX_SCHEDULE_DURATION = 720;      // 最长排期时长
export const PIXELS_PER_MINUTE = 1.2;          // 每分钟像素高度
export const UNSCHEDULED_PANEL_WIDTH = 220;    // 左侧面板宽度
export const RESPONSIVE_BREAKPOINT = 500;      // 窄屏断点(px)
```

## 四、时间线渲染

### 4.1 刻度与坐标

- 纵轴从 `resetHour * 60` 分钟画到 `(resetHour + 24) * 60` 分钟，即覆盖完整 24 小时
- 每 30 分钟一条刻度线，整点（minute % 60 === 0）为粗线 + 时间标签
- 时间标签格式 "HH:MM"（24 小时制），如 "08:00"、"14:30"
- 时间线总高度 = `24 * 60 * PIXELS_PER_MINUTE`（约 1728px），可滚动

### 4.2 当前时间指示线

- 红色水平线 + 左侧圆点，位置 = `(currentMinute - resetHour * 60) * PIXELS_PER_MINUTE`
- `currentMinute` = 当前时间的小时 * 60 + 分钟（相对于 0:00 的绝对分钟数）
- 每 60 秒刷新一次位置
- 进入时间线视图时自动滚动到当前时间位置

### 4.3 任务卡片渲染

- 位置：`top = scheduleStart * PIXELS_PER_MINUTE`，`height = (scheduleEnd - scheduleStart) * PIXELS_PER_MINUTE`
- 显示内容：优先级色点 + 任务名称 + 时间范围文字（如 "9:00 - 10:00"）
- 最小高度保护：当 duration 较小时，保证最小 `MIN_SCHEDULE_DURATION * PIXELS_PER_MINUTE` px

### 4.4 泳道（重叠处理）

使用贪心泳道算法：

1. 将所有已排期任务按 scheduleStart 排序
2. 维护泳道列表，每个新任务放入第一个不与已有任务重叠的泳道
3. 卡片宽度 = `容器宽度 / 泳道总数`，水平偏移 = `泳道索引 * 卡片宽度`
4. 时间线容器使用 `position: relative`，卡片使用 `position: absolute`

## 五、交互设计

### 5.1 从左侧拖到时间线（HTML5 Drag & Drop）

- 左侧简化卡片设置 `draggable="true"`
- `dragstart`：将 `{ blockId }` 序列化存入 `dataTransfer`
- 时间线 `dragover`：计算落点分钟数（`Math.round(offsetY / PIXELS_PER_MINUTE / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES`），显示半透明预览卡片
- 时间线 `drop`：调用 `setMyDaySchedule(blockId, snapStart, snapStart + DEFAULT_SCHEDULE_DURATION)`，返回新状态更新 store
- 拖拽靠近时间线边缘时自动滚动

### 5.2 时间线内拖拽移动（Pointer Events）

- 按住卡片主体拖拽，整体平移（保持 duration 不变）
- `pointerdown` → 记录初始位置和 scheduleStart/scheduleEnd
- `pointermove` → 实时更新预览位置，吸附到 15 分钟
- `pointerup` → 如果位置变化 > 15 分钟，调用 `setMyDaySchedule` 更新；否则视为点击，弹出操作菜单
- 拖到左侧面板区域上方时，显示"取消排期"提示，释放则清除 schedule

### 5.3 拖拽调整时长（Pointer Events）

- 卡片顶部和底部各有一个 6px 高的 resize 手柄区域（`cursor: ns-resize`）
- 拖拽顶部手柄：调整 scheduleStart（保持 scheduleEnd 不变）
- 拖拽底部手柄：调整 scheduleEnd（保持 scheduleStart 不变）
- 最小持续时间保护：`scheduleEnd - scheduleStart >= MIN_SCHEDULE_DURATION`
- 同样吸附到 15 分钟

### 5.4 左键点击弹出操作菜单

- 区分点击与拖拽：`pointerdown` 时记录位置，`pointerup` 时如果位移 < 5px 则视为点击
- 点击时间线卡片弹出浮动菜单，包含以下选项：
  - **取消排期**：清除 scheduleStart/scheduleEnd，任务回到左侧面板
  - **标记完成**：调用 updateTask 设置 status=done
  - **设置优先级**：子菜单，1-7 级（复用现有优先级逻辑）
  - **从我的一天移除**：调用 removeTaskFromMyDay，任务从"我的一天"完全移除
- 菜单使用思源 `Menu` 组件实现（与现有右键菜单一致）

### 5.5 拖回左侧面板取消排期

- 时间线内拖拽移动时，如果拖到左侧面板上方，左侧面板高亮提示"释放以取消排期"
- 释放后调用 `setMyDaySchedule(blockId, null, null)`

## 六、组件拆分

### 新增组件

| 组件 | 职责 |
|------|------|
| `TimelineView.svelte` | 时间线模式主容器，管理左右分栏布局、响应式断点、视图切换 |
| `UnscheduledPanel.svelte` | 左侧未排期面板，渲染简化卡片列表，处理 dragstart |
| `TimelineColumn.svelte` | 右侧时间线，渲染刻度、当前时间线、任务卡片，处理 drop/pointer |
| `TimelineCard.svelte` | 时间线上的排期任务卡片，处理拖拽移动/resize/点击 |
| `TimelineNeedle.svelte` | 当前时间红色指示线，定时刷新位置 |
| `TaskQuickMenu.ts` | 点击卡片弹出的操作菜单（取消排期/完成/优先级/移除） |

### 修改组件

| 组件 | 变更 |
|------|------|
| `MyDayView.svelte` | 顶部增加列表/时间线切换按钮，根据模式渲染原有列表或 TimelineView |
| `my-day-manager.ts` | setSchedule 参数语义改为分钟数，添加边界校验 |
| `i18n/*.json` | 新增：timelineMode, listMode, unscheduled, cancelSchedule, setPriority 等 key |

## 七、内核变更

### my-day-manager.ts

- `setSchedule(blockId, start, end)`：参数改为分钟数（0-1440 | null）
  - 校验：`start` 和 `end` 都为 null 或都不为 null
  - 校验：`start >= 0, end <= 1440, end - start >= 15, end - start <= 720`
  - 返回不可变副本（遵循 goja 规则）
- 新增 `removeSchedule(blockId)`：便捷方法，等价于 `setSchedule(blockId, null, null)`

### rpc-server.ts

- 无新增 RPC 方法，现有 `setMyDaySchedule` 已满足需求

## 八、数据流

```
用户拖拽任务到时间线
  → TimelineColumn ondrop 计算落点分钟数
    → bridge.setMyDaySchedule(blockId, startMin, endMin)
      → RPC → TaskService.setMyDaySchedule → MyDayManager.setSchedule
        → persist() → siyuan.storage.put
      → 返回新 MyDayState
    → taskStore.applyMyDayUpdate(newState)
  → Svelte 响应式更新：左侧面板移除该卡片，右侧时间线渲染新卡片
```

## 九、错误处理

- 排期冲突：不阻止，泳道自动并排显示
- 无效时间范围（end <= start 等）：内核 setSchedule 校验失败返回错误，前端 toast 提示
- 拖拽异常（pointer 丢失等）：pointerup 时如果无有效目标，回退到拖拽前状态
- 时间线区域外释放：同上回退

## 十、不做什么

- 不做精确时间输入（15 分钟吸附足够）
- 不做跨天排期（仅限当天 24 小时窗口）
- 不做自动排期/智能建议
- 不做 Journal 同步
- 不做多日视图
- 不做时间追踪/番茄钟
