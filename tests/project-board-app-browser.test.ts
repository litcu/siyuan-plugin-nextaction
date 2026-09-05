import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

test("看板拖动与菜单共用专用写入并保留部分成功、失败和撤销反馈", async () => {
    const modulePath = (path: string) => JSON.stringify(resolve(path).replace(/\\/g, "/"));
    const result = await runSvelteBrowserTest({
        fixtureName: "project-board-app",
        timeout: 30_000,
        virtualTimeBudget: 8_000,
        files: {
            "siyuan.js": `
export const messages = [];
export class Dialog {}
export function confirm() {}
export function openTab() {}
export function showMessage(message, _timeout, type) { messages.push({ message, type }); }
export class Menu {
    items = [];
    addItem(item) { this.items.push(item); }
    addSeparator() {}
    open() {
        document.querySelector('#test-menu')?.remove();
        const menu = document.createElement('div');
        menu.id = 'test-menu';
        const add = (items, prefix = '') => {
            for (const item of items) {
                const label = prefix + item.label;
                if (item.submenu) { add(item.submenu, label + '/'); continue; }
                const button = document.createElement('button');
                button.dataset.menuLabel = label;
                button.textContent = label;
                button.onclick = () => { void item.click?.(); };
                menu.appendChild(button);
            }
        };
        add(this.items);
        document.body.appendChild(menu);
    }
}`,
            "Harness.svelte": `<script>
import NextActionApp from ${modulePath("src/frontend/components/NextActionApp.svelte")};
import NotificationHost from ${modulePath("src/frontend/components/NotificationHost.svelte")};
import { taskStore } from ${modulePath("src/frontend/stores/task-store.ts")};
import { dismissActionMoveUndo } from ${modulePath("src/frontend/stores/action-move-undo-store.ts")};
import en from ${modulePath("src/i18n/en.json")};
import { messages } from './siyuan.js';

const base = {
    identificationSource: 'native', status: 'todo', priority: 'medium', importance: 4, effort: 4,
    due: '', start: '', context: '', taskType: '1', order: 0, childIds: [], depends: '', depMode: 'all',
    sequential: false, repeat: '', repeatState: '', completed: '', note: '', outcome: '', dod: '',
    actionKind: 'action', created: '', tags: '', blocked: false, blockedReason: '', reviewInterval: 0,
    reviewDate: '', reminder: '', customFields: {}, sort: 0,
};
const project = { ...base, blockId: 'project', attrHostId: 'project', parentId: '',
    identificationSource: 'document', taskType: '2', title: 'Project', childIds: ['action', 'sibling', 'stage'] };
const action = { ...base, blockId: 'action', attrHostId: 'action', parentId: 'project', title: 'Action' };
const sibling = { ...base, blockId: 'sibling', attrHostId: 'sibling', parentId: 'project', title: 'Sibling', sort: 10 };
const stage = { ...base, blockId: 'stage', attrHostId: 'stage', parentId: 'project', title: 'Stage', actionKind: 'stage', sort: 20 };
let calls = [];
let undoCalls = [];
let forbiddenCalls = [];
let mode = 'success';
function reset(nextMode) {
    mode = nextMode;
    calls = [];
    undoCalls = [];
    forbiddenCalls = [];
    messages.length = 0;
    dismissActionMoveUndo();
    for (const task of [project, action, sibling, stage]) taskStore.applyUpdate(task);
}
reset(mode);
const bridge = {
    getProjectBoardPreferences: async () => ({ version: 1, projects: {} }),
    updateProjectBoardPreference: async () => ({ version: 1, projects: {} }),
    getProjectSupport: async () => ({ projectId: 'project', items: [] }),
    moveProjectBoardTask: async (input) => {
        calls = [...calls, input];
        if (mode === 'failure') throw new Error('move rejected');
        const field = input.groupBy === 'stage' ? {} : { [input.groupBy]: input.value };
        return {
            status: mode === 'partial' ? 'partial' : 'success',
            task: { ...action, ...field, title: 'Confirmed action' },
            reordered: mode === 'success',
            ...(mode === 'success' ? { undo: { credential: 'credential', taskId: 'action', summary: 'Board move' } } : {}),
        };
    },
    undoProjectBoardMove: async (credential) => {
        undoCalls = [...undoCalls, credential];
        return { task: action, summary: 'Restored action' };
    },
    updateTask: async () => { forbiddenCalls = [...forbiddenCalls, 'update']; throw new Error('unexpected update'); },
    reorderTask: async () => { forbiddenCalls = [...forbiddenCalls, 'reorder']; throw new Error('unexpected reorder'); },
};
const i18n = { ...en, byProject: 'Projects', projectViewBoard: 'Board', statusDoing: 'Doing',
    projectBoardMove: 'Board move', projectBoardMoveTop: 'Top', projectBoardMoveBottom: 'Bottom',
    projectBoardMovePartial: 'Partial move', moveActionUndo: 'Undo', priorityCritical: 'Critical' };
</script>
<button id="reset-success" onclick={() => reset('success')}>reset success</button>
<button id="reset-partial" onclick={() => reset('partial')}>reset partial</button>
<button id="reset-failure" onclick={() => reset('failure')}>reset failure</button>
<div id="calls" data-moves={JSON.stringify(calls)} data-undos={JSON.stringify(undoCalls)} data-forbidden={JSON.stringify(forbiddenCalls)}></div>
<NextActionApp {bridge} {i18n} />
<NotificationHost {bridge} {i18n} />`,
            "main.js": `import { mount, tick } from 'svelte';
import Harness from './Harness.svelte';
import { messages } from './siyuan.js';
mount(Harness, { target: document.querySelector('#app') });
const pause = async () => { await tick(); await new Promise(resolve => setTimeout(resolve, 30)); };
const card = title => [...document.querySelectorAll('.na-project-board__card')]
    .find(node => node.querySelector('.na-task-card__title')?.textContent.trim() === title);
const column = label => [...document.querySelectorAll('.na-project-board__column')]
    .find(node => node.querySelector('header')?.textContent.includes(label));
const button = label => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === label);
const readCalls = () => JSON.parse(document.querySelector('#calls').dataset.moves);
const snapshot = () => ({ calls: readCalls(), messages: [...messages], undo: Boolean(button('Undo')),
    confirmed: Boolean(card('Confirmed action')), reset: [...document.querySelectorAll('.na-project-board__card')]
        .every(node => node.draggable), forbidden: JSON.parse(document.querySelector('#calls').dataset.forbidden) });
const drop = async (label, target) => {
    const dataTransfer = new DataTransfer();
    card('Action').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    (target || column(label)).dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
    await pause();
};
const menuClick = async label => {
    card('Action').querySelector('.na-task-card').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    document.querySelector('[data-menu-label="' + label + '"]').click();
    await pause();
};
const setGroup = async value => {
    const select = document.querySelector('#na-project-board-group-by');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await pause();
};
const unhandled = [];
window.addEventListener('unhandledrejection', event => { unhandled.push(String(event.reason)); event.preventDefault(); });
void (async () => {
    await pause();
    document.querySelector('[aria-label="Projects"]').click();
    await pause();
    button('Board').click();
    await pause();
    const scenarios = [];
    for (const entry of ['drag', 'menu']) {
        for (const mode of ['success', 'partial', 'failure']) {
            document.querySelector('#reset-' + mode).click();
            await pause();
            if (entry === 'drag') await drop('Doing'); else await menuClick('Board move/Doing');
            const state = snapshot();
            if (mode === 'success') {
                button('Undo').click();
                await pause();
                state.restored = Boolean(card('Action'));
                state.undoCalls = JSON.parse(document.querySelector('#calls').dataset.undos);
            }
            scenarios.push({ entry, mode, ...state });
        }
    }
    const inputs = [];
    for (const position of ['Top', 'Bottom']) {
        document.querySelector('#reset-success').click(); await pause();
        await menuClick(position); inputs.push(readCalls()[0]);
    }
    document.querySelector('#reset-success').click(); await pause();
    await drop('', card('Sibling')); inputs.push(readCalls()[0]);
    for (const [group, label] of [['priority', 'Critical'], ['importance', '7'], ['stage', 'Stage']]) {
        document.querySelector('#reset-success').click(); await pause();
        await setGroup(group); await drop(label); inputs.push(readCalls()[0]);
    }
    window.__NA_BROWSER_RESULT__({ scenarios, inputs, unhandled });
})().catch(error => window.__NA_BROWSER_RESULT__({ error: String(error.stack || error) }));`,
        },
    });
    assert.equal(result.error, undefined);
    const scenarios = result.scenarios as Array<Record<string, unknown>>;
    assert.equal(scenarios.length, 6);
    for (const scenario of scenarios) {
        const calls = scenario.calls as Array<Record<string, unknown>>;
        assert.equal(calls.length, 1);
        assert.equal(calls[0].taskId, "action");
        assert.equal(calls[0].projectId, "project");
        assert.equal(calls[0].groupBy, "status");
        assert.equal(calls[0].value, "doing");
        assert.deepEqual(scenario.forbidden, []);
        assert.equal(scenario.reset, true);
        assert.equal(scenario.confirmed, scenario.mode !== "failure");
        assert.equal(scenario.undo, scenario.mode === "success");
        const messages = scenario.messages as Array<{ message: string; type: string }>;
        if (scenario.mode === "success") {
            assert.deepEqual(messages, []);
            assert.equal(scenario.restored, true);
            assert.deepEqual(scenario.undoCalls, ["credential"]);
        } else {
            assert.equal(messages.length, 1);
            assert.equal(messages[0].type, scenario.mode === "partial" ? "info" : "error");
            assert.match(messages[0].message, scenario.mode === "partial" ? /Partial move/ : /move rejected/);
        }
    }
    const inputs = result.inputs as Array<Record<string, unknown>>;
    assert.equal(inputs[0].afterId, "sibling");
    assert.equal(inputs[1].afterId, undefined);
    assert.equal(inputs[2].afterId, "sibling");
    assert.equal(inputs[2].afterParentId, "project");
    assert.deepEqual([...(inputs[2].visibleTaskIds as string[])].sort(), ["action", "sibling", "stage"]);
    assert.deepEqual(
        inputs.slice(3).map(({ groupBy, value }) => ({ groupBy, value })),
        [
            { groupBy: "priority", value: "critical" },
            { groupBy: "importance", value: 7 },
            { groupBy: "stage", value: "stage" },
        ],
    );
    assert.deepEqual(result.unhandled, []);
});
