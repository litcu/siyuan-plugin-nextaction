<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let count: number = 7;
  export let value: number = 0;
  export let color: string = 'var(--b3-theme-primary)';

  const dispatch = createEventDispatcher<{ change: number }>();

  function handleClick(i: number) {
    const newValue = i + 1 === value ? i : i + 1;
    value = newValue;
    dispatch('change', newValue);
  }
</script>

<div class="na-dot-rating" role="radiogroup">
  {#each Array(count) as _, i}
    <button
      type="button"
      class="na-dot-rating__seg"
      class:na-dot-rating__seg--filled={i < value}
      style={i < value ? `background-color: ${color}` : ''}
      on:click={() => handleClick(i)}
      role="radio"
      aria-checked={i < value}
    ></button>
  {/each}
</div>

<style lang="scss">
  .na-dot-rating {
    display: inline-flex;
    gap: 3px;
    align-items: center;
  }

  .na-dot-rating__seg {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    cursor: pointer;
    transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.15s, background-color 0.15s;
    border: 1.5px solid var(--b3-theme-surface-lighter);
    padding: 0;
    background: transparent;
  }

  .na-dot-rating__seg:hover {
    transform: scale(1.15);
    border-color: var(--b3-theme-primary-light);
  }

  .na-dot-rating__seg--filled {
    border-color: transparent;
  }

  .na-dot-rating__seg--filled:hover {
    opacity: 0.8;
    transform: scale(1.08);
  }
</style>
