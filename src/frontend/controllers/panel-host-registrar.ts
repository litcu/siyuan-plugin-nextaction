import { openTab, type Plugin } from "siyuan";
import type { KernelBridge } from "../kernel-bridge";
import type { I18nStrings } from "../../shared/i18n";
import { mountSvelteComponentAsync, type AsyncSvelteComponentMount } from "../svelte-mount";

export const NEXTACTION_TAB_TYPE = "nextaction_tab";
export const NEXTACTION_DOCK_TYPE = "nextaction_dock";

type PanelMount = AsyncSvelteComponentMount<object>;

export class PanelHostRegistrar {
    private readonly mounted = new Set<PanelMount>();
    private disposed = false;

    constructor(
        private readonly plugin: Plugin,
        private readonly i18n: I18nStrings,
        private readonly isMobile: boolean,
        private readonly getBridge: () => KernelBridge,
    ) {}

    register(): void {
        this.plugin.addIcons(`<symbol id="iconNextAction" viewBox="0 0 32 32">
    <path d="M5 24C8 20 11 8 16 12S24 20 27 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <circle cx="11" cy="13" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="11" cy="13" r="1.5" fill="currentColor"/>
    <path d="M24 8l3 0 0 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</symbol>`);
        const registrar = this;
        if (!this.isMobile) {
            this.plugin.addTab({
                type: NEXTACTION_TAB_TYPE,
                init() {
                    const host = this as unknown as { element: HTMLElement; _naApp?: PanelMount };
                    const container = host.element;
                    container.style.width = "100%";
                    container.style.height = "100%";
                    container.classList.add("fn__flex");
                    if (registrar.disposed) return;
                    const mounted = mountSvelteComponentAsync(
                        () => import("../components/NextActionApp.svelte"),
                        () => ({
                            target: container,
                            props: { bridge: registrar.getBridge(), i18n: registrar.i18n },
                        }),
                    );
                    registrar.mounted.add(mounted);
                    host._naApp = mounted;
                },
                destroy() {
                    const mounted = (this as unknown as { _naApp?: PanelMount })._naApp;
                    void mounted?.dispose();
                    if (mounted) registrar.mounted.delete(mounted);
                },
            });
        }

        this.plugin.addDock({
            config: {
                position: "RightTop",
                size: { width: 300, height: 0 },
                icon: "iconNextAction",
                title: this.i18n.pluginName || "NextAction",
                hotkey: "",
            },
            data: {},
            type: NEXTACTION_DOCK_TYPE,
            destroy() {
                const mounted = (this as unknown as { _naDock?: PanelMount })._naDock;
                void mounted?.dispose();
                if (mounted) registrar.mounted.delete(mounted);
            },
            resize() {},
            update() {},
            init() {
                const host = this as unknown as { element: HTMLElement; _naDock?: PanelMount };
                const container = host.element;
                container.style.width = "100%";
                container.style.height = "100%";
                container.classList.add("nextaction");
                if (registrar.disposed) return;
                const mounted = mountSvelteComponentAsync(
                    () =>
                        registrar.isMobile
                            ? import("../components/MobileDockHost.svelte")
                            : import("../components/DockSidebar.svelte"),
                    () => ({
                        target: container,
                        props: { bridge: registrar.getBridge(), i18n: registrar.i18n },
                    }),
                );
                registrar.mounted.add(mounted);
                host._naDock = mounted;
            },
        });

        if (!this.isMobile) {
            this.plugin.addTopBar({
                icon: "iconNextAction",
                title: this.i18n.pluginName || "NextAction",
                callback: () => this.openTaskPanel(),
            });
        }
    }

    openTaskPanel(): void {
        if (this.isMobile) return;
        void openTab({
            app: this.plugin.app,
            custom: {
                id: this.plugin.name + NEXTACTION_TAB_TYPE,
                icon: "iconNextAction",
                title: this.i18n.pluginName || "NextAction",
            },
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const mounted of this.mounted) void mounted.dispose();
        this.mounted.clear();
    }
}
