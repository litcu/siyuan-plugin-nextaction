import type { TaskCacheEntry } from "../../shared/types";
import { normalizePriority } from "../constants";
import {
    isTaskDateRangeValid,
    type TaskDetailDraft,
} from "../utils/task-detail-draft";

export type TaskDetailSaveState = "idle" | "pending" | "saving" | "saved" | "error";
export type TaskDetailCloseDecision = "close" | "confirm-discard";
export type TaskDetailDraftField = keyof TaskDetailDraft;

export interface TaskDetailControllerSnapshot {
    task: TaskCacheEntry;
    baseline: TaskDetailDraft;
    draft: TaskDetailDraft;
    dirtyFields: ReadonlySet<TaskDetailDraftField>;
    dirty: boolean;
    saveState: TaskDetailSaveState;
    saveError: string;
    validationError: "" | "date-range";
    saveGeneration: number;
    closeRequested: boolean;
}

export interface TaskDetailControllerOptions {
    save(blockId: string, draft: TaskDetailDraft): Promise<TaskCacheEntry>;
    formatError(error: unknown): string;
    debounceMs?: number;
    savedStateMs?: number;
}

export interface TaskDetailDisposeOptions {
    bestEffort?: boolean;
}

const DRAFT_FIELDS: TaskDetailDraftField[] = [
    "status",
    "priority",
    "importance",
    "effort",
    "due",
    "start",
    "note",
    "contexts",
    "taskTags",
    "parentId",
    "depends",
    "depMode",
    "sequentialEnabled",
    "taskType",
    "reviewInterval",
    "reviewDate",
    "customFieldValues",
];

function cloneDraft(draft: TaskDetailDraft): TaskDetailDraft {
    return {
        ...draft,
        contexts: [...draft.contexts],
        taskTags: [...draft.taskTags],
        depends: [...draft.depends],
        customFieldValues: { ...draft.customFieldValues },
    };
}

function fieldEquals(draft: TaskDetailDraft, baseline: TaskDetailDraft, field: TaskDetailDraftField): boolean {
    return JSON.stringify(draft[field]) === JSON.stringify(baseline[field]);
}

function dirtyFieldsFor(draft: TaskDetailDraft, baseline: TaskDetailDraft): Set<TaskDetailDraftField> {
    return new Set(DRAFT_FIELDS.filter(field => !fieldEquals(draft, baseline, field)));
}

export function taskToTaskDetailDraft(task: TaskCacheEntry): TaskDetailDraft {
    return {
        status: task.status || "todo",
        priority: normalizePriority(task.priority),
        importance: task.importance || 4,
        effort: task.effort || 4,
        due: task.due || "",
        start: task.start || "",
        note: task.note || "",
        contexts: task.context ? task.context.split("|").filter(Boolean) : [],
        taskTags: task.tags ? task.tags.split("|").filter(Boolean) : [],
        parentId: task.parentId || "",
        depends: task.depends ? task.depends.split("|").filter(Boolean) : [],
        depMode: task.depMode || "all",
        sequentialEnabled: task.sequential || false,
        taskType: task.taskType || "1",
        reviewInterval: task.reviewInterval || 0,
        reviewDate: task.reviewDate || "",
        customFieldValues: { ...(task.customFields || {}) },
    };
}

export function rebaseTaskDetailDraft(
    current: TaskDetailDraft,
    previousBaseline: TaskDetailDraft,
    incoming: TaskDetailDraft,
): TaskDetailDraft {
    const rebased = cloneDraft(incoming);
    for (const field of DRAFT_FIELDS) {
        if (!fieldEquals(current, previousBaseline, field)) {
            (rebased as Record<TaskDetailDraftField, unknown>)[field] = cloneDraftField(current[field]);
        }
    }
    return rebased;
}

function cloneDraftField<T>(value: T): T {
    if (Array.isArray(value)) return [...value] as T;
    if (value && typeof value === "object") return { ...value } as T;
    return value;
}

