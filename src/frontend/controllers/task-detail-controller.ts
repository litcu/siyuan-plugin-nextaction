import type { TaskCacheEntry } from "../../shared/types";
import { normalizePriority } from "../constants";
import { isTaskDateRangeValid, type TaskDetailDraft } from "../utils/task-detail-draft";

export type TaskDetailSaveState = "idle" | "pending" | "saving" | "saved" | "error";
export type TaskDetailDraftField = keyof TaskDetailDraft;

interface TaskDetailDraftSnapshot {
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

interface TaskDetailDraftControllerOptions {
    save(blockId: string, draft: TaskDetailDraft): Promise<TaskCacheEntry>;
    commit(task: TaskCacheEntry): void;
    formatError(error: unknown): string;
    debounceMs?: number;
    savedStateMs?: number;
}

export interface TaskDetailDisposeOptions {
    bestEffort?: boolean;
}

export interface TaskDetailTaskSource {
    resolve(blockId: string): Promise<TaskCacheEntry | null>;
    observe(blockId: string, listener: (task: TaskCacheEntry | null) => void): () => void;
    commit(task: TaskCacheEntry): void;
    remove(blockId: string): void;
}

export type TaskDetailTransition = { type: "close" } | { type: "task"; blockId: string };
export type TaskDetailTransitionDecision = "applied" | "confirm-discard" | "blocked";
export type TaskDetailAvailability = "available" | "removed";
export type TaskDetailRemovalReason = "local" | "external";

export class TaskDetailTransitionQueue {
    private tail: Promise<void> | null = null;

