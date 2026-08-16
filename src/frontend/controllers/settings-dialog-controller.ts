import { Dialog } from "siyuan";
import type { PluginSettings } from "../../shared/settings";
import type { I18nStrings } from "../../shared/i18n";
import type { KernelBridge } from "../kernel-bridge";
import { notifyInfo, notifyOperationError } from "../notify";
import { taskStore } from "../stores/task-store";

export class SettingsDialogController {
    private dialog?: Dialog;

    constructor(
        private readonly bridge: KernelBridge,
        private readonly i18n: I18nStrings,
    ) {}

    open(): void {
        if (this.dialog) return;
        const dialog = new Dialog({
            title: "",
            content: `<div id="naSettingsPanel" class="nextaction"></div>`,
            width: "min(840px, calc(100vw - 24px))",
            height: "min(620px, calc(100vh - 24px))",
            disableClose: true,
            hideCloseIcon: true,
            destroyCallback: () => {
                const component = (dialog as Dialog & { _naSettings?: { $destroy(): void } })._naSettings;
                component?.$destroy();
                if (this.dialog === dialog) this.dialog = undefined;
            },
        });
        this.dialog = dialog;
        dialog.element.querySelector(".b3-dialog__header")?.remove();
        const container = dialog.element.querySelector("#naSettingsPanel") as HTMLElement | null;
        if (!container) {
            dialog.destroy();
            return;
        }
        const dialogContainer = dialog.element.querySelector(".b3-dialog__container") as HTMLElement | null;
        const dialogContent = dialog.element.querySelector(".b3-dialog__content") as HTMLElement | null;
        if (dialogContainer) dialogContainer.style.overflow = "hidden";
        if (dialogContent) {
            dialogContent.style.display = "flex";
            dialogContent.style.minHeight = "0";
            dialogContent.style.overflow = "hidden";
        }
        container.style.cssText += "height:100%;min-height:0;overflow:hidden;flex:1;";

        void import("../components/SettingsPanel.svelte").then(({ default: SettingsPanel }) => {
            const component = new SettingsPanel({
                target: container,
                props: {
                    bridge: this.bridge,
                    i18n: this.i18n,
                    onSave: async (settings: PluginSettings) => {
                        taskStore.applySettingsUpdate(settings);
                        try {
                            await this.bridge.recalcAllOrders();
                            notifyInfo(this.i18n.settingsSaved || "Settings saved");
                        } finally {
                            void taskStore.loadTasks();
                        }
                    },
                    onClose: () => dialog.destroy(),
                },
            });
            (dialog as Dialog & { _naSettings?: typeof component })._naSettings = component;
            dialog.element.querySelector(".b3-dialog__scrim")?.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                component.requestClose();
            }, { capture: true });
        }).catch((error: unknown) => {
            dialog.destroy();
            notifyOperationError(error, this.i18n);
        });
    }

    dispose(): void {
        this.dialog?.destroy();
        this.dialog = undefined;
    }
}
