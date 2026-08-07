<script lang="ts">
  import { onDestroy } from "svelte";
  import { getCurrentUiZIndex } from "../utils/layer";
  import { portal } from "../utils/portal";

  export let text: string;
  export let position: "top" | "bottom" | "left" | "right" = "top";
  export let delay: number = 300;
  export let fill = false;

  let visible = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let triggerEl: HTMLSpanElement;
  let popupStyle = "";

  function updatePosition() {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const gap = 5;
    const coordinates = position === "top"
      ? { left: rect.left + rect.width / 2, top: rect.top - gap }
      : position === "bottom"
        ? { left: rect.left + rect.width / 2, top: rect.bottom + gap }
        : position === "left"
          ? { left: rect.left - gap, top: rect.top + rect.height / 2 }
          : { left: rect.right + gap, top: rect.top + rect.height / 2 };
    popupStyle = `left:${coordinates.left}px;top:${coordinates.top}px;z-index:${getCurrentUiZIndex()};`;
  }

  function handleMouseEnter() {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      updatePosition();
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

  onDestroy(() => {
    if (timer !== null) clearTimeout(timer);
  });
</script>

<span
  class="na-tooltip"
  class:na-tooltip--fill={fill}
  bind:this={triggerEl}
  on:mouseenter={handleMouseEnter}
  on:mouseleave={handleMouseLeave}
  on:focusin={handleMouseEnter}
  on:focusout={handleMouseLeave}
>
  <slot/>
  {#if visible}
    <span
      use:portal
      class="na-tooltip__popup"
      class:na-tooltip__popup--top={position === "top"}
      class:na-tooltip__popup--bottom={position === "bottom"}
      class:na-tooltip__popup--left={position === "left"}
      class:na-tooltip__popup--right={position === "right"}
      style={popupStyle}
      role="tooltip"
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

  .na-tooltip--fill {
    flex: 1;
    min-width: 0;
  }

  .na-tooltip__popup {
    position: fixed;
    pointer-events: none;
    white-space: nowrap;
    background: color-mix(in srgb, var(--b3-theme-surface) 96%, var(--b3-theme-background));
    border: 1px solid color-mix(in srgb, var(--b3-border-color) 62%, transparent);
    color: var(--b3-theme-on-background);
    border-radius: var(--na-radius-sm);
    padding: 3px 8px;
    font-size: var(--na-font-size-xs);
    box-shadow: var(--na-shadow-sm);
    animation: na-tooltip-fade 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .na-tooltip__popup--top {
    transform: translate(-50%, -100%);
  }

  .na-tooltip__popup--bottom {
    transform: translateX(-50%);
  }

  .na-tooltip__popup--left {
    transform: translate(-100%, -50%);
  }

  .na-tooltip__popup--right {
    transform: translateY(-50%);
  }

  @keyframes na-tooltip-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
</style>
