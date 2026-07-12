import { Plugin, showMessage, getFrontend, Menu, openTab, Dialog, confirm } from "siyuan";
import { get } from "svelte/store";
import "./index.scss";
import { KernelBridge } from "./frontend/kernel-bridge";
import { taskStore } from "./frontend/stores/task-store";
import type TaskDetail from "./frontend/components/TaskDetail.svelte";
import { DEFAULT_SETTINGS, type PluginSettings, type PriorityEngineSettings } from "./shared/settings";
import { notifyError, formatRpcError } from "./frontend/notify";
import { initReminderStore, destroyReminderStore } from "./frontend/stores/reminder-store";
import NotificationHost from "./frontend/components/NotificationHost.svelte";
import { PRIORITY_LIST } from "./frontend/constants";
import { toI18nKey } from "./frontend/utils";

const TAB_TYPE = "nextaction_tab";
const DOCK_TYPE = "nextaction_dock";

const DEFAULT_TASK_ATTRS: Record<string, string> = {
    "custom-na-task": "1",
    "custom-na-status": "inbox",
    "custom-na-priority": "none",
    "custom-na-importance": "4",
    "custom-na-effort": "4",
    "custom-na-sort": "",
};

export default class NextActionPlugin extends Plugin {
    private bridge!: KernelBridge;
    private isMobile: boolean = false;
    private tasksChangedHandler: ((...params: any[]) => void) | null = null;
    private blockIconHandler: (({detail}: any) => void) | null = null;
    private editorTitleIconHandler: (({detail}: any) => void) | null = null;
    private notificationHost?: NotificationHost;

    /**
     * Handle clicks on the ::before status checkbox in the editor.
     * Detects clicks in the left 20px area of a task block, opens a
     * status selection menu.
     */
    private handleEditorStatusClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        // Find the closest block with custom-na-task
        const taskBlock = target.closest('[data-node-id][custom-na-task]') as HTMLElement;
        if (!taskBlock) return;

        const rect = taskBlock.getBoundingClientRect();
        // ::before is absolutely positioned at left:0, 14px wide, padding-left:22px
        if (event.clientX > rect.left + 22 || event.clientX < rect.left) return;

        const blockId = taskBlock.dataset.nodeId;
        if (!blockId) return;
        const currentStatus = taskBlock.getAttribute('custom-na-status') || 'todo';
        const currentPriority = taskBlock.getAttribute('custom-na-priority') || 'none';

        event.stopPropagation();
        event.preventDefault();

        const menu = new Menu('na-editor-status');

        // Status section
        for (const s of ['inbox', 'todo', 'doing', 'waiting', 'someday', 'done']) {
            const i18nKey = 'status' + s.charAt(0).toUpperCase() + s.slice(1);
            menu.addItem({
                icon: s === currentStatus ? 'iconSelect' : '',
                label: this.i18n[i18nKey] || s,
                click: async () => {
                    try {
                        const updated = await this.bridge.updateTask(blockId, { 'na-status': s });
                        taskStore.applyUpdate(updated);
                    } catch (e: any) {
                        notifyError(formatRpcError(e, this.i18n));
                    }
                },
            });
        }

        menu.addSeparator();

        // Priority submenu
        menu.addItem({
            icon: 'iconSort',
            label: this.i18n.priority || 'Priority',
            type: 'submenu',
            submenu: PRIORITY_LIST.map((p) => ({
                icon: p === currentPriority ? 'iconSelect' : '',
                label: this.i18n[toI18nKey('priority', p)] || p,
                click: async () => {
                    try {
                        const updated = await this.bridge.updateTask(blockId, { 'na-priority': p });
                        taskStore.applyUpdate(updated);
                    } catch (e: any) {
                        notifyError(formatRpcError(e, this.i18n));
                    }
                },
            })),
        });

        menu.addSeparator();

