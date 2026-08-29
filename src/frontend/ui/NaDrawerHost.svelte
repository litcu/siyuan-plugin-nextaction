<script lang="ts">
    import { createEventDispatcher, onDestroy, tick } from "svelte";

    export let open = false;
    export let label: string;
    export let titleId = "na-drawer-title";

    const dispatch = createEventDispatcher<{ requestClose: "backdrop" | "escape" }>();
    let hostElement: HTMLDivElement;
    let drawerElement: HTMLElement;
    let previousFocus: HTMLElement | null = null;
    let wasOpen = false;
    const inertSiblings = new Map<HTMLElement, boolean>();

    function focusableElements(): HTMLElement[] {
        return Array.from(
            drawerElement?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ) || [],
        );
    }

    function setBackgroundInert(value: boolean) {
        if (!hostElement?.parentElement) return;
        if (value) {
            for (const sibling of Array.from(hostElement.parentElement.children)) {
                if (sibling === hostElement || !(sibling instanceof HTMLElement)) continue;
                inertSiblings.set(sibling, sibling.inert);
                sibling.inert = true;
            }
        } else {
            for (const [sibling, previous] of inertSiblings) sibling.inert = previous;
            inertSiblings.clear();
        }
    }

    async function updateOpenState() {
        if (open && !wasOpen) {
            if (!hostElement || !drawerElement) return;
            wasOpen = true;
            previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setBackgroundInert(true);
            await tick();
            (focusableElements()[0] || drawerElement)?.focus();
        } else if (!open && wasOpen) {
            wasOpen = false;
            setBackgroundInert(false);
            await tick();
            const focusTarget = previousFocus;
            focusTarget?.focus({ preventScroll: true });
            previousFocus = null;
        }
    }

    $: (open, void updateOpenState());

    onDestroy(() => {
        setBackgroundInert(false);
        previousFocus?.focus();
    });

    function handleKeydown(event: KeyboardEvent) {
        if (!open || event.defaultPrevented) return;
        if (event.key === "Tab") {
            const elements = focusableElements();
            if (!elements.length) return;
            const index = elements.indexOf(document.activeElement as HTMLElement);
            const next = event.shiftKey
                ? elements[index <= 0 ? elements.length - 1 : index - 1]
                : elements[index === elements.length - 1 ? 0 : index + 1];
            event.preventDefault();
            next.focus();
            return;
        }
        if (event.key !== "Escape") return;
        const dialogs = (window as any).siyuan?.dialogs;
        if (Array.isArray(dialogs) && dialogs.length > 0) return;
        event.preventDefault();
        dispatch("requestClose", "escape");
    }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="na-drawer-host-root" bind:this={hostElement}>
    {#if open}
        <button
            class="na-drawer-host__backdrop"
            aria-label={label}
            on:click={() => dispatch("requestClose", "backdrop")}
        ></button>
    {/if}
    <aside
        class="na-drawer-host"
        class:na-drawer-host--open={open}
        bind:this={drawerElement}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!open}
        tabindex="-1"
    >
        <slot />
    </aside>
</div>

<style lang="scss">
    .na-drawer-host {
        position: absolute;
        inset: 0 0 0 auto;
        z-index: 21;
        width: min(440px, 100%);
        height: 100%;
        max-width: 100%;
        min-height: 0;
        box-sizing: border-box;
        overflow: hidden;
        border-left: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        box-shadow: var(--b3-dialog-shadow);
        transform: translateX(100%);
        transition: transform 180ms cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
    }
    .na-drawer-host-root {
        position: absolute;
        inset: 0;
        z-index: 20;
        pointer-events: none;
    }
    .na-drawer-host--open {
        transform: translateX(0);
        pointer-events: auto;
    }
    .na-drawer-host-root:has(.na-drawer-host--open) {
        pointer-events: auto;
    }
    .na-drawer-host__backdrop {
        position: absolute;
        inset: 0;
        z-index: 20;
        padding: 0;
        border: 0;
        background: var(--na-color-overlay-bg);
    }
    @media (max-width: 520px) {
        .na-drawer-host {
            width: 100%;
            border-left: 0;
        }
    }
</style>
