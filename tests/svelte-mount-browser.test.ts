import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

const mountAdapter = resolve("src/frontend/svelte-mount.ts");

test("统一挂载边界保留组件公开方法并幂等清理组件资源", async () => {
    const result = await runSvelteBrowserTest<{
        text: string;
        methodResult: string;
        destroyCount: number;
        eventCount: number;
        timerCountAfterDispose: number;
        childCount: number;
    }>({
        fixtureName: "svelte-mount-lifecycle",
        aliases: [{ find: "@nextaction/svelte-mount", replacement: mountAdapter }],
        virtualTimeBudget: 200,
        files: {
            "Fixture.svelte": `<script>
import { onDestroy, onMount } from "svelte";
export let message;
let timer;
const onProbe = () => window.__eventCount += 1;
onMount(() => {
    window.addEventListener("na-probe", onProbe);
    timer = setInterval(() => window.__timerCount += 1, 10);
});
onDestroy(() => {
    window.__destroyCount += 1;
    window.removeEventListener("na-probe", onProbe);
    clearInterval(timer);
});
export function greet() { return "hello " + message; }
</script>
<p>{message}</p>`,
            "main.js": `import Fixture from "./Fixture.svelte";
import { tick } from "svelte";
import { mountSvelteComponent } from "@nextaction/svelte-mount";

void (async () => {
window.__destroyCount = 0;
window.__eventCount = 0;
window.__timerCount = 0;
const target = document.querySelector("#app");
const mounted = mountSvelteComponent(Fixture, { target, props: { message: "ready" } });
const text = target.querySelector("p")?.textContent || "";
const methodResult = mounted.instance.greet();
await tick();
window.dispatchEvent(new Event("na-probe"));
await new Promise((resolve) => setTimeout(resolve, 40));
await mounted.dispose();
await mounted.dispose();
window.dispatchEvent(new Event("na-probe"));
const timerCountAfterDispose = window.__timerCount;
await new Promise((resolve) => setTimeout(resolve, 40));
window.__NA_BROWSER_RESULT__({
    text,
    methodResult,
    destroyCount: window.__destroyCount,
    eventCount: window.__eventCount,
    timerCountAfterDispose: window.__timerCount === timerCountAfterDispose ? timerCountAfterDispose : -1,
    childCount: target.childElementCount,
});
})();`,
        },
    });

    // Regression: 重复销毁曾可能重复执行组件清理，并遗留监听器或定时器。
    assert.deepEqual(
        {
            text: result.text,
            methodResult: result.methodResult,
            destroyCount: result.destroyCount,
            eventCount: result.eventCount,
            childCount: result.childCount,
        },
        {
            text: "ready",
            methodResult: "hello ready",
            destroyCount: 1,
            eventCount: 1,
            childCount: 0,
        },
    );
    assert.ok(result.timerCountAfterDispose > 0);
});

test("异步组件在挂载完成前被销毁后不会写入脱离的宿主节点", async () => {
    const result = await runSvelteBrowserTest<{
        readyResult: null;
        childCount: number;
        destroyCount: number;
        optionCalls: number;
    }>({
        fixtureName: "svelte-mount-async-dispose",
        aliases: [{ find: "@nextaction/svelte-mount", replacement: mountAdapter }],
        files: {
            "Fixture.svelte": `<script>
import { onDestroy } from "svelte";
onDestroy(() => window.__destroyCount += 1);
</script>
<p>late mount</p>`,
            "main.js": `import { mountSvelteComponentAsync } from "@nextaction/svelte-mount";

void (async () => {
window.__destroyCount = 0;
const target = document.querySelector("#app");
let finishLoad;
let optionCalls = 0;
const loading = new Promise((resolve) => finishLoad = resolve);
const mounted = mountSvelteComponentAsync(() => loading, () => {
    optionCalls += 1;
    return { target, props: {} };
});
await mounted.dispose();
target.remove();
finishLoad(await import("./Fixture.svelte"));
const readyResult = await mounted.ready;
window.__NA_BROWSER_RESULT__({
    readyResult,
    childCount: target.childElementCount,
    destroyCount: window.__destroyCount,
    optionCalls,
});
})();`,
        },
    });

    // Regression: Dialog 在动态 import 完成前关闭后，组件曾延迟挂载到已脱离 DOM 的节点。
    assert.deepEqual(result, { readyResult: null, childCount: 0, destroyCount: 0, optionCalls: 0 });
});

