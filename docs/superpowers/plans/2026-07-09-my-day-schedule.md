# "我的一天"时间排期功能实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为"我的一天"视图增加垂直时间线排期能力，支持拖拽排期、拖拽移动/调整时长、点击操作菜单、当前时间指示线、泳道重叠处理。

**架构：** 左右分栏布局（左侧未排期面板 + 右侧垂直时间线），窄屏自动切换上下排列。MyDayTaskEntry 的 scheduleStart/scheduleEnd 改为一天内分钟数（0-1440）。交互使用 HTML5 Drag & Drop（跨面板）+ Pointer Events（时间线内移动/resize）。内核 setSchedule 增加分钟数边界校验。

**技术栈：** Svelte 3 + 思源 Menu 组件 + HTML5 Drag & Drop API + Pointer Events API + CSS absolute positioning

---

## 文件结构

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/frontend/components/timeline/TimelineView.svelte` | 时间线模式主容器：左右分栏布局、响应式断点、视图切换按钮 |
| `src/frontend/components/timeline/UnscheduledPanel.svelte` | 左侧未排期面板：简化卡片列表、dragstart 处理、dragover 高亮提示 |
| `src/frontend/components/timeline/TimelineColumn.svelte` | 右侧时间线：刻度渲染、drop 处理、pointer 事件协调、自动滚动 |
| `src/frontend/components/timeline/TimelineCard.svelte` | 排期任务卡片：拖拽移动、resize、点击检测、视觉状态 |
| `src/frontend/components/timeline/TimelineNeedle.svelte` | 当前时间指示线：位置计算、定时刷新 |
| `src/frontend/components/timeline/timeline-utils.ts` | 时间线工具函数：分钟→像素、吸附、泳道算法、分钟→时间标签 |
| `src/frontend/components/timeline/TaskQuickMenu.ts` | 点击卡片弹出操作菜单：取消排期/完成/优先级/移除 |

### 修改文件

| 文件 | 变更范围 |
|------|---------|
| `src/shared/constants.ts` | 追加时间线相关常量 |
| `src/kernel/my-day-manager.ts` | setSchedule 增加分钟数校验 + removeSchedule 便捷方法 |
| `src/frontend/components/MyDayView.svelte` | 增加列表/时间线切换按钮，条件渲染 TimelineView |
| `src/i18n/zh-CN.json` | 追加时间线相关 i18n key |
| `src/i18n/en.json` | 追加时间线相关 i18n key |

---

## 任务 1：共享常量与工具函数

**文件：**
- 修改：`src/shared/constants.ts`
- 创建：`src/frontend/components/timeline/timeline-utils.ts`

- [ ] **步骤 1：在 constants.ts 追加时间线常量**

在 `src/shared/constants.ts` 末尾追加：

```typescript
export const TIMELINE_SLOT_MINUTES = 30;
export const DRAG_SNAP_MINUTES = 15;
export const DEFAULT_SCHEDULE_DURATION = 60;
export const MIN_SCHEDULE_DURATION = 15;
export const MAX_SCHEDULE_DURATION = 720;
export const PIXELS_PER_MINUTE = 1.2;
export const UNSCHEDULED_PANEL_WIDTH = 220;
export const RESPONSIVE_BREAKPOINT = 500;
export const MY_DAY_DRAG_TYPE = "application/x-na-my-day-task";
export const RESIZE_HANDLE_HEIGHT = 6;
export const CLICK_THRESHOLD_PX = 5;
export const DAY_MINUTES = 1440;
```

- [ ] **步骤 2：创建 timeline-utils.ts 工具函数**

创建 `src/frontend/components/timeline/timeline-utils.ts`：

```typescript
import {
    PIXELS_PER_MINUTE,
    DRAG_SNAP_MINUTES,
    DAY_MINUTES,
    MIN_SCHEDULE_DURATION,
    DEFAULT_MY_DAY_RESET_HOUR,
} from "../../../shared/constants";
import type { MyDayTaskEntry } from "../../../shared/types";

