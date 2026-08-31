import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

type SearchSelectMetrics = {
    clientWidth: number;
    scrollWidth: number;
    boxClientWidth: number;
    boxScrollWidth: number;
    overflow: boolean;
};

// Regression: 多选搜索框的选项总宽度超过控件宽度时不得横向溢出。
test("多选搜索框会在固定宽度内容纳过长选项", async () => {
    const metrics = await runSvelteBrowserTest<SearchSelectMetrics>({
        fixtureName: "search-select",
        indexHtml:
            '<!doctype html><html><body><div id="control"></div><script type="module" src="./main.js"></script></body></html>',
        prepareFixture(fixtureRoot) {
            const componentPath = resolve("src/frontend/ui/NaSearchSelect.svelte").replace(/\\/g, "/");
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import NaSearchSelect from ${JSON.stringify(componentPath)};
const control = document.querySelector("#control");
control.style.width = "394px";
new NaSearchSelect({
    target: control,
    props: {
        multi: true,
        selected: ["上下文上下文", "下上下文下上下文", "中中中中中中", "第四个上下文"],
        removeLabel: "移除",
    },
});
const box = control.querySelector(".na-search-select__box");
const result = document.createElement("pre");
result.id = "browser-result";
result.textContent = JSON.stringify({
    clientWidth: control.clientWidth,
    scrollWidth: control.scrollWidth,
    boxClientWidth: box.clientWidth,
    boxScrollWidth: box.scrollWidth,
    overflow: control.scrollWidth > control.clientWidth,
});
document.body.appendChild(result);`,
            );
        },
    });
    assert.equal(metrics.overflow, false, `多选框发生横向溢出：${JSON.stringify(metrics)}`);
});
