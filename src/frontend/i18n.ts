import type { ReminderSoundId } from "../shared/constants";
import type { CustomFieldType } from "../shared/custom-fields";
import type { I18nKey, I18nStrings } from "../shared/i18n";
import type { ProjectDateBucket } from "../shared/project-domain";
import type { ProjectRiskKind } from "../shared/types";
import type { PRIORITY_LIST, STATUS_LIST } from "./constants";

type Status = (typeof STATUS_LIST)[number];
type Priority = (typeof PRIORITY_LIST)[number] | "none";

const STATUS_KEYS = {
    inbox: "statusInbox",
    todo: "statusTodo",
    doing: "statusDoing",
    waiting: "statusWaiting",
    someday: "statusSomeday",
    done: "statusDone",
} as const satisfies Record<Status, I18nKey>;

const PRIORITY_KEYS = {
    critical: "priorityCritical",
    high: "priorityHigh",
    medium: "priorityMedium",
    low: "priorityLow",
    veryLow: "priorityVeryLow",
    none: "priorityNone",
} as const satisfies Record<Priority, I18nKey>;

const PROJECT_RISK_KEYS = {
    overdue: "projectRiskOverdue",
    dueSoon: "projectRiskDueSoon",
    blocked: "projectRiskBlocked",
    noNextAction: "projectRiskNoNextAction",
    empty: "projectRiskEmpty",
    waiting: "projectRiskWaiting",
} as const satisfies Record<ProjectRiskKind, I18nKey>;

const PROJECT_PLAN_KEYS = {
    overdue: "projectPlanOverdue",
    today: "projectPlanToday",
    thisWeek: "projectPlanThisWeek",
    later: "projectPlanLater",
    unscheduled: "projectPlanUnscheduled",
} as const satisfies Record<ProjectDateBucket, I18nKey>;

const REMINDER_SOUND_KEYS = {
    chime: "reminderSoundChime",
    soft: "reminderSoundSoft",
    bell: "reminderSoundBell",
    ping: "reminderSoundPing",
    gentle: "reminderSoundGentle",
} as const satisfies Record<ReminderSoundId, I18nKey>;

const CUSTOM_FIELD_TYPE_KEYS = {
    text: "customFieldTypeText",
    textarea: "customFieldTypeTextarea",
    number: "customFieldTypeNumber",
    boolean: "customFieldTypeBoolean",
    date: "customFieldTypeDate",
    datetime: "customFieldTypeDatetime",
    singleSelect: "customFieldTypeSingleSelect",
    multiSelect: "customFieldTypeMultiSelect",
    url: "customFieldTypeUrl",
} as const satisfies Record<CustomFieldType, I18nKey>;

function lookup<Key extends string>(map: Readonly<Record<Key, I18nKey>>, value: string): I18nKey | undefined {
    return Object.prototype.hasOwnProperty.call(map, value) ? map[value as Key] : undefined;
}

export function translateKey(i18n: I18nStrings, key: I18nKey | undefined, fallback: string): string {
    return key ? i18n[key] || fallback : fallback;
}

export const statusI18nKey = (value: string): I18nKey | undefined => lookup(STATUS_KEYS, value);
export const priorityI18nKey = (value: string): I18nKey | undefined => lookup(PRIORITY_KEYS, value);
export const projectRiskI18nKey = (value: ProjectRiskKind): I18nKey => PROJECT_RISK_KEYS[value];
export const projectPlanI18nKey = (value: ProjectDateBucket): I18nKey => PROJECT_PLAN_KEYS[value];
export const reminderSoundI18nKey = (value: ReminderSoundId): I18nKey => REMINDER_SOUND_KEYS[value];
export const customFieldTypeI18nKey = (value: CustomFieldType): I18nKey => CUSTOM_FIELD_TYPE_KEYS[value];
