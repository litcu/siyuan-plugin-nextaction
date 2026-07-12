# 提醒功能增强 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 增强提醒功能的交互便捷性（右键菜单+铃铛图标+弹窗管理）和模型灵活性（固定时间提醒，与截止日期脱钩）

**架构：** 数据模型从纯偏移量数组迁移为结构化 JSON（relative + absolute），新增 ReminderPopup.svelte 弹窗组件作为统一提醒管理入口，替换 TaskDetail 中的内联提醒编辑。右键菜单和铃铛图标都打开同一弹窗。扫描逻辑扩展以支持 absolute 类型提醒。

**技术栈：** Svelte + TypeScript，思源 Dialog API，NaDatePicker 复用

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `src/shared/types.ts` | 新增 ReminderRelative/ReminderAbsolute/ReminderItem 类型，扩展 ReminderEntry.type |
| 修改 | `src/shared/constants.ts` | 新增 REMINDER_MAX_PER_TASK = 7 常量 |
| 修改 | `src/shared/settings.ts` | 无变化（defaultOffsets 仍作为预设来源） |
| 修改 | `src/kernel/utils.ts` | 更新 ATTR_REMINDER 验证，支持结构化 JSON |
| 创建 | `src/frontend/utils/reminder-utils.ts` | 解析/迁移/序列化提醒属性，formatReminderDescription |
| 修改 | `src/frontend/stores/reminder-store.ts` | 重构扫描逻辑支持 absolute，更新 getEffectiveReminders/dedupKey |
| 修改 | `src/frontend/stores/task-store.ts` | 扩展 tasksWithDueOrReview 包含有 absolute 提醒的任务 |
| 创建 | `src/frontend/components/ReminderPopup.svelte` | 提醒设置弹窗（已设列表+添加固定时间+截止前预设） |
| 修改 | `src/frontend/components/TaskDetail.svelte` | 移除旧提醒 UI，新增铃铛图标，打开 ReminderPopup |
| 修改 | `src/frontend/components/task-context-menu.ts` | 添加"添加提醒"菜单项 |
| 修改 | `src/frontend/components/NotificationCard.svelte` | type 支持 "absolute" |
| 修改 | `src/frontend/components/NotificationHost.svelte` | getMessage 支持 absolute 类型 |
| 修改 | `src/frontend/components/ReminderView.svelte` | getDescription/typeLabel 支持 absolute |
| 修改 | `src/i18n/zh-CN.json` | 新增 i18n key |
| 修改 | `src/i18n/en.json` | 新增 i18n key |
| 修改 | `src/index.scss` | ReminderPopup 样式 |

---

### 任务 1：数据模型与工具函数

**文件：**
- 修改：`src/shared/types.ts:32-41`
- 修改：`src/shared/constants.ts:47-48`
- 创建：`src/frontend/utils/reminder-utils.ts`

- [ ] **步骤 1：在 types.ts 中新增 ReminderItem 类型并扩展 ReminderEntry**

在 `src/shared/types.ts` 中，在 `ReminderEntry` 接口之前添加：

```typescript
export interface ReminderRelative {
    type: "relative";
    minutes: number;
}

export interface ReminderAbsolute {
    type: "absolute";
    time: string;       // "YYYY-MM-DDTHH:mm"
}

export type ReminderItem = ReminderRelative | ReminderAbsolute;
```

修改 `ReminderEntry` 的 `type` 字段：

```typescript
export interface ReminderEntry {
    blockId: string;
    title: string;
    triggerTime: number;
    type: "due" | "review" | "absolute";  // 新增 "absolute"
    minutesBefore: number;
    baseDateStr: string;
    dueTime: number;
    dismissed: boolean;
}
```

- [ ] **步骤 2：在 constants.ts 中新增常量**

在 `src/shared/constants.ts` 的 `ATTR_REMINDER` 相关区域添加：

```typescript
export const REMINDER_MAX_PER_TASK = 7;
```

- [ ] **步骤 3：创建 reminder-utils.ts 工具函数**

创建 `src/frontend/utils/reminder-utils.ts`：

