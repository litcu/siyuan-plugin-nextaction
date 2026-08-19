import { Dialog, Menu, confirm, type IEventBusMap, type Plugin } from "siyuan";
import { get } from "svelte/store";
import type TaskDetail from "../components/TaskDetail.svelte";
import type { KernelBridge } from "../kernel-bridge";
import type { I18nStrings } from "../../shared/i18n";
import type { TaskCacheEntry } from "../../shared/types";
import { taskStore } from "../stores/task-store";
import { notifyError, notifyInfo, notifyOperationError } from "../notify";
import { normalizePriority, PRIORITY_LIST } from "../constants";
import { priorityI18nKey, statusI18nKey, translateKey } from "../i18n";
import { runAiDecomposeTask, runAiExtractTasks } from "../ai/ai-feature-service";
import { openReminderSettingsDialog } from "../dialogs/task-property-dialogs";
import { openCreateTaskDialog } from "../dialogs/create-task-dialog";
import type { TaskCommandController } from "./task-command-controller";

type TaskDetailDialog = Dialog & {
    _naDetail?: TaskDetail;
};

const NATIVE_TASK_ITEM_SELECTOR =
    '[data-type="NodeListItem"][data-subtype="t"], [data-type="NodeList"][data-subtype="t"] > [data-type="NodeListItem"]';

export class EditorTaskIntegration {
    private blockIconHandler: ((event: CustomEvent<IEventBusMap["click-blockicon"]>) => void) | null = null;
    private editorTitleIconHandler: ((event: CustomEvent<IEventBusMap["click-editortitleicon"]>) => void) | null = null;
    private nativeTaskObserver: MutationObserver | null = null;
    private nativeTaskRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    private taskStoreUnsubscribe: (() => void) | null = null;
    private started = false;

    constructor(
        private readonly plugin: Plugin,
        private readonly i18n: I18nStrings,
        private readonly getBridge: () => KernelBridge,
        private readonly commands: TaskCommandController,
    ) {}

    private openCreateChildDialog = (parentTask: TaskCacheEntry) => {
        openCreateTaskDialog({
            bridge: this.getBridge(),
            i18n: this.i18n,
            parentTask,
            onCreated: (createdTask) => {
                taskStore.applyUpdate(createdTask);
            },
        }).catch((error) => notifyOperationError(error, this.plugin.i18n));
    };

    /**
     * Handle clicks on the ::before status checkbox in the editor.
     * Detects clicks in the left 20px area of a task block, opens a
     * status selection menu.
     */
    private handleEditorStatusClick = (event: MouseEvent | PointerEvent) => {
        const target = event.target as HTMLElement;
        const nativeAction = target.closest(".protyle-action--task") as HTMLElement | null;
        const nativeTaskBlock = nativeAction?.closest(
            `[data-node-id]:is(${NATIVE_TASK_ITEM_SELECTOR})`,
        ) as HTMLElement | null;
        const documentTaskBlock = target.closest("[data-node-id][custom-na-task]") as HTMLElement | null;
        const taskBlock = nativeTaskBlock || documentTaskBlock;
        if (!taskBlock) return;

        if (!nativeTaskBlock) {
            if (event.type !== "click") return;
            const rect = taskBlock.getBoundingClientRect();
            if (event.clientX > rect.left + 22 || event.clientX < rect.left) return;
        }

        event.stopPropagation();
        event.preventDefault();
        if (event.type !== "click") return;

        const blockId = taskBlock.dataset.nodeId;
        if (!blockId) return;
        void this.openEditorTaskMenu(taskBlock, blockId, event, !!nativeTaskBlock);
    };

    private handleEditorStatusKeydown = (event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const action = (event.target as HTMLElement).closest(".protyle-action--task") as HTMLElement | null;
        const taskBlock = action?.closest(`[data-node-id]:is(${NATIVE_TASK_ITEM_SELECTOR})`) as HTMLElement | null;
        const blockId = taskBlock?.dataset.nodeId;
        if (!action || !taskBlock || !blockId) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = action.getBoundingClientRect();
        void this.openEditorTaskMenu(
            taskBlock,
            blockId,
            new MouseEvent("click", { clientX: rect.left, clientY: rect.bottom }),
            true,
        );
    };

