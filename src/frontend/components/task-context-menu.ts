import { Menu, confirm } from "siyuan";
import type { TaskCacheEntry } from "../../shared/types";
import { KernelBridge } from "../kernel-bridge";
import { normalizePriority, STATUS_LIST, PRIORITY_LIST } from "../constants";
import { toI18nKey } from "../utils";
import { notifyError, notifyInfo, formatRpcError } from "../notify";
import { parseRepeatState } from "../../shared/repeat";
import { runAiDecomposeTask } from "../ai/ai-feature-service";

interface ContextMenuCallbacks {
    onUpdated: (updatedEntry: TaskCacheEntry) => void;
    onRemoved: (blockId: string) => void;
    onEdit?: (task: TaskCacheEntry) => void;
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
                    const statusLabel = i18n?.[i18nKey] || s;
                    const template = s === "done"
                        ? (i18n?.taskMarkedDone || "Marked as done")
                        : (i18n?.taskStatusUpdated || "Status updated to {status}");
                    notifyInfo(template.replace("{status}", statusLabel));
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
            icon: p === normalizePriority(task.priority) ? "iconSelect" : "",
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

    if (task.repeat) {
        const repeatState = parseRepeatState(task.repeatState);
        const repeatStatus = repeatState?.status || "active";

        if (repeatStatus === "active") {
            menu.addItem({
                label: i18n?.repeatSkipOccurrence || "跳过本次",
                click: async () => {
                    try {
                        const updated = await bridge.skipRepeatOccurrence(task.blockId);
                        callbacks.onUpdated(updated);
                        notifyInfo(i18n?.repeatOccurrenceSkipped || "已跳到下一次");
                    } catch (e: any) {
                        notifyError(formatRpcError(e, i18n));
                    }
                },
            });
        }

        if (repeatStatus !== "ended") {
            menu.addItem({
                label: repeatStatus === "paused"
                    ? (i18n?.repeatResume || "恢复重复")
                    : (i18n?.repeatPause || "暂停重复"),
                click: async () => {
                    try {
                        const updated = await bridge.setRepeatPaused(task.blockId, repeatStatus !== "paused");
                        callbacks.onUpdated(updated);
                    } catch (e: any) {
                        notifyError(formatRpcError(e, i18n));
                    }
                },
            });
        }

        menu.addSeparator();
    }

    if (callbacks.onEdit) {
        menu.addItem({
            icon: "iconEdit",
            label: i18n?.taskProperties || "Task Properties",
            click: () => {
                callbacks.onEdit!(task);
            },
        });

        menu.addSeparator();
    }

    menu.addItem({
        icon: "iconSparkles",
        label: i18n?.aiDecomposeTask || "AI 拆解任务",
        click: async () => runAiDecomposeTask(task),
    });

    menu.addSeparator();

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
