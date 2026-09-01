import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

test("公共值控件直接回调最新领域值并保留键盘与 disabled 行为", async () => {
    const uiRoot = resolve("src/frontend/ui").replace(/\\/g, "/");
    const result = await runSvelteBrowserTest<{
        toggleValues: boolean[];
        segmentValues: string[];
        ratingValues: number[];
        searchValues: string[];
        toggleChecked: string | null;
        segmentChecked: string | null;
        buttonClicks: number;
    }>({
        fixtureName: "public-control-callbacks",
        files: {
            "Harness.svelte": `<script>
import NaToggle from ${JSON.stringify(`${uiRoot}/NaToggle.svelte`)};
import NaSegmentControl from ${JSON.stringify(`${uiRoot}/NaSegmentControl.svelte`)};
import NaDotRating from ${JSON.stringify(`${uiRoot}/NaDotRating.svelte`)};
import NaSearchInput from ${JSON.stringify(`${uiRoot}/NaSearchInput.svelte`)};
import NaButton from ${JSON.stringify(`${uiRoot}/NaButton.svelte`)};

let toggleValue = false;
let segmentValue = "first";
let ratingValue = 0;
let searchValue = "";
window.__controlValues = { toggle: [], segment: [], rating: [], search: [] };
window.__buttonClicks = 0;
</script>

<NaButton onclick={() => (window.__buttonClicks += 1)}>Save</NaButton>
<NaButton disabled onclick={() => (window.__buttonClicks += 1)}>Disabled</NaButton>
<NaToggle checked={toggleValue} label="Enabled toggle" onChange={(value) => {
    toggleValue = value;
    window.__controlValues.toggle.push(value);
}} />
<NaToggle checked={false} label="Disabled toggle" disabled onChange={(value) => window.__controlValues.toggle.push(value)} />
<NaSegmentControl
    value={segmentValue}
    options={[{ value: "first", label: "First" }, { value: "second", label: "Second" }]}
    onChange={(value) => {
        segmentValue = value;
        window.__controlValues.segment.push(value);
    }}
/>
<NaSegmentControl
    value="first"
    disabled
    options={[{ value: "first", label: "Disabled first" }, { value: "second", label: "Disabled second" }]}
    onChange={(value) => window.__controlValues.segment.push(value)}
/>
<NaDotRating count={3} value={ratingValue} onChange={(value) => {
    ratingValue = value;
    window.__controlValues.rating.push(value);
}} />
<NaSearchInput value={searchValue} ariaLabel="Search" onInput={(value) => {
    searchValue = value;
    window.__controlValues.search.push(value);
}} />`,
            "main.js": `import Harness from "./Harness.svelte";
import { mount, tick } from "svelte";

void (async () => {
mount(Harness, { target: document.querySelector("#app") });
await tick();
const toggles = document.querySelectorAll(".na-toggle");
document.querySelectorAll(".na-button")[0].click();
document.querySelectorAll(".na-button")[1].click();
toggles[0].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
toggles[1].click();
document.querySelectorAll(".na-segment-control")[0].querySelectorAll("button")[1].click();
document.querySelectorAll(".na-segment-control")[1].querySelectorAll("button")[1].click();
document.querySelectorAll(".na-dot-rating button")[1].click();
const search = document.querySelector("input[type=search]");
search.value = "current value";
search.dispatchEvent(new Event("input", { bubbles: true }));
await tick();
window.__NA_BROWSER_RESULT__({
    toggleValues: window.__controlValues.toggle,
    segmentValues: window.__controlValues.segment,
    ratingValues: window.__controlValues.rating,
    searchValues: window.__controlValues.search,
    toggleChecked: toggles[0].getAttribute("aria-checked"),
    segmentChecked: document.querySelectorAll(".na-segment-control")[0].querySelectorAll("button")[1].getAttribute("aria-checked"),
    buttonClicks: window.__buttonClicks,
});
})();`,
        },
    });

    // Regression: bind 与 legacy change/input dispatcher 共用时，调用方曾可能读到更新前的旧值。
    assert.deepEqual(result, {
        toggleValues: [true],
        segmentValues: ["second"],
        ratingValues: [2],
        searchValues: ["current value"],
        toggleChecked: "true",
        segmentChecked: "true",
        buttonClicks: 1,
    });
});

