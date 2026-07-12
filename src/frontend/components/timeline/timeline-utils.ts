import {
    PIXELS_PER_MINUTE,
    DRAG_SNAP_MINUTES,
    DAY_MINUTES,
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
