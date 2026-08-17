import type { TaskCacheEntry } from "./types";

export const CUSTOM_FIELD_TYPES = [
    "text",
    "textarea",
    "number",
    "boolean",
    "date",
    "datetime",
    "singleSelect",
    "multiSelect",
    "url",
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export type CustomFieldStatus = "active" | "archived";
export type CustomFieldTaskType = "task" | "project";

export type CustomFieldScope =
    { mode: "all" } | { mode: "task" } | { mode: "project" } | { mode: "projectTree"; projectIds: string[] };

export interface CustomFieldOption {
    id: string;
    label: string;
    status: CustomFieldStatus;
}

export interface CustomFieldDef {
    version: 2;
    id: string;
    key: string;
    label: string;
    description: string;
    type: CustomFieldType;
    status: CustomFieldStatus;
    scope: CustomFieldScope;
    showOnCard: boolean;
    options?: CustomFieldOption[];
    migrationIssue?: string;
    legacyKey?: string;
}

export interface CustomFieldMigrationResult {
    fields: CustomFieldDef[];
    issues: string[];
}

export type CustomFieldInput = string | number | boolean | string[] | null;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function isCustomFieldType(value: unknown): value is CustomFieldType {
    return typeof value === "string" && (CUSTOM_FIELD_TYPES as readonly string[]).includes(value);
}

export function isValidCustomFieldKey(key: string): boolean {
    return /^[a-z][a-z0-9-]*$/.test(key);
}

export function normalizeCustomFieldKey(key: string): string {
    return key.trim().toLowerCase();
}

function stableId(seed: string): string {
    const safe = seed
        .replace(/[^a-z0-9-]/gi, "-")
        .toLowerCase()
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return `legacy-${safe || "field"}`;
}

function optionId(label: string, index: number): string {
    return `option-${index + 1}-${stableId(label).slice(7) || "value"}`;
}

function normalizeOptions(raw: unknown): CustomFieldOption[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const seen = new Set<string>();
    const result: CustomFieldOption[] = [];
    for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        const source = isRecord(item) ? item : null;
        const label =
            typeof item === "string" ? item.trim() : typeof source?.label === "string" ? source.label.trim() : "";
        if (!label) continue;
        const requestedId = typeof source?.id === "string" ? source.id : optionId(label, i);
        const id = requestedId || optionId(label, i);
        if (seen.has(id)) continue;
        seen.add(id);
        result.push({
            id,
            label,
            status: source?.status === "archived" ? "archived" : "active",
        });
    }
    return result;
}

export function migrateCustomFieldDefs(raw: unknown): CustomFieldMigrationResult {
    const fields: CustomFieldDef[] = [];
    const issues: string[] = [];
    if (!Array.isArray(raw)) return { fields, issues };

    for (const item of raw) {
        if (!isRecord(item)) continue;
        const source = item;
        const originalKey = typeof source.key === "string" ? source.key.trim() : "";
        const normalizedKey = normalizeCustomFieldKey(originalKey);
        const valid = isValidCustomFieldKey(normalizedKey);
        const key = valid ? normalizedKey : stableId(originalKey);
        const migrationIssue =
            valid && originalKey !== normalizedKey
                ? "legacy-key-normalized"
                : !valid
                  ? "invalid-legacy-key"
                  : undefined;
        if (migrationIssue) issues.push(`${originalKey || "<empty>"}:${migrationIssue}`);

        const type = isCustomFieldType(source.type) ? source.type : "text";
        const field: CustomFieldDef = {
            version: 2,
            id: typeof source.id === "string" && source.id ? source.id : stableId(originalKey || key),
            key,
            label: typeof source.label === "string" && source.label.trim() ? source.label.trim() : key,
            description: typeof source.description === "string" ? source.description : "",
            type,
            status: source.status === "archived" || !valid ? "archived" : "active",
            scope: normalizeScope(source.scope),
            showOnCard: source.showOnCard !== false && valid,
            options: normalizeOptions(source.options),
            ...(migrationIssue ? { migrationIssue, legacyKey: originalKey } : {}),
        };
        fields.push(field);
    }

    const keyCounts = new Map<string, number>();
    for (const field of fields) keyCounts.set(field.key, (keyCounts.get(field.key) || 0) + 1);
    for (const field of fields) {
        if ((keyCounts.get(field.key) || 0) > 1) {
            field.status = "archived";
            field.showOnCard = false;
            field.migrationIssue = "duplicate-normalized-key";
            issues.push(`${field.key}:duplicate-normalized-key`);
        }
    }
    return { fields, issues };
}

function normalizeScope(scope: unknown): CustomFieldScope {
    if (!isRecord(scope)) return { mode: "all" };
    const value = scope;
    if (value.mode === "task" || value.mode === "project") return { mode: value.mode };
    if (value.mode === "projectTree") {
        return {
            mode: "projectTree",
            projectIds: Array.isArray(value.projectIds)
                ? value.projectIds.filter((id: unknown): id is string => typeof id === "string" && !!id)
                : [],
        };
    }
    return { mode: "all" };
}