```typescript
import type { ReminderItem, ReminderRelative, ReminderAbsolute } from "../../shared/types";

/**
 * Parse the raw `custom-na-reminder` attribute value into ReminderItem[].
 * Handles backward compatibility:
 *   ""         → []
 *   "enabled"  → []
 *   "[60,1440]" → [{type:"relative",minutes:60},{type:"relative",minutes:1440}]
 *   '[{"type":"relative","minutes":60}]' → as-is
 */
export function parseReminderItems(raw: string): ReminderItem[] {
    if (!raw || raw === "enabled" || raw === "[]") return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        // Old format: array of numbers → migrate
        if (parsed.length > 0 && typeof parsed[0] === "number") {
            return parsed
                .filter((v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0)
                .map((v: number) => ({ type: "relative" as const, minutes: v }));
        }

        // New format: array of ReminderItem
        const items: ReminderItem[] = [];
        for (const item of parsed) {
            if (!item || typeof item !== "object") continue;
            if (item.type === "relative" && typeof item.minutes === "number" && Number.isInteger(item.minutes) && item.minutes > 0) {
                items.push({ type: "relative", minutes: item.minutes });
            } else if (item.type === "absolute" && typeof item.time === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(item.time)) {
                items.push({ type: "absolute", time: item.time });
            }
        }
        return items;
    } catch {
        return [];
    }
}

/** Serialize ReminderItem[] back to the attribute string. Returns "" for empty array. */
export function serializeReminderItems(items: ReminderItem[]): string {
    if (items.length === 0) return "";
    return JSON.stringify(items);
}

/** Format a ReminderItem into a human-readable description string. */
export function formatReminderDescription(item: ReminderItem, i18n?: any): string {
    if (item.type === "absolute") {
        // "7月15日 09:00"
        const d = new Date(item.time);
        const month = d.getMonth() + 1;
        const day = d.getDate();
        const h = String(d.getHours()).padStart(2, "0");
        const m = String(d.getMinutes()).padStart(2, "0");
        return `${month}${i18n?.reminderMonth || "月"}${day}${i18n?.reminderDay || "日"} ${h}:${m}`;
    }
    // relative
    const mins = item.minutes;
    if (mins % 1440 === 0) {
        const d = mins / 1440;
        return `${d}${i18n?.reminderOffsetDays || "天"}${i18n?.reminderBeforeDue || "前截止"}`;
    }
    if (mins % 60 === 0) {
        const h = mins / 60;
        return `${h}${i18n?.reminderOffsetHours || "小时"}${i18n?.reminderBeforeDue || "前截止"}`;
    }
    return `${mins}${i18n?.reminderOffsetMinutes || "分钟"}${i18n?.reminderBeforeDue || "前截止"}`;
}

/** Format minutes into short offset string (e.g. "1d", "2h", "30m") */
export function formatOffset(minutes: number, i18n?: any): string {
    if (minutes % 1440 === 0) {
        return `${minutes / 1440}${i18n?.reminderOffsetDays || "d"}`;
    }
    if (minutes % 60 === 0) {
        return `${minutes / 60}${i18n?.reminderOffsetHours || "h"}`;
    }
    return `${minutes}${i18n?.reminderOffsetMinutes || "m"}`;
}
```

- [ ] **步骤 4：构建验证**

运行：`pnpm run build`
预期：编译通过，无类型错误

- [ ] **步骤 5：Commit**

```bash
git add src/shared/types.ts src/shared/constants.ts src/frontend/utils/reminder-utils.ts
git commit -m "feat(reminder): add ReminderItem types and parse/serialize utilities"
```

---

### 任务 2：内核验证更新

**文件：**
- 修改：`src/kernel/utils.ts:56-73`

- [ ] **步骤 1：更新 validateTaskAttrs 中 ATTR_REMINDER 的验证规则**

替换 `src/kernel/utils.ts` 中 ATTR_REMINDER 的验证块（约第 56-73 行）：

```typescript
        if (key === ATTR_REMINDER) {
            const val = attrs[key];
            if (val.trim() !== "") {
                try {
                    const parsed = JSON.parse(val);
                    if (!Array.isArray(parsed)) {
                        return `Invalid attribute value for ${key}: must be a JSON array`;
                    }
                    if (parsed.length > 7) {
                        return `Invalid attribute value for ${key}: array length must be <= 7`;
                    }
                    // Old format: array of numbers — still accepted
                    if (parsed.length > 0 && typeof parsed[0] === "number") {
                        for (const item of parsed) {
                            if (!Number.isInteger(item) || item < 0) {
                                return `Invalid attribute value for ${key}: array items must be non-negative integers`;
                            }
                        }
                    } else {
                        // New format: array of ReminderItem objects
                        for (const item of parsed) {
                            if (!item || typeof item !== "object") {
                                return `Invalid attribute value for ${key}: array items must be objects`;
                            }
                            if (item.type === "relative") {
                                if (!Number.isInteger(item.minutes) || item.minutes < 1) {
                                    return `Invalid attribute value for ${key}: relative.minutes must be positive integer`;
                                }
                            } else if (item.type === "absolute") {
                                if (typeof item.time !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(item.time)) {
                                    return `Invalid attribute value for ${key}: absolute.time must be YYYY-MM-DDTHH:mm`;
                                }
                            } else {
                                return `Invalid attribute value for ${key}: unknown type "${item.type}"`;
                            }
                        }
                    }
                } catch {
                    return `Invalid attribute value for ${key}: must be valid JSON`;
                }
            }
        }
```

- [ ] **步骤 2：构建验证**

运行：`pnpm run build`
预期：编译通过

- [ ] **步骤 3：Commit**

```bash
git add src/kernel/utils.ts
git commit -m "feat(reminder): update kernel validation for structured ReminderItem format"
```

---

### 任务 3：扫描逻辑扩展

**文件：**
- 修改：`src/frontend/stores/reminder-store.ts:49-65,137-258`
- 修改：`src/frontend/stores/task-store.ts:378-383`

- [ ] **步骤 1：重构 reminder-store.ts 的 getEffectiveOffsets 为 getEffectiveReminders**

替换 `src/frontend/stores/reminder-store.ts` 中 `getEffectiveOffsets` 函数（第 49-65 行）：

```typescript
function getEffectiveReminders(entry: TaskCacheEntry): ReminderItem[] {
    return parseReminderItems(entry.reminder);
}
```

在文件顶部添加 import：

```typescript
import { parseReminderItems } from "../utils/reminder-utils";
import type { ReminderItem } from "../../shared/types";
```

- [ ] **步骤 2：更新 scanReminders 中 due 日期部分的逻辑**

替换扫描函数中第 153-200 行的 due 日期提醒区域。核心变化是遍历 ReminderItem[] 而非纯偏移量数组：