    private decorateNativeTaskActions(root: ParentNode): void {
        const tasksById = new Map(get(taskStore).allTasks.map((task) => [task.blockId, task]));
        const actions: HTMLElement[] = [];
        if (root instanceof Element && root.matches(".protyle-action--task")) actions.push(root as HTMLElement);
        actions.push(...Array.from(root.querySelectorAll<HTMLElement>(".protyle-action--task")));
        for (const action of actions) {
            if (!action.closest(NATIVE_TASK_ITEM_SELECTOR)) continue;
            action.setAttribute("role", "button");
            action.setAttribute("tabindex", "0");
            action.setAttribute("aria-haspopup", "menu");
            action.setAttribute("aria-label", this.plugin.i18n.taskStatus || "Task status");
            const taskBlock = action.closest(`[data-node-id]:is(${NATIVE_TASK_ITEM_SELECTOR})`);
            const task = taskBlock instanceof HTMLElement ? tasksById.get(taskBlock.dataset.nodeId || "") : undefined;
            if (taskBlock instanceof HTMLElement) {
                const status = task?.status || taskBlock.getAttribute("custom-na-status") || "inbox";
                this.applyNativeTaskStatusVisual(taskBlock, action, status);
            }
        }
    }

    private applyNativeTaskStatusVisual(taskBlock: HTMLElement, action: HTMLElement, status: string): void {
        const statusClassPrefix = "na-status-checkbox--";
        for (const className of Array.from(action.classList)) {
            if (className.startsWith(statusClassPrefix)) action.classList.remove(className);
        }
        action.classList.add("na-status-checkbox", `${statusClassPrefix}${status}`);
        taskBlock.dataset.naStatus = status;
        taskBlock.setAttribute("custom-na-status", status);
    }

    private syncNativeTaskDomState(tasks: TaskCacheEntry[]): void {
        for (const task of tasks) {
            if (task.identificationSource !== "native") continue;
            document
                .querySelectorAll<HTMLElement>(`[data-node-id="${task.blockId}"]:is(${NATIVE_TASK_ITEM_SELECTOR})`)
                .forEach((element) => {
                    element.dataset.naStatus = task.status;
                    element.setAttribute("custom-na-status", task.status);
                    element
                        .querySelectorAll<HTMLElement>(".protyle-action--task")
                        .forEach((action) => this.applyNativeTaskStatusVisual(element, action, task.status));
                });
        }
    }

