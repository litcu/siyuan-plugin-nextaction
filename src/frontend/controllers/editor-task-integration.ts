import { Dialog, Menu, confirm, type Plugin } from "siyuan";
import { get } from "svelte/store";
import type TaskDetail from "../components/TaskDetail.svelte";
import type { KernelBridge } from "../kernel-bridge";
import { taskStore } from "../stores/task-store";
import { notifyError, notifyInfo, notifyOperationError } from "../notify";
import { normalizePriority, PRIORITY_LIST } from "../constants";
import { toI18nKey } from "../utils";
import { runAiDecomposeTask, runAiExtractTasks } from "../ai/ai-feature-service";
import { openReminderSettingsDialog } from "../dialogs/task-property-dialogs";
import type { TaskCommandController } from "./task-command-controller";

export class EditorTaskIntegration {
    private blockIconHandler: ((event: any) => void) | null = null;
    private editorTitleIconHandler: ((event: any) => void) | null = null;
    private started = false;

    constructor(
        private readonly plugin: Plugin,
        private readonly getBridge: () => KernelBridge,
        private readonly commands: TaskCommandController,
    ) {}

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
        const currentPriority = normalizePriority(taskBlock.getAttribute('custom-na-priority'));
        const isProject = taskBlock.getAttribute('custom-na-task') === '2';

        event.stopPropagation();
        event.preventDefault();

        const menu = new Menu('na-editor-status');

        // Status section
        for (const s of ['inbox', 'todo', 'doing', 'waiting', 'someday', 'done']) {
            const i18nKey = 'status' + s.charAt(0).toUpperCase() + s.slice(1);
            menu.addItem({
                icon: s === currentStatus ? 'iconSelect' : '',
                label: this.plugin.i18n[i18nKey] || s,
                click: async () => {
                    try {
                        const updated = await this.getBridge().updateTask(blockId, { 'na-status': s });
                        taskStore.applyUpdate(updated);
                        const statusLabel = this.plugin.i18n[i18nKey] || s;
                        const template = s === "done"
                            ? (this.plugin.i18n.taskMarkedDone || "Marked as done")
                            : (this.plugin.i18n.taskStatusUpdated || "Status updated to {status}");
                        notifyInfo(template.replace("{status}", statusLabel));
                    } catch (e: any) {
                        notifyOperationError(e, this.plugin.i18n);
                    }
                },
            });
        }

        menu.addSeparator();

        menu.addItem({
            icon: "iconSparkles",
            label: this.plugin.i18n.ai || "AI",
            type: "submenu",
            submenu: [{
                icon: "iconSparkles",
                label: isProject
                    ? (this.plugin.i18n.aiDecomposeProject || "AI 拆解项目")
                    : (this.plugin.i18n.aiDecomposeTask || "AI 拆解任务"),
                click: async () => {
                    const task = get(taskStore).allTasks.find(item => item.blockId === blockId);
                    if (task) await runAiDecomposeTask(task);
                },
            }],
        });

        menu.addSeparator();

        // Priority submenu
        menu.addItem({
            icon: 'iconSort',
            label: this.plugin.i18n.priority || 'Priority',
            type: 'submenu',
            submenu: PRIORITY_LIST.map((p) => ({
                icon: p === currentPriority ? 'iconSelect' : '',
                label: this.plugin.i18n[toI18nKey('priority', p)] || p,
                click: async () => {
                    try {
                        const updated = await this.getBridge().updateTask(blockId, { 'na-priority': p });
                        taskStore.applyUpdate(updated);
                    } catch (e: any) {
                        notifyOperationError(e, this.plugin.i18n);
                    }
                },
            })),
        });

        menu.addSeparator();

        // My Day toggle
        const storeState = get(taskStore);
        const isInMyDay = storeState.myDayState?.tasks.some(t => t.blockId === blockId) ?? false;
        menu.addItem({
            icon: isInMyDay ? 'iconClose' : 'iconBookmark',
            label: isInMyDay
                ? (this.plugin.i18n.removeFromMyDay || 'Remove from My Day')
                : (this.plugin.i18n.addToMyDay || 'Add to My Day'),
            click: async () => {
                try {
                    const myDayState = isInMyDay
                        ? await this.getBridge().removeTaskFromMyDay(blockId)
                        : await this.getBridge().addTaskToMyDay(blockId);
                    taskStore.applyMyDayUpdate(myDayState);
                } catch (e: any) {
                    notifyOperationError(e, this.plugin.i18n);
                }
            },
        });
        menu.addSeparator();

        // Reminder
        menu.addItem({
            icon: 'iconClock',
            label: this.plugin.i18n.reminderAddReminder || '添加提醒',
            click: () => {
                this.openReminderDialog(blockId);
            },
        });

