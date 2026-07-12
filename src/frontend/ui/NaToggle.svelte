<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let checked: boolean = false;
  export let disabled: boolean = false;

  const dispatch = createEventDispatcher<{ change: { checked: boolean } }>();

  function toggle() {
    if (disabled) return;
    checked = !checked;
    dispatch('change', { checked });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggle();
    }
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="na-toggle"
  class:na-toggle--checked={checked}
  class:na-toggle--disabled={disabled}
  role="switch"
  aria-checked={checked}
  aria-disabled={disabled}
  tabindex={disabled ? -1 : 0}
  on:click={toggle}
  on:keydown={handleKeydown}
>
  <div class="na-toggle__track">
    <div class="na-toggle__thumb"></div>
  </div>
</div>

<style lang="scss">
  .na-toggle {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    outline: none;
  }

  .na-toggle:focus-visible .na-toggle__track {
    box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest);
  }

  .na-toggle--disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .na-toggle__track {
    position: relative;
    width: 36px;
    height: 20px;
    border-radius: 10px;
    background: var(--b3-theme-surface-lighter);
    border: none;
    transition: background 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .na-toggle--checked .na-toggle__track {
    background: var(--b3-theme-primary);
  }

  .na-toggle__thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .na-toggle--checked .na-toggle__thumb {
    transform: translateX(16px);
  }

  .na-toggle:not(.na-toggle--checked) .na-toggle__thumb {
    background: var(--b3-theme-on-surface-light);
  }
</style>