```typescript
        // ---- Due date reminders (relative) ----
        if (entry.due && entry.status !== "done" && entry.status !== "someday") {
            const items = getEffectiveReminders(entry);
            const relativeItems = items.filter(i => i.type === "relative");
            if (relativeItems.length === 0) continue;

            let dueTimeMs = parseDateToMs(entry.due, 0);
            if (entry.due.length > 10) {
                dueTimeMs = new Date(entry.due).getTime();
            }
            const baseDateStr = entry.due.slice(0, 10);

            let bestOffset: number | null = null;
            let bestTriggerTime = Infinity;

            for (const item of relativeItems) {
                const minutesBefore = (item as ReminderRelative).minutes;
                const triggerTime = dueTimeMs - minutesBefore * 60 * 1000;
                if (triggerTime > now) continue;

                const dedupKey = buildDedupKey(entry.blockId, baseDateStr, minutesBefore, "due");
                if (dismissed[dedupKey]) continue;

                if (minutesBefore < (bestOffset ?? Infinity)) {
                    bestOffset = minutesBefore;
                    bestTriggerTime = triggerTime;
                }
            }

            if (bestOffset !== null) {
                const current = get(taskStore).allTasks.find(t => t.blockId === entry.blockId);
                if (!current || current.status === "done") continue;

                newEntries.push({
                    blockId: entry.blockId,
                    title: entry.title,
                    triggerTime: bestTriggerTime,
                    type: "due",
                    minutesBefore: bestOffset,
                    baseDateStr,
                    dueTime: dueTimeMs,
                    dismissed: false,
                });
                queuedBlockIds.add(entry.blockId);
                continue;
            }
        }

        // ---- Absolute time reminders ----
        {
            const items = getEffectiveReminders(entry);
            const absoluteItems = items.filter(i => i.type === "absolute");
            if (absoluteItems.length > 0) {
                for (const item of absoluteItems) {
                    const absItem = item as ReminderAbsolute;
                    const triggerTime = new Date(absItem.time).getTime();
                    if (triggerTime > now) continue;

                    const dedupKey = buildDedupKey(entry.blockId, absItem.time, 0, "absolute");
                    if (dismissed[dedupKey]) continue;
                    if (queuedBlockIds.has(entry.blockId)) continue;

                    const current = get(taskStore).allTasks.find(t => t.blockId === entry.blockId);
                    if (!current || current.status === "done") continue;

                    newEntries.push({
                        blockId: entry.blockId,
                        title: entry.title,
                        triggerTime,
                        type: "absolute",
                        minutesBefore: 0,
                        baseDateStr: absItem.time.slice(0, 10),
                        dueTime: triggerTime,
                        dismissed: false,
                    });
                    queuedBlockIds.add(entry.blockId);
                }
            }
        }
```

需要额外 import ReminderRelative 和 ReminderAbsolute 类型：

```typescript
import type { ReminderItem, ReminderRelative, ReminderAbsolute } from "../../shared/types";
```

- [ ] **步骤 3：更新 buildDedupKey 的类型签名**

在 `src/frontend/stores/reminder-store.ts` 中，`buildDedupKey` 函数的 `type` 参数需要支持 `"absolute"`：

```typescript
export function buildDedupKey(
    blockId: string,
    baseDateStr: string,
    minutesBefore: number,
    type: "due" | "review" | "absolute"
): string {
    return `${blockId}|${baseDateStr}|${minutesBefore}|${type}`;
}
```

- [ ] **步骤 4：扩展 tasksWithDueOrReview**

修改 `src/frontend/stores/task-store.ts` 中的 `tasksWithDueOrReview`，增加对有 absolute 提醒但没有 due/reviewDate 的任务的包含：

```typescript
export const tasksWithDueOrReview = derived(taskStore, ($state) => {
    return $state.allTasks.filter(t => {
        if (t.status === "done") return false;
        if (t.due && t.status !== "someday") return true;
        if (t.reviewDate) return true;
        // Include tasks with absolute reminders even if no due/reviewDate
        if (t.reminder) {
            try {
                const parsed = JSON.parse(t.reminder);
                if (Array.isArray(parsed) && parsed.some((i: any) => i && i.type === "absolute")) {
                    return true;
                }
            } catch { /* ignore */ }
        }
        return false;
    });
});
```

- [ ] **步骤 5：构建验证**

运行：`pnpm run build`
预期：编译通过

- [ ] **步骤 6：Commit**

```bash
git add src/frontend/stores/reminder-store.ts src/frontend/stores/task-store.ts
git commit -m "feat(reminder): extend scan logic to support absolute time reminders"
```

---

### 任务 4：i18n 新增

**文件：**
- 修改：`src/i18n/zh-CN.json`
- 修改：`src/i18n/en.json`

- [ ] **步骤 1：在 zh-CN.json 的 reminder 相关 key 后面添加新 key**

在 `src/i18n/zh-CN.json` 最后一个 reminder key（`"reminderOverdueDays"`）后面添加：

```json
    "reminderAbsolute": "固定提醒",
    "reminderBeforeDue": "前截止",
    "reminderMonth": "月",
    "reminderDay": "日",
    "reminderAddReminder": "添加提醒",
    "reminderPopupTitle": "提醒设置",
    "reminderEmptyList": "暂无提醒",
    "reminderAddAbsolute": "添加",
    "reminderAddAbsoluteCollapse": "收起",
    "reminderAddAbsoluteDate": "选择日期时间",
    "reminderRelativeSection": "截止日期前提醒",
    "reminderNoDueDate": "请先设置截止日期",
    "reminderCustomAdvance": "自定义提前量",
    "reminderMaxReached": "已达上限(7个)",
    "reminderTypeAbsolute": "固定时间"
```

