# 提醒功能实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 NextAction 插件实现任务提醒功能，包括基于截止日期的提前提醒和基于回顾日期的定期提醒，通过前端定时器检测、Svelte Portal 通知卡片、专用提醒 Tab 和 Dock 徽章展示。

**架构：** 前端 30 秒定时器扫描 taskStore 中的到期提醒，全量补漏（不限时间窗口），dismissed 记录通过 Plugin.saveData 持久化（7 天 TTL）。通知通过 Svelte Portal + store 模式实现，提醒 Tab 在 NavRail 中注册。新增 `custom-na-reminder` 属性存储单任务自定义提前量（JSON 分钟数组），内核侧常规属性处理。

**技术栈：** TypeScript、Svelte、思源插件 API（Plugin.loadData/saveData）、Web Audio API / HTMLAudioElement

---

## 文件结构

### 新增文件

| 文件 | 职责 |
|---|---|
| `src/frontend/stores/reminder-store.ts` | 提醒队列 store、30秒扫描、全量补漏、dismissed 持久化、去重 |
| `src/frontend/components/ReminderView.svelte` | 提醒 Tab 视图，展示未处理提醒列表 |
| `src/frontend/components/NotificationHost.svelte` | Portal 通知容器，管理浮层通知卡片 |
| `src/frontend/components/NotificationCard.svelte` | 单条通知卡片组件 |
| `src/frontend/utils/audio-player.ts` | 音效播放工具，autoplay 降级 |
| `src/assets/sounds/chime.mp3` | 清脆铃声（默认截止提醒音） |
| `src/assets/sounds/soft.mp3` | 柔和铃声（默认回顾提醒音） |
| `src/assets/sounds/bell.mp3` | 经典铃声 |
| `src/assets/sounds/ping.mp3` | 短促提示 |
| `src/assets/sounds/gentle.mp3` | 轻柔旋律 |

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `src/shared/constants.ts` | 新增 `ATTR_REMINDER`、`REMINDER_DATA_PATH`、`REMINDER_SOUND_IDS` |
| `src/shared/types.ts` | 新增 `ReminderEntry` 类型、`TaskCacheEntry.reminder` 字段 |
| `src/shared/settings.ts` | 新增 `ReminderSettings` 接口、`reminderSettings` 字段、`DEFAULT_REMINDER_SETTINGS`、校验、合并 |
| `src/kernel/task-service.ts` | `buildEntryFromAttrs` 解析 `ATTR_REMINDER`；`removeTask` 清理 `ATTR_REMINDER` |
| `src/kernel/cache-manager.ts` | `loadAll` 解析 `ATTR_REMINDER` |
| `src/kernel/utils.ts` | `validateTaskAttrs` 新增 `ATTR_REMINDER` 的 JSON 数组校验 |
| `src/frontend/constants.ts` | 新增 `VIEW_REMINDER`、扩展 `ViewType` |
| `src/frontend/stores/task-store.ts` | 新增 `tasksWithDueOrReview` 派生、`pendingReminderCount` |
| `src/frontend/components/NextActionApp.svelte` | 注册提醒视图条件渲染、启动扫描定时器 |
| `src/frontend/components/NavRail.svelte` | 新增铃铛图标+徽章、`reminderEnabled` 条件渲染 |
| `src/frontend/components/TaskDetail.svelte` | 截止日期下方显示提前量编辑（三态模型+禁用开关） |
| `src/index.ts` | 挂载 NotificationHost Portal、加载/保存 dismissed 记录 |
| `src/i18n/zh-CN.json` | 新增提醒相关翻译 key |
| `src/i18n/en.json` | 新增提醒相关翻译 key |
| `src/index.scss` | 通知卡片、徽章、提醒视图样式 |
| `vite.config.ts` | 新增 sounds 目录的静态复制规则（或 import 引入） |

---

## 任务 1：共享层 — 常量与类型

**文件：**
- 修改：`src/shared/constants.ts`
- 修改：`src/shared/types.ts`

- [ ] **步骤 1：在 constants.ts 中新增提醒相关常量**

在 `ATTR_REVIEW_DATE` 之后添加：

```typescript
export const ATTR_REMINDER = "custom-na-reminder";
export const REMINDER_DATA_PATH = "dismissed-reminders.json";

// 提醒扫描间隔（毫秒）
export const REMINDER_SCAN_INTERVAL_MS = 30000;

// 回顾提醒触发时间（小时，24小时制）
export const REMINDER_REVIEW_HOUR = 9;

// 通知浮层最大显示数量
export const REMINDER_MAX_VISIBLE = 5;

// dismissed 记录 TTL（毫秒，7天）
export const REMINDER_DISMISSED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// 可用音效 ID 列表
export const REMINDER_SOUND_IDS = ["chime", "soft", "bell", "ping", "gentle"] as const;
export type ReminderSoundId = typeof REMINDER_SOUND_IDS[number];
```

- [ ] **步骤 2：在 types.ts 中新增 ReminderEntry 和 TaskCacheEntry.reminder**

在 `TaskCacheEntry` 接口中 `customFields` 之前添加：

```typescript
reminder: string;           // na-reminder 原始值，空字符串 = 使用全局默认，"[]" = 禁用
```

在 `TaskChangeNotification` 接口之前添加：

```typescript
export interface ReminderEntry {
    blockId: string;
    title: string;
    triggerTime: number;     // 实际触发时间戳（ms）
    type: "due" | "review";  // 截止提醒 or 回顾提醒
    minutesBefore: number;   // 提前了多少分钟（review 类型固定为 0）
    baseDateStr: string;     // 触发基准日期字符串（due 的日期 or reviewDate）
    dismissed: boolean;       // 用户是否已处理
}

export interface DismissedRecord {
    [dedupKey: string]: number;  // 去重键 → dismissed 时间戳
}
```

- [ ] **步骤 3：Commit**

```bash
git add src/shared/constants.ts src/shared/types.ts
git commit -m "feat(reminder): add shared constants and types"
```

---

## 任务 2：共享层 — 设置

