import { Dialog } from "siyuan";
import type { ActionMoveResult } from "../../shared/action-move";
import type { I18nStrings } from "../../shared/i18n";
import type { TaskCacheEntry } from "../../shared/types";
import type { KernelBridge } from "../kernel-bridge";
import { taskStore } from "../stores/task-store";
import { showActionMoveUndo } from "../stores/action-move-undo-store";
import { mountSvelteComponentAsync, type AsyncSvelteComponentMount } from "../svelte-mount";

export interface OpenActionMoveDialogOptions {
    bridge: KernelBridge;
    i18n: I18nStrings;
    task: TaskCacheEntry;
    project: TaskCacheEntry;
    onMoved?: (task: TaskCacheEntry) => void;
    onUndone?: (task: TaskCacheEntry) => void;
}

export async function openActionMoveDialog(options: OpenActionMoveDialogOptions): Promise<void> {
    let mounted: AsyncSvelteComponentMount<object> | null = null;
    let removeKeydownListener = () => {};
    const dialog = new Dialog({
        title: "",
        content: '<div class="nextaction na-action-move-host"></div>',
        width: "min(520px, calc(100vw - 24px))",
        height: "min(480px, calc(100vh - 24px))",
        disableClose: true,
        hideCloseIcon: true,
        destroyCallback: () => {
            removeKeydownListener();
            void mounted?.dispose();
            mounted = null;
        },
    });
    dialog.element.classList.add("nextaction", "na-action-move-dialog");
    dialog.element.querySelector(".b3-dialog__header")?.remove();
    dialog.element.querySelector<HTMLElement>(".b3-dialog__container")?.classList.add("na-action-move-container");
    const host = dialog.element.querySelector<HTMLElement>(".na-action-move-host");
    if (!host) {
        dialog.destroy();
        throw new Error(options.i18n.moveActionPreviewFailed.replace("{error}", "dialog unavailable"));
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

    mounted = mountSvelteComponentAsync(() => import("../components/project/ActionMoveDialog.svelte"), {
        target: host,
        props: {
            bridge: options.bridge,
            i18n: options.i18n,
            task: options.task,
            project: options.project,
            onClose: () => dialog.destroy(),
            onMoved: (result: ActionMoveResult) => {
                taskStore.applyUpdate(result.task);
                options.onMoved?.(result.task);
                showActionMoveUndo(result.undo, options.onUndone);
                dialog.destroy();
            },
        },
    });
    await mounted.ready;
}