- [ ] **步骤 2：在 en.json 对应位置添加英文 key**

```json
    "reminderAbsolute": "Fixed Reminder",
    "reminderBeforeDue": " before due",
    "reminderMonth": "M",
    "reminderDay": "D",
    "reminderAddReminder": "Add Reminder",
    "reminderPopupTitle": "Reminder Settings",
    "reminderEmptyList": "No reminders",
    "reminderAddAbsolute": "Add",
    "reminderAddAbsoluteCollapse": "Collapse",
    "reminderAddAbsoluteDate": "Select date & time",
    "reminderRelativeSection": "Before Due Date",
    "reminderNoDueDate": "Set a due date first",
    "reminderCustomAdvance": "Custom advance time",
    "reminderMaxReached": "Limit reached (7)",
    "reminderTypeAbsolute": "Fixed Time"
```

- [ ] **步骤 3：构建验证**

运行：`pnpm run build`
预期：编译通过

- [ ] **步骤 4：Commit**

```bash
git add src/i18n/zh-CN.json src/i18n/en.json
git commit -m "feat(reminder): add i18n keys for popup and absolute reminder"
```

---

### 任务 5：ReminderPopup 组件

**文件：**
- 创建：`src/frontend/components/ReminderPopup.svelte`
- 修改：`src/index.scss`

- [ ] **步骤 1：创建 ReminderPopup.svelte**

创建 `src/frontend/components/ReminderPopup.svelte`：