export class TaskDetailController {
    private readonly listeners = new Set<(snapshot: TaskDetailControllerSnapshot) => void>();
    private readonly debounceMs: number;
    private readonly savedStateMs: number;
    private state: TaskDetailControllerSnapshot;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private savedStateTimer: ReturnType<typeof setTimeout> | null = null;
    private activeSave: Promise<boolean> | null = null;
    private disposed = false;
    private discarded = false;

    constructor(task: TaskCacheEntry, private readonly options: TaskDetailControllerOptions) {
        const draft = taskToTaskDetailDraft(task);
        this.debounceMs = options.debounceMs ?? 500;
        this.savedStateMs = options.savedStateMs ?? 1600;
        this.state = {
            task,
            baseline: cloneDraft(draft),
            draft,
            dirtyFields: new Set(),
            dirty: false,
            saveState: "idle",
            saveError: "",
            validationError: "",
            saveGeneration: 0,
            closeRequested: false,
        };
    }

    get snapshot(): TaskDetailControllerSnapshot {
        return this.state;
    }

    subscribe(listener: (snapshot: TaskDetailControllerSnapshot) => void): () => void {
        this.listeners.add(listener);
        listener(this.state);
        return () => this.listeners.delete(listener);
    }

    edit(patch: Partial<TaskDetailDraft>): void {
        if (this.disposed) return;
        const draft = cloneDraft({ ...this.state.draft, ...patch });
        this.updateDraft(draft, {
            saveState: "pending",
            saveError: "",
            closeRequested: false,
        });
        this.scheduleSave();
    }

    receiveExternalTask(task: TaskCacheEntry): void {
        if (this.disposed || task === this.state.task) return;
        const incoming = taskToTaskDetailDraft(task);
        if (task.blockId !== this.state.task.blockId) {
            this.clearTimers();
            this.state = {
                ...this.state,
                task,
                baseline: cloneDraft(incoming),
                draft: incoming,
                dirtyFields: new Set(),
                dirty: false,
                saveState: "idle",
                saveError: "",
                validationError: "",
                closeRequested: false,
            };
            this.emit();
            return;
        }
        const draft = rebaseTaskDetailDraft(this.state.draft, this.state.baseline, incoming);
        this.state = {
            ...this.state,
            task,
            baseline: cloneDraft(incoming),
            draft,
            saveError: "",
        };
        this.refreshDerivedState();
        this.emit();
    }

    async flush(): Promise<boolean> {
        this.clearDebounceTimer();
        if (this.activeSave) {
            const succeeded = await this.activeSave;
            if (!succeeded) return false;
            return this.state.dirty ? this.flush() : true;
        }
        if (!this.state.dirty) {
            this.patchState({ saveState: "idle", saveError: "" });
            return true;
        }
        if (this.state.validationError) {
            this.patchState({ saveState: "error" });
            return false;
        }

        const savingTaskId = this.state.task.blockId;
        const savingDraft = cloneDraft(this.state.draft);
        const generation = this.state.saveGeneration + 1;
        this.patchState({ saveState: "saving", saveError: "", saveGeneration: generation });
        const savePromise = this.saveGeneration(savingTaskId, savingDraft);
        this.activeSave = savePromise;
        const succeeded = await savePromise;
        if (this.activeSave === savePromise) this.activeSave = null;
        if (succeeded && this.state.task.blockId === savingTaskId && this.state.dirty) {
            return this.flush();
        }
        return succeeded;
    }

    async requestClose(): Promise<TaskDetailCloseDecision> {
        this.patchState({ closeRequested: true });
        while (this.activeSave) await this.activeSave;
        if (!this.state.dirty) {
            this.patchState({ closeRequested: false });
            return "close";
        }
        this.clearDebounceTimer();
        return "confirm-discard";
    }

    confirmDiscard(): TaskDetailCloseDecision {
        this.discarded = true;
        this.clearDebounceTimer();
        this.patchState({ closeRequested: false });
        return "close";
    }

    cancelClose(): void {
        this.patchState({ closeRequested: false });
        if (this.state.dirty && this.state.saveState !== "error") this.scheduleSave();
    }

