import * as en from "chrono-node/en";
import * as zhHans from "chrono-node/zh/hans";
import type { ParsedResult, Parser } from "chrono-node/en";

export interface NaturalDateMatch {
    value: string;
    text: string;
    index: number;
    endIndex: number;
    hasExplicitTime: boolean;
    hasExplicitDate: boolean;
    isRelativeWeekday: boolean;
}

export interface NaturalDateOptions {
    referenceDate?: Date;
    forwardDate?: boolean;
    requireTime?: boolean;
    defaultTime?: string;
}

export interface TaskTitleDates {
    start?: NaturalDateMatch;
    due?: NaturalDateMatch;
}

const monthEndParser: Parser = {
    pattern: () =>
        /(下(?:个)?月(?:底|末))|((?:本月|这个月|当月|月)(?:底|末))|(end\s+of\s+(?:the\s+)?(?:(next|this)\s+)?month)/i,
    extract: (context, match) => {
        const isNextMonth = !!match[1] || match[4]?.toLowerCase() === "next";
        const reference = context.refDate;
        const lastDay = new Date(reference.getFullYear(), reference.getMonth() + (isNextMonth ? 2 : 1), 0);
        return {
            year: lastDay.getFullYear(),
            month: lastDay.getMonth() + 1,
            day: lastDay.getDate(),
        };
    },
};

const zhParser = zhHans.casual.clone();
const enParser = en.casual.clone();

function addZhWeekdayGroupCompatibility(parser: Parser): Parser {
    let usesNamedWeekdayGroup = false;
    try {
        usesNamedWeekdayGroup = parser.pattern({} as never).source.includes("(?<weekday>");
    } catch (_error) {
        return parser;
    }
    if (!usesNamedWeekdayGroup) return parser;

    return {
        pattern: (context) => parser.pattern(context),
        extract: (context, match) => {
            // Some SiYuan kernel runtimes accept named-group syntax but omit
            // RegExpMatchArray.groups. Chrono's Chinese weekday parsers read
            // those groups directly, so reconstruct only the missing captures
            // and leave all date calculation to chrono-node.
            if (!match.groups) {
                const relation = /(上|下|这)(?:个)?(?:星期|礼拜|周)([天日一二三四五六])/.exec(match[0]);
                const weekday = relation || /(?:星期|礼拜|周)([天日一二三四五六])/.exec(match[0]);
                if (weekday) {
                    match.groups = relation ? { prefix: relation[1], weekday: relation[2] } : { weekday: weekday[1] };
                }
            }
            return parser.extract(context, match);
        },
    };
}

for (let index = 0; index < zhParser.parsers.length; index++) {
    zhParser.parsers[index] = addZhWeekdayGroupCompatibility(zhParser.parsers[index]);
}
zhParser.parsers.unshift(monthEndParser);
enParser.parsers.unshift(monthEndParser);

function pad(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}