```svelte
<script lang="ts">
    import type { TaskCacheEntry, ReminderItem, ReminderRelative, ReminderAbsolute } from "../../shared/types";
    import { KernelBridge } from "../kernel-bridge";
    import { taskStore } from "../stores/task-store";
    import { REMINDER_MAX_PER_TASK } from "../../shared/constants";
    import { parseReminderItems, serializeReminderItems, formatReminderDescription, formatOffset } from "../utils/reminder-utils";
    import NaDatePicker from "../ui/NaDatePicker.svelte";
    import { notifyError, formatRpcError } from "../notify";

    export let task: TaskCacheEntry;
    export let bridge: KernelBridge;
    export let i18n: any;
    export let onSave: ((updatedEntry: TaskCacheEntry) => void) | undefined = undefined;

    // Current reminder items
    let items: ReminderItem[] = parseReminderItems(task.reminder);
    let showAddAbsolute = false;
    let newAbsoluteTime = "";

    // Global presets from settings
    let defaultOffsets: number[] = [];
    {
        const storeState = $taskStore;
        defaultOffsets = storeState?.settings?.reminderSettings?.defaultOffsets ?? [];
    }

    // Relative items currently in the list
    $: relativeItems = items.filter(i => i.type === "relative") as ReminderRelative[];
    $: absoluteItems = items.filter(i => i.type === "absolute") as ReminderAbsolute[];
    $: count = items.length;
    $: isFull = count >= REMINDER_MAX_PER_TASK;

    // Which default offsets are selected
    $: selectedOffsets = new Set(relativeItems.map(i => i.minutes));

    // Whether task has a due date
    $: hasDue = !!task.due;

    // Custom offset input
    let newOffsetValue: number = 30;
    let newOffsetUnit: string = "minutes";

    async function saveItems(newItems: ReminderItem[]) {
        try {
            const updated = await bridge.updateTask(task.blockId, {
                "na-reminder": serializeReminderItems(newItems),
            });
            items = newItems;
            if (onSave) onSave(updated);
        } catch (e: any) {
            console.error("[NextAction] updateTask (reminder) failed:", e);
            notifyError(formatRpcError(e, i18n));
        }
    }

    function removeItem(index: number) {
        const newItems = items.filter((_, i) => i !== index);
        saveItems(newItems);
    }

    function addAbsoluteItem() {
        if (!newAbsoluteTime || isFull) return;
        // Check duplicate
        if (items.some(i => i.type === "absolute" && (i as ReminderAbsolute).time === newAbsoluteTime)) return;
        const newItems = [...items, { type: "absolute", time: newAbsoluteTime }];
        saveItems(newItems);
        newAbsoluteTime = "";
        showAddAbsolute = false;
    }

    function toggleOffset(minutes: number) {
        if (selectedOffsets.has(minutes)) {
            // Remove
            const newItems = items.filter(i => !(i.type === "relative" && (i as ReminderRelative).minutes === minutes));
            saveItems(newItems);
        } else {
            if (isFull) return;
            // Add
            const newItems = [...items, { type: "relative", minutes } as ReminderRelative];
            // Sort: relative by minutes asc, then absolute by time asc
            newItems.sort((a, b) => {
                if (a.type === "relative" && b.type === "relative") return a.minutes - b.minutes;
                if (a.type === "absolute" && b.type === "absolute") return a.time.localeCompare(b.time);
                return a.type === "relative" ? -1 : 1;
            });
            saveItems(newItems);
        }
    }

    function addCustomOffset() {
        let mins = newOffsetValue;
        if (newOffsetUnit === "hours") mins *= 60;
        else if (newOffsetUnit === "days") mins *= 1440;
        if (mins < 1 || mins > 20160 || isFull) return;
        if (selectedOffsets.has(mins)) return;
        const newItems = [...items, { type: "relative", minutes: mins } as ReminderRelative];
        newItems.sort((a, b) => {
            if (a.type === "relative" && b.type === "relative") return a.minutes - b.minutes;
            if (a.type === "absolute" && b.type === "absolute") return a.time.localeCompare(b.time);
            return a.type === "relative" ? -1 : 1;
        });
        saveItems(newItems);
    }
</script>

<div class="na-reminder-popup">
    <!-- Header -->
    <div class="na-reminder-popup__header">
        <span class="na-reminder-popup__title">{i18n?.reminderPopupTitle || "提醒设置"}</span>
        <span class="na-reminder-popup__count">{count}/{REMINDER_MAX_PER_TASK}</span>
    </div>

    <!-- Current reminders list -->
    <div class="na-reminder-popup__list">
        {#if items.length === 0}
            <div class="na-reminder-popup__empty">{i18n?.reminderEmptyList || "暂无提醒"}</div>
        {:else}
            {#each items as item, index}
                <div class="na-reminder-popup__item">
                    <span class="na-reminder-popup__item-icon">
                        {item.type === "absolute" ? "📅" : "🕐"}
                    </span>
                    <span class="na-reminder-popup__item-desc">{formatReminderDescription(item, i18n)}</span>
                    <button class="na-reminder-popup__item-remove" on:click={() => removeItem(index)} title={i18n?.reminderRemoveOffset || "删除"}>×</button>
                </div>
            {/each}
        {/if}
    </div>

    <!-- Add absolute reminder -->
    <div class="na-reminder-popup__section">
        <button
            class="na-reminder-popup__add-btn"
            on:click={() => { showAddAbsolute = !showAddAbsolute; if (!showAddAbsolute) newAbsoluteTime = ""; }}
            disabled={isFull}
        >
            {showAddAbsolute
                ? (i18n?.reminderAddAbsoluteCollapse || "收起")
                : (i18n?.reminderAddAbsolute || "添加")}
        </button>
        {#if showAddAbsolute}
            <div class="na-reminder-popup__absolute-form">
                <NaDatePicker
                    bind:value={newAbsoluteTime}
                    placeholder={i18n?.reminderAddAbsoluteDate || "选择日期时间"}
                    defaultTime="09:00"
                    {i18n}
                />
                <button class="na-reminder-popup__confirm-btn" on:click={addAbsoluteItem} disabled={!newAbsoluteTime || isFull}>
                    ✓
                </button>
            </div>
        {/if}
    </div>

    <!-- Relative reminders section -->
    <div class="na-reminder-popup__section" class:na-reminder-popup__section--disabled={!hasDue}>
        <div class="na-reminder-popup__section-title">{i18n?.reminderRelativeSection || "截止日期前提醒"}</div>
        {#if !hasDue}
            <div class="na-reminder-popup__no-due">{i18n?.reminderNoDueDate || "请先设置截止日期"}</div>
        {:else}
            {#if defaultOffsets.length > 0}
                <div class="na-reminder-popup__presets">
                    {#each defaultOffsets as offset}
                        <label class="na-reminder-popup__check">
                            <input
                                type="checkbox"
                                checked={selectedOffsets.has(offset)}
                                on:change={() => toggleOffset(offset)}
                                disabled={isFull && !selectedOffsets.has(offset)}
                            />
                            <span class="na-reminder-popup__check-label">{formatOffset(offset, i18n)}</span>
                        </label>
                    {/each}
                </div>
            {/if}
            <div class="na-reminder-popup__custom-offset">
                <input class="na-input na-reminder-popup__custom-input" type="number" min="1" bind:value={newOffsetValue} disabled={isFull} />
                <select class="na-select na-reminder-popup__custom-unit" bind:value={newOffsetUnit} disabled={isFull}>
                    <option value="minutes">{i18n?.reminderOffsetMinutes || "分钟"}</option>
                    <option value="hours">{i18n?.reminderOffsetHours || "小时"}</option>
                    <option value="days">{i18n?.reminderOffsetDays || "天"}</option>
                </select>
                <button class="na-button na-button--sm" on:click={addCustomOffset} disabled={isFull}>+</button>
            </div>
        {/if}
    </div>
</div>
```

- [ ] **步骤 2：在 index.scss 中添加 ReminderPopup 样式**

在 `src/index.scss` 中添加以下样式（放在 `.nextaction` 作用域内，因为弹窗是通过思源 Dialog 渲染在 `.nextaction` 内的）：

