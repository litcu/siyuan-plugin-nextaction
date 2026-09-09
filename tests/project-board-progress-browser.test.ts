import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

// Regression: 看板工具条用负边距叠到进度条上，未预留宽度且窄屏会重叠。
test("项目看板进度与控件宽屏同排、窄屏换行，其他视图保留独立进度", async () => {
    const source = (path: string) => JSON.stringify(resolve(path).replace(/\\/g, "/"));
    const result = await runSvelteBrowserTest({
        fixtureName: "project-board-progress",
        browserArgs: ["--window-size=1400,1000"],
        virtualTimeBudget: 4_000,
        files: {
            "siyuan.js":
                "export class Dialog {} export class Menu {} export function confirm() {} export function openTab() {} export function showMessage() {}",
            "Harness.svelte": `<script>
import ProjectView from ${source("src/frontend/components/ProjectView.svelte")};
import { taskStore } from ${source("src/frontend/stores/task-store.ts")};
import { ProjectDefinitionControllerRegistry } from ${source("src/frontend/controllers/project-definition-controller.ts")};
import zh from ${source("src/i18n/zh-CN.json")};
import en from ${source("src/i18n/en.json")};
import ${source("src/index.scss")};
const registry = new ProjectDefinitionControllerRegistry();
const noop = () => {};
let i18n = zh;
const base = {
    identificationSource: 'native', status: 'doing', priority: 'medium', importance: 4, effort: 4,
    due: '', start: '', context: '', taskType: '1', order: 0, childIds: [], depends: '', depMode: 'all',
    sequential: false, repeat: '', repeatState: '', completed: '', note: '', outcome: '', dod: '',
    actionKind: 'action', created: '', tags: '', blocked: false, blockedReason: '', reviewInterval: 0,
    reviewDate: '', reminder: '', customFields: {}, sort: 0,
};
for (const task of [
    { ...base, blockId: 'project', attrHostId: 'project', parentId: '', identificationSource: 'document', taskType: '2', title: '项目进度', childIds: ['action', 'done'] },
    { ...base, blockId: 'action', attrHostId: 'action', parentId: 'project', title: '进行中的任务' },
    { ...base, blockId: 'done', attrHostId: 'done', parentId: 'project', title: '已完成的任务', status: 'done' },
]) taskStore.applyUpdate(task);
</script>
<button id="english" onclick={() => i18n = en}>English</button>
<div class="nextaction" id="viewport">
    <ProjectView onEdit={noop} onStatusClick={noop} onContextMenu={noop} {i18n}
        onProjectBoardMove={noop}
        loadProjectSupport={async projectId => ({ projectId, items: [] })}
        projectDefinitionControllerRegistry={registry} />
</div>
<style>
    :global(body) { margin: 0; }
    #viewport { width: 1200px; height: 850px; container: nextaction-app / inline-size; }
</style>`,
            "main.js": `import { mount, tick } from 'svelte';
import Harness from './Harness.svelte';
mount(Harness, { target: document.querySelector('#app') });
const pause = async () => { await tick(); await new Promise(resolve => setTimeout(resolve, 50)); };
const rect = selector => document.querySelector(selector).getBoundingClientRect();
const switchMode = async label => {
    [...document.querySelectorAll('.na-segment-control__option')].find(node => node.textContent.trim() === label).click();
    await pause();
};
void (async () => {
    await pause();
    document.querySelector('#english').click();
    await pause();
    await switchMode('Board');
    const samples = [];
    for (const width of [1200, 820, 390]) {
        document.querySelector('#viewport').style.width = width + 'px';
        await pause();
        const progress = rect('.na-project-board__progress');
        const toolbar = rect('.na-project-board__toolbar');
        const header = rect('.na-project-board__header');
        const canvas = rect('.na-project-canvas');
        samples.push({
            width,
            count: document.querySelectorAll('.na-project-canvas > .na-project-canvas__progress, .na-project-board__progress').length,
            sameRow: Math.abs((progress.top + progress.bottom) - (toolbar.top + toolbar.bottom)) < 2,
            separated: progress.right <= toolbar.left || progress.bottom <= toolbar.top,
            insideHeader: toolbar.bottom <= header.bottom + 1 && toolbar.right <= header.right + 1,
            visibleBar: rect('.na-project-board__progress .na-progress__bar').width >= 60,
            columnsBelow: rect('.na-project-board__columns').top >= header.bottom,
            mobileFits: width !== 390 || header.right <= canvas.right,
            indexWidth: rect('.na-project-index').width,
        });
    }
    await switchMode('Hierarchy');
    window.__NA_BROWSER_RESULT__({ samples,
        standaloneProgress: document.querySelectorAll('.na-project-canvas > .na-project-canvas__progress').length,
        boardRemoved: !document.querySelector('.na-project-board'),
    });
})().catch(error => window.__NA_BROWSER_RESULT__({ error: String(error.stack || error) }));`,
        },
    });
    assert.equal(result.error, undefined);
    const samples = result.samples as Array<Record<string, number | boolean>>;
    for (const sample of samples) {
        assert.equal(sample.count, 1);
        assert.equal(sample.sameRow, sample.width !== 390);
        for (const key of ["separated", "insideHeader", "visibleBar", "columnsBelow", "mobileFits"]) {
            assert.equal(sample[key], true, `${sample.width}: ${key}`);
        }
        if (sample.width !== 390) assert.ok(Number(sample.indexWidth) >= 160 && Number(sample.indexWidth) <= 200);
    }
    assert.equal(result.standaloneProgress, 1);
    assert.equal(result.boardRemoved, true);
});
