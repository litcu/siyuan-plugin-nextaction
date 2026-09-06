import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

test("项目编辑回调失效不会静默保存，恢复后可重试且层级拖放仍使用逻辑父级", async () => {
    const modulePath = (path: string) => JSON.stringify(resolve(path).replace(/\\/g, "/"));
    const result = await runSvelteBrowserTest({
        fixtureName: "project-editing",
        virtualTimeBudget: 4_000,
        files: {
            "siyuan.js": "export class Menu {}\nexport function openTab() {}\nexport function showMessage() {}\n",
            "Harness.svelte": `<script>
import ProjectHierarchyMode from ${modulePath("src/frontend/components/project/ProjectHierarchyMode.svelte")};
import ProjectStagePlan from ${modulePath("src/frontend/components/project/ProjectStagePlan.svelte")};
import { buildProjectControlState } from ${modulePath("src/shared/project-control.ts")};
import { buildProjectTreeModel } from ${modulePath("src/frontend/utils/project-tree.ts")};
import en from ${modulePath("src/i18n/en.json")};
const base = {
    identificationSource: 'native', status: 'todo', priority: 'medium', importance: 4, effort: 4,
    due: '', start: '', context: '', taskType: '1', order: 0, childIds: [], depends: '', depMode: 'all',
    sequential: false, repeat: '', repeatState: '', completed: '', note: '', outcome: '', dod: '',
    actionKind: 'action', created: '', tags: '', blocked: false, blockedReason: '', reviewInterval: 0,
    reviewDate: '', reminder: '', customFields: {}, sort: 0,
};
const project = { ...base, blockId: 'project', attrHostId: 'project', parentId: '',
    identificationSource: 'document', taskType: '2', title: 'Project', childIds: ['action', 'sibling'] };
let tasks = [
    { ...base, blockId: 'action', attrHostId: 'action', parentId: 'project', title: 'Action' },
    { ...base, blockId: 'sibling', attrHostId: 'sibling', parentId: 'project', title: 'Sibling', sort: 10 },
];
let available = true;
let calls = [];
let failReorder = true;
const i18n = { ...en, renameStage: 'Rename', retry: 'Retry', save: 'Save' };
const noop = () => {};
$: control = buildProjectControlState([project, ...tasks]);
$: model = buildProjectTreeModel(control.projects[0].summary, new Set(), { showCompleted: true });
async function rename(task, title) {
    calls = [...calls, { type: 'rename', blockId: task.blockId, title }];
    const updated = { ...task, title };
    tasks = tasks.map(entry => entry.blockId === task.blockId ? updated : entry);
    return updated;
}
async function reorder(blockId, parentId, afterId) {
    calls = [...calls, { type: 'reorder', blockId, parentId, afterId }];
    if (failReorder) { failReorder = false; throw new Error('reorder rejected'); }
    tasks = tasks.map(entry => entry.blockId === blockId ? { ...entry, parentId } : entry);
}
</script>
<button id="toggle" onclick={() => available = !available}>toggle callbacks</button>
<div id="state" data-calls={JSON.stringify(calls)}></div>
<section id="tree">
    <ProjectHierarchyMode {project} {model} {i18n} onEdit={noop} onStatusClick={noop} onContextMenu={noop}
        onToggleCollapse={noop} onTaskRename={available ? rename : undefined} onTaskReorder={available ? reorder : undefined} />
</section>
<section id="plan">
    <ProjectStagePlan {project} {model} {i18n} onRenameTask={available ? rename : undefined}
        onTaskReorder={available ? reorder : undefined} />
</section>`,
            "main.js": `import { mount, tick } from 'svelte';
import Harness from './Harness.svelte';
mount(Harness, { target: document.querySelector('#app') });
const pause = async () => { await tick(); await new Promise(resolve => setTimeout(resolve, 20)); };
const treeRow = title => [...document.querySelectorAll('#tree [role="treeitem"]')]
    .find(node => node.querySelector('.na-task-card__title')?.textContent.trim() === title);
const button = (root, label) => [...root.querySelectorAll('button')].find(node => node.textContent.trim() === label);
const calls = () => JSON.parse(document.querySelector('#state').dataset.calls);
void (async () => {
    await pause();
    const snapshots = [];
    for (const name of ['tree', 'plan']) {
        const root = document.querySelector('#' + name);
        if (name === 'tree') treeRow('Action').dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
        else button(root, 'Rename').click();
        await pause();
        const input = root.querySelector('form input');
        input.value = name === 'tree' ? 'Tree title' : 'Plan title';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#toggle').click(); await pause();
        const disabled = name === 'plan' ? [...root.querySelectorAll('select')].every(node => node.disabled) : !treeRow('Action').draggable;
        input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await pause();
        const error = root.querySelector('[role="alert"]')?.textContent || '';
        const draft = input.value;
        const beforeRetry = calls().length;
        document.querySelector('#toggle').click(); await pause();
        button(root, 'Retry').click(); await pause();
        snapshots.push({ name, disabled, error, draft, beforeRetry, afterRetry: calls().length,
            closed: !root.querySelector('form'), alertGone: !root.querySelector('[role="alert"]'),
            focused: root.contains(document.activeElement) });
    }
    const moving = treeRow('Plan title');
    const target = treeRow('Sibling');
    const rect = target.getBoundingClientRect();
    const dataTransfer = new DataTransfer();
    moving.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer, clientY: rect.top + rect.height / 2 }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
    await pause();
    const failedDrop = document.querySelector('#tree [role="alert"]')?.textContent || '';
    const resetDrag = !document.querySelector('.na-project-tree__row--dragging');
    button(document.querySelector('#tree'), 'Retry').click(); await pause();
    window.__NA_BROWSER_RESULT__({ snapshots, calls: calls(), failedDrop, resetDrag,
        retrySucceeded: !document.querySelector('#tree [role="alert"]'),
        focusedAfterDrop: document.activeElement === treeRow('Plan title'),
        nested: Number(treeRow('Plan title').getAttribute('aria-level')) > Number(treeRow('Sibling').getAttribute('aria-level')) });
})().catch(error => window.__NA_BROWSER_RESULT__({ error: String(error.stack || error) }));`,
        },
    });
    assert.equal(result.error, undefined);
    const snapshots = result.snapshots as Array<Record<string, unknown>>;
    assert.equal(snapshots.length, 2);
    for (const [index, snapshot] of snapshots.entries()) {
        assert.equal(snapshot.disabled, true);
        assert.match(String(snapshot.error), /Task rename is unavailable/);
        assert.equal(snapshot.draft, index === 0 ? "Tree title" : "Plan title");
        assert.equal(snapshot.beforeRetry, index);
        assert.equal(snapshot.afterRetry, index + 1);
        assert.equal(snapshot.closed, true);
        assert.equal(snapshot.alertGone, true);
        assert.equal(snapshot.focused, true);
    }
    assert.deepEqual(result.calls, [
        { type: "rename", blockId: "action", title: "Tree title" },
        { type: "rename", blockId: "action", title: "Plan title" },
        { type: "reorder", blockId: "action", parentId: "sibling" },
        { type: "reorder", blockId: "action", parentId: "sibling" },
    ]);
    assert.match(String(result.failedDrop), /reorder rejected/);
    assert.equal(result.resetDrag, true);
    assert.equal(result.retrySucceeded, true);
    assert.equal(result.focusedAfterDrop, true);
    assert.equal(result.nested, true);
});
