<script lang="ts">
    import type { AiProposal, AiProposedTask } from "../../shared/ai";
    import type { KernelBridge } from "../kernel-bridge";
    import { taskStore } from "../stores/task-store";
    import { notifyError, notifyInfo } from "../notify";
    import NaBadge from "../ui/NaBadge.svelte";

    export let proposal: AiProposal;
    export let bridge: KernelBridge;
    export let i18n: any;
    export let dialog: any;
    export let onDone: (() => void) | undefined = undefined;
    export let myDayOnly = false;
    export let defaultDocumentId = "";
    export let childParentBlockId = "";
    export let childParentTitle = "";
    export let childFromSource = false;

    let selected = new Set<number>((proposal.tasks || proposal.myDay || []).map((_item, index) => index));
    let target = proposal.target?.type || "mcp_default";
    let documentId = proposal.target?.documentId || defaultDocumentId;
    let busy = false;
    $: tasks = proposal.tasks || [];
    $: proposalItems = proposal.feature === "planMyDay" ? (proposal.myDay || []) : tasks;
    $: selectedCount = proposalItems.filter((_item, index) => selected.has(index)).length;
    $: canUseSourceChild = childFromSource && !myDayOnly && tasks.length > 0 && tasks.every(item => !!item.sourceBlockId);
    $: if (target === "source_child" && !canUseSourceChild) target = "mcp_default";

    function toggle(index: number) {
        const next = new Set(selected);
        if (next.has(index)) next.delete(index); else next.add(index);
        selected = next;
    }

    function selectedProposal(): AiProposal {
        const selectedIndexes = tasks
            .map((_item, index) => index)
            .filter(index => selected.has(index));
        const indexMap = new Map(selectedIndexes.map((originalIndex, nextIndex) => [originalIndex, nextIndex]));
        const next: AiProposal = {
            ...proposal,
            target: myDayOnly ? undefined : {
                type: target as any,
                documentId: documentId || undefined,
                ...(target === "child" && childParentBlockId ? { parentBlockId: childParentBlockId } : {}),
            },
            tasks: selectedIndexes.map(originalIndex => {
                const item = tasks[originalIndex];
                const dependsOnIndexes = item.dependsOnIndexes
                    ?.map(index => indexMap.get(index))
                    .filter((index): index is number => index !== undefined);
                return {
                    ...item,
                    ...(dependsOnIndexes?.length ? { dependsOnIndexes } : { dependsOnIndexes: undefined }),
                };
            }),
            myDay: proposal.myDay?.filter((_item, index) => selected.has(index)),
        };
        return next;
    }

    async function apply() {
        if (busy) return;
        const next = selectedProposal();
        if (next.feature !== "planMyDay" && !next.tasks?.length) {
            dialog.destroy();
            return;
        }
        busy = true;
        try {
            const validation = await bridge.validateAiProposal(next);
            if (validation.errors.length) throw new Error(validation.errors.join("；"));
            const result = await bridge.applyAiProposal(next);
            if (result.warnings?.length) notifyInfo(result.warnings.join("；"));
            else notifyInfo(i18n?.aiApplied || "AI 建议已应用");
            taskStore.loadTasks();
            taskStore.loadMyDay();
            onDone?.();
            dialog.destroy();
        } catch (error: any) {
            notifyError(error?.message || String(error));
        } finally {
            busy = false;
        }
    }
</script>