        menu.addSeparator();

        // Task properties
        menu.addItem({
            icon: 'iconEdit',
            label: isProject
                ? (this.plugin.i18n.projectProperties || 'Project Properties')
                : (this.plugin.i18n.taskProperties || 'Task Properties'),
            click: () => {
                void this.openTaskDetailDialog(blockId);
            },
        });

        // Remove task
        menu.addItem({
            icon: 'iconTrashcan',
            label: isProject
                ? (this.plugin.i18n.removeProject || 'Remove Project')
                : (this.plugin.i18n.removeTask || 'Remove Task'),
            click: async () => {
                confirm(
                    isProject ? (this.plugin.i18n.removeProject || 'Remove Project') : (this.plugin.i18n.removeTask || 'Remove Task'),
                    isProject
                        ? (this.plugin.i18n.confirmRemoveProject || 'This will clear all project attributes. This action cannot be undone.')
                        : (this.plugin.i18n.confirmRemoveTask || 'This will clear all task attributes. This action cannot be undone.'),
                    async () => {
                        try {
                            await this.getBridge().removeTask(blockId);
                            taskStore.applyRemove(blockId);
                        } catch (e: any) {
                            notifyOperationError(e, this.plugin.i18n);
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

        openReminderSettingsDialog(task, this.getBridge(), this.plugin.i18n, {
            onSave: (updated) => taskStore.applyUpdate(updated),
        });
    }

    /**
     * Open a dialog with the TaskDetail component for the given block.
     * Used from the editor status icon menu.
     */
    private async openTaskDetailDialog(blockId: string) {
        let task = await this.getBridge().getTask(blockId);
        if (!task) {
            try {
                await this.getBridge().rebuildCache();
                await taskStore.loadTasks();
                task = await this.getBridge().getTask(blockId);
            } catch (error: any) {
                notifyOperationError(error, this.plugin.i18n);
                return;
            }
        }
        if (!task) {
            notifyError(this.plugin.i18n?.errItemNotFound || this.plugin.i18n?.errTaskNotFound || "Project or task not found");
            return;
        }

        const dialog = new Dialog({
            title: "",
            content: `<div class="nextaction na-task-dialog-content"></div>`,
            width: "min(520px, calc(100vw - 24px))",
            height: "min(720px, calc(100vh - 24px))",
            disableClose: true,
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
        dialogContainer?.classList.add("na-task-dialog-container");

        dialog.element.querySelector(".b3-dialog__scrim")?.addEventListener("click", () => {
            const component = (dialog as any)._naDetail as TaskDetail | undefined;
            component?.requestClose();
        });

        import("../components/TaskDetail.svelte")
            .then(({ default: TaskDetailComp }) => {
                const comp = new TaskDetailComp({
                    target: containerEl as HTMLElement,
                    props: {
                        task,
                        bridge: this.getBridge(),
                        i18n: this.plugin.i18n,
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
            })
            .catch((error: any) => {
                dialog.destroy();
                notifyOperationError(error, this.plugin.i18n);
            });
    }

    start(): void {
        if (this.started) return;
        this.started = true;
        // Block icon menu
        this.blockIconHandler = ({ detail }: any) => {
            const blockElements = detail.blockElements || [];
            const taskBlock = blockElements.length === 1 && blockElements[0].hasAttribute("custom-na-task");
            const isProjectBlock = taskBlock && blockElements[0].getAttribute("custom-na-task") === "2";
            detail.menu.addItem({
                icon: "iconSparkles",
                label: `[NextAction] ${this.plugin.i18n.ai || "AI"}`,
                type: "submenu",
                submenu: [
                    {
                        icon: "iconSparkles",
                        label: this.plugin.i18n.aiExtractTasks || "AI 提取任务",
                        click: async () => runAiExtractTasks(blockElements.map((element: HTMLElement) => element.dataset.nodeId).filter(Boolean)),
                    },
                    ...(taskBlock ? [{
                        icon: "iconSplitLR",
                        label: isProjectBlock
                            ? (this.plugin.i18n.aiDecomposeProject || "AI 拆解项目")
                            : (this.plugin.i18n.aiDecomposeTask || "AI 拆解任务"),
                        click: async () => {
                            const task = get(taskStore).allTasks.find(item => item.blockId === blockElements[0].dataset.nodeId);
                            if (task) await runAiDecomposeTask(task);
                        },
                    }] : []),
                ],
            });
            detail.menu.addItem({
                icon: "iconNextAction",
                label: `[NextAction] ${this.plugin.i18n.convertToTask}`,
                click: async () => {
                    let ok = 0;
                    for (const blockElement of detail.blockElements) {
                        const blockId = blockElement.dataset.nodeId;
                        if (blockId) {
                            try {
                                await this.commands.doConvertToTask(blockId);
                                ok++;
                            } catch (e: any) {
                                notifyOperationError(e, this.plugin.i18n);
                            }
                        }
                    }
                    if (ok > 0) notifyInfo(this.plugin.i18n.convertToTaskSuccess);
                    void taskStore.loadTasks();
                },
            });
            detail.menu.addItem({
                icon: "iconFolder",
                label: `[NextAction] ${this.plugin.i18n.convertToProject}`,
                click: async () => {
                    let ok = 0;
                    for (const blockElement of detail.blockElements) {
                        const blockId = blockElement.dataset.nodeId;
                        if (blockId) {
                            try {
                                await this.commands.doConvertToTask(blockId, undefined, "2");
                                ok++;
                            } catch (e: any) {
                                notifyOperationError(e, this.plugin.i18n);
                            }
                        }
                    }
                    if (ok > 0) notifyInfo(this.plugin.i18n.convertToProjectSuccess);
                    void taskStore.loadTasks();
                },
            });
            detail.menu.addItem({
                icon: "iconDown",
                label: `[NextAction] ${this.plugin.i18n.convertToTaskWithChildren}`,
                click: async () => {
                    for (const blockElement of detail.blockElements) {
                        const blockId = blockElement.dataset.nodeId;
                        if (blockId) {
                            try {
                                const result = await this.commands.doConvertToTaskWithChildren(blockId);
                                const msg = this.plugin.i18n.convertToTaskWithChildrenResult
                                    .replace("{converted}", String(result.converted))
                                    .replace("{skipped}", String(result.skipped));
                                notifyInfo(msg);
                            } catch (e: any) {
                                notifyOperationError(e, this.plugin.i18n);
                            }
                        }
                    }
                    void taskStore.loadTasks();
                },
            });
        };
        this.plugin.eventBus.on("click-blockicon", this.blockIconHandler);

        // Document title icon menu
        this.editorTitleIconHandler = ({ detail }: any) => {
            const docId = detail.data?.id;
            if (!docId) return;
            detail.menu.addItem({
                icon: "iconSparkles",
                label: `[NextAction] ${this.plugin.i18n.aiExtractTasks || "AI 提取任务"}`,
                click: async () => runAiExtractTasks([docId]),
            });
            detail.menu.addItem({
                icon: "iconNextAction",
                label: `[NextAction] ${this.plugin.i18n.convertToTask}`,
                click: async () => {
                    try {
                        await this.commands.doConvertToTask(docId);
                        notifyInfo(this.plugin.i18n.convertToTaskSuccess);
                        void taskStore.loadTasks();
                    } catch (e: any) {
                        notifyOperationError(e, this.plugin.i18n);
                    }
                },
            });
            detail.menu.addItem({
                icon: "iconFolder",
                label: `[NextAction] ${this.plugin.i18n.convertToProject}`,
                click: async () => {
                    try {
                        await this.commands.doConvertToTask(docId, undefined, "2");
                        notifyInfo(this.plugin.i18n.convertToProjectSuccess);
                        void taskStore.loadTasks();
                    } catch (e: any) {
                        notifyOperationError(e, this.plugin.i18n);
                    }
                },
            });
            detail.menu.addItem({
                icon: "iconDown",
                label: `[NextAction] ${this.plugin.i18n.convertToTaskWithChildren}`,
                click: async () => {
                    try {
                        const result = await this.commands.doConvertToTaskWithChildren(docId);
                        const msg = this.plugin.i18n.convertToTaskWithChildrenResult
                            .replace("{converted}", String(result.converted))
                            .replace("{skipped}", String(result.skipped));
                        notifyInfo(msg);
                        void taskStore.loadTasks();
                    } catch (e: any) {
                        notifyOperationError(e, this.plugin.i18n);
                    }
                },
            });
        };
        this.plugin.eventBus.on("click-editortitleicon", this.editorTitleIconHandler);

        // Editor status checkbox click listener
        document.addEventListener('click', this.handleEditorStatusClick, true);

    }

    dispose(): void {
        if (!this.started) return;
        this.started = false;
        document.removeEventListener("click", this.handleEditorStatusClick, true);
        if (this.blockIconHandler) this.plugin.eventBus.off("click-blockicon", this.blockIconHandler);
        if (this.editorTitleIconHandler) this.plugin.eventBus.off("click-editortitleicon", this.editorTitleIconHandler);
        this.blockIconHandler = null;
        this.editorTitleIconHandler = null;
    }
}