**文件：**
- 修改：`src/shared/settings.ts`

- [ ] **步骤 1：新增 ReminderSettings 接口和默认值**

在 `CustomFieldDef` 接口之后添加：

```typescript
export interface ReminderSettings {
    enabled: boolean;
    defaultOffsets: number[];       // 默认提前量（分钟数）
    dueSound: ReminderSoundId;
    reviewSound: ReminderSoundId;
    soundEnabled: boolean;
}
```

在 `DEFAULT_SETTINGS` 之前添加：

```typescript
import { ReminderSoundId } from "./constants";

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
    enabled: true,
    defaultOffsets: [60, 720, 1440, 4320, 7200, 10080],
    dueSound: "chime",
    reviewSound: "soft",
    soundEnabled: true,
};
```

注意：`ReminderSoundId` 从 `constants.ts` 导入，需在文件顶部添加 import。

- [ ] **步骤 2：在 PluginSettings 中新增 reminderSettings 字段**

在 `customFields` 之后添加：

```typescript
reminderSettings: ReminderSettings;
```

在 `DEFAULT_SETTINGS` 中添加：

```typescript
reminderSettings: { ...DEFAULT_REMINDER_SETTINGS },
```

- [ ] **步骤 3：在 validateSettings 中新增 reminderSettings 校验**

在 `customFields` 校验块之后、`return null` 之前添加：

```typescript
const rs = settings.reminderSettings;
if (rs) {
    if (rs.enabled !== undefined && typeof rs.enabled !== "boolean") {
        return "reminderSettings.enabled must be boolean";
    }
    if (rs.defaultOffsets !== undefined) {
        if (!Array.isArray(rs.defaultOffsets)) {
            return "reminderSettings.defaultOffsets must be an array";
        }
        if (rs.defaultOffsets.length > 10) {
            return "reminderSettings.defaultOffsets must have at most 10 items";
        }
        for (const v of rs.defaultOffsets) {
            if (!Number.isInteger(v) || v < 1 || v > 20160) {
                return "reminderSettings.defaultOffsets items must be positive integers <= 20160 (14 days)";
            }
        }
        const unique = new Set(rs.defaultOffsets);
        if (unique.size !== rs.defaultOffsets.length) {
            return "reminderSettings.defaultOffsets must not contain duplicates";
        }
    }
    if (rs.dueSound !== undefined && !REMINDER_SOUND_IDS.includes(rs.dueSound)) {
        return "reminderSettings.dueSound must be one of: " + REMINDER_SOUND_IDS.join(", ");
    }
    if (rs.reviewSound !== undefined && !REMINDER_SOUND_IDS.includes(rs.reviewSound)) {
        return "reminderSettings.reviewSound must be one of: " + REMINDER_SOUND_IDS.join(", ");
    }
    if (rs.soundEnabled !== undefined && typeof rs.soundEnabled !== "boolean") {
        return "reminderSettings.soundEnabled must be boolean";
    }
}
```

- [ ] **步骤 4：在 mergeSettings 中新增 reminderSettings 合并**

在 `customFields` 行之后添加：

```typescript
reminderSettings: {
    ...base.reminderSettings,
    ...(override.reminderSettings ?? {}),
},
```

- [ ] **步骤 5：Commit**

```bash
git add src/shared/settings.ts
git commit -m "feat(reminder): add ReminderSettings to PluginSettings"
```

---

## 任务 3：内核侧 — 属性解析与清理

**文件：**
- 修改：`src/kernel/task-service.ts`
- 修改：`src/kernel/cache-manager.ts`
- 修改：`src/kernel/utils.ts`

- [ ] **步骤 1：在 task-service.ts 的 buildEntryFromAttrs 中解析 ATTR_REMINDER**

在 `reviewDate: attrs[ATTR_REVIEW_DATE] || "",` 之后添加：

```typescript
reminder: attrs[ATTR_REMINDER] || "",
```

- [ ] **步骤 2：在 task-service.ts 的 removeTask 中清理 ATTR_REMINDER**

在 `clearAttrs[ATTR_REVIEW_DATE] = "";` 之后添加：

```typescript
clearAttrs[ATTR_REMINDER] = "";
```

- [ ] **步骤 3：在 cache-manager.ts 的 loadAll 中解析 ATTR_REMINDER**

在 `reviewDate: attrs[ATTR_REVIEW_DATE] || "",` 之后添加：

```typescript
reminder: attrs[ATTR_REMINDER] || "",
```

- [ ] **步骤 4：在 utils.ts 的 validateTaskAttrs 中新增 ATTR_REMINDER 校验**

在现有的 `for` 循环内部、`if (typeof attrs[key] !== "string")` 检查之后添加：

```typescript
if (key === ATTR_REMINDER) {
    const val = attrs[key];
    if (val.trim() !== "") {
        try {
            const parsed = JSON.parse(val);
            if (!Array.isArray(parsed)) {
                return `Invalid attribute value for ${key}: must be a JSON array`;
            }
            for (const item of parsed) {
                if (!Number.isInteger(item) || item < 0) {
                    return `Invalid attribute value for ${key}: array items must be non-negative integers`;
                }
            }
        } catch {
            return `Invalid attribute value for ${key}: must be valid JSON`;
        }
    }
}
```

需要在文件顶部添加 `ATTR_REMINDER` 的 import。

- [ ] **步骤 5：Commit**

```bash
git add src/kernel/task-service.ts src/kernel/cache-manager.ts src/kernel/utils.ts
git commit -m "feat(reminder): kernel-side attribute parsing and cleanup"
```

---

## 任务 4：前端常量与 i18n

**文件：**
- 修改：`src/frontend/constants.ts`
- 修改：`src/i18n/zh-CN.json`
- 修改：`src/i18n/en.json`

- [ ] **步骤 1：在 frontend/constants.ts 中新增 VIEW_REMINDER**

在 `VIEW_REVIEW` 之后添加：

```typescript
export const VIEW_REMINDER = "reminder";
```

更新 `ViewType` 联合类型，在末尾添加 `| typeof VIEW_REMINDER`：