    reportError(message: string): void {
        this.patchState({ saveState: "error", saveError: message });
    }

    dispose(options: TaskDetailDisposeOptions = {}): void {
        if (this.disposed) return;
        this.clearTimers();
        const shouldSave = options.bestEffort && this.state.dirty && !this.discarded && !this.activeSave && !this.state.validationError;
        const taskId = this.state.task.blockId;
        const draft = cloneDraft(this.state.draft);
        this.disposed = true;
        this.listeners.clear();
        if (shouldSave) void this.options.save(taskId, draft).catch(() => undefined);
    }

    private async saveGeneration(taskId: string, savingDraft: TaskDetailDraft): Promise<boolean> {
        try {
            const updated = await this.options.save(taskId, cloneDraft(savingDraft));
            if (this.disposed || this.state.task.blockId !== taskId) return true;
            const incoming = taskToTaskDetailDraft(updated);
            const draft = rebaseTaskDetailDraft(this.state.draft, savingDraft, incoming);
            this.state = {
                ...this.state,
                task: updated,
                baseline: cloneDraft(incoming),
                draft,
                saveError: "",
            };
            this.refreshDerivedState();
            if (this.state.dirty) {
                this.state = { ...this.state, saveState: "pending" };
            } else {
                this.state = { ...this.state, saveState: "saved" };
                this.scheduleSavedStateReset();
            }
            this.emit();
            return true;
        } catch (error: unknown) {
            if (!this.disposed) this.patchState({ saveState: "error", saveError: this.options.formatError(error) });
            return false;
        }
    }

    private updateDraft(draft: TaskDetailDraft, patch: Partial<TaskDetailControllerSnapshot>): void {
        this.state = { ...this.state, ...patch, draft };
        this.refreshDerivedState();
        this.emit();
    }

    private refreshDerivedState(): void {
        const dirtyFields = dirtyFieldsFor(this.state.draft, this.state.baseline);
        this.state = {
            ...this.state,
            dirtyFields,
            dirty: dirtyFields.size > 0,
            validationError: isTaskDateRangeValid(this.state.draft.start, this.state.draft.due) ? "" : "date-range",
        };
    }

    private scheduleSave(): void {
        this.clearDebounceTimer();
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            void this.flush();
        }, this.debounceMs);
    }

    private scheduleSavedStateReset(): void {
        if (this.savedStateTimer) clearTimeout(this.savedStateTimer);
        this.savedStateTimer = setTimeout(() => {
            this.savedStateTimer = null;
            if (this.state.saveState === "saved") this.patchState({ saveState: "idle" });
        }, this.savedStateMs);
    }

    private clearDebounceTimer(): void {
        if (!this.debounceTimer) return;
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
    }

    private clearTimers(): void {
        this.clearDebounceTimer();
        if (this.savedStateTimer) clearTimeout(this.savedStateTimer);
        this.savedStateTimer = null;
    }

    private patchState(patch: Partial<TaskDetailControllerSnapshot>): void {
        this.state = { ...this.state, ...patch };
        this.emit();
    }

    private emit(): void {
        for (const listener of this.listeners) listener(this.state);
    }
}

export function taskDetailDraftToAttrs(
    draft: TaskDetailDraft,
    customAttrs: Record<string, string> = {},
): Record<string, string> {
    return {
        "na-status": draft.status,
        "na-priority": draft.priority,
        "na-importance": String(draft.importance),
        "na-effort": String(draft.effort),
        "na-due": draft.due,
        "na-start": draft.start,
        "na-context": draft.contexts.join("|"),
        "na-tags": draft.taskTags.join("|"),
        "na-parent": draft.parentId,
        "na-task": draft.taskType,
        "na-depends": draft.depends.join("|"),
        "na-dep-mode": draft.depMode,
        "na-sequential": draft.sequentialEnabled ? "1" : "",
        "na-note": draft.note,
        "na-review-interval": draft.reviewInterval > 0 ? String(draft.reviewInterval) : "",
        "na-review-date": draft.reviewDate || "",
        ...customAttrs,
    };
}
