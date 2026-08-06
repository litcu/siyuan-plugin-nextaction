<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { KernelBridge } from "../kernel-bridge";
    import DockNextAction from "./DockNextAction.svelte";
    import DockMyDay from "./DockMyDay.svelte";
    import DockInbox from "./DockInbox.svelte";
    import { showTaskContextMenu } from "./task-context-menu";
    import { showStatusMenu } from "../utils";
    import { Dialog } from "siyuan";
    import { openReminderSettingsDialog } from "../dialogs/task-property-dialogs";
    import type { TaskCacheEntry } from "../../shared/types";
    import { get } from "svelte/store";
    import NaPanelHeader from "../ui/NaPanelHeader.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";

    export let bridge: KernelBridge;
    export let i18n: any;

    type DockTab = "nextAction" | "myDay" | "inbox";
    let activeTab: DockTab = "nextAction";

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

    $: myDayEnabled = $taskStore.settings.myDayEnabled !== false;

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
        const inMyDay = myDayEnabled && ($taskStore.myDayState?.tasks.some(t => t.blockId === task.blockId) ?? false);
        const callbacks: any = {
            onUpdated: (updated: TaskCacheEntry) => {
                taskStore.applyUpdate(updated);
            },
            onRemoved: (blockId: string) => {
                taskStore.applyRemove(blockId);
            },
            onEdit: handleEdit,
        };
        if (myDayEnabled) {
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
        }
        callbacks.onReminderEdit = (blockId: string) => {
            const storeState = get(taskStore);
            const taskEntry = storeState.allTasks.find(t => t.blockId === blockId);
            if (!taskEntry) return;
            openReminderSettingsDialog(taskEntry, bridge, i18n, {
                onSave: (updated: TaskCacheEntry) => taskStore.applyUpdate(updated),
            });
        };
        showTaskContextMenu(task, event, bridge, i18n, callbacks, activeTab, inMyDay);
    }

    function switchTab(tab: DockTab) {
        if (tab === "myDay" && !myDayEnabled) return;
        activeTab = tab;
    }

    function handleTabChange(event: CustomEvent<string>) {
        switchTab(event.detail as DockTab);
    }

    $: visibleTabs = tabs.filter(t => {
        if (t.id === "myDay") return myDayEnabled;
        return true;
    });

    $: tabOptions = visibleTabs.map(tab => ({ value: tab.id, label: tab.label }));
    $: activeTabLabel = tabs.find(tab => tab.id === activeTab)?.label || "";
</script>

<div class="na-dock">
    <NaPanelHeader compact title={activeTabLabel} icon={activeTab === "inbox" ? "iconInbox" : activeTab === "myDay" ? "iconCalendar" : "iconListItem"} />
    <div class="na-dock__tabs">
        <NaSegmentControl options={tabOptions} value={activeTab} size="sm" stretch label={i18n?.pluginName || "NextAction"} on:change={handleTabChange} />
    </div>

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

    .na-dock__tabs {
        display: flex;
        justify-content: center;
        padding: 7px 10px 8px;
        border-bottom: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        flex-shrink: 0;
    }

    :global(.na-dock__tabs .na-segment-control) { max-width: 100%; }
    :global(.na-dock__tabs .na-segment-control__option) { overflow: hidden; text-overflow: ellipsis; }

    .na-dock__body {
        flex: 1;
        overflow: hidden;
    }

    @container na-dock (max-width: 260px) {
        .na-dock__tabs { padding-inline: 6px; }
        :global(.na-dock__tabs .na-segment-control__option) { padding-inline: 5px; }
    }
</style>
