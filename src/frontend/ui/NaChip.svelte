<script lang="ts">
  export let label: string;
  export let color: string | undefined = undefined;
  export let onClose: (() => void) | undefined = undefined;
  export let ellipsis: boolean = true;
</script>

<div
  class="na-chip"
  class:na-chip--ellipsis={ellipsis}
  class:na-chip--closable={onClose}
  style={color ? `border-left: 2px solid ${color}` : ''}
>
  <span class="na-chip__label">{label}</span>
  {#if onClose}
    <button class="na-chip__close" on:click={onClose} aria-label="Remove">
      <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="4" y1="4" x2="12" y2="12" />
        <line x1="12" y1="4" x2="4" y2="12" />
      </svg>
    </button>
  {/if}
</div>

<style lang="scss">
  .na-chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 1px var(--na-space-sm);
    border-radius: var(--na-radius-pill);
    background: var(--b3-theme-surface-light);
    border: 1px solid transparent;
    font-size: var(--na-font-size-sm);
    font-weight: 500;
    line-height: 1.4;
    max-width: 100%;
    transition: background 0.15s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.15s;
  }

  .na-chip:hover {
    background: var(--b3-theme-surface-lighter);
    border-color: var(--na-color-divider);
  }

  .na-chip__label {
    overflow: hidden;
    white-space: normal;
    text-overflow: clip;
    min-width: 0;
  }

  .na-chip--ellipsis .na-chip__label {
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .na-chip__close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    border-radius: 50%;
    cursor: pointer;
    color: var(--b3-theme-on-surface-light);
    transition: color 0.15s, background 0.15s, transform 0.1s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .na-chip__close:hover {
    color: var(--b3-theme-on-background);
    background: var(--b3-theme-surface);
  }

  .na-chip__close:active {
    transform: scale(0.85);
  }
</style>