        // My Day toggle
        const storeState = get(taskStore);
        const myDayEnabled = storeState.settings.myDayEnabled !== false;
        if (myDayEnabled) {
            const isInMyDay = storeState.myDayState?.tasks.some(t => t.blockId === blockId) ?? false;
            menu.addItem({
                icon: isInMyDay ? 'iconClose' : 'iconBookmark',
                label: isInMyDay
                    ? (this.i18n.removeFromMyDay || 'Remove from My Day')
                    : (this.i18n.addToMyDay || 'Add to My Day'),
                click: async () => {
                    try {
                        const myDayState = isInMyDay
                            ? await this.bridge.removeTaskFromMyDay(blockId)
                            : await this.bridge.addTaskToMyDay(blockId);
                        taskStore.applyMyDayUpdate(myDayState);
                    } catch (e: any) {
                        notifyError(formatRpcError(e, this.i18n));
                    }
                },
            });
            menu.addSeparator();
        }

        // Reminder
        menu.addItem({
            icon: 'iconClock',
            label: this.i18n.reminderAddReminder || '添加提醒',
            click: () => {
                this.openReminderDialog(blockId);
            },
        });

        menu.addSeparator();

        // Task properties
        menu.addItem({
            icon: 'iconEdit',
            label: this.i18n.taskProperties || 'Task Properties',
            click: () => {
                this.openTaskDetailDialog(blockId);
            },
        });

        // Remove task
        menu.addItem({
            icon: 'iconTrashcan',
            label: this.i18n.removeTask || 'Remove Task',
            click: async () => {
                confirm(
                    this.i18n.removeTask || 'Remove Task',
                    this.i18n.confirmRemoveTask || 'This will clear all task attributes. This action cannot be undone.',
                    async () => {
                        try {
                            await this.bridge.removeTask(blockId);
                            taskStore.applyRemove(blockId);
                        } catch (e: any) {
                            notifyError(formatRpcError(e, this.i18n));
                        }
                    },
                );
            },
        });

