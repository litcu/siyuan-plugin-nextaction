import type { KernelBridge } from "../kernel-bridge";

export async function refreshTasks(bridge: KernelBridge, loadTasks: () => Promise<void>): Promise<void> {
    await bridge.rebuildCache();
    await bridge.recalcAllOrders();
    await loadTasks();
}