```scss
.na-reminder-popup {
    display: flex;
    flex-direction: column;
    gap: var(--na-space-sm);
    padding: var(--na-space-md);
    min-width: 280px;
    max-width: 320px;

    &__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    &__title {
        font-size: var(--na-font-size-lg);
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }

    &__count {
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface-secondary);
    }

    &__list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 180px;
        overflow-y: auto;
    }

    &__empty {
        text-align: center;
        padding: var(--na-space-md);
        color: var(--b3-theme-on-surface-light);
        font-size: var(--na-font-size-sm);
    }

    &__item {
        display: flex;
        align-items: center;
        gap: var(--na-space-xs);
        padding: 4px var(--na-space-xs);
        border-radius: var(--na-radius-sm);
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface);

        &:hover {
            background: var(--b3-theme-surface-lighter);
        }
    }

    &__item-icon {
        flex-shrink: 0;
        font-size: 12px;
    }

    &__item-desc {
        flex: 1;
        min-width: 0;
    }

    &__item-remove {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--b3-theme-on-surface-light);
        border-radius: var(--na-radius-sm);
        font-size: 14px;
        line-height: 1;

        &:hover {
            color: var(--na-color-error);
            background: var(--b3-theme-surface-lighter);
        }
    }

    &__section {
        display: flex;
        flex-direction: column;
        gap: var(--na-space-xs);
        padding-top: var(--na-space-sm);
        border-top: 1px solid var(--b3-theme-surface-lighter);

        &--disabled {
            opacity: 0.5;
            pointer-events: none;
        }
    }

    &__section-title {
        font-size: var(--na-font-size-sm);
        font-weight: 500;
        color: var(--b3-theme-on-surface-secondary);
    }

    &__no-due {
        font-size: var(--na-font-size-xs);
        color: var(--na-color-error);
    }

    &__add-btn {
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-primary);
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px 0;
        text-align: left;

        &:hover {
            text-decoration: underline;
        }

        &:disabled {
            color: var(--b3-theme-on-surface-light);
            cursor: not-allowed;
            text-decoration: none;
        }
    }

    &__absolute-form {
        display: flex;
        align-items: center;
        gap: var(--na-space-xs);
    }

    &__confirm-btn {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);
        border: none;
        border-radius: var(--na-radius-sm);
        cursor: pointer;
        font-size: 14px;
        flex-shrink: 0;

        &:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
    }

    &__presets {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    &__check {
        display: flex;
        align-items: center;
        gap: var(--na-space-xs);
        padding: 2px 0;
        font-size: var(--na-font-size-sm);
        color: var(--b3-theme-on-surface);
        cursor: pointer;

        input[type="checkbox"] {
            cursor: pointer;
        }

        input[type="checkbox"]:disabled + .na-reminder-popup__check-label {
            opacity: 0.5;
        }
    }

    &__check-label {
        user-select: none;
    }

    &__custom-offset {
        display: flex;
        align-items: center;
        gap: var(--na-space-xs);
        margin-top: 2px;
    }

    &__custom-input {
        width: 60px;
    }

    &__custom-unit {
        width: auto;
    }
}
```

- [ ] **步骤 3：构建验证**

运行：`pnpm run build`
预期：编译通过

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/components/ReminderPopup.svelte src/index.scss
git commit -m "feat(reminder): create ReminderPopup component with absolute+relative sections"
```

---

### 任务 6：右键菜单集成

**文件：**
- 修改：`src/frontend/components/task-context-menu.ts:22-98`

- [ ] **步骤 1：在右键菜单中添加"添加提醒"菜单项**

在 `src/frontend/components/task-context-menu.ts` 中：

1. 在顶部添加 import：

```typescript
import { Dialog } from "siyuan";
```

2. 在 `ContextMenuCallbacks` 接口中添加：

```typescript
onReminderEdit?: (blockId: string) => void;
```

3. 在 `showTaskContextMenu` 函数中，在 `menu.addSeparator()` 之前（约第 61 行），添加"添加提醒"菜单项：

```typescript
    menu.addItem({
        icon: "iconClock",
        label: i18n?.reminderAddReminder || "添加提醒",
        click: () => {
            if (callbacks.onReminderEdit) {
                callbacks.onReminderEdit(task.blockId);
            }
        },
    });

    menu.addSeparator();
```

这应该加在优先级子菜单之后、myDay 操作之前的位置（即第 60 行 `menu.addSeparator()` 之前）。

- [ ] **步骤 2：构建验证**

运行：`pnpm run build`
预期：编译通过

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/task-context-menu.ts
git commit -m "feat(reminder): add 'Add Reminder' to task context menu"
```

---

### 任务 7：TaskDetail 集成 — 铃铛图标 + 打开弹窗

**文件：**
- 修改：`src/frontend/components/TaskDetail.svelte`

- [ ] **步骤 1：移除旧提醒相关变量和函数**

删除 TaskDetail.svelte 中以下代码（约第 58-175 行）：
- `reminderOffsets`、`reminderEnabled`、`defaultOffsets`、`newOffsetValue`、`newOffsetUnit` 变量声明
- `parseReminderState` 函数
- `formatOffset` 函数
- `addReminderOffset` 函数
- `removeReminderOffset` 函数
- `handleReminderToggle` 函数
- `saveReminder` 函数
- `saveReminderClear` 函数
- `saveReminderEnabled` 函数

删除 `syncFromTask` 函数中的 `parseReminderState(task.reminder || "");` 调用（约第 266 行）。

删除 `$: if (due !== prevDue)` 响应式块中对 reminderHasOverride/reminderDisabled 的引用（约第 179-188 行）。将该块简化为仅更新 prevDue：

```typescript
    let prevDue = task.due || "";
    $: if (due !== prevDue) {
        prevDue = due;
    }
```

- [ ] **步骤 2：添加铃铛图标和弹窗打开逻辑**

在 TaskDetail.svelte 的 `<script>` 区域添加：

```typescript
import ReminderPopup from "./ReminderPopup.svelte";
import { parseReminderItems } from "../utils/reminder-utils";
import { Dialog } from "siyuan";
```

添加弹窗打开函数：

```typescript
function openReminderPopup() {
    const dialog = new Dialog({
        title: i18n?.reminderPopupTitle || "提醒设置",
        content: `<div id="na-reminder-popup-container"></div>`,
        width: "360px",
    });
    const container = dialog.element.querySelector("#na-reminder-popup-container");
    if (container) {
        new ReminderPopup({
            target: container,
            props: {
                task,
                bridge,
                i18n,
                onSave: (updated: TaskCacheEntry) => {
                    if (onSave) onSave(updated);
                },
            },
        });
    }
}

$: hasReminders = parseReminderItems(task.reminder).length > 0;
```