```typescript
export type ViewType = typeof VIEW_NEXT_ACTION | typeof VIEW_ALL_TASKS | typeof VIEW_BY_PROJECT | typeof VIEW_SOMEDAY | typeof VIEW_WAITING | typeof VIEW_MY_DAY | typeof VIEW_STATISTICS | typeof VIEW_REVIEW | typeof VIEW_REMINDER;
```

- [ ] **步骤 2：在 zh-CN.json 中新增提醒相关 key**

在 JSON 最后一个 key 之前添加：

```json
"reminder": "提醒",
"reminderDue": "截止提醒",
"reminderReview": "回顾提醒",
"reminderDueIn": "{n}小时后到期",
"reminderDueInMinutes": "{n}分钟后到期",
"reminderDueInDays": "{n}天后到期",
"reminderReviewToday": "今天需回顾",
"reminderDismiss": "已读",
"reminderDismissAll": "一键已读",
"reminderNoPending": "暂无待处理提醒",
"reminderSettingEnabled": "启用提醒",
"reminderSettingEnabledDesc": "开启后将在截止日期和回顾日期前发出提醒",
"reminderSettingDefaultOffsets": "默认提前量",
"reminderSettingDefaultOffsetsDesc": "提前提醒的时间点列表",
"reminderSettingDueSound": "截止提醒音效",
"reminderSettingReviewSound": "回顾提醒音效",
"reminderSettingSoundEnabled": "音效",
"reminderSettingSoundEnabledDesc": "提醒时播放音效",
"reminderSoundChime": "清脆铃声",
"reminderSoundSoft": "柔和铃声",
"reminderSoundBell": "经典铃声",
"reminderSoundPing": "短促提示",
"reminderSoundGentle": "轻柔旋律",
"reminderSoundPreview": "试听",
"reminderOffsetMinutes": "分钟",
"reminderOffsetHours": "小时",
"reminderOffsetDays": "天",
"reminderAddOffset": "添加提前量",
"reminderRemoveOffset": "删除",
"reminderCustomOffsets": "自定义提前量",
"reminderCustomOffsetsDesc": "此任务的提醒提前量，留空使用全局默认",
"reminderDisabled": "已禁用提醒",
"reminderResetToDefault": "重置为默认",
"reminderUseDefault": "使用默认设置",
"reminderDisableForTask": "禁用此任务提醒"
```

- [ ] **步骤 3：在 en.json 中新增对应英文翻译**

添加与 zh-CN.json 相同 key 的英文翻译：

```json
"reminder": "Reminders",
"reminderDue": "Due Reminder",
"reminderReview": "Review Reminder",
"reminderDueIn": "Due in {n}h",
"reminderDueInMinutes": "Due in {n}min",
"reminderDueInDays": "Due in {n}d",
"reminderReviewToday": "Review today",
"reminderDismiss": "Dismiss",
"reminderDismissAll": "Dismiss All",
"reminderNoPending": "No pending reminders",
"reminderSettingEnabled": "Enable Reminders",
"reminderSettingEnabledDesc": "Show notifications before due dates and on review dates",
"reminderSettingDefaultOffsets": "Default Advance Times",
"reminderSettingDefaultOffsetsDesc": "List of advance times for due reminders",
"reminderSettingDueSound": "Due Reminder Sound",
"reminderSettingReviewSound": "Review Reminder Sound",
"reminderSettingSoundEnabled": "Sound",
"reminderSettingSoundEnabledDesc": "Play sound on reminder",
"reminderSoundChime": "Chime",
"reminderSoundSoft": "Soft",
"reminderSoundBell": "Bell",
"reminderSoundPing": "Ping",
"reminderSoundGentle": "Gentle",
"reminderSoundPreview": "Preview",
"reminderOffsetMinutes": "minutes",
"reminderOffsetHours": "hours",
"reminderOffsetDays": "days",
"reminderAddOffset": "Add advance time",
"reminderRemoveOffset": "Remove",
"reminderCustomOffsets": "Custom Advance Times",
"reminderCustomOffsetsDesc": "Advance times for this task, empty means global default",
"reminderDisabled": "Reminders disabled",
"reminderResetToDefault": "Reset to default",
"reminderUseDefault": "Using default",
"reminderDisableForTask": "Disable reminders for this task"
```

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/constants.ts src/i18n/zh-CN.json src/i18n/en.json
git commit -m "feat(reminder): add VIEW_REMINDER constant and i18n keys"
```

---

## 任务 5：音效资源与播放工具

**文件：**
- 创建：`src/frontend/utils/audio-player.ts`
- 创建：`src/assets/sounds/chime.mp3`（等5个文件）

- [ ] **步骤 1：创建 5 个音效文件**

在 `src/assets/sounds/` 目录下放置 5 个 1-2 秒短铃声 mp3 文件：
- `chime.mp3` — 清脆铃声
- `soft.mp3` — 柔和铃声
- `bell.mp3` — 经典铃声
- `ping.mp3` — 短促提示
- `gentle.mp3` — 轻柔旋律

每个文件目标大小 < 30KB（64kbps mono 编码）。

注意：这些文件需要人工准备或从免费音效库获取。可先创建占位的静音文件进行开发，后续替换为实际音效。

- [ ] **步骤 2：创建 audio-player.ts**

```typescript
import { REMINDER_SOUND_IDS, type ReminderSoundId } from "@shared/constants";

const audioCache: Map<string, HTMLAudioElement> = new Map();
let autoplayUnlocked = false;

function getAudioUrl(soundId: ReminderSoundId): string {
    const map: Record<string, string> = {
        chime: new URL("../../assets/sounds/chime.mp3", import.meta.url).href,
        soft: new URL("../../assets/sounds/soft.mp3", import.meta.url).href,
        bell: new URL("../../assets/sounds/bell.mp3", import.meta.url).href,
        ping: new URL("../../assets/sounds/ping.mp3", import.meta.url).href,
        gentle: new URL("../../assets/sounds/gentle.mp3", import.meta.url).href,
    };
    return map[soundId] || map.chime;
}

