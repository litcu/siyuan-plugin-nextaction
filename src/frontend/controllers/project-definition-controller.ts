export type ProjectDefinitionField = "outcome" | "dod";
export type ProjectDefinitionSaveState = "idle" | "saving" | "saved" | "error";

export interface ProjectDefinitionValues {
    outcome: string;
    dod: string;
}

export interface ProjectDefinitionFieldSnapshot {
    remote: string;
    draft: string;
    dirty: boolean;
    saveState: ProjectDefinitionSaveState;
    error: string;
    conflict: string | null;
}

export type ProjectDefinitionSnapshot = Record<ProjectDefinitionField, ProjectDefinitionFieldSnapshot>;

export interface ProjectDefinitionControllerOptions {
    save(field: ProjectDefinitionField, value: string): Promise<ProjectDefinitionValues>;
    formatError(error: unknown): string;
}

function fieldSnapshot(value: string): ProjectDefinitionFieldSnapshot {
    return {
        remote: value,
        draft: value,
        dirty: false,
        saveState: "idle",
        error: "",
        conflict: null,
    };
}

export class ProjectDefinitionController {
    private state: ProjectDefinitionSnapshot;
    private activeSave: { field: ProjectDefinitionField; promise: Promise<boolean> } | null = null;
    private readonly listeners = new Set<(snapshot: ProjectDefinitionSnapshot) => void>();

    constructor(
        initial: ProjectDefinitionValues,
        private options: ProjectDefinitionControllerOptions,
    ) {
        this.state = {
            outcome: fieldSnapshot(initial.outcome),
            dod: fieldSnapshot(initial.dod),
        };
    }

    get snapshot(): ProjectDefinitionSnapshot {
        return this.state;
    }

    rebind(options: ProjectDefinitionControllerOptions): void {
        this.options = options;
    }

    subscribe(listener: (snapshot: ProjectDefinitionSnapshot) => void): () => void {
        this.listeners.add(listener);
        listener(this.state);
        return () => this.listeners.delete(listener);
    }

    edit(field: ProjectDefinitionField, value: string): void {
        const current = this.state[field];
        this.patch(field, {
            draft: value,
            dirty: value !== current.remote,
            saveState: "idle",
            error: "",
            conflict: value === current.remote ? null : current.conflict,
        });
    }

    sync(values: ProjectDefinitionValues): void {
        for (const field of ["outcome", "dod"] as const) {
            const current = this.state[field];
            const remote = values[field];
            if (remote === current.remote) continue;
            if (!current.dirty || remote === current.draft) {
                this.replaceState({ ...this.state, [field]: fieldSnapshot(remote) });
                continue;
            }
            this.patch(field, { remote, conflict: remote });
        }
    }

    cancel(field: ProjectDefinitionField): void {
        const current = this.state[field];
        this.replaceState({
            ...this.state,
            [field]: fieldSnapshot(current.remote),
        });
    }

    reloadRemote(field: ProjectDefinitionField): void {
        this.cancel(field);
    }

    keepDraft(field: ProjectDefinitionField): void {
        const current = this.state[field];
        if (current.conflict === null) return;
        this.patch(field, {
            conflict: null,
            dirty: current.draft !== current.remote,
            saveState: "idle",
            error: "",
        });
    }

    save(field: ProjectDefinitionField): Promise<boolean> {
        if (this.activeSave) {
            return this.activeSave.field === field ? this.activeSave.promise : Promise.resolve(false);
        }
        const current = this.state[field];
        if (!current.dirty || current.conflict !== null) return Promise.resolve(false);
        const savePromise = this.performSave(field, current.draft);
        this.activeSave = { field, promise: savePromise };
        void savePromise.finally(() => {
            if (this.activeSave?.promise === savePromise) this.activeSave = null;
        });
        return savePromise;
    }

    private async performSave(field: ProjectDefinitionField, draft: string): Promise<boolean> {
        this.patch(field, { saveState: "saving", error: "" });
        try {
            const authoritative = await this.options.save(field, draft);
            this.sync(authoritative);
            this.replaceState({
                ...this.state,
                [field]: { ...fieldSnapshot(authoritative[field]), saveState: "saved" },
            });
            return true;
        } catch (error: unknown) {
            this.patch(field, { saveState: "error", error: this.options.formatError(error) });
            return false;
        }
    }

    private patch(field: ProjectDefinitionField, patch: Partial<ProjectDefinitionFieldSnapshot>): void {
        this.replaceState({
            ...this.state,
            [field]: { ...this.state[field], ...patch },
        });
    }

    private replaceState(state: ProjectDefinitionSnapshot): void {
        this.state = state;
        for (const listener of this.listeners) listener(state);
    }
}

export class ProjectDefinitionControllerRegistry {
    private readonly controllers = new Map<string, ProjectDefinitionController>();

    acquire(
        projectId: string,
        values: ProjectDefinitionValues,
        options: ProjectDefinitionControllerOptions,
    ): ProjectDefinitionController {
        const existing = this.controllers.get(projectId);
        if (existing) {
            existing.rebind(options);
            existing.sync(values);
            return existing;
        }
        const created = new ProjectDefinitionController(values, options);
        this.controllers.set(projectId, created);
        return created;
    }
}