function toLocalValue(date: Date, hasExplicitTime: boolean, options: NaturalDateOptions): string {
    const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    if (!hasExplicitTime && !options.requireTime) return datePart;

    if (!hasExplicitTime) {
        const [hour = "09", minute = "00"] = (options.defaultTime || "09:00").split(":");
        return `${datePart}T${pad(Math.max(0, Math.min(23, Number(hour) || 0)))}:${pad(Math.max(0, Math.min(59, Number(minute) || 0)))}`;
    }
    return `${datePart}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromChronoResult(result: ParsedResult, options: NaturalDateOptions): NaturalDateMatch | null {
    if (result.end) return null;
    const date = result.start.date();
    if (!Number.isFinite(date.getTime())) return null;

    const hasExplicitTime = result.start.isCertain("hour") || result.start.isCertain("minute");
    const hasExplicitDate =
        result.start.isCertain("year") ||
        result.start.isCertain("month") ||
        result.start.isCertain("day") ||
        result.start.isCertain("weekday");
    return {
        value: toLocalValue(date, hasExplicitTime, options),
        text: result.text,
        index: result.index,
        endIndex: result.index + result.text.length,
        hasExplicitTime,
        hasExplicitDate,
        isRelativeWeekday:
            result.start.isCertain("weekday") &&
            (!result.start.isCertain("year") || !result.start.isCertain("month") || !result.start.isCertain("day")),
    };
}

function overlaps(left: NaturalDateMatch, right: NaturalDateMatch): boolean {
    return left.index < right.endIndex && right.index < left.endIndex;
}

function combineAdjacentDateAndTime(matches: NaturalDateMatch[], input: string): NaturalDateMatch[] {
    const combined: NaturalDateMatch[] = [];
    for (let index = 0; index < matches.length; index++) {
        const current = matches[index];
        const next = matches[index + 1];
        if (next) {
            const separator = input.slice(current.endIndex, next.index);
            const dateMatch =
                current.hasExplicitDate && !current.hasExplicitTime
                    ? current
                    : next.hasExplicitDate && !next.hasExplicitTime
                      ? next
                      : null;
            const timeMatch =
                current.hasExplicitTime && !current.hasExplicitDate
                    ? current
                    : next.hasExplicitTime && !next.hasExplicitDate
                      ? next
                      : null;
            if (dateMatch && timeMatch && /^[\s,，的]*$/.test(separator)) {
                const datePart = dateMatch.value.split("T")[0];
                const timePart = timeMatch.value.split("T")[1];
                if (timePart) {
                    combined.push({
                        value: `${datePart}T${timePart}`,
                        text: input.slice(current.index, next.endIndex),
                        index: current.index,
                        endIndex: next.endIndex,
                        hasExplicitTime: true,
                        hasExplicitDate: true,
                        isRelativeWeekday: dateMatch.isRelativeWeekday,
                    });
                    index++;
                    continue;
                }
            }
        }
        combined.push(current);
    }
    return combined;
}

export function parseNaturalDates(text: string, options: NaturalDateOptions = {}): NaturalDateMatch[] {
    const input = text.trim();
    if (!input) return [];

    const referenceDate = options.referenceDate || new Date();
    const parsingOptions = { forwardDate: options.forwardDate ?? true };
    let zhResults: ParsedResult[] = [];
    let enResults: ParsedResult[] = [];
    try {
        zhResults = zhParser.parse(input, referenceDate, parsingOptions);
    } catch (_error) {
        // Semantic parsing is an optional enhancement and must never block a
        // task conversion or a date control when one locale parser fails.
    }
    try {
        enResults = enParser.parse(input, referenceDate, parsingOptions);
    } catch (_error) {
        // Keep results from the other locale when available.
    }
    const candidates = [...zhResults, ...enResults]
        .map((result) => fromChronoResult(result, options))
        .filter((result): result is NaturalDateMatch => !!result)
        .sort((left, right) => left.index - right.index || right.text.length - left.text.length);

    const merged: NaturalDateMatch[] = [];
    for (const candidate of candidates) {
        const duplicate = merged.find(
            (existing) =>
                existing.index === candidate.index &&
                existing.endIndex === candidate.endIndex &&
                existing.value === candidate.value,
        );
        if (duplicate) continue;

        const overlappingIndex = merged.findIndex((existing) => overlaps(existing, candidate));
        if (overlappingIndex === -1) {
            merged.push(candidate);
        } else if (candidate.text.length > merged[overlappingIndex].text.length) {
            merged[overlappingIndex] = candidate;
        }
    }
    return combineAdjacentDateAndTime(
        merged.sort((left, right) => left.index - right.index),
        input,
    );
}

export function parseNaturalDate(text: string, options: NaturalDateOptions = {}): NaturalDateMatch | null {
    const matches = parseNaturalDates(text, options);
    return matches.length === 1 ? matches[0] : null;
}

type TaskDateRole = "start" | "due";

function dateRole(title: string, match: NaturalDateMatch): TaskDateRole | null {
    const before = title.slice(Math.max(0, match.index - 24), match.index).toLowerCase();
    const after = title.slice(match.endIndex, Math.min(title.length, match.endIndex + 24)).toLowerCase();

    // Prefer a role immediately before the expression. Chrono may include trailing
    // punctuation in the date text (for example "next Monday,"), which otherwise
    // makes the following field's role appear closer.
    if (/(?:截止(?:到|于)?|到期(?:于)?|due(?:\s+(?:on|by))?|by)\s*$/i.test(before)) return "due";
    if (/(?:从|开始(?:于)?|start(?:ing)?(?:\s+on)?|from)\s*$/i.test(before)) return "start";
    if (/^\s*(?:截止|到期|前完成|due\b)/i.test(after)) return "due";
    if (/^\s*(?:开始|起|启动|start\b)/i.test(after)) return "start";
    return null;
}

function localBoundary(value: string, endOfDay: boolean): number {
    const [datePart, timePart = ""] = value.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart ? timePart.split(":").map(Number) : endOfDay ? [23, 59] : [0, 0];
    return new Date(year, month - 1, day, hour, minute).getTime();
}

function dateFromValue(value: string): Date {
    const [datePart, timePart = ""] = value.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart ? timePart.split(":").map(Number) : [0, 0];
    return new Date(year, month - 1, day, hour, minute);
}

export function parseTaskTitleDates(title: string, referenceDate: Date = new Date()): TaskTitleDates {
    const matches = parseNaturalDates(title, { referenceDate, forwardDate: true });
    if (matches.length === 0) return {};

    const assigned: Record<TaskDateRole, NaturalDateMatch[]> = { start: [], due: [] };
    const unassigned: NaturalDateMatch[] = [];
    for (const match of matches) {
        const role = dateRole(title, match);
        if (role) assigned[role].push(match);
        else unassigned.push(match);
    }

    if (unassigned.length === 1 && assigned.due.length === 0) assigned.due.push(unassigned[0]);
    let start = assigned.start.length === 1 ? assigned.start[0] : undefined;
    let due = assigned.due.length === 1 ? assigned.due[0] : undefined;

    if (start && due && localBoundary(due.value, true) < localBoundary(start.value, false) && due.isRelativeWeekday) {
        const reparsed = parseNaturalDate(due.text, {
            referenceDate: dateFromValue(start.value),
            forwardDate: true,
        });
        if (reparsed) due = { ...reparsed, index: due.index, endIndex: due.endIndex };
    }

    if (start && due && localBoundary(due.value, true) < localBoundary(start.value, false)) return {};
    const result: TaskTitleDates = {};
    if (start) result.start = start;
    if (due) result.due = due;
    return result;
}
