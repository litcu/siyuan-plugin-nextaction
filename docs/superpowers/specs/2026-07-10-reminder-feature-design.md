# 提醒功能设计规格

## 概述

为 NextAction 插件新增任务提醒功能，补全 GTD 流程中"提醒"这一关键环节。支持基于截止日期的提前提醒和基于回顾日期的定期提醒，通过前端定时器检测到期提醒，以 Svelte Portal 通知卡片和专用提醒 Tab 展示。

## 数据模型

### 新增属性

`custom-na-reminder`：存储单任务自定义提前量列表。

存储格式为 JSON 字符串，内容为分钟数数组：

```json
[60, 720, 1440]   // 1小时、12小时、1天
```

- 未设置该属性 → 使用全局默认提前量
- 设置为 `[]` → 禁用该任务的提醒（显式关闭）
- 设置为 `[60]` → 仅提前1小时提醒，覆盖全局

无效 JSON 解析失败时回退为空数组（等同于未设置属性）。

### TaskCacheEntry 新增字段

```typescript
reminder: string;  // custom-na-reminder 原始值，空字符串 = 使用全局默认
```

与 `repeat`、`depends` 等字段保持一致的原始字符串存储模式。前端使用时通过 `getEffectiveOffsets(entry, settings)` 函数解析为 `number[]`。

### 新增运行时类型

```typescript
// 提醒条目（运行时，不持久化到思源属性）
interface ReminderEntry {
  blockId: string;
  title: string;
  triggerTime: number;     // 实际触发时间戳（ms）
  type: 'due' | 'review'; // 截止提醒 or 回顾提醒
  minutesBefore: number;   // 提前了多少分钟（review 类型固定为 0）
  baseDateStr: string;     // 触发基准日期字符串（due 的日期 or reviewDate），用于去重和调试
  dismissed: boolean;       // 用户是否已处理
}
```

`ReminderEntry` 存在前端 store 中，不写入思源属性。

### 触发时间计算

- 截止提醒：`triggerTime = due时间戳 - minutesBefore * 60000`
- 回顾提醒：`triggerTime = reviewDate当天 09:00`（无提前量概念，到达当天即触发。固定使用09:00而非 myDayResetHour，因为回顾是独立概念，不应与"我的一天"设置耦合）

## 全局设置

在 `PluginSettings` 中新增 `reminderSettings`：

```typescript
reminderSettings: {
  enabled: boolean;              // 总开关，默认 true
  defaultOffsets: number[];      // 默认提前量（分钟数），默认 [60, 720, 1440, 4320, 7200, 10080]
  dueSound: string;              // 截止提醒音效ID，默认 'chime'
  reviewSound: string;           // 回顾提醒音效ID，默认 'soft'
  soundEnabled: boolean;         // 音效开关，默认 true
}
```

### 设置面板 UI

设置 Tab 中新增"提醒"分区：

1. **总开关** — toggle，关闭后隐藏提醒 Tab、停止通知和音效
2. **默认提前量列表** — 可增删改的列表，每项是数值 + 单位下拉（分钟/小时/天），添加按钮在底部。单位下拉仅用于显示友好，存储统一转成分钟数
3. **音效选择** — 两行选择器，分别选截止提醒和回顾提醒的音效，每个选择器旁有试听按钮（试听同时解锁浏览器 autoplay 限制）
4. **音效开关** — toggle

### 校验规则

- `enabled`、`soundEnabled` 必须为布尔值
- `defaultOffsets` 必须为正整数数组，元素范围 1~20160（14天），无重复，升序，数组长度 ≤ 10
- `dueSound`、`reviewSound` 必须为预定义枚举值之一：`chime` | `soft` | `bell` | `ping` | `gentle`
- `mergeSettings` 中 `reminderSettings` 使用浅合并（与 `priorityEngine` 一致）：`{ ...base.reminderSettings, ...(override.reminderSettings ?? {}) }`
- 旧版 settings.json 缺少 `reminderSettings` 时，由 `mergeSettings` 自动用默认值填充

## 前端定时器与补漏机制

### 扫描调度

前端启动 `setInterval`，每 30 秒执行一次扫描：

1. 检查 `reminderSettings.enabled`，为 false 则早退
2. 遍历 taskStore 中所有有 due 或 reviewDate 的任务（维护派生列表，不全量遍历）
3. 对每个有截止日期的任务，根据其提前量（自定义或全局默认）计算每个提醒点的 `triggerTime`
4. 对每个有 `reviewDate` 的任务，计算回顾提醒的 `triggerTime`
5. 将到期的提醒点加入通知队列

