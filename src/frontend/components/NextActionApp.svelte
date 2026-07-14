<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { KernelBridge } from "../kernel-bridge";
    import { VIEW_INBOX, VIEW_NEXT_ACTION, VIEW_ALL_TASKS, VIEW_BY_PROJECT, VIEW_SOMEDAY, VIEW_WAITING, VIEW_STATISTICS, VIEW_MY_DAY, VIEW_REVIEW, VIEW_REMINDER } from "../constants";
    import NavRail from "./NavRail.svelte";
    import NextActionView from "./NextActionView.svelte";
    import InboxView from "./InboxView.svelte";
    import AllTasksView from "./AllTasksView.svelte";
    import ProjectView from "./ProjectView.svelte";
    import StatisticsView from "./StatisticsView.svelte";
    import SomedayView from "./SomedayView.svelte";
    import WaitingView from "./WaitingView.svelte";
    import MyDayView from "./MyDayView.svelte";
    import ReviewView from "./ReviewView.svelte";
    import ReminderView from "./ReminderView.svelte";
    import TaskDetail from "./TaskDetail.svelte";
    import { showTaskContextMenu } from "./task-context-menu";
    import { showStatusMenu } from "../utils";
    import { onMount, onDestroy } from "svelte";
    import { notifyError, formatRpcError } from "../notify";
    import type { TaskCacheEntry } from "../../shared/types";
    import { get } from "svelte/store";
    import ReminderPopup from "./ReminderPopup.svelte";
    import { Dialog } from "siyuan";

    export let bridge: KernelBridge;
    export let i18n: any;

    let activeView: string = VIEW_NEXT_ACTION;
    let selectedTask: TaskCacheEntry | null = null;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    $: myDayEnabled = $taskStore.settings.myDayEnabled !== false;
    $: if (!myDayEnabled && activeView === VIEW_MY_DAY) {
        activeView = VIEW_NEXT_ACTION;
        taskStore.setActiveView(VIEW_NEXT_ACTION);
    }

    // Safety-net refresh: most data is kept in sync by tasksChanged broadcast
    // and local derivation in applyUpdate/applyChangeNotification. This timer
    // only handles edge cases where incremental updates might diverge.
    onMount(() => {
        refreshTimer = setInterval(() => {
            if (document.visibilityState === "visible") {
                taskStore.loadTasks();
            }
        }, 300000);
    });

    onDestroy(() => {
        if (refreshTimer) clearInterval(refreshTimer);
    });

    function switchView(view: string) {
        activeView = view;
        selectedTask = null;
        taskStore.setActiveView(view);
    }

    function handleSelectTask(task: TaskCacheEntry) {
        if (selectedTask && selectedTask.blockId === task.blockId) {
            selectedTask = null;
        } else {
            selectedTask = task;
        }
    }

    function handleEdit(task: TaskCacheEntry) {
        selectedTask = task;
    }

    function handleDetailClose() {
        selectedTask = null;
    }

    function handleDetailSave(updated: TaskCacheEntry) {
        taskStore.applyUpdate(updated);
        if (selectedTask && selectedTask.blockId === updated.blockId) {
            selectedTask = updated;
        }
    }

    function handleDetailRemove(blockId: string) {
        taskStore.applyRemove(blockId);
        selectedTask = null;
    }

    function handleContextMenu(task: TaskCacheEntry, event: MouseEvent) {
        const inMyDay = myDayEnabled && ($taskStore.myDayState?.tasks.some(t => t.blockId === task.blockId) ?? false);
        const callbacks: any = {
            onUpdated: (updated) => {
                taskStore.applyUpdate(updated);
                if (selectedTask && selectedTask.blockId === updated.blockId) {
                    selectedTask = updated;
                }
            },
            onRemoved: (blockId) => {
                taskStore.applyRemove(blockId);
                if (selectedTask && selectedTask.blockId === blockId) {
                    selectedTask = null;
                }
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
            const dialog = new Dialog({
                title: i18n?.reminderPopupTitle || "提醒设置",
                content: `<div id="na-reminder-popup-ctx"></div>`,
                width: "360px",
            });
            // Add .nextaction class so --na-* CSS variables are available
            dialog.element.classList.add("nextaction");
            const container = dialog.element.querySelector("#na-reminder-popup-ctx");
            if (container) {
                new ReminderPopup({
                    target: container,
                    props: {
                        task: taskEntry,
                        bridge,
                        i18n,
                        onSave: (updated: TaskCacheEntry) => {
                            taskStore.applyUpdate(updated);
                            if (selectedTask && selectedTask.blockId === updated.blockId) {
                                selectedTask = updated;
                            }
                        },
                    },
                });
            }
        };
        showTaskContextMenu(task, event, bridge, i18n, callbacks, activeView, inMyDay);
    }

    async function handleStatusClick(task: TaskCacheEntry, event: MouseEvent) {
        const updated = await showStatusMenu(task, event, bridge, i18n);
        taskStore.applyUpdate(updated);
        if (selectedTask && selectedTask.blockId === updated.blockId) {
            selectedTask = updated;
        }
    }

    async function handleRefresh() {
        try {
            await bridge.recalcAllOrders();
            taskStore.loadTasks();
        } catch (e: any) {
            console.error("[NextAction] recalcAllOrders failed:", e);
            notifyError(formatRpcError(e, i18n));
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape" && selectedTask) {
            selectedTask = null;
        }
    }

    $: selectedTaskId = selectedTask ? selectedTask.blockId : "";
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="nextaction na-app">
    <NavRail {activeView} onSwitchView={switchView} onRefresh={handleRefresh} {i18n} />

    <div class="na-app__center">
        <div class="na-app__list">
            {#if activeView === VIEW_INBOX}
                <InboxView
                    {bridge}
                    {selectedTaskId}
                    onSelectTask={handleSelectTask}
                    onEdit={handleEdit}
                    onStatusClick={handleStatusClick}
                    onContextMenu={handleContextMenu}
                    {i18n}
                />
            {:else if activeView === VIEW_NEXT_ACTION}
                <NextActionView
                    {selectedTaskId}
                    onSelectTask={handleSelectTask}
                    onEdit={handleEdit}
                    onStatusClick={handleStatusClick}
                    onContextMenu={handleContextMenu}
                    {i18n}
                />
            {:else if activeView === VIEW_MY_DAY}
                <MyDayView
                    {bridge}
                    {selectedTaskId}
                    onSelectTask={handleSelectTask}
                    onEdit={handleEdit}
                    onStatusClick={handleStatusClick}
                    onContextMenu={handleContextMenu}
                    {i18n}
                />
            {:else if activeView === VIEW_ALL_TASKS}
                <AllTasksView
                    {bridge}
                    {selectedTaskId}
                    onSelectTask={handleSelectTask}
                    onEdit={handleEdit}
                    onStatusClick={handleStatusClick}
                    onContextMenu={handleContextMenu}
                    {i18n}
                />
            {:else if activeView === VIEW_BY_PROJECT}
                <ProjectView
                    {selectedTaskId}
                    onSelectTask={handleSelectTask}
                    onEdit={handleEdit}
                    onStatusClick={handleStatusClick}
                    onContextMenu={handleContextMenu}
                    {i18n}
                />
            {:else if activeView === VIEW_SOMEDAY}
                <SomedayView
                    {bridge}
                    {selectedTaskId}
                    onSelectTask={handleSelectTask}
                    onEdit={handleEdit}
                    onStatusClick={handleStatusClick}
                    onContextMenu={handleContextMenu}
                    {i18n}
                />
            {:else if activeView === VIEW_WAITING}
                <WaitingView
                    {selectedTaskId}
                    onSelectTask={handleSelectTask}
                    onEdit={handleEdit}
                    onStatusClick={handleStatusClick}
                    onContextMenu={handleContextMenu}
                    {i18n}
                />
            {:else if activeView === VIEW_STATISTICS}
                <StatisticsView {bridge} {i18n} />
            {:else if activeView === VIEW_REVIEW}
                <ReviewView
                    {bridge}
                    {selectedTaskId}
                    onSelectTask={handleSelectTask}
                    onEdit={handleEdit}
                    onStatusClick={handleStatusClick}
                    onContextMenu={handleContextMenu}
                    {i18n}
                />
            {:else if activeView === VIEW_REMINDER}
                <ReminderView {i18n} />
            {/if}
        </div>
    </div>

    {#if selectedTask}
        <button
            class="na-app__detail-backdrop"
            class:open={selectedTask !== null}
            on:click={handleDetailClose}
            aria-label="Close"
        ></button>
    {/if}

    <div class="na-app__detail-pane" class:open={selectedTask !== null}>
        {#if selectedTask}
            <div class="na-app__detail-inner">
                {#key selectedTask.blockId}
                    <TaskDetail
                        task={selectedTask}
                        {bridge}
                        {i18n}
                        onSave={handleDetailSave}
                        onRemove={handleDetailRemove}
                        onClose={handleDetailClose}
                    />
                {/key}
            </div>
        {/if}
    </div>
</div>
