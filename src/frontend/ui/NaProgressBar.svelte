<script lang="ts">
  export let percent: number = 0;
  export let label: string | undefined = undefined;
  export let color: string = "var(--b3-theme-primary)";
</script>

<div class="na-progress">
  {#if label}
    <span class="na-progress__label">{label}</span>
  {/if}
  <div class="na-progress__bar">
    <div
      class="na-progress__fill"
      style="width: {percent}%; background: {color};"
    ></div>
  </div>
  <span class="na-progress__percent">{percent}%</span>
</div>

<style lang="scss">
  .na-progress {
    display: flex;
    align-items: center;
    gap: var(--na-space-sm);
    font-size: var(--na-font-size-xs);
    color: var(--b3-theme-on-surface-light);
  }

  .na-progress__label {
    flex-shrink: 0;
    font-size: var(--na-font-size-xs);
    letter-spacing: 0.02em;
  }

  .na-progress__bar {
    flex: 1;
    height: 3px;
    background: var(--b3-theme-surface-lighter);
    border-radius: 2px;
    overflow: hidden;
  }

  .na-progress__fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .na-progress__percent {
    flex-shrink: 0;
    min-width: 28px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
