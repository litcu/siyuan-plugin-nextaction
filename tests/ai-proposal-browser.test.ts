import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

type AiProposalBrowserResult = {
    viewportWidth: number;
    beforeConfirm: number;
    titleInputFound: boolean;
    disabledWithEmptyTitle: boolean;
    partialVisible: boolean;
    destroyedAfterPartial: number;
    validateCalls: Array<{ context: { sourceBlockIds: string[] } }>;
    applyCalls: Array<{ proposal: { tasks: unknown[] }; context: unknown }>;
    destroyed: number;
    notifications: string[];
};

test("AI Action 预览支持编辑与选择，确认前不写入", async () => {
    const result = await runSvelteBrowserTest<AiProposalBrowserResult>({
        fixtureName: "ai-proposal",
        browserArgs: ["--window-size=390,844"],
        prepareFixture(fixtureRoot) {
            const componentPath = resolve("src/frontend/components/AiProposalDialog.svelte").replace(/\\/g, "/");
            writeFileSync(
                join(fixtureRoot, "siyuan.js"),
                `export const messages = [];
export class Menu {}
export function openTab() {}
export function showMessage(message) { messages.push(message); }
`,
            );
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import AiProposalDialog from ${JSON.stringify(componentPath)};

const firstSourceId = "20260825191000-source1";
const secondSourceId = "20260825191001-source2";
const defaultProjectId = "20260825191002-project";
const sourceBlockIds = [firstSourceId, secondSourceId];
const proposal = {
    feature: "extractTasks", summary: "Choose Actions", target: { type: "mcp_default" },
    tasks: [
        { title: "Draft title", sourceBlockId: firstSourceId, actionKind: "action" },
        { title: "Skip this", sourceBlockId: secondSourceId, actionKind: "action" },
    ],
};
const i18n = new Proxy({
    aiChanges: "Suggested changes", aiDetectedItems: "Detected {count} items", aiSelectedItems: "{count} selected",
    aiWriteTarget: "Creation target", aiWriteTargetHint: "Written only after confirmation", aiTargetDefault: "Default",
    aiTargetSourceChild: "Source child", aiTargetCurrentDocument: "Current document", aiTargetSourceDocument: "Source document",
    aiTargetDocument: "Specific document", aiTargetOriginal: "Convert in place", aiCandidateTitle: "Action title",
    aiProposalKindTask: "Action", aiProposalEyebrow: "AI Proposal", cancel: "Cancel", confirm: "Confirm",
    loading: "Loading", aiRetryFailed: "Retry failed", aiItemFailed: "Not applied",
    aiRetryAvailable: "Can retry", aiPartialSummary: "{count} suggestions need attention", aiItemCreated: "Action created",
}, { get: (target, key) => target[key] || String(key) });
let validateCalls = [];
let applyCalls = [];
let destroyed = 0;
const dialog = { destroy: () => (destroyed += 1) };
const bridge = {
    async validateAiProposal(next, context) {
        validateCalls = [...validateCalls, { proposal: next, context }];
        return { proposal: next, errors: [] };
    },
    async applyAiProposal(next, context) {
        applyCalls = [...applyCalls, { proposal: next, context }];
        if (applyCalls.length === 1) {
            return {
                feature: "extractTasks", created: [], converted: [], myDay: null, warnings: [],
                items: [{
                    index: 0, sourceBlockId: firstSourceId, target: "mcp_default", status: "failed",
                    error: "temporary write failure", retryable: true,
                }],
            };
        }
        return {
            feature: "extractTasks", created: [], converted: [], myDay: null, warnings: [],
            items: [{ index: 0, sourceBlockId: firstSourceId, target: "mcp_default", status: "created", retryable: false }],
        };
    },
};
</script>

<div id="harness" data-validates={JSON.stringify(validateCalls)} data-applies={JSON.stringify(applyCalls)} data-destroyed={destroyed}>
    <AiProposalDialog {proposal} {bridge} {i18n} {dialog} {sourceBlockIds} {defaultProjectId} />
</div>`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import Harness from "./Harness.svelte";
import { messages } from "siyuan";
import { mount } from "svelte";
mount(Harness, { target: document.querySelector("#app") });
const finish = (value) => {
    const result = document.createElement("pre");
    result.id = "browser-result";
    result.textContent = JSON.stringify(value);
    document.body.appendChild(result);
};
setTimeout(() => {
    const harness = document.querySelector("#harness");
    const beforeConfirm = JSON.parse(harness?.dataset.applies || "[]").length;
    const title = document.querySelector(".na-ai-proposal__title-input");
    if (title) {
        title.value = "";
        title.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setTimeout(() => {
        const confirmButton = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Confirm");
        const disabledWithEmptyTitle = Boolean(confirmButton?.disabled);
        if (title) {
            title.value = "Edited Action";
            title.dispatchEvent(new Event("input", { bubbles: true }));
        }
        const checkboxes = [...document.querySelectorAll('.na-ai-proposal__row input[type="checkbox"]')];
        checkboxes[1]?.click();
        setTimeout(() => {
            confirmButton?.click();
            setTimeout(() => {
                const partialVisible = document.body.textContent.includes("Not applied") &&
                    document.body.textContent.includes("Can retry");
                const destroyedAfterPartial = Number(harness?.dataset.destroyed || 0);
                [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Retry failed")?.click();
                setTimeout(() => {
                    finish({
                        viewportWidth: window.innerWidth,
                        beforeConfirm,
                        titleInputFound: Boolean(title),
                        disabledWithEmptyTitle,
                        partialVisible,
                        destroyedAfterPartial,
                        validateCalls: JSON.parse(harness?.dataset.validates || "[]"),
                        applyCalls: JSON.parse(harness?.dataset.applies || "[]"),
                        destroyed: Number(harness?.dataset.destroyed || 0),
                        notifications: messages,
                    });
                }, 100);
            }, 100);
        }, 100);
    }, 50);
}, 50);`,
            );
        },
    });
    assert.ok(result.viewportWidth >= 390 && result.viewportWidth <= 500);
    assert.equal(result.beforeConfirm, 0);
    assert.equal(result.titleInputFound, true);
    assert.equal(result.disabledWithEmptyTitle, true);
    assert.equal(result.partialVisible, true);
    assert.equal(result.destroyedAfterPartial, 0);
    assert.equal(result.validateCalls.length, 2);
    assert.deepEqual(result.validateCalls[0].context.sourceBlockIds, [
        "20260825191000-source1",
        "20260825191001-source2",
    ]);
    const expectedTask = {
        title: "Edited Action",
        sourceBlockId: "20260825191000-source1",
        actionKind: "action",
        parentId: "20260825191002-project",
    };
    assert.deepEqual(result.applyCalls[0].proposal.tasks, [expectedTask]);
    assert.deepEqual(result.applyCalls[1].proposal.tasks, [expectedTask]);
    assert.deepEqual(result.applyCalls[0].context, result.validateCalls[0].context);
    assert.deepEqual(result.applyCalls[1].context, result.validateCalls[1].context);
    assert.equal(result.destroyed, 1);
    // Regression: AI 建议成功应用后，列表刷新和对话框关闭已提供充分反馈，不应再弹成功消息。
    assert.deepEqual(result.notifications, []);
});
