<script lang="ts">
  export let text: string;
  export let position: "top" | "bottom" | "left" | "right" = "top";
  export let delay: number = 300;

  let visible = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function handleMouseEnter() {
    timer = setTimeout(() => {
      visible = true;
    }, delay);
  }

  function handleMouseLeave() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    visible = false;
  }
</script>

<span
  class="na-tooltip"
  on:mouseenter={handleMouseEnter}
  on:mouseleave={handleMouseLeave}
>
  <slot/>
  {#if visible}
    <span
      class="na-tooltip__popup"
      class:na-tooltip__popup--top={position === "top"}
      class:na-tooltip__popup--bottom={position === "bottom"}
      class:na-tooltip__popup--left={position === "left"}
      class:na-tooltip__popup--right={position === "right"}
    >
      {text}
    </span>
  {/if}
</span>

<style lang="scss">
  .na-tooltip {
    position: relative;
    display: inline-flex;
  }

  .na-tooltip__popup {
    position: absolute;
    pointer-events: none;
    white-space: nowrap;
    z-index: 9999;
    background: var(--b3-theme-surface);
    border: 1px solid var(--na-color-divider);
    color: var(--b3-theme-on-background);
    border-radius: var(--na-radius-sm);
    padding: 3px 8px;
    font-size: var(--na-font-size-xs);
    box-shadow: var(--na-shadow-sm);
    animation: na-tooltip-fade 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .na-tooltip__popup--top {
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-bottom: 4px;
  }

  .na-tooltip__popup--bottom {
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 4px;
  }

  .na-tooltip__popup--left {
    right: 100%;
    top: 50%;
    transform: translateY(-50%);
    margin-right: 4px;
  }

  .na-tooltip__popup--right {
    left: 100%;
    top: 50%;
    transform: translateY(-50%);
    margin-left: 4px;
  }

  @keyframes na-tooltip-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
</style>
