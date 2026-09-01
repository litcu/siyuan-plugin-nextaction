<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { PIXELS_PER_MINUTE } from "../../../shared/constants";
    import { getCurrentMinuteOffset } from "./timeline-utils";

    interface Props {
        resetHour?: number;
        containerHeight?: number;
    }

    let { resetHour = 5, containerHeight = 0 }: Props = $props();

    let needleTop: number = $state(0);
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function updatePosition() {
        needleTop = getCurrentMinuteOffset(resetHour) * PIXELS_PER_MINUTE;
    }

    onMount(() => {
        updatePosition();
        intervalId = setInterval(updatePosition, 60000);
    });

    onDestroy(() => {
        if (intervalId) clearInterval(intervalId);
    });

    let needleStyle = $derived(`top: ${needleTop}px`);
</script>

{#if needleTop > 0 && needleTop < containerHeight}
    <div class="na-timeline-needle" style={needleStyle}>
        <div class="na-timeline-needle__dot"></div>
        <div class="na-timeline-needle__line"></div>
    </div>
{/if}

<style lang="scss">
    .na-timeline-needle {
        position: absolute;
        left: 0;
        right: 0;
        z-index: 10;
        pointer-events: none;
    }

    .na-timeline-needle__dot {
        position: absolute;
        left: -4px;
        top: -4px;
        width: 8px;
        height: 8px;
        background: var(--na-danger);
        border-radius: 50%;
    }

    .na-timeline-needle__line {
        height: 2px;
        background: var(--na-danger);
    }
</style>
