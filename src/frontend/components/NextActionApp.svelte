<script lang="ts">
    import { taskStore } from "../stores/task-store";
    import { KernelBridge } from "../kernel-bridge";
    import {
        VIEW_INBOX,
        VIEW_NEXT_ACTION,
        VIEW_ALL_TASKS,
        VIEW_BY_PROJECT,
        VIEW_SOMEDAY,
        VIEW_WAITING,
        VIEW_STATISTICS,
        VIEW_MY_DAY,
        VIEW_REVIEW,
        VIEW_REMINDER,
    } from "../constants";
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
    import type { I18nStrings } from "../../shared/i18n";
    import { get } from "svelte/store";
    import NaDrawerHost from "../ui/NaDrawerHost.svelte";
    import { openReminderSettingsDialog } from "../dialogs/task-property-dialogs";
    import NaPanelHeader from "../ui/NaPanelHeader.svelte";
    import NaButton from "../ui/NaButton.svelte";
    import { openCreateTaskDialog } from "../dialogs/create-task-dialog";
    import { confirm } from "siyuan";

    export let bridge: KernelBridge;
    export let i18n: I18nStrings;

    let activeView: string = VIEW_NEXT_ACTION;
    let selectedTask: TaskCacheEntry | null = null;
    let detailComponent: TaskDetail | null = null;
    let viewAfterClose: string | undefined = undefined;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    // Safety-net refresh: most data is kept in sync by revisioned task broadcasts
    // and local derivation in applyUpdate/applyChangeSetV2. This timer
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
        if (selectedTask) {
            viewAfterClose = view;
            requestDetailClose();
            return;
        }
        applyView(view);
    }

    function applyView(view: string) {
        activeView = view;
        selectedTask = null;
        taskStore.setActiveView(view);
    }

    async function handleSelectTask(task: TaskCacheEntry) {
        if (selectedTask && selectedTask.blockId === task.blockId) {
            await requestDetailClose();
            return;
        }
        await handleEdit(task);
    }

    async function handleEdit(task: TaskCacheEntry) {
        if (detailComponent && selectedTask) {
            await detailComponent.openTask(task.blockId);
            return;
        }
        selectedTask = task;
    }

    function closeDetailNow() {
        selectedTask = null;
        if (viewAfterClose !== undefined) {
            const nextView = viewAfterClose;
            viewAfterClose = undefined;
            applyView(nextView);
        }
    }

    async function requestDetailClose() {
        if (detailComponent) {
            const closed = await detailComponent.requestClose();
            if (!closed) {
                viewAfterClose = undefined;
            }
        } else {
            closeDetailNow();
        }
    }

    function confirmDetailDiscard(confirmDiscard: () => void, cancelClose: () => void) {
        confirm(
            i18n?.unsavedChangesTitle || "Unsaved changes",
            i18n?.unsavedChangesMessage || "Discard unsaved changes?",
            confirmDiscard,
            cancelClose,
        );
    }

    function handleDetailTaskChange(currentTask: TaskCacheEntry) {
        selectedTask = currentTask;
    }

    function handleContextMenu(task: TaskCacheEntry, event: MouseEvent) {
        const inMyDay = $taskStore.myDayState?.tasks.some((t) => t.blockId === task.blockId) ?? false;
        const callbacks: {
            onUpdated: (updated: TaskCacheEntry) => void;
            onRemoved: (blockId: string) => void;
            onEdit: (task: TaskCacheEntry) => void;
            onMyDayToggle?: (blockId: string, isInMyDay: boolean) => Promise<void>;
            onReminderEdit?: (blockId: string) => void;
        } = {
            onUpdated: (updated: TaskCacheEntry) => {
                taskStore.applyUpdate(updated);
                if (selectedTask && selectedTask.blockId === updated.blockId) {
                    selectedTask = updated;
                }
            },
            onRemoved: (blockId: string) => {
                taskStore.applyRemove(blockId);
                if (selectedTask && selectedTask.blockId === blockId) {
                    selectedTask = null;
                }
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
                onSave: (updated: TaskCacheEntry) => {
                    taskStore.applyUpdate(updated);
                    if (selectedTask && selectedTask.blockId === updated.blockId) selectedTask = updated;
                },
            });
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

    async function handleProjectTaskUpdate(task: TaskCacheEntry, attrs: Record<string, string>): Promise<void> {
        try {
            const updated = await bridge.updateTask(task.blockId, attrs);
            taskStore.applyUpdate(updated);
            if (selectedTask && selectedTask.blockId === updated.blockId) selectedTask = updated;
        } catch (error: any) {
            notifyError(formatRpcError(error, i18n));
            throw error;
        }
    }

    async function handleProjectTaskReorder(blockId: string, parentId: string, afterId?: string): Promise<void> {
        try {
            const updated = await bridge.reorderTask(blockId, parentId, afterId);
            taskStore.applyUpdate(updated);
        } catch (error: any) {
            notifyError(formatRpcError(error, i18n));
            throw error;
        }
    }

    async function handleRefresh() {
        try {
            await bridge.recalcAllOrders();
            await taskStore.loadTasks();
        } catch (e: any) {
            console.error("[NextAction] recalcAllOrders failed:", e);
            notifyError(formatRpcError(e, i18n));
        }
    }

    function handleTaskCreated(task: TaskCacheEntry) {
        taskStore.applyUpdate(task);
        void handleEdit(task);
    }

    function openCreate(parentTask: TaskCacheEntry | null = null) {
        openCreateTaskDialog({
            bridge,
            i18n,
            parentTask,
            onCreated: handleTaskCreated,
        }).catch((error) => notifyError(formatRpcError(error, i18n)));
    }

    $: selectedTaskId = selectedTask ? selectedTask.blockId : "";
    $: activeViewMeta = (() => {
        const labels: Record<string, { title: string; icon: string }> = {
            [VIEW_INBOX]: { title: i18n?.inbox || "Inbox", icon: "iconInbox" },
            [VIEW_NEXT_ACTION]: { title: i18n?.nextAction || "Next", icon: "iconListItem" },
            [VIEW_MY_DAY]: { title: i18n?.myDay || "My Day", icon: "iconCalendar" },
            [VIEW_ALL_TASKS]: { title: i18n?.allTasks || "All", icon: "iconList" },
            [VIEW_BY_PROJECT]: { title: i18n?.byProject || "Project", icon: "iconFolder" },
            [VIEW_SOMEDAY]: { title: i18n?.someday || "Someday", icon: "iconLight" },
            [VIEW_WAITING]: { title: i18n?.waiting || "Waiting", icon: "iconClock" },
            [VIEW_STATISTICS]: { title: i18n?.statistics || "Statistics", icon: "iconGraph" },
            [VIEW_REVIEW]: { title: i18n?.review || "Review", icon: "iconCheck" },
            [VIEW_REMINDER]: { title: i18n?.reminder || "Reminders", icon: "iconClock" },
        };
        return labels[activeView] || labels[VIEW_NEXT_ACTION];
    })();
</script>

<div class="nextaction na-app">
    <NavRail {activeView} onSwitchView={switchView} onRefresh={handleRefresh} {i18n} />

    <div class="na-app__center">
        <NaPanelHeader compact title={activeViewMeta.title} icon={activeViewMeta.icon}>
            <svelte:fragment slot="actions"
                ><NaButton size="sm" variant="primary" icon="iconAdd" on:click={() => openCreate()}
                    >{i18n?.createTask || "Create task"}</NaButton
                ></svelte:fragment
            >
        </NaPanelHeader>
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
                    selectedTaskOverride={selectedTask}
                    onSelectTask={handleSelectTask}
                    onEdit={handleEdit}
                    onStatusClick={handleStatusClick}
                    onContextMenu={handleContextMenu}
                    onTaskUpdate={handleProjectTaskUpdate}
                    onTaskReorder={handleProjectTaskReorder}
                    onCreateChild={(task) => openCreate(task)}
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

    <NaDrawerHost open={selectedTask !== null} label={i18n?.close || "Close"} on:requestClose={requestDetailClose}>
        {#if selectedTask}
            <div class="na-app__detail-inner">
                <TaskDetail
                    bind:this={detailComponent}
                    task={selectedTask}
                    {bridge}
                    {i18n}
                    onCreateChild={(task) => openCreate(task)}
                    onTaskChange={handleDetailTaskChange}
                    onClose={closeDetailNow}
                    onConfirmDiscard={confirmDetailDiscard}
                />
            </div>
        {/if}
    </NaDrawerHost>
</div>