### 状态过滤

- `someday` 状态的任务不触发提醒（与 isNextActionCandidate 排除逻辑一致）
- `waiting` 状态的任务触发提醒（等待中更需要跟进）
- `done` 状态的任务不触发提醒

### 补漏逻辑

**全量补漏**：扫描时不设固定时间窗口，所有 `triggerTime < now` 且任务未完成、未被 dismissed 的提醒都应触发。这样即使用户一周才打开一次，也能看到所有错过的提醒。

### 已 dismissed 记录的持久化

为防止插件重启后已处理的提醒反复弹出，使用 `Plugin.saveData("dismissed-reminders.json", data)` 持久化 dismissed 记录：

- 存储格式：`Record<string, number>`，键为去重键，值为 dismissed 时间戳
- 7 天 TTL 自动清理：每次扫描时删除 7 天前的记录
- 插件加载时通过 `Plugin.loadData("dismissed-reminders.json")` 读取恢复

### 去重

用 `blockId + baseDateStr + minutesBefore + type` 作为去重键，确保同一任务不同轮次（如重复任务 due 更新后）的提醒不会被错误合并。review 类型提醒的 `minutesBefore` 固定为 0。

### 触发前最终检查

提醒触发前从缓存读取任务最新状态，如果 `status === 'done'` 或任务已不存在，则跳过该提醒（不弹通知、不播音效）。

### 插件加载时

插件初始化时立即执行一次全量扫描，补发所有错过的提醒。

## 通知 UI

### NotificationHost 组件

- 挂载为 body 级 Portal，固定在屏幕右下角（实现前先验证 z-index 在思源 Electron 环境中是否可用，如不可用则降级为面板内渲染）
- 内部维护通知队列（Svelte store），可视区域最多同时显示 5 条
- 超出 5 条时采用 FIFO 策略：移除最早的一条（带淡出动画），第 6 条入场。面板内提醒列表保留全部历史
- 每条通知卡片包含：
  - 任务标题（点击跳转到块）
  - 提醒类型标签："截止提醒"（红色）或"回顾提醒"（蓝色）
  - 具体内容，如"1小时后到期"、"今天需要回顾"
  - 关闭按钮（单条已读）
- 通知卡片不自动消失，只有用户手动关闭
- 底部有"一键已读"按钮，关闭当前所有通知（200ms 淡出动画）

### 动画

- 入场：Svelte `transition:fly` 从右侧滑入
- 退场：Svelte `transition:fade` 淡出
- 音效在入场时播放

### 音效

5种1-2秒短铃声，打包为 mp3 文件（思源 Electron 环境兼容性最佳，无需 ogg 备份）：

| ID | 名称 | 特点 |
|---|---|---|
| chime | 清脆铃声 | 默认截止提醒音 |
| soft | 柔和铃声 | 默认回顾提醒音 |
| bell | 经典铃声 |  |
| ping | 短促提示 |  |
| gentle | 轻柔旋律 |  |

截止提醒和回顾提醒可分别选择不同音效，全局配置，不可单任务设置。

### autoplay 限制

浏览器 autoplay policy 要求首次音频播放由用户手势触发。应对策略：
- 捕获 `audio.play()` 的 Promise rejection，播放失败时静默降级（仅视觉通知）
- 设置面板的"试听"按钮可解锁后续自动播放（用户点击后浏览器允许该域自动播放）
- 首次安装插件后，在设置面板顶部提示用户点击试听以启用音效

## 提醒 Tab

### Tab 位置与可见性

NavRail 中新增铃铛图标，排在现有 Tab 最后。图标右上角叠加红色数字徽章，显示未处理提醒数量。无未处理提醒时徽章隐藏。

`reminderSettings.enabled === false` 时隐藏铃铛图标和提醒 Tab（参照 `myDayEnabled` 的模式）。

### 提醒视图内容

列表展示所有未处理的提醒条目（`ReminderEntry`），按触发时间排序（最紧急的在前）。每条包含：

- 任务标题（点击跳转）
- 提醒类型图标/标签（截止/回顾）
- 触发时间或描述文字（如"1小时后到期"、"今天需回顾"）
- 单条"已读"按钮

底部有"一键已读"按钮。

已处理的提醒不再显示（`dismissed = true` 的过滤掉）。

### 与回顾 Tab 的分工

- 回顾 Tab：安排回顾日程（设置 reviewDate、标记已回顾）— 输入端
- 提醒 Tab：查看和管理已触发的通知 — 输出端
- 两者是输入/输出关系，不重叠

### Dock 徽章

