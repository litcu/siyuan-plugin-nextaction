import { Menu, confirm } from "siyuan";
import type { TaskCacheEntry } from "../../shared/types";
import { KernelBridge } from "../kernel-bridge";
import { STATUS_LIST, PRIORITY_LIST } from "../constants";
import { toI18nKey } from "../utils";
import { notifyError, formatRpcError } from "../notify";

interface ContextMenuCallbacks {
    onUpdated: (updatedEntry: TaskCacheEntry) => void;
    onRemoved: (blockId: string) => void;
    onMyDayToggle?: (blockId: string, inMyDay: boolean) => void;
    onReminderEdit?: (blockId: string) => void;
}

export function showTaskContextMenu(
    task: TaskCacheEntry,
    event: MouseEvent,
    bridge: KernelBridge,
    i18n: any,
    callbacks: ContextMenuCallbacks,
    currentView?: string,
    inMyDay?: boolean,
): void {
    const menu = new Menu("na-task-context");

    for (const s of STATUS_LIST) {
        const i18nKey = toI18nKey("status", s);
        menu.addItem({
            icon: s === task.status ? "iconSelect" : "",
            label: i18n?.[i18nKey] || s,
            click: async () => {
                try {
                    const updated = await bridge.updateTask(task.blockId, { "na-status": s });
                    callbacks.onUpdated(updated);
                } catch (e: any) {
                    console.error("[NextAction] updateTask (status) failed:", e);
                    notifyError(formatRpcError(e, i18n));
                }
            },
        });
    }

    menu.addSeparator();

    menu.addItem({
        icon: "iconSort",
        label: i18n?.priority || "Priority",
        type: "submenu",
        submenu: PRIORITY_LIST.map((p) => ({
            icon: p === task.priority ? "iconSelect" : "",
            label: i18n?.[toI18nKey("priority", p)] || p,
            click: async () => {
                try {
                    const updated = await bridge.updateTask(task.blockId, { "na-priority": p });
                    callbacks.onUpdated(updated);
                } catch (e: any) {
                    console.error("[NextAction] updateTask (priority) failed:", e);
                    notifyError(formatRpcError(e, i18n));
                }
            },
        })),
    });

    menu.addSeparator();

    if (callbacks.onMyDayToggle) {
        const isInMyDay = inMyDay ?? false;
        menu.addItem({
            icon: isInMyDay ? "iconClose" : "iconBookmark",
            label: isInMyDay
                ? (i18n?.removeFromMyDay || "Remove from My Day")
                : (i18n?.addToMyDay || "Add to My Day"),
            click: async () => {
                callbacks.onMyDayToggle!(task.blockId, isInMyDay);
            },
        });

        menu.addSeparator();
    }

    menu.addItem({
        icon: "iconClock",
        label: i18n?.reminderAddReminder || "添加提醒",
        click: () => {
            if (callbacks.onReminderEdit) {
                callbacks.onReminderEdit(task.blockId);
            }
        },
    });

    menu.addSeparator();

    menu.addItem({
        icon: "iconTrashcan",
        label: i18n?.removeTask || "Remove Task",
        click: async () => {
            confirm(
                i18n?.removeTask || "Remove Task",
                i18n?.confirmRemoveTask || "This will clear all task attributes. This action cannot be undone.",
                async () => {
                    try {
                        await bridge.removeTask(task.blockId);
                        callbacks.onRemoved(task.blockId);
                    } catch (e: any) {
                        console.error("[NextAction] removeTask failed:", e);
                        notifyError(formatRpcError(e, i18n));
                    }
                },
            );
        },
    });

    menu.open({ x: event.clientX, y: event.clientY });
}