test("搜索、日期和文档选择器保留键盘、事件修饰符与领域值回调", async () => {
    const uiRoot = resolve("src/frontend/ui").replace(/\\/g, "/");
    const result = await runSvelteBrowserTest<{
        searchValues: Array<string | string[]>;
        searchEscapePrevented: boolean;
        searchDropdownClosed: boolean;
        searchParentClicks: number;
        dateValues: string[];
        dateEscapePrevented: boolean;
        dateDropdownClosed: boolean;
        dateInputValue: string;
        documentValues: Array<{ id: string; title: string } | null>;
        disabledDocumentResults: number;
    }>({
        fixtureName: "public-selector-callbacks",
        virtualTimeBudget: 1_500,
        files: {
            "Harness.svelte": `<script>
import NaSearchSelect from ${JSON.stringify(`${uiRoot}/NaSearchSelect.svelte`)};
import NaDatePicker from ${JSON.stringify(`${uiRoot}/NaDatePicker.svelte`)};
import NaDocumentPicker from ${JSON.stringify(`${uiRoot}/NaDocumentPicker.svelte`)};

let selected = "";
let date = "";
let documentValue = null;
let parentClicks = 0;
window.__selectorValues = { search: [], date: [], document: [], get parentClicks() { return parentClicks; } };
const bridge = {
    async searchMcpTargetDocuments() {
        return [{ id: "doc-1", title: "Project notes", notebookId: "box-1", notebookName: "Work", path: "/Project notes", icon: "" }];
    },
    async resolveMcpDocumentTarget(id) {
        return { id, title: "Project notes", path: "/Project notes" };
    },
};
</script>

<div id="search-parent" onclick={() => (parentClicks += 1)}>
    <NaSearchSelect
        selected={selected}
        selectedLabel={selected}
        allOptions={["Alpha", "Beta"]}
        onChange={(value) => {
            selected = Array.isArray(value) ? value[0] || "" : value;
            window.__selectorValues.search.push(value);
        }}
    />
</div>
<NaDatePicker value={date} onChange={(value) => {
    date = value;
    window.__selectorValues.date.push(value);
}} />
<NaDocumentPicker {bridge} i18n={{}} value={documentValue} onChange={(value) => {
    documentValue = value;
    window.__selectorValues.document.push(value ? { id: value.id, title: value.title } : null);
}} />
<div id="disabled-document"><NaDocumentPicker {bridge} i18n={{}} disabled /></div>`,
            "main.js": `import Harness from "./Harness.svelte";
import { mount, tick } from "svelte";

void (async () => {
mount(Harness, { target: document.querySelector("#app") });
await tick();
const searchBox = document.querySelector(".na-search-select__box");
searchBox.click();
await tick();
document.querySelector(".na-search-select__option").click();
await tick();
document.querySelector(".na-search-select__clear").click();
await new Promise((resolve) => setTimeout(resolve, 10));
const searchInput = document.querySelector(".na-search-select__input");
const searchEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
searchInput.dispatchEvent(searchEscape);
await tick();

const calendarButton = document.querySelector(".na-date-picker__calendar-button");
calendarButton.click();
await tick();
const dateEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
document.body.dispatchEvent(dateEscape);
await tick();
const dateInput = document.querySelector(".na-date-picker__input");
dateInput.value = "2026-09-15";
dateInput.dispatchEvent(new Event("input", { bubbles: true }));
dateInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
await tick();

const documentInputs = document.querySelectorAll(".na-document-picker input[type=search]");
documentInputs[0].value = "project";
documentInputs[0].dispatchEvent(new Event("input", { bubbles: true }));
documentInputs[1].click();
await new Promise((resolve) => setTimeout(resolve, 280));
document.querySelector(".na-document-picker__result").click();
await tick();
document.querySelector(".na-document-picker__selected .na-icon-button").click();
await tick();

window.__NA_BROWSER_RESULT__({
    searchValues: window.__selectorValues.search,
    searchEscapePrevented: searchEscape.defaultPrevented,
    searchDropdownClosed: !document.querySelector(".na-search-select__dropdown"),
    searchParentClicks: window.__selectorValues.parentClicks,
    dateValues: window.__selectorValues.date,
    dateEscapePrevented: dateEscape.defaultPrevented,
    dateDropdownClosed: !document.querySelector(".na-date-picker__dropdown"),
    dateInputValue: document.querySelector(".na-date-picker__input").value,
    documentValues: window.__selectorValues.document,
    disabledDocumentResults: document.querySelectorAll("#disabled-document .na-document-picker__result").length,
});

})();`,
        },
    });

    // Regression: legacy event modifiers迁移后，浮层点击和 Escape 曾可能向父级泄漏或丢失当前选择值。
    assert.deepEqual(result, {
        searchValues: ["Alpha", ""],
        searchEscapePrevented: true,
        searchDropdownClosed: true,
        searchParentClicks: 1,
        dateValues: ["2026-09-15"],
        dateEscapePrevented: true,
        dateDropdownClosed: true,
        dateInputValue: "2026/09/15",
        documentValues: [{ id: "doc-1", title: "Project notes" }, null],
        disabledDocumentResults: 0,
    });
});