- [ ] **步骤 3：替换模板中的提醒区域**

替换模板中的整个提醒区域（约第 643-688 行），将：

```svelte
        <!-- Reminder section (only shown when due date is set) -->
        {#if due}
        <div class="na-detail__field">
            ... (整个旧提醒区域)
        </div>
        {/if}
```

替换为铃铛图标（放在截止日期字段旁边）：

找到截止日期字段区域（约第 631-636 行），改为：

```svelte
        <div class="na-detail__field">
            <span class="na-detail__label">{i18n?.dueTime || i18n?.dueDate || "Due Time"}</span>
            <div class="na-detail__value na-detail__value--with-bell">
                <NaDatePicker bind:value={due} placeholder={i18n?.dueTime || i18n?.dueDate || "Due Time"} defaultTime="23:59" {i18n} on:change={handleChange} />
                <button
                    class="na-detail__bell-btn"
                    class:na-detail__bell-btn--active={hasReminders}
                    on:click={openReminderPopup}
                    title={i18n?.reminder || "Reminders"}
                >
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M8 14.5c-.83 0-1.5-.67-1.5-1.5h3c0 .83-.67 1.5-1.5 1.5z"/>
                        <path d="M12.5 11V7.5a4.5 4.5 0 0 0-9 0V11l-1 1.5h11L12.5 11z"/>
                    </svg>
                </button>
            </div>
        </div>
```

- [ ] **步骤 4：添加铃铛按钮样式**

在 `src/index.scss` 的 `.na-detail` 相关样式中添加：

```scss
.na-detail__value--with-bell {
    display: flex;
    align-items: center;
    gap: var(--na-space-xs);
}

.na-detail__bell-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--b3-theme-on-surface-light);
    border-radius: var(--na-radius-sm);
    transition: color 0.15s, background 0.15s;

    &:hover {
        color: var(--b3-theme-on-surface);
        background: var(--b3-theme-surface-lighter);
    }

    &--active {
        color: var(--na-color-warning, #f0ad4e);
    }
}
```

- [ ] **步骤 5：构建验证**

运行：`pnpm run build`
预期：编译通过

- [ ] **步骤 6：Commit**

```bash
git add src/frontend/components/TaskDetail.svelte src/index.scss
git commit -m "feat(reminder): replace inline reminder UI with bell icon + popup"
```

---

### 任务 8：通知组件更新 — 支持 absolute 类型

**文件：**
- 修改：`src/frontend/components/NotificationCard.svelte`
- 修改：`src/frontend/components/NotificationHost.svelte`
- 修改：`src/frontend/components/ReminderView.svelte`

- [ ] **步骤 1：更新 NotificationCard 的 type 类型**

在 `src/frontend/components/NotificationCard.svelte` 中，修改 `type` prop 的类型：

```typescript
export let type: "due" | "review" | "absolute";
```

修改 `typeLabel` 计算逻辑：

```typescript
    $: typeLabel =
        type === "due"
            ? (i18n?.reminderDue || "截止提醒")
            : type === "review"
            ? (i18n?.reminderReview || "回顾提醒")
            : (i18n?.reminderTypeAbsolute || "固定提醒");
```

- [ ] **步骤 2：更新 NotificationHost 的 getMessage 和 handleDismiss**

在 `src/frontend/components/NotificationHost.svelte` 中：

修改 `handleDismiss` 函数的参数类型：

```typescript
function handleDismiss(item: { blockId: string; baseDateStr: string; minutesBefore: number; type: "due" | "review" | "absolute" }) {
```

修改 `getMessage` 函数，absolute 类型用与 due 相同的计算逻辑（dueTime - Date.now()）：

```typescript
function getMessage(item: { type: "due" | "review" | "absolute"; dueTime: number }): string {
    if (item.type === "review") {
        return i18n?.reminderReviewToday || "今天需回顾";
    }
    // "due" and "absolute" share the same time-remaining calculation
    const diffMs = item.dueTime - Date.now();
    if (diffMs <= 0) {
        const overdueMin = Math.round(Math.abs(diffMs) / 60000);
        if (overdueMin < 60) {
            const template = i18n?.reminderOverdueMinutes || "已逾期{n}分钟";
            return template.replace("{n}", String(overdueMin));
        }
        const overdueH = Math.round(overdueMin / 60);
        if (overdueH < 24) {
            const template = i18n?.reminderOverdueHours || "已逾期{n}小时";
            return template.replace("{n}", String(overdueH));
        }
        const overdueD = Math.round(overdueH / 24);
        const template = i18n?.reminderOverdueDays || "已逾期{n}天";
        return template.replace("{n}", String(overdueD));
    }
    const remainMin = Math.round(diffMs / 60000);
    if (remainMin < 60) {
        const template = i18n?.reminderDueInMinutes || "{n}分钟后到期";
        return template.replace("{n}", String(remainMin));
    }
    const remainH = Math.round(remainMin / 60);
    if (remainH < 24) {
        const template = i18n?.reminderDueIn || "{n}小时后到期";
        return template.replace("{n}", String(remainH));
    }
    const remainD = Math.round(remainH / 24);
    const template = i18n?.reminderDueInDays || "{n}天后到期";
    return template.replace("{n}", String(remainD));
}
```

- [ ] **步骤 3：更新 ReminderView 的类型标签和描述**

在 `src/frontend/components/ReminderView.svelte` 中：

修改 `getTypeLabel` 函数：

