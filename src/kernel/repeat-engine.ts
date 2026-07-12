interface RepeatRule {
    freq: "day" | "week" | "month" | "year";
    interval: number;
    from: "due" | "complete";
}

export function parseRepeatRule(json: string): RepeatRule | null {
    try {
        const parsed = JSON.parse(json);
        if (!["day", "week", "month", "year"].includes(parsed.freq)) return null;
        if (typeof parsed.interval !== "number" || parsed.interval < 1 || !Number.isInteger(parsed.interval)) return null;
        if (parsed.from !== undefined && !["due", "complete"].includes(parsed.from)) return null;
        return {
            freq: parsed.freq,
            interval: parsed.interval,
            from: parsed.from || "due",
        };
    } catch {
        return null;
    }
}

export function calculateNextDate(baseDate: string, rule: RepeatRule): string {
    const date = new Date(baseDate + "T00:00:00Z");
    switch (rule.freq) {
        case "day":
            date.setUTCDate(date.getUTCDate() + rule.interval);
            break;
        case "week":
            date.setUTCDate(date.getUTCDate() + rule.interval * 7);
            break;
        case "month": {
            const targetMonth = date.getUTCMonth() + rule.interval;
            const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12);
            const adjustedMonth = targetMonth % 12;
            const lastDay = new Date(Date.UTC(targetYear, adjustedMonth + 1, 0)).getUTCDate();
            date.setUTCFullYear(targetYear, adjustedMonth, Math.min(date.getUTCDate(), lastDay));
            break;
        }
        case "year": {
            const targetYear = date.getUTCFullYear() + rule.interval;
            const lastDay = new Date(Date.UTC(targetYear, date.getUTCMonth() + 1, 0)).getUTCDate();
            date.setUTCFullYear(targetYear, date.getUTCMonth(), Math.min(date.getUTCDate(), lastDay));
            break;
        }
    }
    return date.toISOString().slice(0, 10);
}