在插件 Dock 图标上叠加红色数字徽章，数字与 Tab 图标徽章一致。用户打开面板后徽章不清零，必须逐条处理或一键已读后才消失。

实现前需验证思源 Dock API 是否支持自定义徽章渲染。如不支持，降级为仅在 NavRail 铃铛图标上显示数量角标（纯 CSS 实现）。

## 任务编辑弹窗中的提醒设置

选中截止日期后，下方自动显示提前量选项。采用三态模型：

- **状态A（无截止日期）**：提醒设置区域隐藏，不可操作
- **状态B（有截止日期，无 per-task 覆盖）**：显示全局默认 offsets 作为占位文本（灰色），标注"使用默认设置"。用户未编辑时**不写入** `custom-na-reminder` 属性（保持"跟随全局"语义）
- **状态C（有 per-task 覆盖）**：显示实际 offsets 值（正常色），提供"重置为默认"按钮回到状态B

额外交互：
- 独立的"禁用提醒"开关，开关关闭时写入 `[]`，开关打开时显示提前量列表
- 删除截止日期时，自动清除 `custom-na-reminder` 属性并更新缓存
- `custom-na-reminder` 的短键 `na-reminder` 仅用于 RPC 调用，IAL 中存储为 `custom-na-reminder`

## 内核侧变更

### removeTask

在属性清理列表中添加 `ATTR_REMINDER`，确保删除任务时不残留属性。

### buildEntryFromAttrs

新增 `reminder: attrs[ATTR_REMINDER] || ""` 解析行。

### validateTaskAttrs

新增 `ATTR_REMINDER` 的校验：值必须是合法 JSON 数组，元素为正整数，无重复值。校验失败抛出错误。

### updateTask

支持 `na-reminder` 属性更新，自动归一化为 `custom-na-reminder`。

## 新增常量

`constants.ts` 中新增：

```typescript
export const ATTR_REMINDER = 'custom-na-reminder';
export const REMINDER_DATA_PATH = 'dismissed-reminders.json';
```

前端 `constants.ts` 中新增 `ViewType` 的 `reminder` 成员。

## 新增 i18n key

两个语言文件中同步添加提醒相关翻译，包括：提醒 Tab 名称、通知卡片文案、设置面板标签、音效名称、提前量单位等。

## 架构影响

### 新增文件

| 文件 | 职责 |
|---|---|
| `src/frontend/stores/reminder-store.ts` | 提醒队列 store、扫描逻辑、补漏机制、dismissed 持久化 |
| `src/frontend/components/ReminderView.svelte` | 提醒 Tab 视图 |
| `src/frontend/components/NotificationHost.svelte` | Portal 通知容器 |
| `src/frontend/components/NotificationCard.svelte` | 单条通知卡片 |
| `src/frontend/utils/audio-player.ts` | 音效播放工具（含 autoplay 降级） |
| `src/assets/sounds/` | 5个音效文件（chime/soft/bell/ping/gentle.mp3） |

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `src/shared/constants.ts` | 新增 `ATTR_REMINDER`、`REMINDER_DATA_PATH` |
| `src/shared/types.ts` | 新增 `ReminderEntry` 类型、`TaskCacheEntry.reminder` 字段 |
| `src/shared/settings.ts` | 新增 `reminderSettings` 字段、`mergeSettings` 浅合并、`validateSettings` 校验 |
| `src/kernel/task-service.ts` | `buildEntryFromAttrs` 解析 `ATTR_REMINDER`；`removeTask` 清理 `ATTR_REMINDER`；`validateTaskAttrs` 校验新属性 |
| `src/kernel/cache-manager.ts` | `loadAll` 解析新属性 |
| `src/kernel/rpc-server.ts` | `updateTask` 支持新属性 |
| `src/frontend/constants.ts` | `ViewType` 新增 `reminder` |
| `src/frontend/stores/task-store.ts` | 导出有 due/reviewDate 任务的派生列表 |
| `src/frontend/components/TaskEditPopup.svelte` | 截止日期下方显示提前量编辑（三态模型+禁用开关） |
| `src/frontend/components/NextActionApp.svelte` | 注册新 Tab、新增提醒视图条件渲染 |
| `src/frontend/components/NavRail.svelte` | 新增铃铛图标+徽章、enabled 控制可见性 |
| `src/index.ts` | 挂载 NotificationHost、启动定时器、加载 dismissed 记录 |
| `src/i18n/zh-CN.json` | 新增翻译 key |
| `src/i18n/en.json` | 新增翻译 key |
| `src/index.scss` | 通知卡片样式、徽章样式 |
