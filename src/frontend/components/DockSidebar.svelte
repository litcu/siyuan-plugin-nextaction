<script lang="ts">
    import Workspace from "./Workspace.svelte";
    import type { KernelBridge } from "../kernel-bridge";
    import type { I18nStrings } from "../../shared/i18n";
    import type { App } from "siyuan";
    interface Props {
        bridge: KernelBridge;
        i18n: I18nStrings;
        app?: App;
    }
    let { bridge, i18n, app = undefined }: Props = $props();
</script>

<Workspace {bridge} {i18n} {app} host="desktop-dock" />
