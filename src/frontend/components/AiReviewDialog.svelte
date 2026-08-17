<script lang="ts">
    import type { AiProposal } from "../../shared/ai";
    import type { TaskCacheEntry } from "../../shared/types";
    import { taskStore } from "../stores/task-store";
    import { jumpToBlock } from "../utils";
    export let proposal: AiProposal;
    export let i18n: any;
    export let dialog: any;
    export let reviewTasks: TaskCacheEntry[] = [];

    // 回顾提案只传递稳定的 blockId；展示层从任务缓存解析标题，避免把内部 ID 暴露给用户。
    $: taskMap = new Map([...$taskStore.allTasks, ...reviewTasks].map((task) => [task.blockId, task]));

    function taskLabel(blockId: string): string {
        return taskMap.get(blockId)?.title || i18n?.aiTaskUnavailable || "任务未加载";
    }

    function taskTitle(blockId: string): string {
        return taskMap.get(blockId)?.title || blockId;
    }

    function openBlock(blockId: string) {
        if (!blockId) return;
        jumpToBlock(blockId);
    }
</script>

<div class="nextaction na-ai-review">
    <div class="na-ai-review__intro">
        <span class="na-ai-review__eyebrow">{i18n?.aiReviewEyebrow || "NEXTACTION / REVIEW"}</span>
        <h3>{proposal.review?.summary || proposal.summary}</h3>
        <p>{i18n?.aiReviewReadOnly || "This is a read-only review; tasks will not be modified automatically."}</p>
    </div>
    <div class="na-ai-review__content">
        <div class="na-ai-review__groups">
            {#each proposal.review?.groups || [] as group}
                <section class="na-ai-review__group">
                    <div class="na-ai-review__group-head">
                        <strong>{group.title || group.key}</strong>
                        <span class="na-ai-review__count">{group.blockIds.length}</span>
                    </div>
                    {#if group.summary}<p>{group.summary}</p>{/if}
                    {#if group.blockIds.length}
                        <div class="na-ai-review__block-links">
                            {#each group.blockIds as blockId}
                                <button
                                    class="na-ai-review__block-link b3-tooltips b3-tooltips__e"
                                    aria-label={taskTitle(blockId)}
                                    on:click={() => openBlock(blockId)}>{taskLabel(blockId)}</button
                                >
                            {/each}
                        </div>
                    {:else}
                        <div class="na-ai-review__empty">{i18n?.aiReviewNoItems || "当前没有需要处理的任务"}</div>
                    {/if}
                </section>
            {/each}
        </div>
        {#if proposal.review?.actions?.length}
            <div class="na-ai-review__actions-list">
                <div class="na-ai-review__label">{i18n?.aiReviewSuggestions || "建议"}</div>
                {#each proposal.review.actions as action}
                    <button class="na-ai-review__action" on:click={() => openBlock(action.blockId)}>
                        <span class="na-ai-review__action-mark">↗</span>
                        <span class="na-ai-review__action-copy">
                            <strong>{action.action}</strong>
                            <span>{action.reason}</span>
                            <small class="b3-tooltips b3-tooltips__n" aria-label={taskTitle(action.blockId)}
                                >{taskLabel(action.blockId)}</small
                            >
                        </span>
                    </button>
                {/each}
            </div>
        {/if}
    </div>
    <div class="na-ai-review__footer">
        <span class="na-ai-review__footer-hint"
            >{i18n?.aiReviewReadOnly || "This is a read-only review; tasks will not be modified automatically."}</span
        >
        <button class="na-button na-button--primary" on:click={() => dialog.destroy()}>{i18n?.done || "完成"}</button>
    </div>
</div>

<style lang="scss">
    .na-ai-review {
        --na-ai-ink: var(--b3-theme-on-background);
        --na-ai-muted: var(--na-text-secondary);
        --na-ai-line: var(--na-color-divider, var(--b3-border-color));
        display: flex;
        flex-direction: column;
        max-height: none;
        min-height: 0;
        padding: 20px 22px 16px;
        color: var(--na-ai-ink);
    }
    .na-ai-review__intro {
        flex: 0 0 auto;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--na-ai-line);
    }
    .na-ai-review__eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: var(--b3-theme-primary);
        font-size: 10px;
        letter-spacing: 0.14em;
        font-weight: 750;
    }
    .na-ai-review__eyebrow::before {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--b3-theme-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--b3-theme-primary) 15%, transparent);
        content: "";
    }
    h3 {
        margin: 8px 0 6px;
        color: var(--na-ai-ink);
        font-size: 18px;
        line-height: 1.34;
        letter-spacing: -0.01em;
        font-weight: 650;
    }
    p {
        margin: 0;
        color: var(--na-ai-muted);
        font-size: 12px;
        line-height: 1.55;
    }
    .na-ai-review__content {
        flex: 0 0 auto;
        min-height: 0;
        overflow: visible;
        padding: 14px 3px 2px 0;
    }
    .na-ai-review__groups {
        display: grid;
        gap: 10px;
    }
    .na-ai-review__group {
        padding: 13px 14px 12px;
        border: 1px solid color-mix(in srgb, var(--na-ai-line) 90%, transparent);
        border-radius: 11px;
        background: color-mix(in srgb, var(--b3-theme-surface) 94%, var(--b3-theme-primary) 6%);
        box-shadow: 0 1px 0 color-mix(in srgb, var(--b3-theme-on-background) 4%, transparent);
    }
    .na-ai-review__group:hover {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 42%, var(--na-ai-line));
    }
    .na-ai-review__group-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
    }
    .na-ai-review__group-head strong {
        color: var(--na-ai-ink);
        font-size: 13px;
        font-weight: 650;
    }
    .na-ai-review__count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 22px;
        height: 20px;
        padding: 0 6px;
        border: 1px solid color-mix(in srgb, var(--b3-theme-primary) 35%, var(--na-ai-line));
        border-radius: 999px;
        background: color-mix(in srgb, var(--b3-theme-primary) 12%, transparent);
        color: var(--b3-theme-primary);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
    }
    .na-ai-review__group p {
        margin-top: 6px;
    }
    .na-ai-review__block-links {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 10px;
    }
    .na-ai-review__block-link {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border: 1px solid color-mix(in srgb, var(--b3-theme-primary) 22%, var(--na-ai-line));
        border-radius: 6px;
        padding: 4px 8px;
        background: color-mix(in srgb, var(--b3-theme-primary) 8%, var(--b3-theme-surface));
        color: var(--b3-theme-primary);
        cursor: pointer;
        font-size: 11px;
        line-height: 1.2;
        transition:
            background 0.16s,
            border-color 0.16s,
            transform 0.16s;
    }
    .na-ai-review__block-link:hover {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 55%, var(--na-ai-line));
        background: color-mix(in srgb, var(--b3-theme-primary) 15%, var(--b3-theme-surface));
        transform: translateY(-1px);
    }
    .na-ai-review__empty {
        margin-top: 8px;
        color: var(--na-ai-muted);
        font-size: 11px;
    }
    .na-ai-review__actions-list {
        display: grid;
        gap: 8px;
        margin-top: 18px;
    }
    .na-ai-review__label {
        margin-bottom: 1px;
        color: var(--na-ai-muted);
        font-size: 10px;
        letter-spacing: 0.12em;
        font-weight: 700;
        text-transform: uppercase;
    }
    .na-ai-review__action {
        display: grid;
        grid-template-columns: 24px minmax(0, 1fr);
        gap: 9px;
        width: 100%;
        padding: 11px 12px 11px 10px;
        border: 1px solid color-mix(in srgb, var(--na-ai-line) 88%, transparent);
        border-left: 3px solid color-mix(in srgb, var(--b3-theme-primary) 70%, var(--na-ai-line));
        border-radius: 9px;
        background: color-mix(in srgb, var(--b3-theme-surface) 96%, var(--b3-theme-primary) 4%);
        color: inherit;
        text-align: left;
        cursor: pointer;
        font-size: 12px;
        transition:
            border-color 0.16s,
            background 0.16s,
            transform 0.16s;
    }
    .na-ai-review__action:hover {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 48%, var(--na-ai-line));
        background: color-mix(in srgb, var(--b3-theme-primary) 9%, var(--b3-theme-surface));
        transform: translateY(-1px);
    }
    .na-ai-review__action-mark {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 6px;
        background: color-mix(in srgb, var(--b3-theme-primary) 13%, transparent);
        color: var(--b3-theme-primary);
        font-size: 14px;
    }
    .na-ai-review__action-copy {
        display: grid;
        min-width: 0;
        gap: 3px;
    }
    .na-ai-review__action-copy strong {
        color: var(--na-ai-ink);
        font-size: 12px;
        font-weight: 650;
        line-height: 1.4;
    }
    .na-ai-review__action-copy span {
        color: var(--na-ai-muted);
        line-height: 1.45;
    }
    .na-ai-review__action-copy small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--b3-theme-primary);
        font-size: 10px;
    }
    .na-ai-review__footer {
        position: sticky;
        bottom: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex: 0 0 auto;
        margin: 0 -22px -16px;
        padding: 14px 22px 16px;
        border-top: 1px solid var(--na-ai-line);
        background: color-mix(in srgb, var(--na-ai-dialog-bg, var(--b3-theme-background)) 94%, transparent);
        backdrop-filter: blur(8px);
    }
    .na-ai-review__footer-hint {
        color: var(--na-ai-muted);
        font-size: 10px;
    }
</style>
