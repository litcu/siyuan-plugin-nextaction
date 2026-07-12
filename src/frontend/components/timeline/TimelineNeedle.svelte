<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { PIXELS_PER_MINUTE } from "../../../shared/constants";
    import { getCurrentMinuteOffset } from "./timeline-utils";

    export let resetHour: number = 5;
    export let containerHeight: number = 0;

    let needleTop: number = 0;
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

    $: needleStyle = `top: ${needleTop}px`;
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
        background: var(--na-danger, #e74c3c);
        border-radius: 50%;
    }

    .na-timeline-needle__line {
        height: 2px;
        background: var(--na-danger, #e74c3c);
    }
</style>
