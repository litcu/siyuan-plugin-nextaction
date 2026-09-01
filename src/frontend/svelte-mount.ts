import { mount, unmount, type Component, type ComponentProps, type MountOptions } from "svelte";

export type MountableSvelteComponent = Component<any, any>;
export type SvelteComponentLoader<TComponent extends MountableSvelteComponent = MountableSvelteComponent> =
    () => Promise<{ default: TComponent }>;

type ComponentExports<TComponent> = TComponent extends Component<any, infer Exports> ? Exports : Record<string, any>;

export interface SvelteComponentMount<Exports extends object> {
    readonly instance: Exports;
    dispose(): Promise<void>;
}

export interface AsyncSvelteComponentMount<Exports extends object> {
    readonly instance: Exports | null;
    readonly ready: Promise<Exports | null>;
    dispose(): Promise<void>;
}

class SvelteMountLifecycle<Exports extends object> {
    private mountedInstance: Exports | null = null;
    private disposed = false;
    private disposePromise: Promise<void> | null = null;

    get instance(): Exports | null {
        return this.mountedInstance;
    }

    mount<Props extends Record<string, any>>(
        component: MountableSvelteComponent,
        options: MountOptions<Props>,
    ): Exports | null {
        if (this.disposed) return null;
        const instance = mount(component, options) as Exports;
        if (this.disposed) {
            void unmount(instance);
            return null;
        }
        this.mountedInstance = instance;
        return instance;
    }

    mountDeferred<Props extends Record<string, any>>(
        component: MountableSvelteComponent,
        options: MountOptions<Props> | (() => MountOptions<Props>),
    ): Exports | null {
        if (this.disposed) return null;
        return this.mount(component, typeof options === "function" ? options() : options);
    }

    dispose(): Promise<void> {
        if (this.disposePromise) return this.disposePromise;
        this.disposed = true;
        const instance = this.mountedInstance;
        this.mountedInstance = null;
        this.disposePromise = instance ? unmount(instance) : Promise.resolve();
        return this.disposePromise;
    }
}

export function mountSvelteComponent<TComponent extends MountableSvelteComponent>(
    component: TComponent,
    options: MountOptions<ComponentProps<TComponent>>,
): SvelteComponentMount<ComponentExports<TComponent>> {
    const lifecycle = new SvelteMountLifecycle<ComponentExports<TComponent>>();
    const instance = lifecycle.mount(component, options);
    if (!instance) throw new Error("Cannot mount a disposed Svelte component lifecycle");
    return {
        instance,
        dispose: () => lifecycle.dispose(),
    };
}

export function mountSvelteComponentAsync<TComponent extends MountableSvelteComponent>(
    loader: SvelteComponentLoader<TComponent>,
    options: MountOptions<ComponentProps<TComponent>> | (() => MountOptions<ComponentProps<TComponent>>),
): AsyncSvelteComponentMount<ComponentExports<TComponent>> {
    const lifecycle = new SvelteMountLifecycle<ComponentExports<TComponent>>();
    const ready = loader().then(({ default: component }) => lifecycle.mountDeferred(component, options));
    return {
        get instance() {
            return lifecycle.instance;
        },
        ready,
        dispose: () => lifecycle.dispose(),
    };
}