export function unlockAutoplay(): void {
    autoplayUnlocked = true;
}

export async function playSound(soundId: ReminderSoundId): Promise<void> {
    try {
        let audio = audioCache.get(soundId);
        if (!audio) {
            audio = new Audio(getAudioUrl(soundId));
            audioCache.set(soundId, audio);
        }
        audio.currentTime = 0;
        await audio.play();
        autoplayUnlocked = true;
    } catch {
        // Autoplay blocked or other audio error — silent fallback
        // Visual notification still shows, only sound is skipped
    }
}

export function isAutoplayUnlocked(): boolean {
    return autoplayUnlocked;
}
```

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/utils/audio-player.ts src/assets/sounds/
git commit -m "feat(reminder): add audio player utility and sound assets"
```

---

## 任务 6：提醒 Store — 核心扫描与补漏逻辑

**文件：**
- 创建：`src/frontend/stores/reminder-store.ts`
- 修改：`src/frontend/stores/task-store.ts`

- [ ] **步骤 1：在 task-store.ts 中新增 tasksWithDueOrReview 派生**

在 task-store.ts 中添加一个派生 store，仅包含有 due 或 reviewDate 的任务（提醒扫描用，避免全量遍历）：

```typescript
export const tasksWithDueOrReview = derived(allTasks, ($allTasks) => {
    return $allTasks.filter(t => (t.due && t.status !== "done" && t.status !== "someday") || (t.reviewDate && t.status !== "done"));
});
```

同时添加 `pendingReminderCount` 导出（供 NavRail 徽章使用）：

```typescript
export const pendingReminderCount = writable(0);
```

- [ ] **步骤 2：创建 reminder-store.ts**