    private async openEditorTaskMenu(
        taskBlock: HTMLElement,
        blockId: string,
        event: MouseEvent | PointerEvent,
        isNative: boolean,
    ): Promise<void> {
        let task = get(taskStore).allTasks.find((item) => item.blockId === blockId);
        if (isNative && !task) {
            try {
                await this.getBridge().rebuildCache();
                await taskStore.loadTasks();
                task = get(taskStore).allTasks.find((item) => item.blockId === blockId);
            } catch (error) {
                notifyOperationError(error, this.plugin.i18n);
                return;
            }
        }
        const currentStatus =
            task?.status || taskBlock.getAttribute("custom-na-status") || (isNative ? "inbox" : "todo");
        const currentPriority = normalizePriority(task?.priority || taskBlock.getAttribute("custom-na-priority"));
        const isProject = task?.taskType === "2" || taskBlock.getAttribute("custom-na-task") === "2";

        const menu = new Menu("na-editor-status");

        // Status section
        for (const s of ["inbox", "todo", "doing", "waiting", "someday", "done"]) {
            const i18nKey = statusI18nKey(s);
            menu.addItem({
                icon: s === currentStatus ? "iconSelect" : "",
                label: translateKey(this.i18n, i18nKey, s),
                click: async () => {
                    try {
                        const updated = await this.getBridge().updateTask(blockId, { "na-status": s });
                        taskStore.applyUpdate(updated);
                        const statusLabel = translateKey(this.i18n, i18nKey, s);
                        const template =
                            s === "done"
                                ? this.plugin.i18n.taskMarkedDone || "Marked as done"
                                : this.plugin.i18n.taskStatusUpdated || "Status updated to {status}";
                        notifyInfo(template.replace("{status}", statusLabel));
                    } catch (e) {
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
            submenu: [
                {
                    icon: "iconSparkles",
                    label: isProject
                        ? this.plugin.i18n.aiDecomposeProject || "AI 拆解项目"
                        : this.plugin.i18n.aiDecomposeTask || "AI 拆解任务",
                    click: async () => {
                        const currentTask = get(taskStore).allTasks.find((item) => item.blockId === blockId);
                        if (currentTask) await runAiDecomposeTask(currentTask);
                    },
                },
            ],
        });

        menu.addSeparator();

        // Priority submenu
        menu.addItem({
            icon: "iconSort",
            label: this.plugin.i18n.priority || "Priority",
            type: "submenu",
            submenu: PRIORITY_LIST.map((p) => ({
                icon: p === currentPriority ? "iconSelect" : "",
                label: translateKey(this.i18n, priorityI18nKey(p), p),
                click: async () => {
                    try {
                        const updated = await this.getBridge().updateTask(blockId, { "na-priority": p });
                        taskStore.applyUpdate(updated);
                    } catch (e) {
                        notifyOperationError(e, this.plugin.i18n);
                    }
                },
            })),
        });

        menu.addSeparator();

        // My Day toggle
        const storeState = get(taskStore);
        const isInMyDay = storeState.myDayState?.tasks.some((t) => t.blockId === blockId) ?? false;
        menu.addItem({
            icon: isInMyDay ? "iconClose" : "iconBookmark",
            label: isInMyDay
                ? this.plugin.i18n.removeFromMyDay || "Remove from My Day"
                : this.plugin.i18n.addToMyDay || "Add to My Day",
            click: async () => {
                try {
                    const myDayState = isInMyDay
                        ? await this.getBridge().removeTaskFromMyDay(blockId)
                        : await this.getBridge().addTaskToMyDay(blockId);
                    taskStore.applyMyDayUpdate(myDayState);
                } catch (e) {
                    notifyOperationError(e, this.plugin.i18n);
                }
            },
        });
        menu.addSeparator();

        // Reminder
        menu.addItem({
            icon: "iconClock",
            label: this.plugin.i18n.reminderAddReminder || "添加提醒",
            click: () => {
                this.openReminderDialog(blockId);
            },
        });

        menu.addSeparator();

        // Task properties
        menu.addItem({
            icon: "iconEdit",
            label: isProject
                ? this.plugin.i18n.projectProperties || "Project Properties"
                : this.plugin.i18n.taskProperties || "Task Properties",
            click: () => {
                void this.openTaskDetailDialog(blockId);
            },
        });

        // Remove task
        menu.addItem({
            icon: "iconTrashcan",
            label: isProject
                ? this.plugin.i18n.removeProject || "Remove Project"
                : this.plugin.i18n.removeTask || "Remove Task",
            click: async () => {
                confirm(
                    isProject
                        ? this.plugin.i18n.removeProject || "Remove Project"
                        : this.plugin.i18n.removeTask || "Remove Task",
                    isProject
                        ? this.plugin.i18n.confirmRemoveProject ||
                              "This will clear all project attributes. This action cannot be undone."
                        : this.plugin.i18n.confirmRemoveTask ||
                              "This will clear all task attributes. This action cannot be undone.",
                    async () => {
                        try {
                            await this.getBridge().removeTask(blockId);
                            taskStore.applyRemove(blockId);
                        } catch (e) {
                            notifyOperationError(e, this.plugin.i18n);
                        }
                    },
                );
            },
        });

        menu.open({ x: event.clientX, y: event.clientY });
    }

    private resolveTaskBlock(
        element: HTMLElement,
    ): { element: HTMLElement; blockId: string; isNative: boolean } | null {
        const native = (
            element.matches('[data-type="NodeListItem"][data-subtype="t"]')
                ? element
                : element.closest('[data-type="NodeListItem"][data-subtype="t"]')
        ) as HTMLElement | null;
        if (native?.dataset.nodeId) return { element: native, blockId: native.dataset.nodeId, isNative: true };
        const documentTask = (
            element.hasAttribute("custom-na-task") ? element : element.closest("[data-node-id][custom-na-task]")
        ) as HTMLElement | null;
        if (documentTask?.dataset.nodeId) {
            return { element: documentTask, blockId: documentTask.dataset.nodeId, isNative: false };
        }
        return null;
    }

    private addNativeTaskManagementItems(
        menu: { addItem: (options: Parameters<Menu["addItem"]>[0]) => unknown },
        blockId: string,
    ): void {
        const state = get(taskStore);
        const isInMyDay = state.myDayState?.tasks.some((task) => task.blockId === blockId) ?? false;
        menu.addItem({
            icon: isInMyDay ? "iconClose" : "iconBookmark",
            label: isInMyDay
                ? this.plugin.i18n.removeFromMyDay || "Remove from My Day"
                : this.plugin.i18n.addToMyDay || "Add to My Day",
            click: async () => {
                try {
                    const myDayState = isInMyDay
                        ? await this.getBridge().removeTaskFromMyDay(blockId)
                        : await this.getBridge().addTaskToMyDay(blockId);
                    taskStore.applyMyDayUpdate(myDayState);
                } catch (error) {
                    notifyOperationError(error, this.plugin.i18n);
                }
            },
        });
        menu.addItem({
            icon: "iconClock",
            label: this.plugin.i18n.reminderAddReminder || "添加提醒",
            click: () => this.openReminderDialog(blockId),
        });
        menu.addItem({
            icon: "iconEdit",
            label: this.plugin.i18n.taskProperties || "Task Properties",
            click: () => void this.openTaskDetailDialog(blockId),
        });
        menu.addItem({
            icon: "iconTrashcan",
            label: this.plugin.i18n.removeTask || "Remove Task",
            click: () => {
                confirm(
                    this.plugin.i18n.removeTask || "Remove Task",
                    this.plugin.i18n.confirmRemoveTask ||
                        "This will convert the native task to a regular list item and clear NextAction fields.",
                    async () => {
                        try {
                            await this.getBridge().removeTask(blockId);
                            taskStore.applyRemove(blockId);
                        } catch (error) {
                            notifyOperationError(error, this.plugin.i18n);
                        }
                    },
                );
            },
        });
    }

    private scheduleNativeTaskRefresh(): void {
        if (this.nativeTaskRefreshTimer) clearTimeout(this.nativeTaskRefreshTimer);
        this.nativeTaskRefreshTimer = setTimeout(() => {
            this.nativeTaskRefreshTimer = null;
            void this.getBridge()
                .rebuildCache()
                .then(() => taskStore.loadTasks())
                .catch((error) => console.warn("[NextAction] native task discovery refresh failed", error));
        }, 250);
    }

    /**
     * Open a reminder settings dialog for the given task.
     * Used from the editor status icon menu.
     */
    private openReminderDialog(blockId: string) {
        const storeState = get(taskStore);
        const task = storeState.allTasks.find((t) => t.blockId === blockId);
        if (!task) return;

        openReminderSettingsDialog(task, this.getBridge(), this.i18n, {
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
            } catch (error) {
                notifyOperationError(error, this.plugin.i18n);
                return;
            }
        }
        if (!task) {
            notifyError(
                this.plugin.i18n?.errItemNotFound || this.plugin.i18n?.errTaskNotFound || "Project or task not found",
            );
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
                const comp = (dialog as TaskDetailDialog)._naDetail;
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
            const component = (dialog as TaskDetailDialog)._naDetail;
            component?.requestClose();
        });

        import("../components/TaskDetail.svelte")
            .then(({ default: TaskDetailComp }) => {
                const comp = new TaskDetailComp({
                    target: containerEl as HTMLElement,
                    props: {
                        task,
                        bridge: this.getBridge(),
                        i18n: this.i18n,
                        dialogMode: true,
                        onCreateChild: this.openCreateChildDialog,
                        onOpenTask: (nextBlockId: string) => {
                            dialog.destroy();
                            void this.openTaskDetailDialog(nextBlockId);
                        },
                        onSave: (updated: TaskCacheEntry) => {
                            taskStore.applyUpdate(updated);
                        },
                        onRemove: (removedId: string) => {
                            taskStore.applyRemove(removedId);
                            dialog.destroy();
                        },
                        onClose: () => {
                            dialog.destroy();
                        },
                        onConfirmDiscard: (confirmDiscard: () => void, cancelClose: () => void) => {
                            confirm(
                                this.plugin.i18n?.unsavedChangesTitle || "Unsaved changes",
                                this.plugin.i18n?.unsavedChangesMessage || "Discard unsaved changes?",
                                confirmDiscard,
                                cancelClose,
                            );
                        },
                    },
                });
                (dialog as TaskDetailDialog)._naDetail = comp;
            })
            .catch((error) => {
                dialog.destroy();
                notifyOperationError(error, this.plugin.i18n);
            });
    }

    start(): void {
        if (this.started) return;
        this.started = true;
        // Block icon menu
        this.blockIconHandler = ({ detail }) => {
            const blockElements = detail.blockElements || [];
            const resolvedTask = blockElements.length === 1 ? this.resolveTaskBlock(blockElements[0]) : null;
            const taskBlock = !!resolvedTask;
            const isProjectBlock = resolvedTask?.element.getAttribute("custom-na-task") === "2";
            detail.menu.addItem({
                icon: "iconSparkles",
                label: `[NextAction] ${this.plugin.i18n.ai || "AI"}`,
                type: "submenu",
                submenu: [
                    {
                        icon: "iconSparkles",
                        label: this.plugin.i18n.aiExtractTasks || "AI 提取任务",
                        click: async () =>
                            runAiExtractTasks(
                                blockElements
                                    .map((element: HTMLElement) => element.dataset.nodeId)
                                    .filter((id): id is string => Boolean(id)),
                            ),
                    },
                    ...(taskBlock
                        ? [
                              {
                                  icon: "iconSplitLR",
                                  label: isProjectBlock
                                      ? this.plugin.i18n.aiDecomposeProject || "AI 拆解项目"
                                      : this.plugin.i18n.aiDecomposeTask || "AI 拆解任务",
                                  click: async () => {
                                      const task = get(taskStore).allTasks.find(
                                          (item) => item.blockId === resolvedTask?.blockId,
                                      );
                                      if (task) await runAiDecomposeTask(task);
                                  },
                              },
                          ]
                        : []),
                ],
            });
            detail.menu.addItem({
                icon: "iconNextAction",
                label: `[NextAction] ${this.plugin.i18n.convertToTask}`,
                click: async () => {
                    let ok = 0;
                    for (const blockElement of detail.blockElements) {
                        const blockId = this.resolveTaskBlock(blockElement)?.blockId || blockElement.dataset.nodeId;
                        if (blockId) {
                            try {
                                await this.commands.doConvertToTask(blockId);
                                ok++;
                            } catch (e) {
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
                            } catch (e) {
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
                            } catch (e) {
                                notifyOperationError(e, this.plugin.i18n);
                            }
                        }
                    }
                    void taskStore.loadTasks();
                },
            });
            if (resolvedTask?.isNative) {
                detail.menu.addSeparator();
                this.addNativeTaskManagementItems(detail.menu, resolvedTask.blockId);
            }
        };
        this.plugin.eventBus.on("click-blockicon", this.blockIconHandler);

        // Document title icon menu
        this.editorTitleIconHandler = ({ detail }) => {
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
                    } catch (e) {
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
                    } catch (e) {
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
                    } catch (e) {
                        notifyOperationError(e, this.plugin.i18n);
                    }
                },
            });
        };
        this.plugin.eventBus.on("click-editortitleicon", this.editorTitleIconHandler);

        // Capture native checkbox input before SiYuan toggles its binary marker.
        document.addEventListener("pointerdown", this.handleEditorStatusClick, true);
        document.addEventListener("mousedown", this.handleEditorStatusClick, true);
        document.addEventListener("click", this.handleEditorStatusClick, true);
        document.addEventListener("keydown", this.handleEditorStatusKeydown, true);
        this.decorateNativeTaskActions(document);
        this.taskStoreUnsubscribe = taskStore.subscribe((state) => this.syncNativeTaskDomState(state.allTasks));
        this.nativeTaskObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node instanceof Element) this.decorateNativeTaskActions(node);
                }
            }
            const hasNativeTask = mutations.some((mutation) =>
                [...mutation.addedNodes].some(
                    (node) =>
                        node instanceof Element &&
                        (node.matches('[data-type="NodeListItem"][data-subtype="t"]') ||
                            !!node.querySelector('[data-type="NodeListItem"][data-subtype="t"]')),
                ),
            );
            if (hasNativeTask) this.scheduleNativeTaskRefresh();
        });
        this.nativeTaskObserver.observe(document.body, { childList: true, subtree: true });
    }

    dispose(): void {
        if (!this.started) return;
        this.started = false;
        document.removeEventListener("pointerdown", this.handleEditorStatusClick, true);
        document.removeEventListener("mousedown", this.handleEditorStatusClick, true);
        document.removeEventListener("click", this.handleEditorStatusClick, true);
        document.removeEventListener("keydown", this.handleEditorStatusKeydown, true);
        this.nativeTaskObserver?.disconnect();
        this.nativeTaskObserver = null;
        this.taskStoreUnsubscribe?.();
        this.taskStoreUnsubscribe = null;
        if (this.nativeTaskRefreshTimer) clearTimeout(this.nativeTaskRefreshTimer);
        this.nativeTaskRefreshTimer = null;
        if (this.blockIconHandler) this.plugin.eventBus.off("click-blockicon", this.blockIconHandler);
        if (this.editorTitleIconHandler) this.plugin.eventBus.off("click-editortitleicon", this.editorTitleIconHandler);
        this.blockIconHandler = null;
        this.editorTitleIconHandler = null;
    }
}