    run(
        target: TaskDetailTransition,
        transition: (target: TaskDetailTransition) => Promise<boolean>,
    ): Promise<boolean> {
        const result = this.tail ? this.tail.then(() => transition(target)) : transition(target);
        const tail = result.then(
            () => undefined,
            () => undefined,
        );
        this.tail = tail;
        void tail.then(() => {
            if (this.tail === tail) this.tail = null;
        });
        return result;
    }
}

export interface TaskDetailSessionSnapshot extends TaskDetailDraftSnapshot {
    availability: TaskDetailAvailability;
    removalReason: TaskDetailRemovalReason | null;
    pendingTransition: TaskDetailTransition | null;
}

export interface TaskDetailSessionOptions {
    source: TaskDetailTaskSource;
    save(blockId: string, draft: TaskDetailDraft): Promise<TaskCacheEntry>;
    remove(blockId: string): Promise<void>;
    formatError(error: unknown): string;
    missingTaskMessage: string;
    debounceMs?: number;
    savedStateMs?: number;
}

const DRAFT_FIELDS: TaskDetailDraftField[] = [
    "status",
    "priority",
    "importance",
    "effort",
    "due",
    "start",
    "note",
    "outcome",
    "dod",
    "actionKind",
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
    return new Set(DRAFT_FIELDS.filter((field) => !fieldEquals(draft, baseline, field)));
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
        outcome: task.outcome || "",
        dod: task.dod || "",
        actionKind: task.actionKind || "",
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

class TaskDetailDraftController {
    private readonly listeners = new Set<(snapshot: TaskDetailDraftSnapshot) => void>();
    private readonly debounceMs: number;
    private readonly savedStateMs: number;
    private state: TaskDetailDraftSnapshot;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private savedStateTimer: ReturnType<typeof setTimeout> | null = null;
    private activeSave: Promise<boolean> | null = null;
    private disposed = false;
    private discarded = false;

    constructor(
        task: TaskCacheEntry,
        private readonly options: TaskDetailDraftControllerOptions,
    ) {
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

    get snapshot(): TaskDetailDraftSnapshot {
        return this.state;
    }

    subscribe(listener: (snapshot: TaskDetailDraftSnapshot) => void): () => void {
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
            this.discarded = false;
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
        if (this.disposed) return false;
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

    async requestClose(): Promise<"close" | "confirm-discard"> {
        this.patchState({ closeRequested: true });
        while (this.activeSave) await this.activeSave;
        if (!this.state.dirty) {
            this.patchState({ closeRequested: false });
            return "close";
        }
        this.clearDebounceTimer();
        return "confirm-discard";
    }

    confirmDiscard(): "close" {
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
        const shouldSave =
            options.bestEffort &&
            this.state.dirty &&
            !this.discarded &&
            !this.activeSave &&
            !this.state.validationError;
        const taskId = this.state.task.blockId;
        const draft = cloneDraft(this.state.draft);
        this.disposed = true;
        this.listeners.clear();
        if (shouldSave) {
            void this.options
                .save(taskId, draft)
                .then((task) => this.options.commit(task))
                .catch(() => undefined);
        }
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
            this.options.commit(updated);
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

    private updateDraft(draft: TaskDetailDraft, patch: Partial<TaskDetailDraftSnapshot>): void {
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

    private patchState(patch: Partial<TaskDetailDraftSnapshot>): void {
        this.state = { ...this.state, ...patch };
        this.emit();
    }

    private emit(): void {
        for (const listener of this.listeners) listener(this.state);
    }
}

export class TaskDetailSession {
    private readonly listeners = new Set<(snapshot: TaskDetailSessionSnapshot) => void>();
    private readonly controller: TaskDetailDraftController;
    private readonly unsubscribeController: () => void;
    private unsubscribeTask: (() => void) | null = null;
    private availability: TaskDetailAvailability = "available";
    private removalReason: TaskDetailRemovalReason | null = null;
    private pendingTransition: TaskDetailTransition | null = null;
    private pendingTask: TaskCacheEntry | null = null;
    private activeTransition: Promise<TaskDetailTransitionDecision> | null = null;
    private disposed = false;

    constructor(
        task: TaskCacheEntry,
        private readonly options: TaskDetailSessionOptions,
    ) {
        this.controller = new TaskDetailDraftController(task, {
            save: options.save,
            commit: (updated) => options.source.commit(updated),
            formatError: options.formatError,
            debounceMs: options.debounceMs,
            savedStateMs: options.savedStateMs,
        });
        this.unsubscribeController = this.controller.subscribe(() => this.emit());
        this.observeTask(task.blockId);
    }

    get snapshot(): TaskDetailSessionSnapshot {
        return {
            ...this.controller.snapshot,
            availability: this.availability,
            removalReason: this.removalReason,
            pendingTransition: this.pendingTransition,
        };
    }

    subscribe(listener: (snapshot: TaskDetailSessionSnapshot) => void): () => void {
        this.listeners.add(listener);
        listener(this.snapshot);
        return () => this.listeners.delete(listener);
    }

    edit(patch: Partial<TaskDetailDraft>): void {
        if (this.availability === "available") this.controller.edit(patch);
    }

    flush(): Promise<boolean> {
        return this.availability === "available" ? this.controller.flush() : Promise.resolve(false);
    }

    transition(target: TaskDetailTransition): Promise<TaskDetailTransitionDecision> {
        if (this.disposed) return Promise.resolve("blocked");
        if (this.activeTransition) {
            return this.activeTransition.then(() => this.transition(target));
        }
        const transition = this.prepareTransition(target);
        this.activeTransition = transition;
        return transition.finally(() => {
            if (this.activeTransition === transition) this.activeTransition = null;
        });
    }

    async confirmTransition(): Promise<TaskDetailTransitionDecision> {
        const target = this.pendingTransition;
        const task = this.pendingTask;
        if (!target) return "blocked";
        this.controller.confirmDiscard();
        this.clearPendingTransition();
        return this.applyTransition(target, task);
    }

    cancelTransition(): void {
        if (!this.pendingTransition) return;
        this.clearPendingTransition();
        this.controller.cancelClose();
    }

    receiveAuthoritativeTask(task: TaskCacheEntry): void {
        if (this.disposed || this.availability === "removed") return;
        if (task.blockId === this.controller.snapshot.task.blockId) this.controller.receiveExternalTask(task);
        this.options.source.commit(task);
    }

    async removeCurrent(): Promise<boolean> {
        if (this.disposed || this.availability === "removed") return false;
        const blockId = this.controller.snapshot.task.blockId;
        try {
            await this.options.remove(blockId);
            this.controller.confirmDiscard();
            this.removalReason = "local";
            this.options.source.remove(blockId);
            this.markRemoved("local");
            return true;
        } catch (error: unknown) {
            this.controller.reportError(this.options.formatError(error));
            return false;
        }
    }

    reportError(message: string): void {
        this.controller.reportError(message);
    }

    dispose(options: TaskDetailDisposeOptions = {}): void {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribeTask?.();
        this.unsubscribeTask = null;
        this.unsubscribeController();
        this.controller.dispose({ bestEffort: this.availability === "available" && options.bestEffort });
        this.listeners.clear();
    }

    private async prepareTransition(target: TaskDetailTransition): Promise<TaskDetailTransitionDecision> {
        if (this.availability === "removed") return target.type === "close" ? "applied" : "blocked";
        let targetTask: TaskCacheEntry | null = null;
        if (target.type === "task") {
            if (target.blockId === this.controller.snapshot.task.blockId) return "applied";
            try {
                targetTask = await this.options.source.resolve(target.blockId);
            } catch (error: unknown) {
                this.controller.reportError(this.options.formatError(error));
                return "blocked";
            }
            if (!targetTask) {
                this.controller.reportError(this.options.missingTaskMessage);
                return "blocked";
            }
        }

        if (this.isRemoved()) return target.type === "close" ? "applied" : "blocked";
        const flushed = await this.controller.flush();
        if (this.isRemoved()) return target.type === "close" ? "applied" : "blocked";
        if (!flushed && this.controller.snapshot.dirty) {
            this.pendingTransition = target;
            this.pendingTask = targetTask;
            await this.controller.requestClose();
            this.emit();
            return "confirm-discard";
        }
        return this.applyTransition(target, targetTask);
    }

    private applyTransition(
        target: TaskDetailTransition,
        targetTask: TaskCacheEntry | null,
    ): TaskDetailTransitionDecision {
        if (target.type === "close") return "applied";
        if (!targetTask) {
            this.controller.reportError(this.options.missingTaskMessage);
            return "blocked";
        }
        this.unsubscribeTask?.();
        this.unsubscribeTask = null;
        this.controller.receiveExternalTask(targetTask);
        this.observeTask(targetTask.blockId);
        return "applied";
    }

    private observeTask(blockId: string): void {
        this.unsubscribeTask = this.options.source.observe(blockId, (task) => {
            if (this.disposed || blockId !== this.controller.snapshot.task.blockId) return;
            if (!task) {
                this.markRemoved("external");
                return;
            }
            this.controller.receiveExternalTask(task);
        });
    }

    private markRemoved(reason: TaskDetailRemovalReason): void {
        if (this.availability === "removed") return;
        this.availability = "removed";
        this.removalReason = this.removalReason || reason;
        this.clearPendingTransition();
        this.unsubscribeTask?.();
        this.unsubscribeTask = null;
        this.controller.dispose();
        this.emit();
    }

    private clearPendingTransition(): void {
        this.pendingTransition = null;
        this.pendingTask = null;
    }

    private isRemoved(): boolean {
        return this.availability === "removed";
    }

    private emit(): void {
        if (this.disposed) return;
        const snapshot = this.snapshot;
        for (const listener of this.listeners) listener(snapshot);
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
        "na-outcome": draft.outcome,
        "na-dod": draft.dod,
        "na-kind": draft.taskType === "2" ? "" : draft.actionKind || "action",
        "na-review-interval": draft.reviewInterval > 0 ? String(draft.reviewInterval) : "",
        "na-review-date": draft.reviewDate || "",
        ...customAttrs,
    };
}