```typescript
import { writable, derived, get } from "svelte/store";
import { taskStore, tasksWithDueOrReview, pendingReminderCount } from "./task-store";
import {
    REMINDER_SCAN_INTERVAL_MS,
    REMINDER_REVIEW_HOUR,
    REMINDER_MAX_VISIBLE,
    REMINDER_DISMISSED_TTL_MS,
    REMINDER_DATA_PATH,
    type ReminderSoundId,
} from "@shared/constants";
import type { ReminderEntry, DismissedRecord, TaskCacheEntry } from "@shared/types";
import type { Plugin } from "siyuan";
import { playSound } from "../utils/audio-player";

// --- Store 状态 ---
export const reminderEntries = writable<ReminderEntry[]>([]);
export const dismissedKeys = writable<Set<string>>(new Set());

let scanInterval: ReturnType<typeof setInterval> | null = null;
let pluginRef: Plugin | null = null;

// --- 工具函数 ---
function getEffectiveOffsets(entry: TaskCacheEntry): number[] {
    const rs = get(taskStore).settings?.reminderSettings;
    if (!rs || !rs.enabled) return [];
    const raw = entry.reminder;
    if (raw === undefined || raw === "") return rs.defaultOffsets;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed as number[];
    } catch {
        return [];
    }
}

function parseDateToMs(dateStr: string, hour: number = 0): number {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d, hour, 0, 0, 0).getTime();
}

function buildDedupKey(blockId: string, baseDateStr: string, minutesBefore: number, type: "due" | "review"): string {
    return `${blockId}|${baseDateStr}|${minutesBefore}|${type}`;
}

function formatOffsetText(minutes: number, i18n: any): string {
    if (minutes >= 1440 && minutes % 1440 === 0) {
        const days = minutes / 1440;
        return (i18n?.reminderDueInDays || "{n}天后到期").replace("{n}", String(days));
    }
    if (minutes >= 60 && minutes % 60 === 0) {
        const hours = minutes / 60;
        return (i18n?.reminderDueIn || "{n}小时后到期").replace("{n}", String(hours));
    }
    return (i18n?.reminderDueInMinutes || "{n}分钟后到期").replace("{n}", String(minutes));
}

// --- 持久化 dismissed ---
async function loadDismissed(): Promise<DismissedRecord> {
    if (!pluginRef) return {};
    try {
        const data = await pluginRef.loadData(REMINDER_DATA_PATH);
        return (data as DismissedRecord) || {};
    } catch {
        return {};
    }
}

async function saveDismissed(record: DismissedRecord): Promise<void> {
    if (!pluginRef) return;
    try {
        await pluginRef.saveData(REMINDER_DATA_PATH, record);
    } catch {
        // 保存失败不影响主流程
    }
}

function cleanupExpiredDismissed(record: DismissedRecord): DismissedRecord {
    const now = Date.now();
    const result: DismissedRecord = {};
    for (const [key, ts] of Object.entries(record)) {
        if (now - ts < REMINDER_DISMISSED_TTL_MS) {
            result[key] = ts;
        }
    }
    return result;
}

// --- 扫描逻辑 ---
function scanReminders(): void {
    const state = get(taskStore);
    const rs = state.settings?.reminderSettings;
    if (!rs || !rs.enabled) return;

    const now = Date.now();
    const tasks = get(tasksWithDueOrReview);
    const currentDismissed = get(dismissedKeys);
    const newEntries: ReminderEntry[] = [...get(reminderEntries).filter(e => !e.dismissed)];

    for (const task of tasks) {
        // 截止提醒
        if (task.due && task.status !== "done" && task.status !== "someday") {
            const offsets = getEffectiveOffsets(task);
            const dueDateStr = task.due.includes("T") ? task.due.split("T")[0] : task.due;
            const dueTimeStr = task.due.includes("T") ? task.due : task.due + "T23:59:59";
            const dueMs = new Date(dueTimeStr).getTime();

            for (const offset of offsets) {
                const triggerTime = dueMs - offset * 60000;
                if (triggerTime > now) continue; // 还没到触发时间

                const dedupKey = buildDedupKey(task.blockId, dueDateStr, offset, "due");
                if (currentDismissed.has(dedupKey)) continue;

                // 触发前最终检查：任务是否已完成
                const freshTask = get(taskStore).allTasks.find(t => t.blockId === task.blockId);
                if (!freshTask || freshTask.status === "done") continue;

                // 是否已存在同一条目
                if (newEntries.some(e => e.blockId === task.blockId && e.baseDateStr === dueDateStr && e.minutesBefore === offset && e.type === "due")) continue;

                newEntries.push({
                    blockId: task.blockId,
                    title: task.title,
                    triggerTime,
                    type: "due",
                    minutesBefore: offset,
                    baseDateStr: dueDateStr,
                    dismissed: false,
                });

                // 弹通知
                triggerNotification(task.title, "due", offset, task.blockId);
            }
        }

        // 回顾提醒
        if (task.reviewDate && task.status !== "done") {
            const triggerTime = parseDateToMs(task.reviewDate, REMINDER_REVIEW_HOUR);
            if (triggerTime > now) continue;

            const dedupKey = buildDedupKey(task.blockId, task.reviewDate, 0, "review");
            if (currentDismissed.has(dedupKey)) continue;

            const freshTask = get(taskStore).allTasks.find(t => t.blockId === task.blockId);
            if (!freshTask || freshTask.status === "done") continue;

            if (newEntries.some(e => e.blockId === task.blockId && e.baseDateStr === task.reviewDate && e.type === "review")) continue;

            newEntries.push({
                blockId: task.blockId,
                title: task.title,
                triggerTime,
                type: "review",
                minutesBefore: 0,
                baseDateStr: task.reviewDate,
                dismissed: false,
            });

            triggerNotification(task.title, "review", 0, task.blockId);
        }
    }

    reminderEntries.set(newEntries);
    const pending = newEntries.filter(e => !e.dismissed);
    pendingReminderCount.set(pending.length);
}

// --- 通知触发 ---
const notificationQueue = writable<{title: string; type: "due" | "review"; minutesBefore: number; blockId: string}[]>([]);

function triggerNotification(title: string, type: "due" | "review", minutesBefore: number, blockId: string): void {
    const rs = get(taskStore).settings?.reminderSettings;
    if (!rs || !rs.enabled) return;

    notificationQueue.update(q => [...q, { title, type, minutesBefore, blockId }]);

    // 播放音效
    if (rs.soundEnabled) {
        const soundId = type === "due" ? rs.dueSound : rs.reviewSound;
        playSound(soundId);
    }
}

// --- 用户操作 ---
export async function dismissReminder(dedupKey: string): Promise<void> {
    const current = get(reminderEntries);
    const entry = current.find(e => buildDedupKey(e.blockId, e.baseDateStr, e.minutesBefore, e.type) === dedupKey);
    if (!entry) return;

    entry.dismissed = true;
    reminderEntries.set([...current]);
    pendingReminderCount.set(current.filter(e => !e.dismissed).length);

    dismissedKeys.update(set => {
        set.add(dedupKey);
        return set;
    });

    // 持久化
    const record = await loadDismissed();
    record[dedupKey] = Date.now();
    const cleaned = cleanupExpiredDismissed(record);
    await saveDismissed(cleaned);
}

export async function dismissAllReminders(): Promise<void> {
    const current = get(reminderEntries);
    const now = Date.now();
    const newDismissed: Record<string, number> = {};

    for (const entry of current) {
        if (!entry.dismissed) {
            entry.dismissed = true;
            const key = buildDedupKey(entry.blockId, entry.baseDateStr, entry.minutesBefore, entry.type);
            newDismissed[key] = now;
        }
    }

    reminderEntries.set([...current]);
    pendingReminderCount.set(0);

    const record = await loadDismissed();
    Object.assign(record, newDismissed);
    const cleaned = cleanupExpiredDismissed(record);
    await saveDismissed(cleaned);

    dismissedKeys.update(set => {
        for (const key of Object.keys(newDismissed)) {
            set.add(key);
        }
        return set;
    });
}

// --- 生命周期 ---
export async function initReminderStore(plugin: Plugin): Promise<void> {
    pluginRef = plugin;

    // 加载 dismissed 记录
    const record = await loadDismissed();
    const cleaned = cleanupExpiredDismissed(record);
    await saveDismissed(cleaned);
    dismissedKeys.set(new Set(Object.keys(cleaned)));

    // 立即执行一次全量扫描
    scanReminders();

    // 启动定时器
    scanInterval = setInterval(scanReminders, REMINDER_SCAN_INTERVAL_MS);
}

export function destroyReminderStore(): void {
    if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
    }
    pluginRef = null;
}

export { notificationQueue };
```

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/stores/reminder-store.ts src/frontend/stores/task-store.ts
git commit -m "feat(reminder): add reminder store with scan, backfill, and dismiss logic"
```

---

## 任务 7：通知 UI — NotificationCard 与 NotificationHost

**文件：**
- 创建：`src/frontend/components/NotificationCard.svelte`
- 创建：`src/frontend/components/NotificationHost.svelte`

- [ ] **步骤 1：创建 NotificationCard.svelte**

```svelte
<script lang="ts">
    import { fly } from "svelte/transition";
    import { fade } from "svelte/transition";
    import { jumpToBlock } from "../utils";

    export let title: string;
    export let type: "due" | "review";
    export let message: string;
    export let blockId: string;
    export let onDismiss: () => void;

    function handleClick() {
        jumpToBlock(blockId);
    }
</script>

<div class="na-notification-card" transition:fly={{ x: 200, duration: 250 }}>
    <div class="na-notification-card__header">
        <span class="na-notification-card__type na-notification-card__type--{type}">
            {type === "due" ? "截止提醒" : "回顾提醒"}
        </span>
        <button class="na-notification-card__close" on:click={onDismiss} title="已读">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>
            </svg>
        </button>
    </div>
    <div class="na-notification-card__title" on:click={handleClick} role="button" tabindex="0">
        {title}
    </div>
    <div class="na-notification-card__message">{message}</div>
