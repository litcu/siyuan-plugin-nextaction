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
    let offsetText: string;
    if (mins % 1440 === 0) {
        offsetText = `${mins / 1440}${i18n?.reminderOffsetDays || "天"}`;
    } else if (mins % 60 === 0) {
        offsetText = `${mins / 60}${i18n?.reminderOffsetHours || "小时"}`;
    } else {
        offsetText = `${mins}${i18n?.reminderOffsetMinutes || "分钟"}`;
    }
    const template = i18n?.reminderBeforeDue || "截止时间{n}前";
    return template.replace("{n}", offsetText);
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
