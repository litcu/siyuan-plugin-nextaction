import { Menu, openTab } from "siyuan";
import { STATUS_LIST } from "./constants";
import { TASK_WARNING_PROJECT_REOPENED } from "../shared/constants";
import type { KernelBridge } from "./kernel-bridge";
import type { TaskCacheEntry } from "../shared/types";
import type { I18nStrings } from "../shared/i18n";
import { notifyError, notifyInfo, formatRpcError } from "./notify";

/**
 * Open the SiYuan document that contains a block, focusing on the block.
 */
export async function jumpToBlock(blockId: string): Promise<void> {
    const app = (window as any).siyuan?.ws?.app;
    if (!app) return;
    await openTab({
        app,
        doc: {
            id: blockId,
            action: ["cb-get-focus", "cb-get-context", "cb-get-hl"],
        },
    });
}

/**
 * Generate i18n key for a status/priority value.
 * e.g. toI18nKey("status", "todo") → "statusTodo"
 */
export function toI18nKey(prefix: string, value: string): string {
    return prefix + value.charAt(0).toUpperCase() + value.slice(1);
}

export function taskWriteWarningMessage(
    warning: TaskCacheEntry["_warning"],
    i18n: Pick<I18nStrings, "projectReopenedNotice"> | undefined,
): string {
    if (warning === TASK_WARNING_PROJECT_REOPENED) {
        return i18n?.projectReopenedNotice || "The completed project was reopened because it has new work.";
    }
    return "";
}

export function taskCreationWarningMessage(
    warning: string,
    i18n: Pick<I18nStrings, "projectReopenedNotice"> | undefined,
): string {
    return warning === TASK_WARNING_PROJECT_REOPENED ? taskWriteWarningMessage(warning, i18n) : warning;
}

/**
 * Show a status selection menu at the given position.
 * Calls bridge.updateTask and returns the updated entry.
 */
export async function showStatusMenu(
    task: TaskCacheEntry,
    event: MouseEvent,
    bridge: KernelBridge,
    i18n: any,
): Promise<TaskCacheEntry> {
    return new Promise((resolve) => {
        const menu = new Menu("na-status-select");
        for (const s of STATUS_LIST) {
            const i18nKey = toI18nKey("status", s);
            menu.addItem({
                icon: s === task.status ? "iconSelect" : "",
                label: i18n?.[i18nKey] || s,
                click: async () => {
                    try {
                        const updated = await bridge.updateTask(task.blockId, { "na-status": s });
                        const warningMessage = taskWriteWarningMessage(updated._warning, i18n);
                        if (warningMessage) notifyInfo(warningMessage);
                        resolve(updated);
                    } catch (e: any) {
                        notifyError(formatRpcError(e, i18n));
                        resolve(task);
                    }
                },
            });
        }
        menu.open({ x: event.clientX, y: event.clientY });
    });
}
