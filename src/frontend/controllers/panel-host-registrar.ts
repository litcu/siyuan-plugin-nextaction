import { openTab, type Plugin } from "siyuan";
import type { SvelteComponent } from "svelte";
import type { KernelBridge } from "../kernel-bridge";
import type { I18nStrings } from "../../shared/i18n";

export const NEXTACTION_TAB_TYPE = "nextaction_tab";
export const NEXTACTION_DOCK_TYPE = "nextaction_dock";

type MountedComponent = Pick<SvelteComponent, "$destroy">;

export class PanelHostRegistrar {
    private readonly mounted = new Set<MountedComponent>();
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
                    const container = (this as unknown as { element: HTMLElement }).element;
                    container.style.width = "100%";
                    container.style.height = "100%";
                    container.classList.add("fn__flex");
                    void import("../components/NextActionApp.svelte").then(({ default: NextActionApp }) => {
                        if (registrar.disposed) return;
                        const component = new NextActionApp({
                            target: container,
                            props: { bridge: registrar.getBridge(), i18n: registrar.i18n },
                        });
                        registrar.mounted.add(component);
                        (this as unknown as { _naApp?: MountedComponent })._naApp = component;
                    });
                },
                destroy() {
                    const component = (this as unknown as { _naApp?: MountedComponent })._naApp;
                    component?.$destroy();
                    if (component) registrar.mounted.delete(component);
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
                const component = (this as unknown as { _naDock?: MountedComponent })._naDock;
                component?.$destroy();
                if (component) registrar.mounted.delete(component);
            },
            resize() {},
            update() {},
            init() {
                const container = (this as unknown as { element: HTMLElement }).element;
                container.style.width = "100%";
                container.style.height = "100%";
                container.classList.add("nextaction");
                const componentImport = registrar.isMobile
                    ? import("../components/MobileDockHost.svelte")
                    : import("../components/DockSidebar.svelte");
                void componentImport.then(({ default: DockComponent }) => {
                    if (registrar.disposed) return;
                    const component = new DockComponent({
                        target: container,
                        props: { bridge: registrar.getBridge(), i18n: registrar.i18n },
                    });
                    registrar.mounted.add(component);
                    (this as unknown as { _naDock?: MountedComponent })._naDock = component;
                });
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
        for (const component of this.mounted) component.$destroy();
        this.mounted.clear();
    }
}
