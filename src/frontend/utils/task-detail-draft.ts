export type TaskDetailDraft = {
    status: string;
    priority: string;
    importance: number;
    effort: number;
    due: string;
    start: string;
    note: string;
    contexts: string[];
    taskTags: string[];
    parentId: string;
    depends: string[];
    depMode: string;
    sequentialEnabled: boolean;
    taskType: string;
    reviewInterval: number;
    reviewDate: string;
    customFieldValues: Record<string, string>;
};

export function taskDetailDraftKey(draft: TaskDetailDraft): string {
    return JSON.stringify(draft);
}

export function isTaskDateRangeValid(start: string, due: string): boolean {
    if (!start || !due) return true;
    const startDate = new Date(start.includes("T") ? start : start + "T00:00");
    const dueDate = new Date(due.includes("T") ? due : due + "T23:59");
    return dueDate >= startDate;
}

export type TaskDetailSaveUiState = {
    dirty: boolean;
    saving: boolean;
    hasValidationError: boolean;
    operationBusy: boolean;
};

export function canSaveTaskDetailNow(state: TaskDetailSaveUiState): boolean {
    return state.dirty && !state.saving && !state.hasValidationError && !state.operationBusy;
}

export function shouldConfirmTaskDetailClose(dirty: boolean): boolean {
    return dirty;
}

export function shouldContinueTaskDetailSave(savedKey: string, currentKey: string, succeeded: boolean): boolean {
    return succeeded && savedKey !== currentKey;
}
