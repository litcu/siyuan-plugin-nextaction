<script lang="ts">
  export let text: string | undefined = undefined;
  export let loading: boolean = false;
  export let action: { label: string; onClick: () => void } | undefined = undefined;
</script>

<div class="na-empty">
  {#if loading}
    <div class="na-empty__spinner">
      <div class="na-empty__spinner-ring"></div>
    </div>
  {:else}
    <div class="na-empty__illustration">
      <svg viewBox="0 0 80 80" width="80" height="80" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.25">
        <rect x="16" y="10" width="48" height="60" rx="4" />
        <line x1="26" y1="26" x2="54" y2="26" />
        <line x1="26" y1="36" x2="48" y2="36" />
        <line x1="26" y1="46" x2="44" y2="46" />
        <circle cx="26" cy="56" r="2" fill="currentColor" stroke="none" opacity="0.4" />
        <line x1="32" y1="56" x2="50" y2="56" />
      </svg>
    </div>
  {/if}
  {#if text}
    <span class="na-empty__text">{text}</span>
  {/if}
  {#if !loading && action}
    <button class="na-button na-button--sm" on:click={action.onClick}>
      {action.label}
    </button>
  {/if}
</div>

<style lang="scss">
  .na-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    min-height: 200px;
    padding: var(--na-space-xxl) var(--na-space-xl);
    gap: var(--na-space-lg);
    color: var(--b3-theme-on-surface-light);
    text-align: center;
  }

  .na-empty__spinner {
    width: 24px;
    height: 24px;
  }

  .na-empty__spinner-ring {
    width: 24px;
    height: 24px;
    border: 2.5px solid var(--b3-theme-surface-lighter);
    border-top-color: var(--b3-theme-primary);
    border-radius: 50%;
    animation: na-empty-spin 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }

  .na-empty__illustration {
    line-height: 1;
    color: var(--b3-theme-on-surface-light);
  }

  .na-empty__text {
    max-width: 240px;
    color: var(--b3-theme-on-surface-secondary);
    font-size: var(--na-font-size-lg);
    font-weight: 500;
    letter-spacing: 0.02em;
    line-height: 1.5;
  }

  @keyframes na-empty-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
