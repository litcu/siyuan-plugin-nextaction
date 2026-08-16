<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { getCurrentUiZIndex } from "../utils/layer";
  import { portal } from "../utils/portal";
  import { calculateTooltipPosition, type TooltipPosition } from "../utils/tooltip-position";

  export let text: string;
  export let position: TooltipPosition = "top";
  export let delay: number = 300;
  export let fill = false;
  export let block = false;
  export let followCursor = true;

  let visible = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let triggerEl: HTMLSpanElement;
  let popupEl: HTMLSpanElement;
  let popupStyle = "";
  let resolvedPosition: TooltipPosition = position;
  let cursor: { x: number; y: number } | null = null;

  function updatePosition() {
    if (!triggerEl || !popupEl || typeof window === "undefined") return;
    const rect = triggerEl.getBoundingClientRect();
    const popupRect = popupEl.getBoundingClientRect();
    const coordinates = calculateTooltipPosition({
      anchor: rect,
      popupWidth: popupRect.width,
      popupHeight: popupRect.height,
      preferred: position,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      cursor: followCursor ? cursor : null,
    });
    resolvedPosition = coordinates.position;
    popupStyle = `left:${coordinates.left}px;top:${coordinates.top}px;z-index:${getCurrentUiZIndex()};`;
  }

  async function showTooltip() {
    if (!text) return;
    visible = true;
    await tick();
    updatePosition();
  }

  function handleMouseEnter(event: MouseEvent) {
    cursor = { x: event.clientX, y: event.clientY };
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void showTooltip();
    }, delay);
  }

  function handleMouseMove(event: MouseEvent) {
    cursor = { x: event.clientX, y: event.clientY };
    if (visible && followCursor) updatePosition();
  }

  function handleMouseLeave() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    visible = false;
    cursor = null;
  }

  function handleClick() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    visible = false;
    cursor = null;
  }

  function handleFocusIn() {
    cursor = null;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void showTooltip();
    }, delay);
  }

  onDestroy(() => {
    if (timer !== null) clearTimeout(timer);
  });
</script>

<span
  class="na-tooltip"
  class:na-tooltip--fill={fill}
  class:na-tooltip--block={block}
  bind:this={triggerEl}
  role="button"
  tabindex="0"
  on:mouseenter={handleMouseEnter}
  on:mousemove={handleMouseMove}
  on:mouseleave={handleMouseLeave}
  on:click={handleClick}
  on:keydown={(event) => { if (event.key === "Escape") handleClick(); }}
  on:focusin={handleFocusIn}
  on:focusout={handleMouseLeave}
>
  <slot/>
  {#if visible}
    <span
      use:portal
      bind:this={popupEl}
      class="na-tooltip__popup"
      data-position={resolvedPosition}
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

  .na-tooltip--block {
    width: 100%;
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

  @keyframes na-tooltip-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
</style>
