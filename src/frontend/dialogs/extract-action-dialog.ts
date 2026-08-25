import { Dialog } from "siyuan";
import { get } from "svelte/store";
import type { I18nStrings } from "../../shared/i18n";
import type { TaskCacheEntry } from "../../shared/types";
import { isProjectTask } from "../../shared/project-domain";
import type { KernelBridge } from "../kernel-bridge";
import { notifyInfo } from "../notify";
import { taskStore } from "../stores/task-store";

export interface OpenExtractActionDialogOptions {
    bridge: KernelBridge;
    i18n: I18nStrings;
    sourceBlockId: string;
    sourceTitle: string;
    defaultProjectId?: string;
    onCreated?: (task: TaskCacheEntry) => void;
}

export async function openExtractActionDialog(options: OpenExtractActionDialogOptions): Promise<void> {
    let component: { $destroy(): void } | null = null;
    let removeKeydownListener = () => {};
    const dialog = new Dialog({
        title: "",
        content: '<div class="nextaction na-extract-action-host"></div>',
        width: "min(560px, calc(100vw - 24px))",
        height: "min(680px, calc(100vh - 24px))",
        disableClose: true,
        hideCloseIcon: true,
        destroyCallback: () => {
            removeKeydownListener();
            component?.$destroy();
            component = null;
        },
    });
    dialog.element.classList.add("nextaction", "na-extract-action-dialog");
    dialog.element.querySelector(".b3-dialog__header")?.remove();
    dialog.element.querySelector<HTMLElement>(".b3-dialog__container")?.classList.add("na-extract-action-container");
    const host = dialog.element.querySelector<HTMLElement>(".na-extract-action-host");
    if (!host) {
        dialog.destroy();
        throw new Error(options.i18n.extractActionDialogUnavailable);
    }
    host.style.height = "100%";
    const container = dialog.element.querySelector<HTMLElement>(".b3-dialog__container");
    if (container) container.style.overflow = "hidden";
    dialog.element.querySelector(".b3-dialog__scrim")?.addEventListener("click", () => dialog.destroy());
    const handleKeydown = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        dialog.destroy();
    };
    window.addEventListener("keydown", handleKeydown);
    removeKeydownListener = () => window.removeEventListener("keydown", handleKeydown);

    const { default: ExtractActionDialog } = await import("../components/ExtractActionDialog.svelte");
    const projects = get(taskStore).allTasks.filter(isProjectTask);
    component = new ExtractActionDialog({
        target: host,
        props: {
            bridge: options.bridge,
            i18n: options.i18n,
            sourceBlockId: options.sourceBlockId,
            sourceTitle: options.sourceTitle,
            projects,
            defaultProjectId: options.defaultProjectId || "",
            onClose: () => dialog.destroy(),
            onCreated: (task: TaskCacheEntry) => {
                if (options.onCreated) options.onCreated(task);
                else taskStore.applyUpdate(task);
                notifyInfo(options.i18n.extractActionSuccess);
                dialog.destroy();
            },
        },
    });
}
