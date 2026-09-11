<script lang="ts">
    import { untrack } from "svelte";
    import type { TaskCacheEntry, MyDayTaskEntry } from "../../shared/types";
    import type { I18nStrings } from "../../shared/i18n";
    import type { KernelBridge } from "../kernel-bridge";
    import { taskStore } from "../stores/task-store";
    import { minuteToTimeLabel, getCurrentMinuteOffset } from "../components/timeline/timeline-utils";
    import { formatRpcError } from "../notify";
    import NaPageHost from "./NaPageHost.svelte";
    import NaButton from "./NaButton.svelte";
    import NaInlineNotice from "./NaInlineNotice.svelte";
    interface Props {
        task: TaskCacheEntry;
        entry: MyDayTaskEntry;
        bridge: KernelBridge;
        i18n: I18nStrings;
        onClose: () => void;
    }
    let { task, entry, bridge, i18n, onClose }: Props = $props();
    const resetHour = untrack(() => $taskStore.settings.myDayResetHour);
    const initialDuration = untrack(() =>
        entry.scheduleEnd !== null && entry.scheduleStart !== null
            ? entry.scheduleEnd - entry.scheduleStart
            : $taskStore.settings.myDayDefaultDuration,
    );
    let duration = $state(initialDuration);
    let startTime = $state(
        untrack(() =>
            minuteToTimeLabel(
                entry.scheduleStart ??
                    Math.min(Math.ceil(getCurrentMinuteOffset(resetHour) / 15) * 15, 1440 - initialDuration),
                resetHour,
            ),
        ),
    );
    let busy = $state(false);
    let error = $state("");
    async function save(remove = false) {
        if (busy) return;
        const [hours, minutes] = startTime.split(":").map(Number);
        const start = (hours * 60 + minutes - resetHour * 60 + 1440) % 1440;
        if (
            !remove &&
            (!startTime ||
                !Number.isFinite(start) ||
                !Number.isFinite(duration) ||
                duration < 15 ||
                duration > 720 ||
                start + duration > 1440)
        ) {
            error = i18n.scheduleRangeError;
            return;
        }
        busy = true;
        error = "";
        try {
            const state = remove
                ? await bridge.removeMyDaySchedule(task.blockId)
                : await bridge.setMyDaySchedule(task.blockId, start, start + duration);
            taskStore.applyMyDayUpdate(state);
            onClose();
        } catch (cause) {
            error = formatRpcError(cause, i18n);
        } finally {
            busy = false;
        }
    }
</script>

<NaPageHost
    title={i18n.scheduleTask}
    backLabel={i18n.cancel}
    onBack={() => {
        if (!busy) onClose();
    }}
>
    <form
        class="na-schedule-editor na-page-stack"
        onsubmit={(event) => {
            event.preventDefault();
            void save();
        }}
    >
        <strong>{task.title}</strong>
        <label
            >{i18n.scheduleStart}<input
                class="na-input"
                type="time"
                bind:value={startTime}
                disabled={busy}
                required
            /></label
        >
        <label
            >{i18n.scheduleDuration}<input
                class="na-input"
                type="number"
                min="15"
                max="720"
                bind:value={duration}
                disabled={busy}
                required
            /></label
        >
        {#if error}<NaInlineNotice message={error} tone="error" />{/if}
        <NaButton type="submit" variant="primary" loading={busy}>{i18n.save}</NaButton>
        {#if entry.scheduleStart !== null}<NaButton disabled={busy} onclick={() => save(true)}
                >{i18n.cancelSchedule}</NaButton
            >{/if}
    </form>
</NaPageHost>

<style>
    .na-schedule-editor {
        padding: 12px;
    }
    label {
        display: grid;
        gap: 8px;
    }
</style>
