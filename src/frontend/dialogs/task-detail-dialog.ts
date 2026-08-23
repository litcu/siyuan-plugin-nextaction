import { confirm, Dialog } from "siyuan";
import type { TaskCacheEntry } from "../../shared/types";
import type { I18nStrings } from "../../shared/i18n";
import type { KernelBridge } from "../kernel-bridge";
import { notifyError, notifyOperationError } from "../notify";
import { taskStore } from "../stores/task-store";

export interface TaskDetailDialogOptions {
    blockId: string;
    bridge: KernelBridge;
    i18n: I18nStrings;
    onCreateChild?: (task: TaskCacheEntry) => void;
}

async function resolveTask(options: TaskDetailDialogOptions): Promise<TaskCacheEntry | null> {
    let task = await options.bridge.getTask(options.blockId);
    if (task) return task;
    await options.bridge.rebuildCache();
    await taskStore.loadTasks();
    task = await options.bridge.getTask(options.blockId);
    return task;
}

export async function openTaskDetailDialog(options: TaskDetailDialogOptions): Promise<void> {
    let task: TaskCacheEntry | null;
    try {
        task = await resolveTask(options);
    } catch (error: unknown) {
        notifyOperationError(error, options.i18n);
        return;
    }
    if (!task) {
        notifyError(options.i18n?.errItemNotFound || options.i18n?.errTaskNotFound || "Project or task not found");
        return;
    }
    taskStore.applyUpdate(task);

    let destroyed = false;
    let detail: { $destroy(): void; requestClose(): Promise<boolean> } | null = null;
    const dialog = new Dialog({
        title: "",
        content: `<div class="nextaction na-task-dialog-content"></div>`,
        width: "min(520px, calc(100vw - 24px))",
        height: "min(720px, calc(100vh - 24px))",
        disableClose: true,
        hideCloseIcon: true,
        destroyCallback: () => {
            destroyed = true;
            detail?.$destroy();
            detail = null;
        },
    });

    const container = dialog.element.querySelector(".na-task-dialog-content");
    if (!container) {
        dialog.destroy();
        return;
    }
    dialog.element.querySelector(".b3-dialog__header")?.remove();
    dialog.element.querySelector<HTMLElement>(".b3-dialog__container")?.classList.add("na-task-dialog-container");
    dialog.element.querySelector(".b3-dialog__scrim")?.addEventListener("click", () => {
        void detail?.requestClose();
    });

    try {
        const { default: TaskDetail } = await import("../components/TaskDetail.svelte");
        if (destroyed) return;
        const component = new TaskDetail({
            target: container as HTMLElement,
            props: {
                task,
                bridge: options.bridge,
                i18n: options.i18n,
                dialogMode: true,
                onCreateChild: options.onCreateChild,
                onClose: () => dialog.destroy(),
                onConfirmDiscard: (confirmDiscard: () => void, cancelClose: () => void) => {
                    confirm(
                        options.i18n?.unsavedChangesTitle || "Unsaved changes",
                        options.i18n?.unsavedChangesMessage || "Discard unsaved changes?",
                        confirmDiscard,
                        cancelClose,
                    );
                },
            },
        });
        detail = component as unknown as { $destroy(): void; requestClose(): Promise<boolean> };
    } catch (error: unknown) {
        dialog.destroy();
        notifyOperationError(error, options.i18n);
    }
}
