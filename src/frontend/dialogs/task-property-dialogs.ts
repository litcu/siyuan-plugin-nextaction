import { confirm, Dialog } from "siyuan";
import { get } from "svelte/store";
import type { I18nStrings } from "../../shared/i18n";
import type { RepeatRuleV2 } from "../../shared/repeat";
import type { TaskCacheEntry } from "../../shared/types";
import type { KernelBridge } from "../kernel-bridge";
import { taskStore } from "../stores/task-store";
import { formatRpcError } from "../notify";
import { parseReminderItems, serializeReminderItems } from "../utils/reminder-utils";
import NaReminderEditor from "../ui/NaReminderEditor.svelte";
import NaRepeatRuleEditor from "../ui/NaRepeatRuleEditor.svelte";

type DialogCallbacks = {
    onSave?: (updated: TaskCacheEntry) => void;
};

type SiyuanWindow = Window & {
    siyuan?: {
        zIndex?: number;
        dialogs?: Dialog[];
    };
};

function configureDialog(dialog: Dialog, className: string): HTMLElement | null {
    dialog.element.classList.add("nextaction");
    const dialogRoot = dialog.element.querySelector<HTMLElement>(".b3-dialog");
    const drawerZIndex = Array.from(
        document.querySelectorAll<HTMLElement>(".na-drawer-host--open, .na-drawer-host__backdrop"),
    ).reduce((highest, element) => {
        const zIndex = Number.parseInt(window.getComputedStyle(element).zIndex, 10);
        return Number.isFinite(zIndex) ? Math.max(highest, zIndex) : highest;
    }, 0);
    const currentDialogZIndex = Number.parseInt(dialogRoot?.style.zIndex || "", 10) || 0;
    if (dialogRoot && drawerZIndex >= currentDialogZIndex) {
        const siyuan = (window as SiyuanWindow).siyuan;
        const nextZIndex = Math.max(drawerZIndex, Number(siyuan?.zIndex) || 0) + 1;
        dialogRoot.style.zIndex = String(nextZIndex);
        if (siyuan) siyuan.zIndex = nextZIndex;
    }
    const container = dialog.element.querySelector(".b3-dialog__container");
    container?.classList.add(className);
    return dialog.element.querySelector("[data-na-dialog-target]");
}

function bindManagedClose(dialog: Dialog, requestClose: () => void): () => void {
    const scrim = dialog.element.querySelector(".b3-dialog__scrim");
    scrim?.addEventListener("click", requestClose);
    const handleKeydown = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        const dialogs = (window as SiyuanWindow).siyuan?.dialogs;
        if (Array.isArray(dialogs) && dialogs[dialogs.length - 1] !== dialog) return;
        event.preventDefault();
        event.stopPropagation();
        requestClose();
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
}

export function openReminderSettingsDialog(
    task: TaskCacheEntry,
    bridge: KernelBridge,
    i18n: I18nStrings,
    callbacks: DialogCallbacks = {},
): void {
    let component: NaReminderEditor | null = null;
    let unbindClose = () => {};
    let currentItems = parseReminderItems(task.reminder);
    const dialog = new Dialog({
        title: "",
        content: '<div class="nextaction na-property-dialog-target" data-na-dialog-target></div>',
        width: "min(380px, calc(100vw - 24px))",
        height: "min(560px, calc(100vh - 24px))",
        disableClose: true,
        hideCloseIcon: true,
        destroyCallback: () => {
            unbindClose();
            component?.$destroy();
        },
    });
    const target = configureDialog(dialog, "na-reminder-dialog-container");
    if (!target) {
        dialog.destroy();
        return;
    }

    const close = () => dialog.destroy();
    unbindClose = bindManagedClose(dialog, close);
    component = new NaReminderEditor({
        target,
        props: {
            items: currentItems,
            due: task.due,
            defaultOffsets: get(taskStore).settings.reminderSettings.defaultOffsets,
            i18n,
        },
    });
    component.$on("close", close);
    component.$on("change", async (event: CustomEvent<{ items: typeof currentItems }>) => {
        const previousItems = currentItems;
        currentItems = event.detail.items;
        component?.$set({ saving: true, error: "" });
        try {
            const updated = await bridge.updateTask(task.blockId, {
                "na-reminder": serializeReminderItems(currentItems),
            });
            currentItems = parseReminderItems(updated.reminder);
            component?.$set({ items: currentItems, due: updated.due });
            callbacks.onSave?.(updated);
        } catch (error) {
            currentItems = previousItems;
            component?.$set({ items: previousItems, error: formatRpcError(error, i18n) });
        } finally {
            component?.$set({ saving: false });
        }
    });
}

export function openRepeatRuleDialog(
    task: TaskCacheEntry,
    bridge: KernelBridge,
    i18n: I18nStrings,
    callbacks: DialogCallbacks = {},
): void {
    let component: NaRepeatRuleEditor | null = null;
    let unbindClose = () => {};
    const dialog = new Dialog({
        title: "",
        content: '<div class="nextaction na-property-dialog-target na-repeat-rule-editor" data-na-dialog-target></div>',
        width: "min(620px, calc(100vw - 24px))",
        height: "min(680px, calc(100vh - 24px))",
        disableClose: true,
        hideCloseIcon: true,
        destroyCallback: () => {
            unbindClose();
            component?.$destroy();
        },
    });
    const target = configureDialog(dialog, "na-repeat-dialog-container");
    if (!target) {
        dialog.destroy();
        return;
    }

    const requestClose = () => {
        if (!component?.hasUnsavedChanges()) {
            dialog.destroy();
            return;
        }
        confirm(
            i18n?.unsavedChangesTitle || "Unsaved changes",
            i18n?.unsavedChangesMessage || "Discard unsaved changes?",
            () => dialog.destroy(),
        );
    };
    unbindClose = bindManagedClose(dialog, requestClose);
    component = new NaRepeatRuleEditor({ target, props: { task, i18n } });
    component.$on("requestClose", requestClose);
    component.$on("apply", async (event: CustomEvent<{ rule: RepeatRuleV2 }>) => {
        component?.$set({ saving: true, error: "" });
        try {
            const updated = await bridge.setRepeatRule(task.blockId, event.detail.rule);
            callbacks.onSave?.(updated);
            dialog.destroy();
        } catch (error) {
            component?.$set({ saving: false, error: formatRpcError(error, i18n) });
        }
    });
}
