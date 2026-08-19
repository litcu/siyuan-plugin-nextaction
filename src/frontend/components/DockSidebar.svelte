<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { KernelBridge } from "../kernel-bridge";
    import DockNextAction from "./DockNextAction.svelte";
    import DockMyDay from "./DockMyDay.svelte";
    import DockInbox from "./DockInbox.svelte";
    import { showTaskContextMenu } from "./task-context-menu";
    import { showStatusMenu } from "../utils";
    import { Dialog } from "siyuan";
    import { notifyOperationError } from "../notify";
    import { openReminderSettingsDialog } from "../dialogs/task-property-dialogs";
    import { openCreateTaskDialog } from "../dialogs/create-task-dialog";
    import type { TaskCacheEntry } from "../../shared/types";
    import { get } from "svelte/store";
    import NaPanelHeader from "../ui/NaPanelHeader.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";
    import NaIconButton from "../ui/NaIconButton.svelte";

    export let bridge: KernelBridge;
    export let i18n: any;
    export let onOpenFullPanel: (() => void) | undefined = undefined;

    type DockTab = "nextAction" | "myDay" | "inbox";
    let activeTab: DockTab = "nextAction";

    function openCreateChild(task: TaskCacheEntry) {
        openCreateTaskDialog({
            bridge,
            i18n,
            parentTask: task,
            onCreated: (createdTask) => {
                taskStore.applyUpdate(createdTask);
            },
        }).catch((error) => notifyOperationError(error, i18n));
    }

    const tabs: { id: DockTab; label: string }[] = [
        { id: "nextAction", label: "" },
        { id: "myDay", label: "" },
        { id: "inbox", label: "" },
    ];

    $: {
        tabs[0].label = i18n?.nextAction || "Next Actions";
        tabs[1].label = i18n?.myDay || "My Day";
        tabs[2].label = i18n?.inbox || "Inbox";
    }

    function handleEdit(task: TaskCacheEntry) {
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

        const header = dialog.element.querySelector(".b3-dialog__header");
        if (header) header.remove();

        const dialogContainer = dialog.element.querySelector(".b3-dialog__container") as HTMLElement;
        dialogContainer?.classList.add("na-task-dialog-container");

        dialog.element.querySelector(".b3-dialog__scrim")?.addEventListener("click", () => {
            (dialog as any)._naDetail?.requestClose();
        });

        import("./TaskDetail.svelte").then(({ default: TaskDetailComp }) => {
            bridge.getTask(task.blockId).then((freshTask) => {
                if (!freshTask) return;
                const comp = new TaskDetailComp({
                    target: containerEl as HTMLElement,
                    props: {
                        task: freshTask,
                        bridge,
                        i18n,
                        dialogMode: true,
                        onCreateChild: openCreateChild,
                        onOpenTask: (blockId: string) => {
                            dialog.destroy();
                            void bridge
                                .getTask(blockId)
                                .then((nextTask) => {
                                    if (nextTask) handleEdit(nextTask);
                                })
                                .catch((error) => notifyOperationError(error, i18n));
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
                    },
                });
                (dialog as any)._naDetail = comp;
            });
        });
    }

    async function handleStatusClick(task: TaskCacheEntry, event: MouseEvent) {
        const updated = await showStatusMenu(task, event, bridge, i18n);
        taskStore.applyUpdate(updated);
    }

    function handleContextMenu(task: TaskCacheEntry, event: MouseEvent) {
        const inMyDay = $taskStore.myDayState?.tasks.some((t) => t.blockId === task.blockId) ?? false;
        const callbacks: any = {
            onUpdated: (updated: TaskCacheEntry) => {
                taskStore.applyUpdate(updated);
            },
            onRemoved: (blockId: string) => {
                taskStore.applyRemove(blockId);
            },
            onEdit: handleEdit,
        };
        callbacks.onMyDayToggle = async (blockId: string, isInMyDay: boolean) => {
            try {
                let myDayState;
                if (isInMyDay) {
                    myDayState = await bridge.removeTaskFromMyDay(blockId);
                } else {
                    myDayState = await bridge.addTaskToMyDay(blockId);
                }
                taskStore.applyMyDayUpdate(myDayState);
            } catch (e: any) {
                console.error("[NextAction] myDay toggle failed:", e);
            }
        };
        callbacks.onReminderEdit = (blockId: string) => {
            const storeState = get(taskStore);
            const taskEntry = storeState.allTasks.find((t) => t.blockId === blockId);
            if (!taskEntry) return;
            openReminderSettingsDialog(taskEntry, bridge, i18n, {
                onSave: (updated: TaskCacheEntry) => taskStore.applyUpdate(updated),
            });
        };
        showTaskContextMenu(task, event, bridge, i18n, callbacks, activeTab, inMyDay);
    }

    function switchTab(tab: DockTab) {
        activeTab = tab;
    }

    function handleTabChange(event: CustomEvent<string>) {
        switchTab(event.detail as DockTab);
    }

    $: visibleTabs = tabs;

    $: tabOptions = visibleTabs.map((tab) => ({ value: tab.id, label: tab.label }));
    $: activeTabLabel = tabs.find((tab) => tab.id === activeTab)?.label || "";
</script>

<div class="na-dock">
    <NaPanelHeader compact title={i18n?.pluginName || "NextAction"} icon="iconNextAction">
        <svelte:fragment slot="actions">
            {#if onOpenFullPanel}
                <NaIconButton
                    compact
                    symbol="iconNextAction"
                    label={i18n?.taskPanel || "Task Panel"}
                    on:click={onOpenFullPanel}
                />
            {/if}
            <NaSegmentControl
                options={tabOptions}
                value={activeTab}
                size="sm"
                label={i18n?.pluginName || "NextAction"}
                on:change={handleTabChange}
            />
        </svelte:fragment>
    </NaPanelHeader>

    <div class="na-dock__body">
        {#if activeTab === "nextAction"}
            <DockNextAction
                onEdit={handleEdit}
                onStatusClick={handleStatusClick}
                onContextMenu={handleContextMenu}
                {i18n}
            />
        {:else if activeTab === "myDay"}
            <DockMyDay
                {bridge}
                onEdit={handleEdit}
                onStatusClick={handleStatusClick}
                onContextMenu={handleContextMenu}
                {i18n}
            />
        {:else if activeTab === "inbox"}
            <DockInbox
                {bridge}
                onEdit={handleEdit}
                onStatusClick={handleStatusClick}
                onContextMenu={handleContextMenu}
                {i18n}
            />
        {/if}
    </div>
</div>

<style lang="scss">
    .na-dock {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        container-name: na-dock;
        container-type: inline-size;
        background: var(--b3-theme-background);
    }

    :global(.na-dock > .na-panel-header) {
        gap: 8px;
    }
    :global(.na-dock > .na-panel-header .na-panel-header__copy) {
        flex: 1 1 auto;
        min-width: 0;
    }
    :global(.na-dock > .na-panel-header .na-panel-header__actions) {
        flex: 0 1 auto;
        min-width: 0;
    }
    :global(.na-dock > .na-panel-header .na-segment-control) {
        max-width: 100%;
    }
    :global(.na-dock > .na-panel-header .na-segment-control__option) {
        overflow: hidden;
        padding-inline: clamp(4px, 1.8vw, 9px);
        text-overflow: ellipsis;
    }

    .na-dock__body {
        flex: 1;
        overflow: hidden;
    }

    @container na-dock (max-width: 260px) {
        :global(.na-dock > .na-panel-header) {
            gap: 4px;
            padding-inline: 7px;
        }
        :global(.na-dock > .na-panel-header .na-panel-header__copy) {
            flex-basis: 72px;
        }
        :global(.na-dock > .na-panel-header .na-panel-header__actions) {
            flex: 1 1 auto;
        }
        :global(.na-dock > .na-panel-header .na-segment-control) {
            width: 100%;
        }
        :global(.na-dock > .na-panel-header .na-segment-control__option) {
            padding-inline: 4px;
            font-size: 10px;
        }
    }
</style>
