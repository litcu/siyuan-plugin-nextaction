<script module lang="ts">
    type PageStack = { pages: HTMLElement[]; background: Map<HTMLElement, boolean> };
    const stacks = new WeakMap<Element, PageStack>();
    function reconcile(root: Element, stack: PageStack) {
        const top = stack.pages[stack.pages.length - 1];
        for (const child of root.children) {
            if (!(child instanceof HTMLElement)) continue;
            if (!stack.pages.includes(child) && !stack.background.has(child)) stack.background.set(child, child.inert);
            child.inert = top ? child !== top : (stack.background.get(child) ?? false);
        }
    }
</script>

<script lang="ts">
    import { onMount, type Snippet } from "svelte";
    import NaIconButton from "./NaIconButton.svelte";
    interface Props {
        title: string;
        backLabel: string;
        onBack: () => void;
        chrome?: boolean;
        children: Snippet;
        actions?: Snippet;
    }
    let { title, backLabel, onBack, chrome = true, children, actions = undefined }: Props = $props();
    let element: HTMLDivElement;
    onMount(() => {
        const previous = document.activeElement as HTMLElement | null;
        const parent = element.parentElement;
        const root = element.closest(".na-app") || parent;
        root?.appendChild(element);
        if (!root) return;
        const stack: PageStack = stacks.get(root) || { pages: [], background: new Map() };
        stack.pages.push(element);
        stacks.set(root, stack);
        reconcile(root, stack);
        element.focus();
        return () => {
            stack.pages = stack.pages.filter((page) => page !== element);
            stack.background.delete(element);
            element.remove();
            reconcile(root, stack);
            if (!stack.pages.length) stacks.delete(root);
            if (previous?.isConnected && !previous.closest("[inert]")) previous.focus({ preventScroll: true });
            else stack.pages[stack.pages.length - 1]?.focus({ preventScroll: true });
        };
    });
    function handleKeydown(event: KeyboardEvent) {
        if ((window as any).siyuan?.dialogs?.length) return;
        if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            onBack();
        }
        if (event.key !== "Tab") return;
        const nodes = [
            ...element.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
            ),
        ].filter((node) => node.getClientRects().length && !node.closest("[inert]"));
        const first = nodes[0],
            last = nodes[nodes.length - 1];
        if (!first) {
            event.preventDefault();
            return;
        }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) {
            event.preventDefault();
            first.focus();
        }
    }
</script>

<div
    class="na-page-host"
    bind:this={element}
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    onkeydown={handleKeydown}
>
    {#if chrome}<header class="na-page-host__header">
            <NaIconButton symbol="iconLeft" label={backLabel} onclick={onBack} />
            <h2>{title}</h2>
            {#if actions}{@render actions()}{/if}
        </header>{/if}
    <div class="na-page-host__body">{@render children()}</div>
</div>

<style lang="scss">
    .na-page-host {
        position: absolute;
        inset: 0;
        z-index: 40;
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        background: var(--b3-theme-background);
        color: var(--na-text-primary);
        padding-bottom: env(safe-area-inset-bottom);
        box-sizing: border-box;
    }
    .na-page-host__header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--b3-border-color);
        flex: none;
    }
    h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        min-width: 0;
        flex: 1;
        overflow-wrap: anywhere;
    }
    .na-page-host__body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
    }
</style>
