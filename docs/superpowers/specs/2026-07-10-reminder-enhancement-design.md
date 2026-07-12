# 提醒功能增强设计

日期：2026-07-10
状态：待实现

## 目标

增强提醒功能的交互便捷性和模型灵活性：
1. 新增固定时间提醒（与截止日期脱钩的一次性绝对时间点提醒）
2. 增加右键菜单和铃铛图标两个快捷入口，统一通过弹窗管理提醒
3. 重构数据模型为结构化 JSON，支持相对偏移 + 绝对时间双模式

## 数据模型

### ReminderItem 类型

```typescript
interface ReminderRelative {
  type: "relative";   // 截止日期前 N 分钟
  minutes: number;    // 正整数，1-20160
}

interface ReminderAbsolute {
  type: "absolute";   // 固定日期时间
  time: string;       // "YYYY-MM-DDTHH:mm"
}

type ReminderItem = ReminderRelative | ReminderAbsolute;
```

### 存储格式

`custom-na-reminder` 属性存储 JSON 字符串：

```json
[
  {"type":"relative","minutes":60},
  {"type":"relative","minutes":1440},
  {"type":"absolute","time":"2026-07-15T09:00"}
]
```

上限：数组长度 ≤ 7。

### 向后兼容与迁移

| 旧值 | 迁移结果 |
|------|---------|
| `""` | `""`（无提醒） |
| `"enabled"` | `""`（空，开启=有至少一个提醒项） |
| `"[60,1440]"` | `'[{"type":"relative","minutes":60},{"type":"relative","minutes":1440}]'` |

迁移在前端解析时自动完成，无需内核改动。`buildEntryFromAttrs`、`CacheManager.loadAll` 中 `reminder` 字段仍为 `string`，解析逻辑全在前端。

### 内核验证

`validateTaskAttrs` 中 ATTR_REMINDER 的验证规则更新：
- 空字符串：合法
- 旧格式 JSON 数组（纯数字）：合法，前端迁移
- 新格式结构化数组：每项必须有 type 字段，relative 需 minutes 正整数，absolute 需 time 符合 YYYY-MM-DDTHH:mm 格式
- 数组长度 ≤ 7

## 新增组件：ReminderPopup.svelte

### 触发入口

1. **右键菜单**：块右键菜单添加"添加提醒"项（带铃铛图标），仅对已转为任务的块显示，点击打开 ReminderPopup
2. **TaskDetail 铃铛图标**：截止日期字段右侧的铃铛图标，点击打开 ReminderPopup

### 弹窗布局

宽度 320px，高度自适应（最大约 400px 出现滚动）。通过思源 Dialog 弹出。

从上到下四个区域：

**1. 标题栏**
- "提醒设置" + 关闭按钮

**2. 已设提醒列表 (0-7 项)**
- 右上角显示计数 "3/7"
- 每项一行：类型图标 + 描述文字 + 删除按钮(×)
  - relative：🕐 + "1天前截止" / "30分钟前截止"
  - absolute：📅 + "7月15日 09:00"
- 空状态：提示"暂无提醒"
- 删除操作即时调用 updateTask

**3. 添加固定时间提醒**
- "添加"按钮，点击后展开内联 NaDatePicker
- 选好日期时间后点确认添加，选择器收起
- 展开时按钮文字变为"收起"
- 已达 7 个上限时按钮灰显
- 添加操作即时调用 updateTask

**4. 截止日期前提醒**
- 标题行："截止日期前提醒"
- 无截止日期时：整个区域灰显 + 红色提示"请先设置截止日期"
- 有截止日期时：展示全局 defaultOffsets 的 checkbox 列表（每行一个）
- 已选中的偏移量在已设列表中显示为 relative 项，取消勾选则从列表移除
- 底部"自定义提前量"：数值输入 + 单位选择(分钟/小时/天) + 添加按钮
- 已达 7 个上限时 checkbox 和添加按钮灰显
- 勾选/取消/添加操作即时调用 updateTask

### 即时保存

弹窗内所有操作（添加、删除、勾选、取消勾选）即时调用 updateTask，无需手动保存按钮或确认。

## TaskDetail 变更

### 移除旧提醒 UI

移除截止日期下方的：
- NaToggle 开关
- checkbox 预设列表
- 自定义偏移量输入
- 相关函数：parseReminderState、addReminderOffset、removeReminderOffset、handleReminderToggle、saveReminder、saveReminderClear、saveReminderEnabled

### 新增铃铛图标

- 位于截止日期字段右侧，12px SVG 铃铛图标
- 有提醒项时：--na-color-warning 色调高亮
- 无提醒项时：低调灰色
- 点击打开 ReminderPopup，传入 blockId
- 铃铛图标始终可见，不受截止日期限制

## 右键菜单集成

在 `task-context-menu.ts` 的块右键菜单中添加"添加提醒"菜单项：
- 图标：铃铛 SVG
- 仅对有 `custom-na-task` 属性的块显示
- 点击打开 ReminderPopup，传入 blockId

## 扫描逻辑变更

### getEffectiveReminders（重构自 getEffectiveOffsets）

```typescript
function getEffectiveReminders(entry: TaskCacheEntry): ReminderItem[]
```

解析 reminder 属性，兼容旧格式自动迁移，返回 ReminderItem 数组。

### 扫描流程扩展

1. 解析 reminder 属性为 ReminderItem[]
2. 遍历列表，按类型分别计算触发时间：
   - relative：基于截止日期 - minutes * 60 * 1000（逻辑不变）
   - absolute：直接用 time 字段解析为时间戳
3. 触发时间 ≤ now 且未 dismissed → 加入通知队列

### 去重 key 格式

| 类型 | dedup key 格式 |
|------|---------------|
| relative | `blockId\|baseDateStr\|{minutes}\|due`（不变） |
| absolute | `blockId\|{time}\|0\|absolute` |
| review | `blockId\|baseDateStr\|0\|review`（不变） |

### ReminderEntry 类型扩展

```typescript
export interface ReminderEntry {
    blockId: string;
    title: string;
    triggerTime: number;
    type: "due" | "review" | "absolute";  // 新增 "absolute"
    minutesBefore: number;   // relative: 实际值, absolute/review: 0
    baseDateStr: string;     // relative: 截止日期, absolute: 日期部分, review: 回顾日期
    dueTime: number;         // relative: 截止时间戳, absolute: = triggerTime, review: 回顾时间戳
    dismissed: boolean;
}
```

### tasksWithDueOrReview store 扩展

当前只筛选有截止日期或回顾日期的任务。新增：也包含 reminder 属性中有 absolute 项的任务（即使没有截止日期和回顾日期）。

## 通知展示

### 通知卡片（NotificationCard）

absolute 类型与 relative/review 统一展示，不区分标签。`getMessage()` 中：
- `dueTime` 对 absolute 等于 `triggerTime`
- 剩余/逾期计算：`dueTime - Date.now()`，逻辑自动适用，无需分支

### ReminderView Tab

列表中 absolute 条目的描述文字通过 `entry.type` 判断：
- relative："1天前截止"
- absolute："7月15日 09:00"
- review："回顾提醒"

## 不在范围内

- 周期性/重复固定时间提醒（如"每天9点"）
- 贪睡(Snooze)功能
- 系统通知（浏览器 Notification API）
- 系统休眠恢复
- 音效替换（仍使用占位 mp3）