export function validateCustomFieldDefinition(field: CustomFieldDef): string | null {
    if (!field || field.version !== 2) return "custom field version must be 2";
    if (!isValidCustomFieldKey(field.key)) return "custom field key must use lowercase letters, digits and hyphens";
    if (!field.label || field.label.trim().length === 0) return "custom field label must not be empty";
    if (!CUSTOM_FIELD_TYPES.includes(field.type)) return "custom field type is invalid";
    if (field.type === "singleSelect" || field.type === "multiSelect") {
        if (!field.options || field.options.length === 0) return "select custom fields require at least one option";
        const ids = new Set<string>();
        for (const option of field.options) {
            if (!option.id || ids.has(option.id) || !option.label.trim())
                return "custom field options must have unique ids and labels";
            ids.add(option.id);
        }
    }
    if (field.scope.mode === "projectTree" && field.scope.projectIds.some((id) => !id))
        return "projectTree scope contains an invalid project id";
    return null;
}

export function validateCustomFieldDefinitions(fields: CustomFieldDef[]): string | null {
    const keys = new Set<string>();
    const ids = new Set<string>();
    for (const field of fields) {
        const error = validateCustomFieldDefinition(field);
        if (error) return error;
        if (keys.has(field.key)) return `custom field key must be unique: ${field.key}`;
        if (ids.has(field.id)) return `custom field id must be unique: ${field.id}`;
        keys.add(field.key);
        ids.add(field.id);
    }
    return null;
}

function isDate(value: string, datetime: boolean): boolean {
    return datetime ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) : /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function encodeCustomFieldValue(field: CustomFieldDef, input: CustomFieldInput): string {
    if (input === null || input === undefined || input === "") return "";
    switch (field.type) {
        case "number": {
            const value = typeof input === "number" ? input : Number(input);
            if (!Number.isFinite(value)) throw new Error("number custom field requires a finite number");
            return String(value);
        }
        case "boolean":
            return input === true || input === "1" || input === "true" ? "1" : "0";
        case "date":
            if (!isDate(String(input), false)) throw new Error("date custom field requires YYYY-MM-DD");
            return String(input);
        case "datetime":
            if (!isDate(String(input), true)) throw new Error("datetime custom field requires YYYY-MM-DDTHH:mm");
            return String(input);
        case "singleSelect": {
            const value = String(input);
            if (!field.options?.some((option) => option.id === value))
                throw new Error("singleSelect value is not a valid option");
            return value;
        }
        case "multiSelect": {
            const values = Array.isArray(input) ? input.map(String) : JSON.parse(String(input));
            if (!Array.isArray(values) || values.some((value) => !field.options?.some((option) => option.id === value)))
                throw new Error("multiSelect value contains an invalid option");
            return JSON.stringify([...new Set(values)]);
        }
        case "url": {
            const value = String(input).trim();
            const url = new URL(value);
            if (
                !["http:", "https:", "siyuan:"].includes(url.protocol) ||
                (url.protocol === "siyuan:" && !value.startsWith("siyuan://blocks/"))
            )
                throw new Error("url custom field only supports http(s) and siyuan block links");
            return value;
        }
        case "textarea":
            if (String(input).length > 4000) throw new Error("textarea custom field is limited to 4000 characters");
            return String(input).trim();
        case "text":
        default:
            if (String(input).length > 500) throw new Error("text custom field is limited to 500 characters");
            return String(input).trim();
    }
}

export function decodeCustomFieldValue(field: CustomFieldDef, raw: string | undefined): CustomFieldInput {
    if (!raw) return null;
    switch (field.type) {
        case "number":
            return Number(raw);
        case "boolean":
            return raw === "1" || raw === "true";
        case "multiSelect":
            try {
                return JSON.parse(raw);
            } catch {
                return [];
            }
        default:
            return raw;
    }
}

export function formatCustomFieldValue(field: CustomFieldDef, raw: string | undefined): string {
    const value = decodeCustomFieldValue(field, raw);
    if (value === null || value === "") return "";
    if (field.type === "boolean") return value ? "Yes" : "No";
    if (field.type === "singleSelect")
        return field.options?.find((option) => option.id === value)?.label || String(value);
    if (field.type === "multiSelect")
        return (value as string[])
            .map((id) => field.options?.find((option) => option.id === id)?.label || id)
            .join(", ");
    return String(value);
}

export function isCustomFieldApplicable(
    field: CustomFieldDef,
    task: TaskCacheEntry,
    taskMap?: Map<string, TaskCacheEntry>,
): boolean {
    if (field.status !== "active") return false;
    if (field.scope.mode === "all") return true;
    if (field.scope.mode === "task") return task.taskType !== "2";
    if (field.scope.mode === "project") return task.taskType === "2";
    if (!taskMap) return false;
    const projectIds = new Set(field.scope.projectIds);
    let current: TaskCacheEntry | undefined = task;
    const visited = new Set<string>();
    for (let depth = 0; current && depth < 100; depth++) {
        if (projectIds.has(current.blockId)) return true;
        if (!current.parentId || visited.has(current.blockId)) break;
        visited.add(current.blockId);
        current = taskMap.get(current.parentId);
    }
    return false;
}
