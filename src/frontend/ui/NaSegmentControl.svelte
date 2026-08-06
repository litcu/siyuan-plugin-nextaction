<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let options: { value: string; label: string }[] = [];
  export let value: string = '';
  export let label: string = '';
  export let size: 'md' | 'sm' = 'md';
  export let stretch = false;

  const dispatch = createEventDispatcher<{ change: string }>();

  function select(optionValue: string) {
    if (optionValue === value) return;
    value = optionValue;
    dispatch('change', optionValue);
  }

  $: activeIndex = options.findIndex(o => o.value === value);
</script>

<div class="na-segment-control" class:na-segment-control--sm={size === 'sm'} class:na-segment-control--stretch={stretch} role="radiogroup" aria-label={label || undefined}>
  {#if activeIndex >= 0}
    <div
      class="na-segment-control__slider"
      style="width: {100 / options.length}%; transform: translateX({activeIndex * 100}%)"
    ></div>
  {/if}
  {#each options as option, i (option.value)}
    <button
      class="na-segment-control__option"
      class:na-segment-control__option--active={option.value === value}
      role="radio"
      aria-checked={option.value === value}
      on:click={() => select(option.value)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style lang="scss">
  .na-segment-control {
    display: inline-flex;
    border: 1px solid var(--na-color-divider);
    border-radius: var(--na-radius-md);
    overflow: hidden;
    position: relative;
    background: var(--b3-theme-background);
  }

  .na-segment-control--stretch { width: 100%; }

  .na-segment-control__slider {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    border-radius: var(--na-radius-sm);
    background: var(--b3-theme-primary);
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 0;
  }

  .na-segment-control__option {
    border: none;
    padding: 3px 12px;
    font-size: var(--na-font-size-sm);
    font-weight: 500;
    cursor: pointer;
    background: transparent;
    color: var(--b3-theme-on-surface);
    position: relative;
    z-index: 1;
    transition: color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    white-space: nowrap;
  }

  .na-segment-control--sm .na-segment-control__option {
    padding: 3px 9px;
    font-size: var(--na-font-size-xs);
  }

  .na-segment-control--stretch .na-segment-control__option { flex: 1; }

  .na-segment-control__option:not(.na-segment-control__option--active):hover {
    color: var(--b3-theme-primary);
  }

  .na-segment-control__option--active {
    color: var(--b3-theme-on-primary);
  }

  @media (prefers-reduced-motion: reduce) {
    .na-segment-control__slider,
    .na-segment-control__option {
      transition: none;
    }
  }
</style>