```typescript
function getTypeLabel(type: "due" | "review" | "absolute"): string {
    if (type === "due") return i18n?.reminderTypeDue || "截止提醒";
    if (type === "absolute") return i18n?.reminderTypeAbsolute || "固定提醒";
    return i18n?.reminderTypeReview || "回顾提醒";
}
```

修改 `getDescription` 函数，absolute 类型显示固定时间：

```typescript
function getDescription(entry: typeof $notificationQueue[0]): string {
    if (entry.type === "review") {
        return i18n?.reminderReviewToday || "今天需回顾";
    }
    if (entry.type === "absolute") {
        // Show the actual fixed time
        const d = new Date(entry.triggerTime);
        const month = d.getMonth() + 1;
        const day = d.getDate();
        const h = String(d.getHours()).padStart(2, "0");
        const m = String(d.getMinutes()).padStart(2, "0");
        return `${month}${i18n?.reminderMonth || "月"}${day}${i18n?.reminderDay || "日"} ${h}:${m}`;
    }
    // Due type — time remaining
    const diffMs = entry.dueTime - Date.now();
    if (diffMs <= 0) {
        const overdueMin = Math.round(Math.abs(diffMs) / 60000);
        if (overdueMin < 60) return `逾期${overdueMin}分钟`;
        const h = Math.round(overdueMin / 60);
        if (h < 24) return `逾期${h}小时`;
        return `逾期${Math.round(h / 24)}天`;
    }
    const remainMin = Math.round(diffMs / 60000);
    if (remainMin < 60) return `${remainMin}分钟后到期`;
    const h = Math.round(remainMin / 60);
    if (h < 24) return `${h}小时后到期`;
    return `${Math.round(h / 24)}天后到期`;
}
```

添加 absolute 类型的 badge 样式：

```scss
.na-reminder__item--absolute {
    border-left: 3px solid var(--na-color-warning, #f0ad4e);
}

.na-reminder__type-badge--absolute {
    background: var(--na-color-warning, #f0ad4e);
    opacity: 0.85;
}
```

在 NotificationCard 的样式中也添加（在 `src/index.scss` 中，NotificationCard 区域）：

```scss
.na-notification-card__type--absolute {
    background: rgba(240, 173, 78, 0.85);
}
```

- [ ] **步骤 4：构建验证**

运行：`pnpm run build`
预期：编译通过

- [ ] **步骤 5：Commit**

```bash
git add src/frontend/components/NotificationCard.svelte src/frontend/components/NotificationHost.svelte src/frontend/components/ReminderView.svelte src/index.scss
git commit -m "feat(reminder): add absolute type support to notification cards and reminder view"
```

---

### 任务 9：连接右键菜单到 ReminderPopup

**文件：**
- 修改：调用 `showTaskContextMenu` 的所有位置，传入 `onReminderEdit` 回调

- [ ] **步骤 1：找到所有 showTaskContextMenu 调用位置**

搜索项目中所有调用 `showTaskContextMenu` 的地方，添加 `onReminderEdit` 回调。该回调需要能访问到 bridge、i18n 和 task 对象来打开 ReminderPopup。

在回调中实现弹窗打开逻辑（与 TaskDetail 中的 `openReminderPopup` 相同）：

```typescript
onReminderEdit: (blockId: string) => {
    const storeState = get(taskStore);
    const taskEntry = storeState.allTasks.find(t => t.blockId === blockId);
    if (!taskEntry) return;
    const dialog = new Dialog({
        title: i18n?.reminderPopupTitle || "提醒设置",
        content: `<div id="na-reminder-popup-ctx"></div>`,
        width: "360px",
    });
    const container = dialog.element.querySelector("#na-reminder-popup-ctx");
    if (container) {
        new ReminderPopup({
            target: container,
            props: {
                task: taskEntry,
                bridge,
                i18n,
                onSave: (updated: TaskCacheEntry) => {
                    taskStore.applyUpdate(updated);
                },
            },
        });
    }
},
```

需要在对应文件中添加 import：`import { get } from "svelte/store";` 和 `import ReminderPopup from "./ReminderPopup.svelte";` 和 `import { Dialog } from "siyuan";`。

- [ ] **步骤 2：构建验证**

运行：`pnpm run build`
预期：编译通过

- [ ] **步骤 3：Commit**

```bash
git add -A
git commit -m "feat(reminder): connect context menu to ReminderPopup"
```

---

### 任务 10：端到端构建与部署验证

**文件：** 无新改动

- [ ] **步骤 1：完整构建**

运行：`pnpm run build`
预期：编译通过，无错误

- [ ] **步骤 2：部署**

运行：`pnpm run release`
预期：部署成功

- [ ] **步骤 3：手动验证清单**

重新加载插件后验证：
1. 右键点击任务 → 看到"添加提醒"菜单项 → 点击打开弹窗
2. TaskDetail 截止日期旁出现铃铛图标 → 点击打开弹窗
3. 弹窗中添加固定时间提醒 → 保存成功 → 铃铛图标高亮
4. 弹窗中勾选截止前提醒预设 → 保存成功
5. 弹窗中添加自定义提前量 → 保存成功
6. 删除提醒项 → 即时保存
7. 无截止日期时截止前区域灰显+提示
8. 已有旧数据（纯偏移量数组）自动迁移为结构化格式
9. 固定时间到达后触发通知卡片
10. 通知卡片和 ReminderView 正确显示 absolute 类型

- [ ] **步骤 4：Commit**

```bash
git add -A
git commit -m "feat(reminder): complete reminder enhancement — popup, absolute, context menu"
```