        menu.open({ x: event.clientX, y: event.clientY });
    };

    /**
     * Open a reminder settings dialog for the given task.
     * Used from the editor status icon menu.
     */
    private openReminderDialog(blockId: string) {
        const storeState = get(taskStore);
        const task = storeState.allTasks.find(t => t.blockId === blockId);
        if (!task) return;

        const dialog = new Dialog({
            title: this.i18n.reminderPopupTitle || "提醒设置",
            content: `<div id="na-editor-reminder-ctx"></div>`,
            width: "360px",
        });
        dialog.element.classList.add("nextaction");

        const container = dialog.element.querySelector("#na-editor-reminder-ctx");
        if (!container) return;

        import("./frontend/components/ReminderPopup.svelte").then(({ default: ReminderPopupComp }) => {
            new ReminderPopupComp({
                target: container as HTMLElement,
                props: {
                    task,
                    bridge: this.bridge,
                    i18n: this.i18n,
                    onSave: (updated: any) => {
                        taskStore.applyUpdate(updated);
                    },
                },
            });
        });
    }

    /**
     * Open a dialog with the TaskDetail component for the given block.
     * Used from the editor status icon menu.
     */
    private openTaskDetailDialog(blockId: string) {
        const dialog = new Dialog({
            title: "",
            content: `<div class="nextaction na-task-dialog-content"></div>`,
            width: "480px",
            hideCloseIcon: true,
            destroyCallback: () => {
                const comp = (dialog as any)._naDetail;
                if (comp) comp.$destroy();
            },
        });

        const containerEl = dialog.element.querySelector(".na-task-dialog-content");
        if (!containerEl) return;

        // Remove the empty header bar to avoid double title
        const header = dialog.element.querySelector(".b3-dialog__header");
        if (header) header.remove();

        // Constrain dialog max-height so body scrolls
        const dialogContainer = dialog.element.querySelector(".b3-dialog__container") as HTMLElement;
        if (dialogContainer) {
            dialogContainer.style.maxHeight = "80vh";
        }

        import("./frontend/components/TaskDetail.svelte").then(({ default: TaskDetailComp }) => {
            this.bridge.getTask(blockId).then((task) => {
                if (!task) return;
                const comp = new TaskDetailComp({
                    target: containerEl as HTMLElement,
                    props: {
                        task,
                        bridge: this.bridge,
                        i18n: this.i18n,
                        dialogMode: true,
                        onSave: (updated: any) => {
                            taskStore.applyUpdate(updated);
                        },
                        onRemove: (removedId: string) => {
                            taskStore.applyRemove(removedId);
                            dialog.destroy();
                        },
                        onClose: () => {
                            dialog.destroy();
                        },
                    },
                });
                (dialog as any)._naDetail = comp;
            });
        });
    }

    /**
     * Convert a block and its list subtree to tasks. Tries kernel RPC first.
     */
    private async doConvertToTaskWithChildren(blockId: string, cleanTitle?: string, taskType: string = "1"): Promise<{ converted: number; skipped: number }> {
        try {
            return await this.bridge.convertToTaskWithChildren(blockId, cleanTitle, taskType);
        } catch (rpcErr: any) {
            console.warn("[NextAction] doConvertToTaskWithChildren RPC failed:", rpcErr.message);
            throw rpcErr;
        }
    }

    /**
     * Convert a block to a task. Tries kernel RPC first, falls back to direct SiYuan API.
     */
    private async doConvertToTask(blockId: string, cleanTitle?: string, taskType: string = "1"): Promise<any> {
        try {
            const result = await this.bridge.convertToTask(blockId, cleanTitle, taskType);
            return result;
        } catch (rpcError: any) {
            // Business validation errors (e.g. non-text block) should be shown directly, not fallback
            if (rpcError?.code && rpcError.code !== undefined) {
                throw rpcError;
            }
            console.warn("[NextAction] doConvertToTask RPC failed (no error code), trying direct API:", rpcError.message);
            // Fallback: directly call SiYuan's attribute API from the frontend (kernel not running)
            try {
                const resp = await fetch("/api/attr/getBlockAttrs", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: blockId }),
                });
                const existing = await resp.json();
                if (existing.code === 0 && existing.data?.["custom-na-task"]) {
                    return existing.data;
                }
                const attrs = { ...DEFAULT_TASK_ATTRS, "custom-na-task": taskType };
                const setResp = await fetch("/api/attr/setBlockAttrs", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: blockId, attrs }),
                });
                const setResult = await setResp.json();
                if (setResult.code !== 0) {
                    throw new Error(`Direct API error: ${setResult.msg}`);
                }
                showMessage(`[NextAction] ${this.i18n.kernelNotReady || "(Kernel not ready, parent relationships may need manual rebuild)"}`);
                return setResult.data;
            } catch (directError: any) {
                console.error("[NextAction] doConvertToTask direct API also failed:", directError);
                throw directError;
            }
        }
    }

    onload() {
        this.isMobile = getFrontend() === "mobile" || getFrontend() === "browser-mobile";

        this.addIcons(`<symbol id="iconNextAction" viewBox="0 0 32 32">
    <path d="M5 24C8 20 11 8 16 12S24 20 27 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <circle cx="11" cy="13" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="11" cy="13" r="1.5" fill="currentColor"/>
    <path d="M24 8l3 0 0 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</symbol>`);

        // Capture plugin refs for closure in addTab callbacks
        const pluginRef = this;
        this.addTab({
            type: TAB_TYPE,
            init() {
                const container = this.element;
                container.style.width = "100%";
                container.style.height = "100%";
                container.classList.add("fn__flex");
                import("./frontend/components/NextActionApp.svelte").then(({ default: NextActionApp }) => {
                    const app = new NextActionApp({
                        target: container,
                        props: {
                            bridge: pluginRef.bridge,
                            i18n: pluginRef.i18n,
                        },
                    });
                    (this as any)._naApp = app;
                });
            },
            destroy() {
                const app = (this as any)._naApp;
                if (app) app.$destroy();
            },
        });

        this.addDock({
            config: {
                position: "RightTop",
                size: { width: 300, height: 0 },
                icon: "iconNextAction",
                title: this.i18n.pluginName || "NextAction",
                hotkey: "",
            },
            data: {},
            type: DOCK_TYPE,
            destroy() {
                const comp = (this as any)._naDock;
                if (comp) comp.$destroy();
            },
            resize() {
            },
            update() {
            },
            init() {
                const container = this.element;
                container.style.width = "100%";
                container.style.height = "100%";
                container.classList.add("nextaction");
                import("./frontend/components/DockSidebar.svelte").then(({ default: DockSidebar }) => {
                    const dock = new DockSidebar({
                        target: container,
                        props: {
                            bridge: pluginRef.bridge,
                            i18n: pluginRef.i18n,
                        },
                    });
                    (this as any)._naDock = dock;
                });
            },
        });

        this.addTopBar({
            icon: "iconNextAction",
            title: this.i18n.taskPanel,
            callback: () => {
                openTab({
                    app: this.app,
                    custom: {
                        id: this.name + TAB_TYPE,
                        icon: "iconNextAction",
                        title: this.i18n.pluginName || "NextAction",
                    },
                });
            },
        });

        // Slash menu items
        this.protyleSlash = [
            {
                filter: [this.i18n.convertToTask, "convert to task", "zrw"],
                html: `<div class="b3-list-item__first"><span class="b3-list-item__text">[NextAction] ${this.i18n.convertToTask}</span></div>`,
                id: "convertToTask",
                callback: async (protyle: any, nodeElement: HTMLElement) => {
                    // SiYuan does not auto-clear slash text for plugin callbacks (unlike
                    // built-in slash items which call range.deleteContents() before dispatch).
                    // We replicate the same behavior here.
                    const savedRange = protyle?.toolbar?.range;
                    const sel = window.getSelection();
                    if (savedRange) {
                        try { savedRange.deleteContents(); } catch (_e) { /* ignore */ }
                    } else if (sel && sel.rangeCount > 0) {
                        try { sel.getRangeAt(0).deleteContents(); } catch (_e) { /* ignore */ }
                    }
                    // Read the clean title from DOM right after deletion, before SiYuan
                    // re-renders and before the database has a chance to lag.
                    const editable = nodeElement.querySelector('[contenteditable="true"]');
                    const cleanTitle = (editable?.textContent || "").trim();
                    // Trigger SiYuan's content sync so the database updates
                    nodeElement.dispatchEvent(new Event("input", { bubbles: true }));

                    const blockId = nodeElement.dataset.nodeId;
                    if (!blockId) {
                        showMessage(`[NextAction] ${this.i18n.errorCannotDetermineBlockId || "Cannot determine block ID"}`);
                        return;
                    }
                    try {
                        await this.doConvertToTask(blockId, cleanTitle);
                        showMessage(`[NextAction] ${this.i18n.convertToTaskSuccess}`);
                        taskStore.loadTasks();
                    } catch (e: any) {
                        console.error("[NextAction] convertToTask error:", e);
                        showMessage(`[NextAction] ${formatRpcError(e, this.i18n)}`);
                    }
                },
            },
            {
                filter: [this.i18n.convertToProject, "convert to project", "zrxm"],
                html: `<div class="b3-list-item__first"><span class="b3-list-item__text">[NextAction] ${this.i18n.convertToProject}</span></div>`,
                id: "convertToProject",
                callback: async (protyle: any, nodeElement: HTMLElement) => {
                    const savedRange = protyle?.toolbar?.range;
                    const sel = window.getSelection();
                    if (savedRange) {
                        try { savedRange.deleteContents(); } catch (_e) { /* ignore */ }
                    } else if (sel && sel.rangeCount > 0) {
                        try { sel.getRangeAt(0).deleteContents(); } catch (_e) { /* ignore */ }
                    }
                    const editable = nodeElement.querySelector('[contenteditable="true"]');
                    const cleanTitle = (editable?.textContent || "").trim();
                    nodeElement.dispatchEvent(new Event("input", { bubbles: true }));

                    const blockId = nodeElement.dataset.nodeId;
                    if (!blockId) {
                        showMessage(`[NextAction] ${this.i18n.errorCannotDetermineBlockId || "Cannot determine block ID"}`);
                        return;
                    }
                    try {
                        await this.doConvertToTask(blockId, cleanTitle, "2");
                        showMessage(`[NextAction] ${this.i18n.convertToProjectSuccess}`);
                        taskStore.loadTasks();
                    } catch (e: any) {
                        console.error("[NextAction] convertToProject error:", e);
                        showMessage(`[NextAction] ${formatRpcError(e, this.i18n)}`);
                    }
                },
            },
            {
                filter: [this.i18n.convertToTaskWithChildren, "convert to task with children", "zrwz"],
                html: `<div class="b3-list-item__first"><span class="b3-list-item__text">[NextAction] ${this.i18n.convertToTaskWithChildren}</span></div>`,
                id: "convertToTaskWithChildren",
                callback: async (protyle: any, nodeElement: HTMLElement) => {
                    const savedRange = protyle?.toolbar?.range;
                    const sel = window.getSelection();
                    if (savedRange) {
                        try { savedRange.deleteContents(); } catch (_e) { /* ignore */ }
                    } else if (sel && sel.rangeCount > 0) {
                        try { sel.getRangeAt(0).deleteContents(); } catch (_e) { /* ignore */ }
                    }
                    const editable = nodeElement.querySelector('[contenteditable="true"]');
                    const cleanTitle = (editable?.textContent || "").trim();
                    nodeElement.dispatchEvent(new Event("input", { bubbles: true }));

                    const blockId = nodeElement.dataset.nodeId;
                    if (!blockId) {
                        showMessage(`[NextAction] ${this.i18n.errorCannotDetermineBlockId || "Cannot determine block ID"}`);
                        return;
                    }
                    try {
                        const result = await this.doConvertToTaskWithChildren(blockId, cleanTitle);
                        const msg = this.i18n.convertToTaskWithChildrenResult
                            .replace("{converted}", String(result.converted))
                            .replace("{skipped}", String(result.skipped));
                        showMessage(`[NextAction] ${msg}`);
                        taskStore.loadTasks();
                    } catch (e: any) {
                        console.error("[NextAction] convertToTaskWithChildren error:", e);
                        showMessage(`[NextAction] ${formatRpcError(e, this.i18n)}`);
                    }
                },
            },
        ];
    }

    onLayoutReady() {
        this.bridge = new KernelBridge(this);
        taskStore.setBridge(this.bridge);

        // Initialize reminder store
        initReminderStore(this);

        // Mount NotificationHost portal for reminder popups
        this.notificationHost = new NotificationHost({
            target: document.body,
            props: {
                i18n: this.i18n,
            },
        });

        // Block icon menu
        this.blockIconHandler = ({ detail }: any) => {
            detail.menu.addItem({
                icon: "iconNextAction",
                label: `[NextAction] ${this.i18n.convertToTask}`,
                click: async () => {
                    let ok = 0;
                    for (const blockElement of detail.blockElements) {
                        const blockId = blockElement.dataset.nodeId;
                        if (blockId) {
                            try {
                                await this.doConvertToTask(blockId);
                                ok++;
                            } catch (e: any) {
                                showMessage(`[NextAction] ${formatRpcError(e, this.i18n)}`);
                            }
                        }
                    }
                    if (ok > 0) showMessage(`[NextAction] ${this.i18n.convertToTaskSuccess}`);
                    taskStore.loadTasks();
                },
            });
            detail.menu.addItem({
                icon: "iconFolder",
                label: `[NextAction] ${this.i18n.convertToProject}`,
                click: async () => {
                    let ok = 0;
                    for (const blockElement of detail.blockElements) {
                        const blockId = blockElement.dataset.nodeId;
                        if (blockId) {
                            try {
                                await this.doConvertToTask(blockId, undefined, "2");
                                ok++;
                            } catch (e: any) {
                                showMessage(`[NextAction] ${formatRpcError(e, this.i18n)}`);
                            }
                        }
                    }
                    if (ok > 0) showMessage(`[NextAction] ${this.i18n.convertToProjectSuccess}`);
                    taskStore.loadTasks();
                },
            });
            detail.menu.addItem({
                icon: "iconDown",
                label: `[NextAction] ${this.i18n.convertToTaskWithChildren}`,
                click: async () => {
                    for (const blockElement of detail.blockElements) {
                        const blockId = blockElement.dataset.nodeId;
                        if (blockId) {
                            try {
                                const result = await this.doConvertToTaskWithChildren(blockId);
                                const msg = this.i18n.convertToTaskWithChildrenResult
                                    .replace("{converted}", String(result.converted))
                                    .replace("{skipped}", String(result.skipped));
                                showMessage(`[NextAction] ${msg}`);
                            } catch (e: any) {
                                showMessage(`[NextAction] ${formatRpcError(e, this.i18n)}`);
                            }
                        }
                    }
                    taskStore.loadTasks();
                },
            });
        };
        this.eventBus.on("click-blockicon", this.blockIconHandler);

        // Document title icon menu
        this.editorTitleIconHandler = ({ detail }: any) => {
            const docId = detail.data?.id;
            if (!docId) return;
            detail.menu.addItem({
                icon: "iconNextAction",
                label: `[NextAction] ${this.i18n.convertToTask}`,
                click: async () => {
                    try {
                        await this.doConvertToTask(docId);
                        showMessage(`[NextAction] ${this.i18n.convertToTaskSuccess}`);
                        taskStore.loadTasks();
                    } catch (e: any) {
                        showMessage(`[NextAction] ${formatRpcError(e, this.i18n)}`);
                    }
                },
            });
            detail.menu.addItem({
                icon: "iconFolder",
                label: `[NextAction] ${this.i18n.convertToProject}`,
                click: async () => {
                    try {
                        await this.doConvertToTask(docId, undefined, "2");
                        showMessage(`[NextAction] ${this.i18n.convertToProjectSuccess}`);
                        taskStore.loadTasks();
                    } catch (e: any) {
                        showMessage(`[NextAction] ${formatRpcError(e, this.i18n)}`);
                    }
                },
            });
            detail.menu.addItem({
                icon: "iconDown",
                label: `[NextAction] ${this.i18n.convertToTaskWithChildren}`,
                click: async () => {
                    try {
                        const result = await this.doConvertToTaskWithChildren(docId);
                        const msg = this.i18n.convertToTaskWithChildrenResult
                            .replace("{converted}", String(result.converted))
                            .replace("{skipped}", String(result.skipped));
                        showMessage(`[NextAction] ${msg}`);
                        taskStore.loadTasks();
                    } catch (e: any) {
                        showMessage(`[NextAction] ${formatRpcError(e, this.i18n)}`);
                    }
                },
            });
        };
        this.eventBus.on("click-editortitleicon", this.editorTitleIconHandler);

        // Kernel state change listener
        this.eventBus.on("kernel-plugin-state-change", async ({ detail }: any) => {
            if (detail.code === 2) {
                showMessage(`[NextAction] ${this.i18n.pluginName} ready`);
                taskStore.loadTasks();
            }
        });

        // Bind kernel broadcast for task changes
        this.tasksChangedHandler = (notification: any) => {
            taskStore.applyChangeNotification(notification);
        };
        this.kernel.rpc.bind("tasksChanged", this.tasksChangedHandler);

        // Load saved settings and push to kernel
        this.loadData("settings.json").then((saved: any) => {
            if (saved && typeof saved === "object") {
                this.bridge.updateSettings(saved).then((merged: any) => {
                    taskStore.applySettingsUpdate(merged);
                }).catch((e: any) => {
                    console.warn("[NextAction] Failed to apply saved settings:", e);
                });
            }
        }).catch(() => {
            // No saved settings yet, use defaults
        });

        // Initial load
        taskStore.loadTasks();

        // Editor status checkbox click listener
        document.addEventListener('click', this.handleEditorStatusClick, true);

        // Commands
        this.addCommand({
            langKey: "convertToTask",
            langText: `[${this.i18n.pluginName}] ${this.i18n.convertToTask}`,
            hotkey: "",
            callback: () => {
                const editor = this.getEditor();
                if (editor) {
                    const blockId = editor.protyle?.block?.rootID;
                    if (!blockId) return;
                    this.doConvertToTask(blockId).then(() => {
                        showMessage(`[NextAction] ${this.i18n.convertToTaskSuccess}`);
                        taskStore.loadTasks();
                    }).catch((e: any) => {
                        showMessage(`[NextAction] ${formatRpcError(e, this.i18n)}`);
                    });
                }
            },
        });

        this.addCommand({
            langKey: "refreshTasks",
            langText: `[${this.i18n.pluginName}] ${this.i18n.refreshTasks}`,
            hotkey: "",
            callback: () => {
                this.bridge.recalcAllOrders().then(() => {
                    taskStore.loadTasks();
                    showMessage(`[NextAction] ${this.i18n.refreshTasks} ✓`);
                }).catch((e: any) => {
                    showMessage(`[NextAction] ${formatRpcError(e, this.i18n)}`);
                });
            },
        });

        this.addCommand({
            langKey: "convertToProject",
            langText: `[${this.i18n.pluginName}] ${this.i18n.convertToProject}`,
            hotkey: "",
            callback: () => {
                const editor = this.getEditor();
                if (editor) {
                    const nodeElement = editor.protyle.wysiwygElement.querySelector(".protyle-wysiwyg--select") || editor.protyle.wysiwygElement.firstElementChild;
                    const blockId = nodeElement?.dataset?.nodeId || editor.protyle.block?.rootID;
                    if (blockId) {
                        this.doConvertToTask(blockId, undefined, "2").then(() => {
                            showMessage(`[NextAction] ${this.i18n.convertToProjectSuccess}`);
                            taskStore.loadTasks();
                        }).catch((e: any) => {
                            showMessage(`[NextAction] ${formatRpcError(e, this.i18n)}`);
                        });
                    }
                }
            },
        });

        this.addCommand({
            langKey: "convertToTaskWithChildren",
            langText: `[${this.i18n.pluginName}] ${this.i18n.convertToTaskWithChildren}`,
            hotkey: "",
            callback: () => {
                const editor = this.getEditor();
                if (editor) {
                    const nodeElement = editor.protyle.wysiwygElement.querySelector(".protyle-wysiwyg--select") || editor.protyle.wysiwygElement.firstElementChild;
                    const blockId = nodeElement?.dataset?.nodeId || editor.protyle.block?.rootID;
                    if (blockId) {
                        this.doConvertToTaskWithChildren(blockId).then((result) => {
                            const msg = this.i18n.convertToTaskWithChildrenResult
                                .replace("{converted}", String(result.converted))
                                .replace("{skipped}", String(result.skipped));
                            showMessage(`[NextAction] ${msg}`);
                            taskStore.loadTasks();
                        }).catch((e: any) => {
                            showMessage(`[NextAction] ${formatRpcError(e, this.i18n)}`);
                        });
                    }
                }
            },
        });

        this.addCommand({
            langKey: "openTaskPanel",
            langText: `[${this.i18n.pluginName}] ${this.i18n.openTaskPanel}`,
            hotkey: "",
            callback: () => {
                openTab({
                    app: this.app,
                    custom: {
                        id: this.name + TAB_TYPE,
                        icon: "iconNextAction",
                        title: this.i18n.pluginName || "NextAction",
                    },
                });
            },
        });
    }

    onunload() {
        document.removeEventListener('click', this.handleEditorStatusClick, true);
        if (this.tasksChangedHandler) {
            this.kernel.rpc.unbind("tasksChanged", this.tasksChangedHandler);
        }
        if (this.blockIconHandler) {
            this.eventBus.off("click-blockicon", this.blockIconHandler);
        }
        if (this.editorTitleIconHandler) {
            this.eventBus.off("click-editortitleicon", this.editorTitleIconHandler);
        }
        destroyReminderStore();
        if (this.notificationHost) {
            this.notificationHost.$destroy();
            this.notificationHost = undefined;
        }
    }

    openSetting(): void {
        const plugin = this;
        const i18n = this.i18n;

        const dialog = new Dialog({
            title: "",
            content: `<div id="naSettingsPanel" class="nextaction"></div>`,
            width: "580px",
            hideCloseIcon: true,
            destroyCallback: () => {
                const comp = (dialog as any)._naSettings;
                if (comp) comp.$destroy();
            },
        });

        // Remove the empty header bar to maximize content area
        const header = dialog.element.querySelector(".b3-dialog__header");
        if (header) header.remove();

        const containerEl = dialog.element.querySelector("#naSettingsPanel");
        if (!containerEl) return;

        import("./frontend/components/SettingsPanel.svelte").then(({ default: SettingsPanel }) => {
            const comp = new SettingsPanel({
                target: containerEl as HTMLElement,
                props: {
                    bridge: plugin.bridge,
                    i18n: i18n,
                    onSave: async (settings: PluginSettings) => {
                        try {
                            await plugin.saveData("settings.json", settings);
                            await plugin.bridge.recalcAllOrders();
                            taskStore.applySettingsUpdate(settings);
                            taskStore.loadTasks();
                            showMessage(`[NextAction] ${i18n.settingsSaved || "Settings saved"}`);
                            dialog.destroy();
                        } catch (e: any) {
                            showMessage(`[NextAction] ${formatRpcError(e, i18n)}`);
                        }
                    },
                    onClose: () => {
                        dialog.destroy();
                    },
                },
            });
            (dialog as any)._naSettings = comp;
        });
    }
}
