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

    $: visibleTabs = tabs.filter(t => {
        if (t.id === "myDay") return myDayEnabled;
        return true;
    });
</script>

<div class="na-dock">
    <div class="na-dock__tabs">
        {#each visibleTabs as tab (tab.id)}
            <button
                class="na-dock__tab"
                class:na-dock__tab--active={activeTab === tab.id}
                on:click={() => switchTab(tab.id)}
            >
                {tab.label}
            </button>
        {/each}
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
    }

    .na-dock__tabs {
        display: flex;
        border-bottom: 1px solid var(--b3-border-color);
        flex-shrink: 0;
    }

    .na-dock__tab {
        flex: 1;
        padding: 8px 4px 6px;
        font-size: 12px;
        font-weight: 500;
        color: var(--b3-theme-on-surface-light);
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        transition: color 0.15s, border-color 0.15s;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: center;

        &:hover {
            color: var(--b3-theme-on-surface);
        }

        &--active {
            color: var(--b3-theme-primary);
            border-bottom-color: var(--b3-theme-primary);
        }
    }

    .na-dock__body {
        flex: 1;
        overflow: hidden;
    }
</style>
