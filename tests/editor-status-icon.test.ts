import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/index.scss", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../src/frontend/ui/tokens.scss", import.meta.url), "utf8");
const start = source.indexOf(".protyle-wysiwyg [data-node-id][custom-na-task]");
const end = source.indexOf(".na-task-card--project", start);
const editorIconStyles = source.slice(start, end);

test("editor task status markers match the panel circular checkbox", () => {
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    assert.match(editorIconStyles, /border-radius:\s*50%/);
    assert.match(editorIconStyles, /border:\s*2px solid var\(--na-text-secondary\)/);
    assert.match(editorIconStyles, /border-style:\s*dashed/);
    assert.match(editorIconStyles, /top:\s*calc\(0\.5lh - 8px\)/);
    assert.doesNotMatch(editorIconStyles, /top:\s*50%/);
    assert.match(tokens, /:root\s*\{[\s\S]*--na-text-secondary:\s*var\(--b3-theme-on-surface-light\)/);
});
