/* eslint-disable @typescript-eslint/no-explicit-any -- Svelte's legacy ComponentType API exposes any-based generics. */
import { mount, unmount, type Component, type ComponentType, type MountOptions, type SvelteComponent } from "svelte";

export type MountableSvelteComponent = Component<any, any> | ComponentType<SvelteComponent<any>>;
export type SvelteComponentLoader<ComponentType extends MountableSvelteComponent = MountableSvelteComponent> =
    () => Promise<{ default: ComponentType }>;

type ComponentProps<ComponentType> =
    ComponentType extends Component<infer Props, any>
        ? Props
        : ComponentType extends new (...args: any[]) => SvelteComponent<infer Props>
          ? Props
          : Record<string, any>;

type ComponentExports<ComponentType> =
    ComponentType extends Component<any, infer Exports>
        ? Exports
        : ComponentType extends new (...args: any[]) => infer Instance
          ? Instance
          : Record<string, any>;

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

export function mountSvelteComponent<ComponentType extends MountableSvelteComponent>(
    component: ComponentType,
    options: MountOptions<ComponentProps<ComponentType>>,
): SvelteComponentMount<ComponentExports<ComponentType>> {
    const lifecycle = new SvelteMountLifecycle<ComponentExports<ComponentType>>();
    const instance = lifecycle.mount(component, options);
    if (!instance) throw new Error("Cannot mount a disposed Svelte component lifecycle");
    return {
        instance,
        dispose: () => lifecycle.dispose(),
    };
}

export function mountSvelteComponentAsync<ComponentType extends MountableSvelteComponent>(
    loader: SvelteComponentLoader<ComponentType>,
    options: MountOptions<ComponentProps<ComponentType>> | (() => MountOptions<ComponentProps<ComponentType>>),
): AsyncSvelteComponentMount<ComponentExports<ComponentType>> {
    const lifecycle = new SvelteMountLifecycle<ComponentExports<ComponentType>>();
    const ready = loader().then(({ default: component }) => lifecycle.mountDeferred(component, options));
    return {
        get instance() {
            return lifecycle.instance;
        },
        ready,
        dispose: () => lifecycle.dispose(),
    };
}
