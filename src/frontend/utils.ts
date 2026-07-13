import { openTab } from "siyuan";
import { Menu } from "siyuan";
import { STATUS_LIST } from "./constants";
import type { KernelBridge } from "./kernel-bridge";
import type { TaskCacheEntry } from "../../shared/types";
import { notifyError, notifyInfo, formatRpcError } from "./notify";

/**
 * Open the SiYuan document that contains a block, focusing on the block.
 */
export async function jumpToBlock(blockId: string): Promise<void> {
    const app = (window as any).siyuan?.ws?.app;
    if (!app) return;
    openTab({
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
                        const statusLabel = i18n?.[i18nKey] || s;
                        const template = s === "done"
                            ? (i18n?.taskMarkedDone || "Marked as done")
                            : (i18n?.taskStatusUpdated || "Status updated to {status}");
                        notifyInfo(template.replace("{status}", statusLabel));
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

