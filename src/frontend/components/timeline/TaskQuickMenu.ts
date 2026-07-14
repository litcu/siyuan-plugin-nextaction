import { Menu } from "siyuan";
import type { TaskCacheEntry } from "../../../shared/types";
import type { KernelBridge } from "../../kernel-bridge";
import { normalizePriority, PRIORITY_LIST } from "../../constants";
import { toI18nKey } from "../../utils";
import { notifyError, notifyInfo, formatRpcError } from "../../notify";
import type { MyDayState } from "../../../shared/types";

interface QuickMenuCallbacks {
    onScheduleRemoved: (newState: MyDayState) => void;
    onTaskUpdated: (updated: TaskCacheEntry) => void;
    onRemovedFromMyDay: (newState: MyDayState) => void;
}

export function showTaskQuickMenu(
    task: TaskCacheEntry,
    x: number,
    y: number,
    bridge: KernelBridge,
    i18n: any,
    callbacks: QuickMenuCallbacks,
): void {
    const menu = new Menu("na-timeline-quick");

    menu.addItem({
        icon: "iconClose",
        label: i18n?.cancelSchedule || "Unschedule",
        click: async () => {
            try {
                const newState = await bridge.removeMyDaySchedule(task.blockId);
                callbacks.onScheduleRemoved(newState);
            } catch (e: any) {
                notifyError(formatRpcError(e, i18n));
            }
        },
    });

    menu.addSeparator();

    menu.addItem({
        icon: "iconSelect",
        label: i18n?.markComplete || "Mark Complete",
        click: async () => {
            try {
                const updated = await bridge.updateTask(task.blockId, { "na-status": "done" });
                callbacks.onTaskUpdated(updated);
                notifyInfo(i18n?.taskMarkedDone || "Marked as done");
            } catch (e: any) {
                notifyError(formatRpcError(e, i18n));
            }
        },
    });

    menu.addItem({
        icon: "iconSort",
        label: i18n?.setPriority || "Set Priority",
        type: "submenu",
        submenu: PRIORITY_LIST.map((p) => ({
            icon: p === normalizePriority(task.priority) ? "iconSelect" : "",
            label: i18n?.[toI18nKey("priority", p)] || p,
            click: async () => {
                try {
                    const updated = await bridge.updateTask(task.blockId, { "na-priority": p });
                    callbacks.onTaskUpdated(updated);
                } catch (e: any) {
                    notifyError(formatRpcError(e, i18n));
                }
            },
        })),
    });

    menu.addSeparator();

    menu.addItem({
        icon: "iconTrashcan",
        label: i18n?.removeFromMyDay || "Remove from My Day",
        click: async () => {
            try {
                const newState = await bridge.removeTaskFromMyDay(task.blockId);
                callbacks.onRemovedFromMyDay(newState);
            } catch (e: any) {
                notifyError(formatRpcError(e, i18n));
            }
        },
    });

    menu.open({ x, y });
}
