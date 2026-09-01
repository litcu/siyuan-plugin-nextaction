import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

// Regression: the production Svelte 5 config must preserve class-style startup mounts until all callers migrate.
test("生产 Svelte 配置兼容现有组件挂载与销毁 API", async () => {
    const result = await runSvelteBrowserTest({
        fixtureName: "svelte-component-api",
        prepareFixture(fixtureRoot) {
            writeFileSync(join(fixtureRoot, "Fixture.svelte"), "<script>export let message;</script><p>{message}</p>");
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import Fixture from "./Fixture.svelte";
const finish = (value) => {
    const result = document.createElement("pre");
    result.id = "browser-result";
    result.textContent = JSON.stringify(value);
    document.body.appendChild(result);
};
try {
    const component = new Fixture({ target: document.querySelector("#app"), props: { message: "ready" } });
    const text = document.querySelector("#app p")?.textContent;
    component.$destroy();
    finish({ text, childCount: document.querySelector("#app")?.childElementCount });
} catch (error) {
    finish({ error: String(error?.message || error) });
}`,
            );
        },
    });
    assert.deepEqual(result, { text: "ready", childCount: 0 });
});