test("主 Tab、桌面 Dock 和移动 Dock 渲染后可完整且幂等销毁", async () => {
    const registrarPath = resolve("src/frontend/controllers/panel-host-registrar.ts");
    const result = await runSvelteBrowserTest<{
        rendered: string[];
        mountCount: number;
        destroyCount: number;
        eventCount: number;
        timerStopped: boolean;
        remainingChildren: number;
    }>({
        fixtureName: "panel-host-lifecycle",
        aliases: (fixtureRoot) => [
            { find: "@nextaction/panel-host-registrar", replacement: registrarPath },
            {
                find: /\.\.\/components\/(?:NextActionApp|DockSidebar|MobileDockHost)\.svelte$/,
                replacement: join(fixtureRoot, "PanelFixture.svelte"),
            },
        ],
        virtualTimeBudget: 250,
        files: {
            "siyuan.js": `export async function openTab() {}`,
            "PanelFixture.svelte": `<script>
import { onDestroy, onMount } from "svelte";
export let bridge;
export let i18n;
let timer;
const onProbe = () => window.__panelEventCount += 1;
onMount(() => {
    window.__panelMountCount += 1;
    window.addEventListener("na-panel-probe", onProbe);
    timer = setInterval(() => window.__panelTimerCount += 1, 10);
});
onDestroy(() => {
    window.__panelDestroyCount += 1;
    window.removeEventListener("na-panel-probe", onProbe);
    clearInterval(timer);
});
</script>
<p>{bridge.label}:{i18n.title}</p>`,
            "main.js": `import { tick } from "svelte";
import { PanelHostRegistrar } from "@nextaction/panel-host-registrar";

void (async () => {
window.__panelMountCount = 0;
window.__panelDestroyCount = 0;
window.__panelEventCount = 0;
window.__panelTimerCount = 0;

function register(isMobile, label) {
    const registrations = { tabs: [], docks: [] };
    const plugin = {
        name: "nextaction",
        app: {},
        addIcons() {},
        addTab(config) { registrations.tabs.push(config); },
        addDock(config) { registrations.docks.push(config); },
        addTopBar() {},
    };
    const registrar = new PanelHostRegistrar(plugin, { title: label }, isMobile, () => ({ label }));
    registrar.register();
    return { registrar, registrations };
}

function initialise(config) {
    const element = document.createElement("section");
    document.body.appendChild(element);
    const host = { element };
    config.init.call(host);
    return { config, host, element };
}

const desktop = register(false, "desktop");
const mobile = register(true, "mobile");
const hosts = [
    initialise(desktop.registrations.tabs[0]),
    initialise(desktop.registrations.docks[0]),
    initialise(mobile.registrations.docks[0]),
];
await new Promise((resolve) => setTimeout(resolve, 20));
await tick();
const rendered = hosts.map(({ element }) => element.textContent.trim());
window.dispatchEvent(new Event("na-panel-probe"));
await new Promise((resolve) => setTimeout(resolve, 30));
for (const { config, host } of hosts) {
    config.destroy.call(host);
    config.destroy.call(host);
}
desktop.registrar.dispose();
mobile.registrar.dispose();
await tick();
window.dispatchEvent(new Event("na-panel-probe"));
const timerCount = window.__panelTimerCount;
await new Promise((resolve) => setTimeout(resolve, 30));

window.__NA_BROWSER_RESULT__({
    rendered,
    mountCount: window.__panelMountCount,
    destroyCount: window.__panelDestroyCount,
    eventCount: window.__panelEventCount,
    timerStopped: timerCount === window.__panelTimerCount,
    remainingChildren: hosts.reduce((count, { element }) => count + element.childElementCount, 0),
});
})();`,
        },
    });

    // Regression: Tab/Dock 重开曾可能遗留组件订阅、监听器或定时器，并在重复 destroy 时再次清理。
    assert.deepEqual(result, {
        rendered: ["desktop:desktop", "desktop:desktop", "mobile:mobile"],
        mountCount: 3,
        destroyCount: 3,
        eventCount: 3,
        timerStopped: true,
        remainingChildren: 0,
    });
});
