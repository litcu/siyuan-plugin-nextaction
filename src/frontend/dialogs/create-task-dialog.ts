import { Dialog } from "siyuan";
import type { KernelBridge } from "../kernel-bridge";
import type { TaskCacheEntry } from "../../shared/types";
import createTaskDialogStyles from "./create-task-dialog.scss?inline";

export interface OpenCreateTaskDialogOptions {
    bridge: KernelBridge;
    i18n: any;
    parentTask?: TaskCacheEntry | null;
    onCreated?: (task: TaskCacheEntry) => void;
}

export async function openCreateTaskDialog(options: OpenCreateTaskDialogOptions): Promise<void> {
    const dialog = new Dialog({
        title: options.parentTask
            ? options.i18n?.createChildTask || "Create child task"
            : options.i18n?.createTask || "Create task",
        content: '<div class="nextaction na-create-task-host"></div>',
        width: "560px",
        destroyCallback: () => {
            const component = (dialog as any)._naCreateTaskComponent;
            component?.$destroy?.();
        },
    });
    dialog.element.classList.add("nextaction", "na-create-task-dialog");
    dialog.element.querySelector(".b3-dialog")?.classList.add("nextaction", "na-create-task-dialog");
    const style = document.createElement("style");
    style.dataset.naCreateTaskDialog = "true";
    style.textContent = createTaskDialogStyles;
    dialog.element.appendChild(style);
    const host = dialog.element.querySelector<HTMLElement>(".na-create-task-host");
    if (!host) {
        dialog.destroy();
        throw new Error(options.i18n?.createDialogUnavailable || "Task creation dialog is unavailable");
    }
    const { default: CreateTaskDialog } = await import("../components/CreateTaskDialog.svelte");
    const component = new CreateTaskDialog({
        target: host,
        props: {
            bridge: options.bridge,
            i18n: options.i18n,
            dialog,
            parentTask: options.parentTask || null,
            onCreated: options.onCreated,
        },
    });
    (dialog as any)._naCreateTaskComponent = component;
}
