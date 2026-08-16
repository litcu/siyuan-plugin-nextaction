<script lang="ts">
    import DockSidebar from "./DockSidebar.svelte";
    import NextActionApp from "./NextActionApp.svelte";
    import NaIcon from "../ui/NaIcon.svelte";
    import NaIconButton from "../ui/NaIconButton.svelte";
    import type { KernelBridge } from "../kernel-bridge";
    import type { I18nStrings } from "../../shared/i18n";

    export let bridge: KernelBridge;
    export let i18n: I18nStrings;

    type MobileDockMode = "sidebar" | "full";
    let mode: MobileDockMode = "sidebar";

    function openFullPanel(): void {
        mode = "full";
    }

    function backToSidebar(): void {
        mode = "sidebar";
    }
</script>

<div class="na-mobile-dock-host" class:na-mobile-dock-host--full={mode === "full"}>
    {#if mode === "sidebar"}
        <DockSidebar {bridge} {i18n} onOpenFullPanel={openFullPanel} />
    {:else}
        <header class="na-mobile-dock-host__toolbar">
            <span class="na-mobile-dock-host__back-button">
                <NaIconButton
                    symbol="iconRight"
                    label={i18n?.back || "Back"}
                    on:click={backToSidebar}
                />
            </span>
            <div class="na-mobile-dock-host__title">
                <span class="na-mobile-dock-host__title-icon"><NaIcon symbol="iconNextAction" size={16} /></span>
                <span>{i18n?.taskPanel || "Task Panel"}</span>
            </div>
        </header>
        <div class="na-mobile-dock-host__full-panel">
            <NextActionApp {bridge} {i18n} />
        </div>
    {/if}
</div>

<style lang="scss">
    .na-mobile-dock-host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        box-sizing: border-box;
        padding-bottom: env(safe-area-inset-bottom);
        background: var(--b3-theme-background);
    }

    .na-mobile-dock-host__toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 44px;
        flex: 0 0 44px;
        padding: 4px 8px;
        box-sizing: border-box;
        border-bottom: 1px solid var(--b3-border-color);
        color: var(--b3-theme-on-surface);
        background: var(--na-color-panel-header);
    }

    .na-mobile-dock-host__back-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        flex: 0 0 44px;
    }

    .na-mobile-dock-host__back-button :global(.na-icon-button) {
        width: 44px;
        height: 44px;
        flex-basis: 44px;
    }

    .na-mobile-dock-host__back-button :global(.na-icon) {
        transform: rotate(180deg);
    }

    .na-mobile-dock-host__title {
        display: inline-flex;
        align-items: center;
        min-width: 0;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
    }

    .na-mobile-dock-host__title-icon {
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border-radius: var(--b3-border-radius);
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
    }

    .na-mobile-dock-host__full-panel {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
    }

    .na-mobile-dock-host__full-panel :global(.na-app) {
        min-height: 0;
    }
</style>
