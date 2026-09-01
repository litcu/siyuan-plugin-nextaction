import { Dialog } from "siyuan";
import type { KernelBridge } from "../kernel-bridge";
import type { TaskCacheEntry } from "../../shared/types";
import createTaskDialogStyles from "./create-task-dialog.scss?inline";
import { mountSvelteComponentAsync, type AsyncSvelteComponentMount } from "../svelte-mount";

export interface OpenCreateTaskDialogOptions {
    bridge: KernelBridge;
    i18n: any;
    parentTask?: TaskCacheEntry | null;
    initialActionKind?: "action" | "stage";
    onCreated?: (task: TaskCacheEntry) => void;
}

export async function openCreateTaskDialog(options: OpenCreateTaskDialogOptions): Promise<void> {
    let mounted: AsyncSvelteComponentMount<object> | null = null;
    const dialog = new Dialog({
        title:
            options.initialActionKind === "stage"
                ? options.i18n?.createStage || "Create Stage"
                : options.parentTask
                  ? options.i18n?.createChildTask || "Create child task"
                  : options.i18n?.createTask || "Create task",
        content: '<div class="nextaction na-create-task-host"></div>',
        width: "640px",
        destroyCallback: () => {
            void mounted?.dispose();
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
    mounted = mountSvelteComponentAsync(() => import("../components/CreateTaskDialog.svelte"), {
        target: host,
        props: {
            bridge: options.bridge,
            i18n: options.i18n,
            dialog,
            parentTask: options.parentTask || null,
            initialActionKind: options.initialActionKind || "action",
            onCreated: options.onCreated,
        },
    });
    await mounted.ready;
}
