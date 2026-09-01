<script lang="ts">
    import { onDestroy, tick, type Snippet } from "svelte";
    import { getCurrentUiZIndex } from "../utils/layer";
    import { portal } from "../utils/portal";
    import { calculateTooltipPosition, type TooltipPosition } from "../utils/tooltip-position";

    export let text: string;
    export let position: TooltipPosition = "top";
    export let delay: number = 300;
    export let fill = false;
    export let block = false;
    export let followCursor = true;
    export let multiline = false;
    export let openOnClick = false;
    export let ariaLabel = "";
    export let children: Snippet;

    let visible = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let triggerEl: HTMLSpanElement;
    let popupEl: HTMLSpanElement;
    let popupStyle = "";
    let resolvedPosition: TooltipPosition = position;
    let cursor: { x: number; y: number } | null = null;
    let globalListenersAttached = false;

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
        attachGlobalListeners();
        await tick();
        updatePosition();
    }

    function hideTooltip() {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        visible = false;
        cursor = null;
        detachGlobalListeners();
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
        hideTooltip();
    }

    function handleClick() {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        cursor = null;
        if (openOnClick && !visible) {
            void showTooltip();
            return;
        }
        hideTooltip();
    }

    function handleFocusIn() {
        cursor = null;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            void showTooltip();
        }, delay);
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            hideTooltip();
            return;
        }
        if (openOnClick && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            handleClick();
        }
    }

    function handleWindowPointerDown(event: PointerEvent) {
        if (!openOnClick || !visible || !triggerEl) return;
        if (event.target instanceof Node && triggerEl.contains(event.target)) return;
        hideTooltip();
    }

    function handleWindowKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") hideTooltip();
    }

    function handleViewportChange() {
        hideTooltip();
    }

    function attachGlobalListeners() {
        if (!openOnClick || globalListenersAttached || typeof window === "undefined") return;
        window.addEventListener("pointerdown", handleWindowPointerDown);
        window.addEventListener("keydown", handleWindowKeydown, true);
        window.addEventListener("resize", handleViewportChange);
        window.addEventListener("scroll", handleViewportChange);
        document.addEventListener("scroll", handleViewportChange, true);
        globalListenersAttached = true;
    }

    function detachGlobalListeners() {
        if (!globalListenersAttached || typeof window === "undefined") return;
        window.removeEventListener("pointerdown", handleWindowPointerDown);
        window.removeEventListener("keydown", handleWindowKeydown, true);
        window.removeEventListener("resize", handleViewportChange);
        window.removeEventListener("scroll", handleViewportChange);
        document.removeEventListener("scroll", handleViewportChange, true);
        globalListenersAttached = false;
    }

    onDestroy(() => {
        if (timer !== null) clearTimeout(timer);
        detachGlobalListeners();
    });
</script>

<span
    class="na-tooltip"
    class:na-tooltip--fill={fill}
    class:na-tooltip--block={block}
    class:na-tooltip--multiline={multiline}
    bind:this={triggerEl}
    role="button"
    tabindex="0"
    aria-label={ariaLabel || undefined}
    aria-expanded={openOnClick ? visible : undefined}
    onmouseenter={handleMouseEnter}
    onmousemove={handleMouseMove}
    onmouseleave={handleMouseLeave}
    onclick={handleClick}
    onkeydown={handleKeydown}
    onfocusin={handleFocusIn}
    onfocusout={handleMouseLeave}
>
    {@render children()}
    {#if visible}
        <span
            use:portal
            bind:this={popupEl}
            class="na-tooltip__popup"
            class:na-tooltip__popup--multiline={multiline}
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

    .na-tooltip__popup--multiline {
        max-width: min(280px, calc(100vw - 16px));
        padding: 6px 8px;
        font-size: var(--na-font-size-sm);
        line-height: 16px;
        overflow-wrap: anywhere;
        white-space: normal;
    }

    @keyframes na-tooltip-fade {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }
</style>