test("链接、自定义字段和任务筛选控件通过 typed callback 传递领域值", async () => {
    const uiRoot = resolve("src/frontend/ui").replace(/\\/g, "/");
    const result = await runSvelteBrowserTest<{
        linkInputs: string[];
        openedLinks: string[];
        customValues: string[];
        filterSearches: string[];
    }>({
        fixtureName: "public-domain-callbacks",
        virtualTimeBudget: 1_500,
        files: {
            "siyuan.js": "export class Menu {}\nexport function openTab() {}\nexport function showMessage() {}",
            "Harness.svelte": `<script>
import NaLinkInput from ${JSON.stringify(`${uiRoot}/NaLinkInput.svelte`)};
import NaCustomFieldInput from ${JSON.stringify(`${uiRoot}/NaCustomFieldInput.svelte`)};
import NaTaskFilterBar from ${JSON.stringify(`${uiRoot}/NaTaskFilterBar.svelte`)};
const field = { version: 2, id: "field-1", key: "note", label: "Note", description: "", type: "text", status: "active", scope: { mode: "all" }, showOnCard: false };
let link = "";
let custom = "";
const filterState = { searchText: "", contexts: [], priorities: [], statuses: [], tags: [], customFieldFilters: [], sortBy: "order", sortAsc: false };
window.__domainValues = { linkInputs: [], openedLinks: [], customValues: [], filterSearches: [] };
</script>
<NaLinkInput value={link} onInput={(value) => { link = value; window.__domainValues.linkInputs.push(value); }} onOpen={(value) => window.__domainValues.openedLinks.push(value)} />
<NaCustomFieldInput def={field} value={custom} onChange={(value) => { custom = value; window.__domainValues.customValues.push(value); }} />
<NaTaskFilterBar {filterState} i18n={{}} onChange={(next) => window.__domainValues.filterSearches.push(next.searchText)} />`,
            "main.js": `import Harness from "./Harness.svelte";
import { mount, tick } from "svelte";
void (async () => {
mount(Harness, { target: document.querySelector("#app") });
await tick();
const linkInput = document.querySelector(".na-link-input__control");
linkInput.value = "https://example.com/docs";
linkInput.dispatchEvent(new Event("input", { bubbles: true }));
await tick();
document.querySelector(".na-link-input__open").click();
const customInput = document.querySelector('input[placeholder="Text"]');
customInput.value = "custom value";
customInput.dispatchEvent(new Event("input", { bubbles: true }));
const filterInput = document.querySelector(".na-task-filter-bar input[type=search]");
filterInput.value = "inbox";
filterInput.dispatchEvent(new Event("input", { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 350));
await tick();
window.__NA_BROWSER_RESULT__(window.__domainValues);
})();`,
        },
    });
    // Regression: 旧 CustomEvent 接线要求调用方读取 detail，且 bind/input 顺序可能暴露更新前的值。
    assert.deepEqual(result, {
        linkInputs: ["https://example.com/docs"],
        openedLinks: ["https://example.com/docs"],
        customValues: ["custom value"],
        filterSearches: ["inbox"],
    });
});