</div>
```

- [ ] **步骤 2：创建 NotificationHost.svelte**

```svelte
<script lang="ts">
    import { notificationQueue, dismissReminder, dismissAllReminders } from "../stores/reminder-store";
    import { taskStore } from "../stores/task-store";
    import NotificationCard from "./NotificationCard.svelte";
    import { REMINDER_MAX_VISIBLE } from "@shared/constants";

    $: visibleNotifications = $notificationQueue.slice(-REMINDER_MAX_VISIBLE);
    $: hasNotifications = $notificationQueue.length > 0;
    $: overflowCount = Math.max(0, $notificationQueue.length - REMINDER_MAX_VISIBLE);

    function getDedupKey(item: {blockId: string; type: string; minutesBefore: number}): string {
        // 简化：在 notificationQueue 中无法直接拿到 baseDateStr，用 blockId+type+minutesBefore
        // 实际去重在 reminder-store 的 scanReminders 中已保证
        return `${item.blockId}|${item.type}|${item.minutesBefore}`;
    }

    function handleDismiss(item: {blockId: string; type: "due" | "review"; minutesBefore: number; title: string}, index: number) {
        // 从队列中移除该项并 dismiss
        notificationQueue.update(q => q.filter((_, i) => i !== index));
        // 同时在 reminderEntries 中标记 dismissed
        const key = getDedupKey(item);
        dismissReminder(key);
    }

    function handleDismissAll() {
        dismissAllReminders();
        notificationQueue.set([]);
    }

    function getMessage(item: {type: "due" | "review"; minutesBefore: number}): string {
        const i18n = $taskStore.settings;
        if (item.type === "review") return "今天需回顾";
        if (item.minutesBefore >= 1440 && item.minutesBefore % 1440 === 0) {
            return `${item.minutesBefore / 1440}天后到期`;
        }
        if (item.minutesBefore >= 60 && item.minutesBefore % 60 === 0) {
            return `${item.minutesBefore / 60}小时后到期`;
        }
        return `${item.minutesBefore}分钟后到期`;
    }
</script>

