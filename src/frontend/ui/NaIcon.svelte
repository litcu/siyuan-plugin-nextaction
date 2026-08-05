<script lang="ts">
    export let symbol: string;
    export let size = 18;
</script>

<svg class="na-icon" width={size} height={size} aria-hidden="true">
    <use href={`#${symbol}`}></use>
</svg>

<style>
    .na-icon {
        display: block;
        flex: 0 0 auto;
        fill: currentColor;
    }
</style>