<div class="nextaction na-ai-proposal">
    <div class="na-ai-proposal__intro">
        <div class="na-ai-proposal__eyebrow"><span class="na-ai-proposal__eyebrow-dot"></span>AI 建议 · 任务提取</div>
        <h3 class="na-ai-proposal__summary">{proposal.summary}</h3>
        <div class="na-ai-proposal__intro-meta">
            {(i18n?.aiDetectedItems || "Detected {count} items").replace("{count}", String(proposalItems.length))}
            <span>·</span>
            {(i18n?.aiSelectedItems || "{count} selected").replace("{count}", String(selectedCount))}
        </div>
        {#if proposal.warnings?.length}
            <div class="na-ai-proposal__warning">{proposal.warnings.join(" · ")}</div>
        {/if}
    </div>

    {#if proposal.feature === "planMyDay"}
        <div class="na-ai-proposal__section-title">{i18n?.aiSuggestedTasks || "建议加入今天"}</div>
        <div class="na-ai-proposal__list">
            {#each (proposal.myDay || []) as item, index}
                <label class="na-ai-proposal__row" class:na-ai-proposal__row--selected={selected.has(index)}>
                    <input type="checkbox" checked={selected.has(index)} on:change={() => toggle(index)} />
                    <span class="na-ai-proposal__row-copy">
                        <strong>{$taskStore.allTasks.find(task => task.blockId === item.blockId)?.title || item.blockId}</strong>
                        <small>{item.reason}</small>
                    </span>
                </label>
            {/each}
        </div>
    {:else}
        <div class="na-ai-proposal__section-title">{i18n?.aiChanges || "建议变更"}</div>
        <div class="na-ai-proposal__list">
            {#each tasks as item, index}
                <label class="na-ai-proposal__row" class:na-ai-proposal__row--selected={selected.has(index)}>
                    <input type="checkbox" checked={selected.has(index)} on:change={() => toggle(index)} />
                    <span class="na-ai-proposal__row-copy">
                        <strong>{item.title}</strong>
                        <small>{item.reason || (item.kind === "project" ? "项目" : "任务")}</small>
                    </span>
                    {#if item.due}<NaBadge text={item.due} />{/if}
                    {#if item.priority}<NaBadge text={item.priority} />{/if}
                </label>
            {/each}
        </div>
        <label class="na-ai-proposal__target">
            <span class="na-ai-proposal__target-label">
                <strong>{i18n?.aiWriteTarget || "创建落点"}</strong>
                <small>{i18n?.aiWriteTargetHint || "Written only after confirmation"}</small>
            </span>
            <select bind:value={target}>
                <option value="mcp_default">{i18n?.aiTargetDefault || "使用默认收集位置"}</option>
                {#if childParentBlockId}
                    <option value="child">{i18n?.aiTargetChild || "保存为父任务的子任务"}{childParentTitle ? ` · ${childParentTitle}` : ""}</option>
                {/if}
                {#if canUseSourceChild}
                    <option value="source_child">{i18n?.aiTargetSourceChild || "保存为来源块的子任务"}</option>
                {/if}
                <option value="current_document">{i18n?.aiTargetCurrentDocument || "当前文档"}</option>
                <option value="source_document">{i18n?.aiTargetSourceDocument || "来源文档"}</option>
                <option value="document">{i18n?.aiTargetDocument || "指定文档"}</option>
                <option value="original">{i18n?.aiTargetOriginal || "原位转换已有块"}</option>
            </select>
            {#if target === "document"}
                <input class="na-input" bind:value={documentId} placeholder="20260802120000-abcdefg" />
            {/if}
        </label>
    {/if}

    <div class="na-ai-proposal__actions">
        <button class="na-button na-button--ghost" on:click={() => dialog.destroy()} disabled={busy}>{i18n?.cancel || "取消"}</button>
        <button class="na-button na-button--primary" on:click={apply} disabled={busy}>
            {busy ? (i18n?.loading || "处理中…") : (i18n?.confirm || "确认应用")}
        </button>
    </div>
</div>

<style lang="scss">
    .na-ai-proposal {
        --na-ai-ink: var(--b3-theme-on-background);
        --na-ai-muted: var(--b3-theme-on-surface-secondary);
        --na-ai-line: var(--na-color-divider, var(--b3-border-color));
        padding: 18px 20px 16px;
        color: var(--na-ai-ink);
    }
    .na-ai-proposal__intro {
        padding: 0 0 13px;
        border-bottom: 1px solid var(--na-ai-line);
    }
    .na-ai-proposal__eyebrow {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--b3-theme-primary);
        font-size: 10px;
        letter-spacing: .12em;
        font-weight: 700;
        text-transform: uppercase;
    }
    .na-ai-proposal__eyebrow-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--b3-theme-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--b3-theme-primary) 15%, transparent);
    }
    .na-ai-proposal__summary {
        margin: 7px 0 0 !important;
        max-width: 100%;
        color: var(--na-ai-ink);
        font-size: 17px !important;
        line-height: 1.42 !important;
        font-weight: 620 !important;
        letter-spacing: -.01em;
    }
    .na-ai-proposal__intro-meta {
        display: flex;
        gap: 7px;
        margin-top: 7px;
        color: var(--na-ai-muted);
        font-size: 10px;
    }
    .na-ai-proposal__warning {
        margin-top: 8px;
        padding: 6px 8px;
        border-left: 2px solid var(--b3-theme-error);
        color: var(--b3-theme-error);
        background: color-mix(in srgb, var(--b3-theme-error) 8%, transparent);
        font-size: 11px;
        line-height: 1.4;
    }
    .na-ai-proposal__section-title {
        margin: 13px 1px 7px;
        color: var(--na-ai-muted);
        font-size: 10px;
        letter-spacing: .1em;
        font-weight: 650;
        text-transform: uppercase;
    }
    .na-ai-proposal__list {
        max-height: 320px;
        overflow: auto;
        display: grid;
        gap: 5px;
        padding: 6px;
        border: 1px solid color-mix(in srgb, var(--na-ai-line) 85%, transparent);
        border-radius: 8px;
        background: color-mix(in srgb, var(--b3-theme-surface) 92%, var(--b3-theme-background));
    }
    .na-ai-proposal__row {
        display: flex;
        align-items: center;
        gap: 9px;
        min-height: 52px;
        padding: 7px 9px;
        border: 1px solid color-mix(in srgb, var(--na-ai-line) 82%, transparent);
        border-radius: 7px;
        background: color-mix(in srgb, var(--b3-theme-surface) 94%, var(--b3-theme-primary) 6%);
        cursor: pointer;
        transition: border-color .16s, background .16s;
    }
    .na-ai-proposal__row:hover {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 45%, var(--na-ai-line));
        background: color-mix(in srgb, var(--b3-theme-primary) 8%, var(--b3-theme-surface));
    }
    .na-ai-proposal__row--selected {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 50%, var(--na-ai-line));
        background: color-mix(in srgb, var(--b3-theme-primary) 10%, var(--b3-theme-surface));
    }
    .na-ai-proposal__row input {
        width: 15px;
        height: 15px;
        margin: 0;
        flex: 0 0 15px;
        accent-color: var(--b3-theme-primary);
    }
    .na-ai-proposal__row-copy {
        flex: 1;
        min-width: 0;
        display: grid;
        gap: 3px;
    }
    .na-ai-proposal__row-copy strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--na-ai-ink);
        font-size: 12px;
        font-weight: 600;
    }
    .na-ai-proposal__row-copy small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--na-ai-muted);
        font-size: 10px;
        line-height: 1.35;
    }
    .na-ai-proposal__target {
        display: grid;
        gap: 6px;
        margin: 13px 0 0;
        padding: 10px;
        border: 1px solid color-mix(in srgb, var(--na-ai-line) 85%, transparent);
        border-radius: 8px;
        background: color-mix(in srgb, var(--b3-theme-surface) 94%, var(--b3-theme-background));
        color: var(--na-ai-muted);
        font-size: 11px;
    }
    .na-ai-proposal__target-label {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
    }
    .na-ai-proposal__target-label strong {
        color: var(--na-ai-ink);
        font-size: 11px;
        font-weight: 600;
    }
    .na-ai-proposal__target-label small {
        color: var(--na-ai-muted);
        font-size: 9px;
    }
    .na-ai-proposal__target select,
    .na-ai-proposal__target input {
        width: 100%;
        height: 30px;
        padding: 0 9px;
        border: 1px solid var(--na-ai-line);
        border-radius: 6px;
        outline: none;
        background: var(--b3-theme-surface);
        color: var(--na-ai-ink);
        font-size: 11px;
    }
    .na-ai-proposal__target select:focus,
    .na-ai-proposal__target input:focus {
        border-color: var(--b3-theme-primary);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--b3-theme-primary) 14%, transparent);
    }
    .na-ai-proposal__actions {
        display: flex;
        justify-content: flex-end;
        gap: 7px;
        padding-top: 13px;
    }
    .na-ai-proposal__actions .na-button {
        height: 28px;
        min-height: 28px;
        padding: 0 12px;
        border-radius: 6px;
        font-size: 11px;
    }
    .na-ai-proposal__actions .na-button--primary {
        min-width: 76px;
    }
</style>