{#if hasNotifications}
    <div class="na-notification-host">
        {#each visibleNotifications as item, i}
            <NotificationCard
                title={item.title}
                type={item.type}
                message={getMessage(item)}
                blockId={item.blockId}
                onDismiss={() => handleDismiss(item, $notificationQueue.length - REMINDER_MAX_VISIBLE + i)}
            />
        {/each}
        {#if overflowCount > 0}
            <div class="na-notification-host__overflow">还有 {overflowCount} 条提醒</div>
        {/if}
        <button class="na-notification-host__dismiss-all" on:click={handleDismissAll}>
            一键已读
        </button>
    </div>
{/if}
```

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/NotificationCard.svelte src/frontend/components/NotificationHost.svelte
git commit -m "feat(reminder): add NotificationCard and NotificationHost components"
```

---

## 任务 8：提醒 Tab 视图

**文件：**
- 创建：`src/frontend/components/ReminderView.svelte`

- [ ] **步骤 1：创建 ReminderView.svelte**

```svelte
<script lang="ts">
    import { reminderEntries, dismissReminder, dismissAllReminders } from "../stores/reminder-store";
    import { taskStore } from "../stores/task-store";
    import { jumpToBlock } from "../utils";

    $: pendingReminders = $reminderEntries
        .filter(e => !e.dismissed)
        .sort((a, b) => a.triggerTime - b.triggerTime);

    $: hasPending = pendingReminders.length > 0;

    function getTypeLabel(type: "due" | "review"): string {
        return type === "due" ? "截止提醒" : "回顾提醒";
    }

    function getDescription(entry): string {
        if (entry.type === "review") return "今天需回顾";
        if (entry.minutesBefore >= 1440 && entry.minutesBefore % 1440 === 0) {
            return `${entry.minutesBefore / 1440}天后到期`;
        }
        if (entry.minutesBefore >= 60 && entry.minutesBefore % 60 === 0) {
            return `${entry.minutesBefore / 60}小时后到期`;
        }
        return `${entry.minutesBefore}分钟后到期`;
    }

    function getDedupKey(entry): string {
        return `${entry.blockId}|${entry.baseDateStr}|${entry.minutesBefore}|${entry.type}`;
    }

    function handleJump(blockId: string) {
        jumpToBlock(blockId);
    }
</script>

<div class="na-reminder-view">
    {#if hasPending}
        <div class="na-reminder-view__list">
            {#each pendingReminders as entry}
                <div class="na-reminder-view__item">
                    <div class="na-reminder-view__item-header">
                        <span class="na-reminder-view__type na-reminder-view__type--{entry.type}">
                            {getTypeLabel(entry.type)}
                        </span>
                        <button class="na-reminder-view__dismiss" on:click={() => dismissReminder(getDedupKey(entry))}>
                            已读
                        </button>
                    </div>
                    <div class="na-reminder-view__title" on:click={() => handleJump(entry.blockId)} role="button" tabindex="0">
                        {entry.title}
                    </div>
                    <div class="na-reminder-view__desc">{getDescription(entry)}</div>
                </div>
            {/each}
        </div>
        <div class="na-reminder-view__footer">
            <button class="na-reminder-view__dismiss-all" on:click={dismissAllReminders}>
                一键已读
            </button>
        </div>
    {:else}
        <div class="na-reminder-view__empty">暂无待处理提醒</div>
    {/if}
</div>
```

- [ ] **步骤 2：Commit**

```bash
git add src/frontend/components/ReminderView.svelte
git commit -m "feat(reminder): add ReminderView component"
```

---

## 任务 9：NavRail 集成 — 铃铛图标与徽章

**文件：**
- 修改：`src/frontend/components/NavRail.svelte`

- [ ] **步骤 1：导入 VIEW_REMINDER 和 pendingReminderCount**

在 import 行中添加 `VIEW_REMINDER`：

```typescript
import { VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY, VIEW_WAITING, VIEW_STATISTICS, VIEW_MY_DAY, VIEW_REVIEW, VIEW_REMINDER } from "../constants";
```

添加 `pendingReminderCount` 导入：

```typescript
import { taskStore, pendingReminderCount } from "../stores/task-store";
```

- [ ] **步骤 2：新增 reminderEnabled 响应式变量**

在 `myDayEnabled` 行之后添加：

```typescript
$: reminderEnabled = $taskStore.settings?.reminderSettings?.enabled !== false;
```

- [ ] **步骤 3：在 allNavItems 中新增提醒 Tab**

在 `{ view: VIEW_STATISTICS, ... }` 之后添加：

```typescript
{ view: VIEW_REMINDER, icon: "reminder", label: i18n?.reminder || "Reminders", requiresReminder: true },
```

- [ ] **步骤 4：更新 navItems 过滤逻辑**

```typescript
$: navItems = allNavItems.filter(item => {
    if (item.requiresMyDay && !myDayEnabled) return false;
    if (item.requiresReminder && !reminderEnabled) return false;
    return true;
});
```

需要给 myDay 的 item 也加上 `requiresMyDay: true` 属性（当前已有）。

- [ ] **步骤 5：添加铃铛图标 SVG 和徽章**

在 `{:else if item.icon === "review"}` 块之后、`{:else}` 之前添加：

```svelte
{:else if item.icon === "reminder"}
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 2C7.24 2 5 4.24 5 7v4l-2 2h14l-2-2V7c0-2.76-2.24-5-5-5z"/>
        <path d="M8 15a2 2 0 0 0 4 0"/>
    </svg>
```

在 review 徽章的 `{/if}` 之后添加：

```svelte
{#if item.icon === "reminder" && $pendingReminderCount > 0}
    <span class="na-nav-rail__badge na-nav-rail__badge--reminder">{$pendingReminderCount}</span>
{/if}
```

- [ ] **步骤 6：Commit**

```bash
git add src/frontend/components/NavRail.svelte
git commit -m "feat(reminder): add reminder tab to NavRail with bell icon and badge"
```

---

## 任务 10：NextActionApp 视图注册

**文件：**
- 修改：`src/frontend/components/NextActionApp.svelte`

- [ ] **步骤 1：导入 VIEW_REMINDER 和 ReminderView**

在 import 区域添加：

```typescript
import { VIEW_REMINDER } from "../constants";
import ReminderView from "./ReminderView.svelte";
```

- [ ] **步骤 2：在视图条件渲染中添加提醒分支**

在最后一个视图分支（review 或 statistics）之后添加：

```svelte
{:else if activeView === VIEW_REMINDER}
    <ReminderView i18n={i18n} />
```

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/NextActionApp.svelte
git commit -m "feat(reminder): register ReminderView in NextActionApp"
```

---

## 任务 11：插件入口集成

**文件：**
- 修改：`src/index.ts`

- [ ] **步骤 1：导入 reminder-store 生命周期函数和 NotificationHost**

```typescript
import { initReminderStore, destroyReminderStore } from "./frontend/stores/reminder-store";
import NotificationHost from "./frontend/components/NotificationHost.svelte";
```

- [ ] **步骤 2：在 onLayoutReady 中初始化提醒 store**

在现有的 onLayoutReady 回调中添加：

```typescript
await initReminderStore(this);
```

- [ ] **步骤 3：在 onunload 中销毁提醒 store**

在现有的 onunload 回调中添加：

```typescript
destroyReminderStore();
```

- [ ] **步骤 4：挂载 NotificationHost Portal**

在插件初始化时（onload 或 onLayoutReady 中），创建 NotificationHost 并挂载到 body：

```typescript
const notificationHost = new NotificationHost({
    target: document.body,
});
```

保存引用以便 onunload 时销毁：

```typescript
this.notificationHost = notificationHost;
```

在 onunload 中：

```typescript
if (this.notificationHost) {
    this.notificationHost.$destroy();
    this.notificationHost = null;
}
```

- [ ] **步骤 5：Commit**

```bash
git add src/index.ts
git commit -m "feat(reminder): integrate reminder store and NotificationHost into plugin lifecycle"
```

---

## 任务 12：TaskDetail 提醒编辑

**文件：**
- 修改：`src/frontend/components/TaskDetail.svelte`

- [ ] **步骤 1：在截止日期区域下方添加提醒设置**

找到截止日期（due）字段的 UI 代码区域，在其后添加提醒提前量编辑区域。实现三态模型：

- 无截止日期时隐藏
- 有截止日期但无自定义提前量时，显示"使用默认设置"灰色标注
- 有自定义提前量时，显示可编辑列表

添加一个"禁用提醒"开关和"重置为默认"按钮。

当用户修改提前量后，通过 `kernelBridge.updateTask(blockId, { "na-reminder": JSON.stringify(offsets) })` 保存。

当删除截止日期时，同时清除 `na-reminder` 属性。

具体实现需要根据 TaskDetail.svelte 中现有的 due 字段代码结构来调整，确保防抖保存（与现有字段一致）。

- [ ] **步骤 2：Commit**

```bash
git add src/frontend/components/TaskDetail.svelte
git commit -m "feat(reminder): add reminder offset editing to TaskDetail (three-state model)"
```

---

## 任务 13：设置面板 — 提醒分区

**文件：**
- 修改：`src/frontend/components/SettingsView.svelte`（或对应的设置组件）

- [ ] **步骤 1：在设置面板中新增"提醒"分区**

包含：
1. 总开关 toggle（`reminderSettings.enabled`）
2. 默认提前量列表（可增删改，数值 + 单位下拉）
3. 截止提醒音效选择器 + 试听按钮
4. 回顾提醒音效选择器 + 试听按钮
5. 音效开关 toggle

试听按钮调用 `playSound(soundId)` 并调用 `unlockAutoplay()` 解锁浏览器 autoplay。

设置变更后通过 `kernelBridge.updateSettings(settings)` 保存。

- [ ] **步骤 2：Commit**

```bash
git add src/frontend/components/SettingsView.svelte
git commit -m "feat(reminder): add reminder settings section"
```

---

## 任务 14：样式

**文件：**
- 修改：`src/index.scss`

- [ ] **步骤 1：添加通知卡片、徽章和提醒视图样式**

在文件末尾添加以下 BEM 风格样式（使用 `--na-*` 和 `--b3-*` CSS 变量）：

```scss
// Notification Host
.na-notification-host {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 320px;
}

.na-notification-host__overflow {
    font-size: 12px;
    color: var(--b3-theme-on-surface);
    opacity: 0.6;
    text-align: center;
    padding: 4px 0;
}

.na-notification-host__dismiss-all {
    width: 100%;
    padding: 6px;
    font-size: 12px;
    color: var(--na-accent);
    background: var(--b3-theme-surface);
    border: 1px solid var(--b3-theme-on-surface);
    border-radius: 4px;
    cursor: pointer;
    opacity: 0.8;
    &:hover { opacity: 1; }
}

// Notification Card
.na-notification-card {
    background: var(--b3-theme-surface);
    border: 1px solid var(--b3-theme-on-surface);
    border-radius: 6px;
    padding: 10px 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}

.na-notification-card__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
}

.na-notification-card__type {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
    &--due { background: rgba(231, 76, 60, 0.15); color: var(--na-priority-critical, #e74c3c); }
    &--review { background: rgba(93, 173, 226, 0.15); color: var(--na-priority-medium, #5dade2); }
}

.na-notification-card__close {
    background: none;
    border: none;
    color: var(--b3-theme-on-surface);
    opacity: 0.5;
    cursor: pointer;
    padding: 2px;
    &:hover { opacity: 1; }
}

.na-notification-card__title {
    font-size: 13px;
    font-weight: 500;
    color: var(--b3-theme-on-surface);
    cursor: pointer;
    &:hover { text-decoration: underline; }
}

.na-notification-card__message {
    font-size: 12px;
    color: var(--b3-theme-on-surface);
    opacity: 0.7;
    margin-top: 2px;
}

// NavRail reminder badge
.na-nav-rail__badge--reminder {
    background: var(--na-priority-critical, #e74c3c);
}

// Reminder View
.na-reminder-view {
    padding: 12px 16px;
    height: 100%;
    overflow-y: auto;
}

.na-reminder-view__list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.na-reminder-view__item {
    padding: 10px 12px;
    border: 1px solid var(--b3-theme-on-surface);
    border-radius: 6px;
    opacity: 0.15;
    background: var(--b3-theme-surface);
}

.na-reminder-view__item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
}

.na-reminder-view__type {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
    &--due { background: rgba(231, 76, 60, 0.15); color: var(--na-priority-critical, #e74c3c); }
    &--review { background: rgba(93, 173, 226, 0.15); color: var(--na-priority-medium, #5dade2); }
}

.na-reminder-view__dismiss {
    font-size: 11px;
    color: var(--na-accent);
    background: none;
    border: 1px solid var(--na-accent);
    border-radius: 3px;
    padding: 1px 8px;
    cursor: pointer;
    opacity: 0.7;
    &:hover { opacity: 1; }
}

.na-reminder-view__title {
    font-size: 13px;
    font-weight: 500;
    color: var(--b3-theme-on-surface);
    cursor: pointer;
    &:hover { text-decoration: underline; }
}

.na-reminder-view__desc {
    font-size: 12px;
    color: var(--b3-theme-on-surface);
    opacity: 0.6;
    margin-top: 2px;
}

.na-reminder-view__footer {
    margin-top: 12px;
    text-align: center;
}

.na-reminder-view__dismiss-all {
    padding: 6px 16px;
    font-size: 12px;
    color: var(--na-accent);
    background: var(--b3-theme-surface);
    border: 1px solid var(--na-accent);
    border-radius: 4px;
    cursor: pointer;
    opacity: 0.8;
    &:hover { opacity: 1; }
}

.na-reminder-view__empty {
    text-align: center;
    padding: 40px 0;
    color: var(--b3-theme-on-surface);
    opacity: 0.4;
    font-size: 14px;
}
```

- [ ] **步骤 2：Commit**

```bash
git add src/index.scss
git commit -m "feat(reminder): add notification, badge, and reminder view styles"
```

---

## 任务 15：Vite 构建配置

**文件：**
- 修改：`vite.config.ts`

- [ ] **步骤 1：确保 mp3 文件通过 import 可被 Vite 处理**

Vite 默认支持 mp3 作为 asset，通过 `import` 或 `new URL()` 引用时会被处理。`audio-player.ts` 中使用 `new URL("../../assets/sounds/chime.mp3", import.meta.url).href` 模式，Vite 会自动处理。

检查 `vite.config.ts` 中 `assetsInclude` 配置是否需要添加 mp3：

```typescript
assetsInclude: ['**/*.mp3'],
```

如已有或默认支持则无需修改。

- [ ] **步骤 2：Commit**

```bash
git add vite.config.ts
git commit -m "feat(reminder): configure Vite for mp3 asset handling"
```

---

## 任务 16：集成验证与修复

**文件：** 可能涉及上述所有文件

- [ ] **步骤 1：构建验证**

```bash
pnpm run build
```

预期：构建成功，无 TypeScript 错误，无 import 错误。

- [ ] **步骤 2：部署验证**

```bash
pnpm run release
```

预期：插件部署到思源插件目录，重启思源后插件加载无报错。

- [ ] **步骤 3：功能验证清单**

手动验证以下场景：
1. 有截止日期的任务，默认提前量提醒是否触发
2. 提醒 Tab 显示未处理提醒列表
3. NavRail 铃铛图标显示徽章数字
4. 点击通知卡片可跳转到任务
5. 单条已读和一键已读正常工作
6. dismiss 后刷新页面不会重复弹出
7. 任务完成/删除后不再触发提醒
8. 设置中关闭提醒后 Tab 隐藏
9. 音效试听按钮可用
10. 回顾提醒在 reviewDate 当天 09:00 触发
11. 重复任务完成后 due 更新，新周期提醒正常触发
12. someday 状态任务不触发提醒

- [ ] **步骤 4：修复发现的问题并 Commit**

```bash
git add -A
git commit -m "fix(reminder): integration test fixes"
```