/** 将分钟偏移量转为时钟时间标签，如 "09:30" */
export function minuteToTimeLabel(
    offsetMinute: number,
    resetHour: number = DEFAULT_MY_DAY_RESET_HOUR,
): string {
    const absoluteMinute = ((offsetMinute + resetHour * 60) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES;
    const hour = Math.floor(absoluteMinute / 60);
    const min = absoluteMinute % 60;
    return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** 分钟偏移量 → 像素 Y 位置 */
export function minuteToPixel(minute: number): number {
    return minute * PIXELS_PER_MINUTE;
}

/** 像素 Y 位置 → 分钟偏移量 */
export function pixelToMinute(px: number): number {
    return px / PIXELS_PER_MINUTE;
}

/** 吸附到 DRAG_SNAP_MINUTES 的整数倍 */
export function snapMinute(minute: number): number {
    return Math.round(minute / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;
}

/** 将像素位置转为吸附后的分钟偏移量 */
export function pixelToSnappedMinute(px: number): number {
    return snapMinute(pixelToMinute(px));
}

/** 计算当前时间相对于 resetHour 的分钟偏移 */
export function getCurrentMinuteOffset(resetHour: number): number {
    const now = new Date();
    const absoluteMinute = now.getHours() * 60 + now.getMinutes();
    const offset = absoluteMinute - resetHour * 60;
    return ((offset % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

/** 泳道分配结果 */
export interface LaneLayout {
    laneIndex: number;
    laneCount: number;
}

/** 贪心泳道算法：为已排期任务分配泳道，避免视觉遮挡 */
export function computeLaneLayouts(entries: MyDayTaskEntry[]): Map<string, LaneLayout> {
    const result = new Map<string, LaneLayout>();
    const scheduled = entries.filter(
        (e) => e.scheduleStart !== null && e.scheduleEnd !== null,
    );
    if (scheduled.length === 0) return result;

    scheduled.sort((a, b) => a.scheduleStart! - b.scheduleStart!);

    // lanes[i] = 该泳道最后一个任务的结束分钟
    const lanes: number[] = [];

    for (const entry of scheduled) {
        const start = entry.scheduleStart!;
        let placed = false;
        for (let i = 0; i < lanes.length; i++) {
            if (lanes[i] <= start) {
                lanes[i] = entry.scheduleEnd!;
                result.set(entry.blockId, { laneIndex: i, laneCount: 0 });
                placed = true;
                break;
            }
        }
        if (!placed) {
            const idx = lanes.length;
            lanes.push(entry.scheduleEnd!);
            result.set(entry.blockId, { laneIndex: idx, laneCount: 0 });
        }
    }

    const totalLanes = lanes.length;
    for (const layout of result.values()) {
        layout.laneCount = totalLanes;
    }

    return result;
}

/** 生成时间线刻度数据 */
export interface TimelineSlot {
    minute: number;
    isMajor: boolean;
    label: string;
}

export function generateTimelineSlots(resetHour: number, slotMinutes: number = 30): TimelineSlot[] {
    const slots: TimelineSlot[] = [];
    for (let m = 0; m < DAY_MINUTES; m += slotMinutes) {
        const absoluteMinute = (m + resetHour * 60) % DAY_MINUTES;
        const isMajor = absoluteMinute % 60 === 0;
        slots.push({
            minute: m,
            isMajor,
            label: isMajor ? minuteToTimeLabel(m, resetHour) : "",
        });
    }
    return slots;
}
```

- [ ] **步骤 3：构建验证**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build`
预期：构建成功，无类型错误

- [ ] **步骤 4：Commit**

```bash
git add src/shared/constants.ts src/frontend/components/timeline/timeline-utils.ts
git commit -m "feat: add timeline constants and utility functions for My Day schedule"
```

---

## 任务 2：内核 setSchedule 分钟数校验 + removeSchedule

**文件：**
- 修改：`src/kernel/my-day-manager.ts`

- [ ] **步骤 1：更新 setSchedule 方法，添加分钟数边界校验**

在 `src/kernel/my-day-manager.ts` 中，替换现有 `setSchedule` 方法为：

```typescript
async setSchedule(blockId: string, start: number | null, end: number | null): Promise<MyDayState> {
    const current = await this.getState();
    const entryIndex = current.tasks.findIndex((t) => t.blockId === blockId);
    if (entryIndex === -1) {
        throw new Error(`Task ${blockId} not found in My Day`);
    }
    // 校验：start 和 end 都为 null 或都不为 null
    if ((start === null) !== (end === null)) {
        throw new Error("scheduleStart and scheduleEnd must both be null or both be set");
    }
    if (start !== null && end !== null) {
        if (start < 0 || end > 1440) {
            throw new Error(`Schedule minutes out of range: start=${start}, end=${end}`);
        }
        if (end - start < 15) {
            throw new Error(`Schedule duration too short: ${end - start} minutes (min 15)`);
        }
        if (end - start > 720) {
            throw new Error(`Schedule duration too long: ${end - start} minutes (max 720)`);
        }
    }
    const updatedEntry: MyDayTaskEntry = {
        ...current.tasks[entryIndex],
        scheduleStart: start,
        scheduleEnd: end,
    };
    const newTasks = [...current.tasks];
    newTasks[entryIndex] = updatedEntry;
    const newState: MyDayState = {
        ...current,
        tasks: newTasks,
        updatedAt: Date.now(),
    };
    this.state = newState;
    await this.persist();
    return { ...this.state, tasks: [...this.state.tasks] };
}
```

- [ ] **步骤 2：添加 removeSchedule 便捷方法**

在 `my-day-manager.ts` 的 `setSchedule` 方法之后追加：

```typescript
async removeSchedule(blockId: string): Promise<MyDayState> {
    return this.setSchedule(blockId, null, null);
}
```

- [ ] **步骤 3：在 TaskService 中添加 removeSchedule 代理方法**

在 `src/kernel/task-service.ts` 中，在 `setMyDaySchedule` 方法之后追加：

```typescript
async removeMyDaySchedule(blockId: string): Promise<MyDayState> {
    this.checkReady();
    return this.myDayManager.removeSchedule(blockId);
}
```

- [ ] **步骤 4：在 RPC Server 注册新方法**

在 `src/kernel/rpc-server.ts` 中，在 `setMyDaySchedule` 绑定之后追加：

```typescript
this.bind("removeMyDaySchedule", async (params: { blockId: string }) => {
    return this.taskService.removeMyDaySchedule(params.blockId);
});
```

- [ ] **步骤 5：在 KernelBridge 添加前端调用方法**

在 `src/frontend/kernel-bridge.ts` 中，在 `setMyDaySchedule` 方法之后追加：

```typescript
async removeMyDaySchedule(blockId: string): Promise<MyDayState> {
    return this.call("removeMyDaySchedule", { blockId });
}
```

- [ ] **步骤 6：构建验证**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build`
预期：构建成功

- [ ] **步骤 7：Commit**

```bash
git add src/kernel/my-day-manager.ts src/kernel/task-service.ts src/kernel/rpc-server.ts src/frontend/kernel-bridge.ts
git commit -m "feat: add minute-based schedule validation and removeSchedule RPC"
```

---

## 任务 3：i18n key

**文件：**
- 修改：`src/i18n/zh-CN.json`
- 修改：`src/i18n/en.json`

- [ ] **步骤 1：在 zh-CN.json 追加 key**

在 `src/i18n/zh-CN.json` 中追加以下 key（在最后一个 key 之后，注意逗号）：

```json
"timelineMode": "时间线",
"listMode": "列表",
"unscheduled": "未排期",
"cancelSchedule": "取消排期",
"removeFromMyDay": "从我的一天移除",
"addToMyDay": "加入我的一天",
"markComplete": "标记完成",
"setPriority": "设置优先级",
"dropToUnschedule": "释放以取消排期",
"scheduleError": "排期设置失败",
"noUnscheduled": "所有任务已排期"
```

- [ ] **步骤 2：在 en.json 追加对应英文 key**

在 `src/i18n/en.json` 中追加：

```json
"timelineMode": "Timeline",
"listMode": "List",
"unscheduled": "Unscheduled",
"cancelSchedule": "Unschedule",
"removeFromMyDay": "Remove from My Day",
"addToMyDay": "Add to My Day",
"markComplete": "Mark Complete",
"setPriority": "Set Priority",
"dropToUnschedule": "Drop to unschedule",
"scheduleError": "Failed to set schedule",
"noUnscheduled": "All tasks scheduled"
```

- [ ] **步骤 3：Commit**

```bash
git add src/i18n/zh-CN.json src/i18n/en.json
git commit -m "feat: add timeline i18n keys for My Day schedule"
```

---

## 任务 4：TimelineNeedle 组件

**文件：**
- 创建：`src/frontend/components/timeline/TimelineNeedle.svelte`

- [ ] **步骤 1：创建 TimelineNeedle.svelte**

创建 `src/frontend/components/timeline/TimelineNeedle.svelte`：

```svelte
<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { PIXELS_PER_MINUTE } from "../../../shared/constants";
    import { getCurrentMinuteOffset } from "./timeline-utils";

    export let resetHour: number = 5;
    export let containerHeight: number = 0;

    let needleTop: number = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function updatePosition() {
        needleTop = getCurrentMinuteOffset(resetHour) * PIXELS_PER_MINUTE;
    }

    onMount(() => {
        updatePosition();
        intervalId = setInterval(updatePosition, 60000);
    });

    onDestroy(() => {
        if (intervalId) clearInterval(intervalId);
    });

    $: needleStyle = `top: ${needleTop}px`;
</script>

{#if needleTop > 0 && needleTop < containerHeight}
    <div class="na-timeline-needle" style={needleStyle}>
        <div class="na-timeline-needle__dot"></div>
        <div class="na-timeline-needle__line"></div>
    </div>
{/if}

<style lang="scss">
    .na-timeline-needle {
        position: absolute;
        left: 0;
        right: 0;
        z-index: 10;
        pointer-events: none;
    }

    .na-timeline-needle__dot {
        position: absolute;
        left: -4px;
        top: -4px;
        width: 8px;
        height: 8px;
        background: var(--na-danger, #e74c3c);
        border-radius: 50%;
    }

    .na-timeline-needle__line {
        height: 2px;
        background: var(--na-danger, #e74c3c);
    }
</style>
```

- [ ] **步骤 2：构建验证**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build`
预期：构建成功

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/timeline/TimelineNeedle.svelte
git commit -m "feat: add TimelineNeedle component for current time indicator"
```

---

## 任务 5：UnscheduledPanel 组件

**文件：**
- 创建：`src/frontend/components/timeline/UnscheduledPanel.svelte`

- [ ] **步骤 1：创建 UnscheduledPanel.svelte**

创建 `src/frontend/components/timeline/UnscheduledPanel.svelte`：

```svelte
<script lang="ts">
    import { PRIORITY_COLORS, PRIORITY_HEX_COLORS } from "../../constants";
    import { MY_DAY_DRAG_TYPE } from "../../../shared/constants";
    import type { MyDayTaskEntry, TaskCacheEntry } from "../../../shared/types";

    export let unscheduledEntries: MyDayTaskEntry[] = [];
    export let taskMap: Map<string, TaskCacheEntry>;
    export let i18n: any;
    export let isDropTarget: boolean = false;

    function handleDragStart(e: DragEvent, blockId: string) {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData(MY_DAY_DRAG_TYPE, blockId);
        e.dataTransfer.effectAllowed = "move";
    }

    function handleDragOver(e: DragEvent) {
        e.preventDefault();
        if (e.dataTransfer) {
            if (e.dataTransfer.types.includes(MY_DAY_DRAG_TYPE)) {
                e.dataTransfer.dropEffect = "move";
            }
        }
    }

    function handleDrop(e: DragEvent) {
        e.preventDefault();
        // 从时间线拖回取消排期由父组件 TimelineView 处理
    }
</script>

<div
    class="na-unscheduled"
    class:na-unscheduled--drop-target={isDropTarget}
    on:dragover={handleDragOver}
    on:drop={handleDrop}
>
    <div class="na-unscheduled__header">
        {i18n?.unscheduled || "Unscheduled"}
    </div>
    {#if unscheduledEntries.length === 0}
        <div class="na-unscheduled__empty">
            {i18n?.noUnscheduled || "All tasks scheduled"}
        </div>
    {:else}
        <div class="na-unscheduled__list">
            {#each unscheduledEntries as entry (entry.blockId)}
                {@const task = taskMap.get(entry.blockId)}
                {#if task}
                    <div
                        class="na-unscheduled-card"
                        draggable="true"
                        on:dragstart={(e) => handleDragStart(e, entry.blockId)}
                    >
                        <span
                            class="na-unscheduled-card__dot"
                            style="background: {PRIORITY_COLORS[task.priority] || 'var(--na-priority-medium)'}"
                        ></span>
                        <span class="na-unscheduled-card__name">{task.title}</span>
                    </div>
                {/if}
            {/each}
        </div>
    {/if}
</div>

<style lang="scss">
    .na-unscheduled {
        display: flex;
        flex-direction: column;
        height: 100%;
        border-right: 1px solid var(--b3-theme-surface-lighter, rgba(255, 255, 255, 0.08));
        background: var(--b3-theme-surface, #1e1e1e);
        transition: background 0.2s;
    }

    .na-unscheduled--drop-target {
        background: var(--na-accent-dim, rgba(59, 130, 246, 0.1));
    }

    .na-unscheduled__header {
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 600;
        color: var(--b3-theme-on-surface, #e0e0e0);
        border-bottom: 1px solid var(--b3-theme-surface-lighter, rgba(255, 255, 255, 0.08));
    }

    .na-unscheduled__empty {
        padding: 12px 10px;
        font-size: 11px;
        color: var(--b3-theme-on-surface-dim, #888);
        text-align: center;
    }

    .na-unscheduled__list {
        flex: 1;
        overflow-y: auto;
        padding: 4px;
    }

    .na-unscheduled-card {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        margin-bottom: 3px;
        border-radius: 4px;
        background: var(--b3-theme-surface-lighter, rgba(255, 255, 255, 0.05));
        cursor: grab;
        transition: background 0.15s;

        &:hover {
            background: var(--b3-theme-surface-hover, rgba(255, 255, 255, 0.1));
        }

        &:active {
            cursor: grabbing;
        }
    }

    .na-unscheduled-card__dot {
        flex-shrink: 0;
        width: 6px;
        height: 6px;
        border-radius: 50%;
    }

    .na-unscheduled-card__name {
        font-size: 12px;
        color: var(--b3-theme-on-surface, #e0e0e0);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
```

- [ ] **步骤 2：构建验证**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build`
预期：构建成功

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/timeline/UnscheduledPanel.svelte
git commit -m "feat: add UnscheduledPanel component for unscheduled task list"
```

---

## 任务 6：TimelineCard + TaskQuickMenu 组件

**文件：**
- 创建：`src/frontend/components/timeline/TimelineCard.svelte`
- 创建：`src/frontend/components/timeline/TaskQuickMenu.ts`

- [ ] **步骤 1：创建 TaskQuickMenu.ts**

创建 `src/frontend/components/timeline/TaskQuickMenu.ts`：

```typescript
import { Menu } from "siyuan";
import type { TaskCacheEntry } from "../../../shared/types";
import type { KernelBridge } from "../../kernel-bridge";
import { STATUS_LIST, PRIORITY_LIST } from "../../constants";
import { toI18nKey } from "../../utils";
import { notifyError, formatError } from "../../notify";
import type { MyDayState } from "../../../shared/types";

interface QuickMenuCallbacks {
    onScheduleRemoved: (newState: MyDayState) => void;
    onTaskUpdated: (updated: TaskCacheEntry) => void;
    onRemovedFromMyDay: (newState: MyDayState) => void;
}

export function showTaskQuickMenu(
    task: TaskCacheEntry,
    x: number,
    y: number,
    bridge: KernelBridge,
    i18n: any,
    callbacks: QuickMenuCallbacks,
): void {
    const menu = new Menu("na-timeline-quick");

    menu.addItem({
        icon: "iconClose",
        label: i18n?.cancelSchedule || "Unschedule",
        click: async () => {
            try {
                const newState = await bridge.removeMyDaySchedule(task.blockId);
                callbacks.onScheduleRemoved(newState);
            } catch (e: any) {
                notifyError(formatError(e));
            }
        },
    });

    menu.addSeparator();

    menu.addItem({
        icon: "iconSelect",
        label: i18n?.markComplete || "Mark Complete",
        click: async () => {
            try {
                const updated = await bridge.updateTask(task.blockId, { "na-status": "done" });
                callbacks.onTaskUpdated(updated);
            } catch (e: any) {
                notifyError(formatError(e));
            }
        },
    });

    menu.addItem({
        icon: "iconSort",
        label: i18n?.setPriority || "Set Priority",
        type: "submenu",
        submenu: PRIORITY_LIST.map((p) => ({
            icon: p === task.priority ? "iconSelect" : "",
            label: i18n?.[toI18nKey("priority", p)] || p,
            click: async () => {
                try {
                    const updated = await bridge.updateTask(task.blockId, { "na-priority": p });
                    callbacks.onTaskUpdated(updated);
                } catch (e: any) {
                    notifyError(formatError(e));
                }
            },
        })),
    });

    menu.addSeparator();

    menu.addItem({
        icon: "iconTrashcan",
        label: i18n?.removeFromMyDay || "Remove from My Day",
        click: async () => {
            try {
                const newState = await bridge.removeTaskFromMyDay(task.blockId);
                callbacks.onRemovedFromMyDay(newState);
            } catch (e: any) {
                notifyError(formatError(e));
            }
        },
    });

    menu.open({ x, y });
}
```

- [ ] **步骤 2：创建 TimelineCard.svelte**

创建 `src/frontend/components/timeline/TimelineCard.svelte`：

```svelte
<script lang="ts">
    import { tick } from "svelte";
    import {
        PIXELS_PER_MINUTE,
        DRAG_SNAP_MINUTES,
        MIN_SCHEDULE_DURATION,
        RESIZE_HANDLE_HEIGHT,
        CLICK_THRESHOLD_PX,
        DAY_MINUTES,
    } from "../../../shared/constants";
    import type { MyDayTaskEntry, TaskCacheEntry, MyDayState } from "../../../shared/types";
    import type { KernelBridge } from "../../kernel-bridge";
    import { PRIORITY_COLORS } from "../../constants";
    import { minuteToTimeLabel, minuteToPixel, snapMinute } from "./timeline-utils";
    import { showTaskQuickMenu } from "./TaskQuickMenu";
    import { notifyError, formatError } from "../../notify";
    import { taskStore } from "../../stores/task-store";

    export let entry: MyDayTaskEntry;
    export let task: TaskCacheEntry;
    export let resetHour: number = 5;
    export let laneIndex: number = 0;
    export let laneCount: number = 1;
    export let containerWidth: number = 0;
    export let bridge: KernelBridge;
    export let i18n: any;

    type DragMode = "none" | "move" | "resize-start" | "resize-end";

    let dragMode: DragMode = "none";
    let pointerId: number = -1;
    let originClientY: number = 0;
    let originStart: number = 0;
    let originEnd: number = 0;
    let previewStart: number = 0;
    let previewEnd: number = 0;
    let originClientX: number = 0;
    let isDragging: boolean = false;

    $: duration = (entry.scheduleEnd ?? 0) - (entry.scheduleStart ?? 0);
    $: cardTop = minuteToPixel(entry.scheduleStart ?? 0);
    $: cardHeight = minuteToPixel(duration);
    $: cardWidth = laneCount > 0 ? (containerWidth / laneCount) - 4 : containerWidth;
    $: cardLeft = laneIndex * (containerWidth / laneCount);
    $: timeLabel = minuteToTimeLabel(entry.scheduleStart ?? 0, resetHour);
    $: endTimeLabel = minuteToTimeLabel(entry.scheduleEnd ?? 0, resetHour);
    $: priorityColor = PRIORITY_COLORS[task.priority] || "var(--na-priority-medium)";

    // 拖拽预览位置
    $: displayTop = isDragging ? minuteToPixel(previewStart) : cardTop;
    $: displayHeight = isDragging ? minuteToPixel(previewEnd - previewStart) : cardHeight;

    function handlePointerDown(e: PointerEvent, mode: DragMode) {
        e.preventDefault();
        e.stopPropagation();
        dragMode = mode;
        pointerId = e.pointerId;
        originClientY = e.clientY;
        originClientX = e.clientX;
        originStart = entry.scheduleStart ?? 0;
        originEnd = entry.scheduleEnd ?? 0;
        previewStart = originStart;
        previewEnd = originEnd;
        isDragging = false;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }

    function handlePointerMove(e: PointerEvent) {
        if (dragMode === "none") return;
        const dy = e.clientY - originClientY;
        const dm = dy / PIXELS_PER_MINUTE;

        if (Math.abs(dy) > CLICK_THRESHOLD_PX || isDragging) {
            isDragging = true;
        }

        if (!isDragging) return;

        if (dragMode === "move") {
            const newStart = snapMinute(originStart + dm);
            const clampedStart = Math.max(0, Math.min(DAY_MINUTES - duration, newStart));
            previewStart = clampedStart;
            previewEnd = clampedStart + duration;
        } else if (dragMode === "resize-start") {
            const newStart = snapMinute(originStart + dm);
            const maxStart = originEnd - MIN_SCHEDULE_DURATION;
            previewStart = Math.max(0, Math.min(maxStart, newStart));
            previewEnd = originEnd;
        } else if (dragMode === "resize-end") {
            const newEnd = snapMinute(originEnd + dm);
            const minEnd = originStart + MIN_SCHEDULE_DURATION;
            previewEnd = Math.min(DAY_MINUTES, Math.max(minEnd, newEnd));
            previewStart = originStart;
        }
    }

    function handlePointerUp(e: PointerEvent) {
        if (dragMode === "none") return;
        const currentMode = dragMode;
        dragMode = "none";

        if (!isDragging) {
            // 视为点击，弹出操作菜单
            showTaskQuickMenu(task, e.clientX, e.clientY, bridge, i18n, {
                onScheduleRemoved: (newState: MyDayState) => {
                    taskStore.applyMyDayUpdate(newState);
                },
                onTaskUpdated: (updated: TaskCacheEntry) => {
                    taskStore.applyUpdate(updated);
                },
                onRemovedFromMyDay: (newState: MyDayState) => {
                    taskStore.applyMyDayUpdate(newState);
                },
            });
            isDragging = false;
            return;
        }

        isDragging = false;

        // 判断是否拖到左侧面板区域（x 偏移很大）
        const dx = e.clientX - originClientX;
        const isDropToLeft = dx < -100;

        if (isDropToLeft && currentMode === "move") {
            // 取消排期
            bridge.removeMyDaySchedule(entry.blockId)
                .then((newState) => taskStore.applyMyDayUpdate(newState))
                .catch((err) => notifyError(formatError(err)));
        } else if (previewStart !== originStart || previewEnd !== originEnd) {
            // 更新排期
            bridge.setMyDaySchedule(entry.blockId, previewStart, previewEnd)
                .then((newState) => taskStore.applyMyDayUpdate(newState))
                .catch((err) => notifyError(formatError(err)));
        }
    }
</script>

<div
    class="na-timeline-card"
    class:na-timeline-card--dragging={isDragging}
    style="top: {displayTop}px; height: {displayHeight}px; left: {cardLeft + 2}px; width: {cardWidth}px;"
    on:pointerdown={(e) => handlePointerDown(e, "move")}
    on:pointermove={handlePointerMove}
    on:pointerup={handlePointerUp}
>
    <!-- 顶部 resize 手柄 -->
    <div
        class="na-timeline-card__handle na-timeline-card__handle--top"
        on:pointerdown|stopPropagation={(e) => handlePointerDown(e, "resize-start")}
    ></div>

    <!-- 卡片内容 -->
    <div class="na-timeline-card__content">
        <span class="na-timeline-card__dot" style="background: {priorityColor}"></span>
        <span class="na-timeline-card__name">{task.title}</span>
        <span class="na-timeline-card__time">{timeLabel} - {endTimeLabel}</span>
    </div>

    <!-- 底部 resize 手柄 -->
    <div
        class="na-timeline-card__handle na-timeline-card__handle--bottom"
        on:pointerdown|stopPropagation={(e) => handlePointerDown(e, "resize-end")}
    ></div>
</div>

<style lang="scss">
    .na-timeline-card {
        position: absolute;
        border-radius: 4px;
        background: var(--b3-theme-surface-lighter, rgba(255, 255, 255, 0.06));
        border-left: 3px solid var(--na-accent, #3b82f6);
        cursor: grab;
        user-select: none;
        touch-action: none;
        overflow: hidden;
        z-index: 5;

        &:hover {
            background: var(--b3-theme-surface-hover, rgba(255, 255, 255, 0.1));
        }

        &:active {
            cursor: grabbing;
        }
    }

    .na-timeline-card--dragging {
        opacity: 0.85;
        z-index: 20;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .na-timeline-card__handle {
        position: absolute;
        left: 0;
        right: 0;
        height: 6px;
        cursor: ns-resize;

        &--top {
            top: 0;
        }

        &--bottom {
            bottom: 0;
        }

        &:hover {
            background: var(--na-accent, rgba(59, 130, 246, 0.2));
        }
    }

    .na-timeline-card__content {
        display: flex;
        flex-direction: column;
        gap: 1px;
        padding: 3px 6px;
        overflow: hidden;
        pointer-events: none;
    }

    .na-timeline-card__dot {
        flex-shrink: 0;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        align-self: flex-start;
    }

    .na-timeline-card__name {
        font-size: 11px;
        font-weight: 500;
        color: var(--b3-theme-on-surface, #e0e0e0);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .na-timeline-card__time {
        font-size: 10px;
        color: var(--b3-theme-on-surface-dim, #888);
    }
</style>
```

- [ ] **步骤 3：构建验证**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build`
预期：构建成功

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/components/timeline/TimelineCard.svelte src/frontend/components/timeline/TaskQuickMenu.ts
git commit -m "feat: add TimelineCard and TaskQuickMenu components"
```

---

## 任务 7：TimelineColumn 组件

**文件：**
- 创建：`src/frontend/components/timeline/TimelineColumn.svelte`

- [ ] **步骤 1：创建 TimelineColumn.svelte**

创建 `src/frontend/components/timeline/TimelineColumn.svelte`：

```svelte
<script lang="ts">
    import { onMount, tick } from "svelte";
    import {
        PIXELS_PER_MINUTE,
        TIMELINE_SLOT_MINUTES,
        DAY_MINUTES,
        DEFAULT_SCHEDULE_DURATION,
        DRAG_SNAP_MINUTES,
        MY_DAY_DRAG_TYPE,
    } from "../../../shared/constants";
    import type { MyDayTaskEntry, TaskCacheEntry, MyDayState } from "../../../shared/types";
    import type { KernelBridge } from "../../kernel-bridge";
    import { taskStore } from "../../stores/task-store";
    import { notifyError, formatError } from "../../notify";
    import {
        minuteToPixel,
        pixelToSnappedMinute,
        computeLaneLayouts,
        generateTimelineSlots,
        minuteToTimeLabel,
        getCurrentMinuteOffset,
    } from "./timeline-utils";
    import TimelineCard from "./TimelineCard.svelte";
    import TimelineNeedle from "./TimelineNeedle.svelte";

    export let scheduledEntries: MyDayTaskEntry[] = [];
    export let taskMap: Map<string, TaskCacheEntry>;
    export let resetHour: number = 5;
    export let bridge: KernelBridge;
    export let i18n: any;

    let containerEl: HTMLElement | null = null;
    let containerWidth: number = 300;
    let isDragOver: boolean = false;
    let dragPreviewStart: number | null = null;
    let dragPreviewEnd: number | null = null;

    $: totalHeight = DAY_MINUTES * PIXELS_PER_MINUTE;
    $: laneLayouts = computeLaneLayouts(scheduledEntries);
    $: slots = generateTimelineSlots(resetHour, TIMELINE_SLOT_MINUTES);
    $: labelWidth = "46px";

    function handleDragOver(e: DragEvent) {
        e.preventDefault();
        if (!e.dataTransfer?.types.includes(MY_DAY_DRAG_TYPE)) return;
        e.dataTransfer.dropEffect = "move";
        isDragOver = true;

        if (containerEl && e.clientY !== 0) {
            const rect = containerEl.getBoundingClientRect();
            const offsetY = e.clientY - rect.top + containerEl.scrollTop;
            const snapped = pixelToSnappedMinute(offsetY);
            dragPreviewStart = Math.max(0, Math.min(DAY_MINUTES - DEFAULT_SCHEDULE_DURATION, snapped));
            dragPreviewEnd = dragPreviewStart + DEFAULT_SCHEDULE_DURATION;
        }

        // 自动滚动
        if (containerEl) {
            const rect = containerEl.getBoundingClientRect();
            const edgeZone = 40;
            if (e.clientY - rect.top < edgeZone) {
                containerEl.scrollTop -= 10;
            } else if (rect.bottom - e.clientY < edgeZone) {
                containerEl.scrollTop += 10;
            }
        }
    }

    function handleDragLeave() {
        isDragOver = false;
        dragPreviewStart = null;
        dragPreviewEnd = null;
    }

    async function handleDrop(e: DragEvent) {
        e.preventDefault();
        isDragOver = false;
        if (!e.dataTransfer?.types.includes(MY_DAY_DRAG_TYPE)) return;

        const blockId = e.dataTransfer.getData(MY_DAY_DRAG_TYPE);
        if (!blockId || dragPreviewStart === null) return;

        try {
            const newState = await bridge.setMyDaySchedule(
                blockId,
                dragPreviewStart,
                dragPreviewEnd!,
            );
            taskStore.applyMyDayUpdate(newState);
        } catch (err: any) {
            notifyError(formatError(err));
        }
        dragPreviewStart = null;
        dragPreviewEnd = null;
    }

    function scrollToCurrentTime() {
        if (!containerEl) return;
        const currentOffset = getCurrentMinuteOffset(resetHour);
        const targetTop = minuteToPixel(currentOffset) - containerEl.clientHeight / 3;
        containerEl.scrollTop = Math.max(0, targetTop);
    }

    onMount(() => {
        scrollToCurrentTime();
        if (containerEl) {
            const resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    containerWidth = entry.contentRect.width;
                }
            });
            resizeObserver.observe(containerEl);
            return () => resizeObserver.disconnect();
        }
    });
</script>

<div class="na-timeline-column" bind:this={containerEl}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
>
    <div class="na-timeline-column__body" style="height: {totalHeight}px; position: relative;">
        <!-- 刻度线 -->
        {#each slots as slot (slot.minute)}
            <div
                class="na-timeline-slot"
                class:na-timeline-slot--major={slot.isMajor}
                style="top: {minuteToPixel(slot.minute)}px"
            >
                {#if slot.isMajor}
                    <span class="na-timeline-slot__label">{slot.label}</span>
                {/if}
            </div>
        {/each}

        <!-- 拖拽预览 -->
        {#if isDragOver && dragPreviewStart !== null && dragPreviewEnd !== null}
            <div
                class="na-timeline-preview"
                style="top: {minuteToPixel(dragPreviewStart)}px; height: {minuteToPixel(dragPreviewEnd - dragPreviewStart)}px;"
            >
                <span class="na-timeline-preview__time">
                    {minuteToTimeLabel(dragPreviewStart, resetHour)} - {minuteToTimeLabel(dragPreviewEnd, resetHour)}
                </span>
            </div>
        {/if}

        <!-- 已排期任务卡片 -->
        {#each scheduledEntries as entry (entry.blockId)}
            {@const task = taskMap.get(entry.blockId)}
            {@const layout = laneLayouts.get(entry.blockId)}
            {#if task && layout}
                <TimelineCard
                    {entry}
                    {task}
                    {resetHour}
                    laneIndex={layout.laneIndex}
                    laneCount={layout.laneCount}
                    {containerWidth}
                    {bridge}
                    {i18n}
                />
            {/if}
        {/each}

        <!-- 当前时间指示线 -->
        <TimelineNeedle {resetHour} containerHeight={totalHeight} />
    </div>
</div>

<style lang="scss">
    .na-timeline-column {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        position: relative;
        background: var(--b3-theme-background, #111);
    }

    .na-timeline-column__body {
        position: relative;
        padding-left: 46px;
    }

    .na-timeline-slot {
        position: absolute;
        left: 0;
        right: 0;
        height: 1px;
        background: var(--b3-theme-surface-lighter, rgba(255, 255, 255, 0.05));

        &--major {
            background: var(--b3-theme-surface-lighter, rgba(255, 255, 255, 0.12));
        }
    }

    .na-timeline-slot__label {
        position: absolute;
        left: -46px;
        top: -8px;
        width: 42px;
        text-align: right;
        font-size: 10px;
        color: var(--b3-theme-on-surface-dim, #888);
        pointer-events: none;
    }

    .na-timeline-preview {
        position: absolute;
        left: 4px;
        right: 4px;
        background: var(--na-accent-dim, rgba(59, 130, 246, 0.15));
        border: 2px dashed var(--na-accent, #3b82f6);
        border-radius: 4px;
        z-index: 15;
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .na-timeline-preview__time {
        font-size: 11px;
        color: var(--na-accent, #3b82f6);
        font-weight: 500;
    }
</style>
```

- [ ] **步骤 2：构建验证**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build`
预期：构建成功

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/timeline/TimelineColumn.svelte
git commit -m "feat: add TimelineColumn component with drop handling and slot rendering"
```

---

## 任务 8：TimelineView 主容器组件

**文件：**
- 创建：`src/frontend/components/timeline/TimelineView.svelte`

- [ ] **步骤 1：创建 TimelineView.svelte**

创建 `src/frontend/components/timeline/TimelineView.svelte`：

```svelte
<script lang="ts">
    import { onMount } from "svelte";
    import { UNSCHEDULED_PANEL_WIDTH, RESPONSIVE_BREAKPOINT, MY_DAY_DRAG_TYPE } from "../../../shared/constants";
    import type { MyDayTaskEntry, TaskCacheEntry, MyDayState } from "../../../shared/types";
    import type { KernelBridge } from "../../kernel-bridge";
    import { taskStore } from "../../stores/task-store";
    import UnscheduledPanel from "./UnscheduledPanel.svelte";
    import TimelineColumn from "./TimelineColumn.svelte";

    export let bridge: KernelBridge;
    export let i18n: any;
    export let resetHour: number = 5;

    let containerWidth: number = 600;
    let containerEl: HTMLElement | null = null;
    let isNarrow: boolean = false;
    let dropTargetActive: boolean = false;

    $: myDayState = $taskStore.myDayState;
    $: allTasks = $taskStore.allTasks;
    $: taskMap = new Map<string, TaskCacheEntry>(allTasks.map((t) => [t.blockId, t] as [string, TaskCacheEntry]));

    $: unscheduledEntries = (myDayState?.tasks ?? []).filter(
        (e) => e.scheduleStart === null || e.scheduleEnd === null,
    );
    $: scheduledEntries = (myDayState?.tasks ?? []).filter(
        (e) => e.scheduleStart !== null && e.scheduleEnd !== null,
    );

    function handleDragOver(e: DragEvent) {
        if (!e.dataTransfer?.types.includes(MY_DAY_DRAG_TYPE)) return;
        e.preventDefault();
        dropTargetActive = true;
    }

    function handleDragLeave() {
        dropTargetActive = false;
    }

    async function handleDropOnUnscheduled(e: DragEvent) {
        e.preventDefault();
        dropTargetActive = false;
        if (!e.dataTransfer?.types.includes(MY_DAY_DRAG_TYPE)) return;
        const blockId = e.dataTransfer.getData(MY_DAY_DRAG_TYPE);
        if (!blockId) return;
        try {
            const newState = await bridge.removeMyDaySchedule(blockId);
            taskStore.applyMyDayUpdate(newState);
        } catch (err: any) {
            // ignore - task may not have been scheduled
        }
    }

    onMount(() => {
        if (containerEl) {
            const observer = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    containerWidth = entry.contentRect.width;
                    isNarrow = containerWidth < RESPONSIVE_BREAKPOINT;
                }
            });
            observer.observe(containerEl);
            return () => observer.disconnect();
        }
    });
</script>

<div class="na-timeline-view" bind:this={containerEl}>
    {#if isNarrow}
        <!-- 窄屏：上下排列 -->
        <div class="na-timeline-view__top">
            <UnscheduledPanel
                {unscheduledEntries}
                {taskMap}
                {i18n}
                isDropTarget={dropTargetActive}
                on:dragover={handleDragOver}
                on:dragleave={handleDragLeave}
                on:drop={handleDropOnUnscheduled}
            />
        </div>
        <div class="na-timeline-view__bottom">
            <TimelineColumn
                {scheduledEntries}
                {taskMap}
                {resetHour}
                {bridge}
                {i18n}
            />
        </div>
    {:else}
        <!-- 宽屏：左右分栏 -->
        <div class="na-timeline-view__left">
            <UnscheduledPanel
                {unscheduledEntries}
                {taskMap}
                {i18n}
                isDropTarget={dropTargetActive}
                on:dragover={handleDragOver}
                on:dragleave={handleDragLeave}
                on:drop={handleDropOnUnscheduled}
            />
        </div>
        <div class="na-timeline-view__right">
            <TimelineColumn
                {scheduledEntries}
                {taskMap}
                {resetHour}
                {bridge}
                {i18n}
            />
        </div>
    {/if}
</div>

<style lang="scss">
    .na-timeline-view {
        display: flex;
        height: 100%;
        overflow: hidden;

        &:not(.na-timeline-view--narrow) {
            flex-direction: row;
        }
    }

    .na-timeline-view--narrow {
        flex-direction: column;
    }

    .na-timeline-view__left {
        width: 220px;
        flex-shrink: 0;
    }

    .na-timeline-view__right {
        flex: 1;
        min-width: 0;
    }

    .na-timeline-view__top {
        height: 120px;
        flex-shrink: 0;
        border-bottom: 1px solid var(--b3-theme-surface-lighter, rgba(255, 255, 255, 0.08));
    }

    .na-timeline-view__bottom {
        flex: 1;
        min-height: 0;
    }
</style>
```

- [ ] **步骤 2：构建验证**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build`
预期：构建成功

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/components/timeline/TimelineView.svelte
git commit -m "feat: add TimelineView container with responsive layout"
```

---

## 任务 9：MyDayView 集成时间线模式 + 视图切换

**文件：**
- 修改：`src/frontend/components/MyDayView.svelte`

- [ ] **步骤 1：修改 MyDayView.svelte，增加列表/时间线切换按钮**

将 `src/frontend/components/MyDayView.svelte` 的完整内容替换为：

```svelte
<script lang="ts">
    import { onMount } from "svelte";
    import { taskStore } from "../stores/task-store";
    import { VIEW_MY_DAY } from "../constants";
    import { DEFAULT_MY_DAY_RESET_HOUR } from "../../shared/constants";
    import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import SearchFilterBar from "./SearchFilterBar.svelte";
    import TimelineView from "./timeline/TimelineView.svelte";
    import type { TaskCacheEntry } from "../../shared/types";
    import type { KernelBridge } from "../kernel-bridge";

    export let bridge: KernelBridge;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let i18n: any;
    export let selectedTaskId: string = "";
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;

    type ViewMode = "timeline" | "list";
    let viewMode: ViewMode = "timeline";

    $: filterState = $taskStore.filterByView[VIEW_MY_DAY] || DEFAULT_FILTER_STATE;
    $: resetHour = $taskStore.settings?.myDayResetHour ?? DEFAULT_MY_DAY_RESET_HOUR;

    $: myDayTasks = (() => {
        const state = $taskStore.myDayState;
        if (!state) return [];
        const taskMap = new Map<string, TaskCacheEntry>();
        for (const t of $taskStore.allTasks) {
            taskMap.set(t.blockId, t);
        }
        const result: TaskCacheEntry[] = [];
        for (const entry of state.tasks) {
            const task = taskMap.get(entry.blockId);
            if (task) result.push(task);
        }
        return result;
    })();

    $: filteredTasks = applyFilters(myDayTasks, filterState);

    const myDaySortOptions = [
        { value: "order", label: i18n?.sortByOrder || "Comprehensive" },
        { value: "due", label: i18n?.sortByDue || "Due date" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
    ];

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_MY_DAY, state);
    }

    onMount(() => {
        taskStore.loadMyDay();
    });
</script>

<div class="na-view na-view--myday">
    <div class="na-view__header">
        <div class="na-myday-title">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="var(--na-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="10" cy="10" r="4"/>
                <line x1="10" y1="2" x2="10" y2="3.5"/>
                <line x1="10" y1="16.5" x2="10" y2="18"/>
                <line x1="2" y1="10" x2="3.5" y2="10"/>
                <line x1="16.5" y1="10" x2="18" y2="10"/>
                <line x1="4.4" y1="4.4" x2="5.5" y2="5.5"/>
                <line x1="14.5" y1="14.5" x2="15.6" y2="15.6"/>
                <line x1="4.4" y1="15.6" x2="5.5" y2="14.5"/>
                <line x1="14.5" y1="5.5" x2="15.6" y2="4.4"/>
            </svg>
            <span class="na-myday-title__text">{i18n?.myDay || "My Day"}</span>
        </div>
        <div class="na-myday-mode-toggle">
            <button
                class="na-myday-mode-btn"
                class:na-myday-mode-btn--active={viewMode === "timeline"}
                on:click={() => viewMode = "timeline"}
            >
                {i18n?.timelineMode || "Timeline"}
            </button>
            <button
                class="na-myday-mode-btn"
                class:na-myday-mode-btn--active={viewMode === "list"}
                on:click={() => viewMode = "list"}
            >
                {i18n?.listMode || "List"}
            </button>
        </div>
    </div>

    {#if viewMode === "timeline"}
        <TimelineView {bridge} {i18n} {resetHour} />
    {:else}
        <SearchFilterBar
            contexts={$taskStore.contexts}
            tags={$taskStore.tags}
            filterState={filterState}
            showStatus={true}
            showPriority={true}
            sortOptions={myDaySortOptions}
            {i18n}
            onFilterChange={handleFilterChange}
        />
        {#if $taskStore.loading}
            <NaEmpty loading={true} />
        {:else if filteredTasks.length === 0}
            <NaEmpty text={i18n?.noMyDayTasks || "No tasks planned for today."} />
        {:else}
            <div class="na-view__list">
                {#each filteredTasks as task (task.blockId)}
                    <TaskCard
                        {task}
                        selected={task.blockId === selectedTaskId}
                        onSelect={onSelectTask}
                        {onEdit}
                        {onStatusClick}
                        {onContextMenu}
                        {i18n}
                    />
                {/each}
            </div>
        {/if}
    {/if}
</div>

<style lang="scss">
    .na-myday-title {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm, 6px);
        padding: var(--na-space-md, 8px) var(--na-space-lg, 12px);
    }

    .na-myday-title__text {
        font-size: var(--na-font-size-lg, 15px);
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }

    .na-myday-mode-toggle {
        display: flex;
        gap: 2px;
        margin-left: auto;
        padding-right: var(--na-space-lg, 12px);
    }

    .na-myday-mode-btn {
        padding: 3px 10px;
        font-size: 11px;
        border: 1px solid var(--b3-theme-surface-lighter, rgba(255, 255, 255, 0.1));
        background: transparent;
        color: var(--b3-theme-on-surface-dim, #888);
        cursor: pointer;
        border-radius: 3px;
        transition: all 0.15s;

        &:first-child {
            border-radius: 3px 0 0 3px;
        }

        &:last-child {
            border-radius: 0 3px 3px 0;
        }

        &--active {
            background: var(--na-accent, #3b82f6);
            color: var(--b3-theme-on-primary, #fff);
            border-color: var(--na-accent, #3b82f6);
        }
    }
</style>
```

- [ ] **步骤 2：构建验证**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build`
预期：构建成功

- [ ] **步骤 3：部署测试**

运行：`cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run release`

在思源中打开"我的一天"视图，验证：
1. 默认显示时间线模式（左侧未排期面板 + 右侧垂直时间线）
2. 点击"列表"按钮切换到原有列表模式
3. 从其他视图右键添加任务到"我的一天"后，任务出现在左侧未排期面板
4. 将任务从左侧拖到时间线，任务排期成功显示为时间线卡片
5. 拖拽时间线卡片移动排期时间
6. 拖拽卡片上下边缘调整时长
7. 点击时间线卡片弹出操作菜单（取消排期/完成/优先级/移除）
8. 将时间线卡片拖回左侧面板取消排期
9. 当前时间红色指示线显示正确
10. 窄屏下布局自动切换为上下排列

- [ ] **步骤 4：Commit**

```bash
git add src/frontend/components/MyDayView.svelte
git commit -m "feat: integrate TimelineView into MyDayView with list/timeline mode toggle"
```
