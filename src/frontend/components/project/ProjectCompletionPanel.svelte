<script lang="ts">
    import type { I18nStrings } from "../../../shared/i18n";
    import type { ProjectSummary, TaskCacheEntry } from "../../../shared/types";
    import NaButton from "../../ui/NaButton.svelte";
    import NaInlineNotice from "../../ui/NaInlineNotice.svelte";

    interface Props {
        summary: ProjectSummary;
        i18n: I18nStrings;
        onConfirm?: (() => Promise<void>) | undefined;
        onSelectTask?: ((task: TaskCacheEntry) => void) | undefined;
    }

    let { summary, i18n, onConfirm = undefined, onSelectTask = undefined }: Props = $props();

    let busy = $state(false);
    let error = $state("");

    let missingDefinition = $derived(!summary.project.outcome.trim() || !summary.project.dod.trim());
    let definitionWarning = $derived(
        !summary.project.outcome.trim() && !summary.project.dod.trim()
            ? i18n?.projectCompletionMissingBoth || "Outcome and Definition of Done are not defined."
            : !summary.project.outcome.trim()
              ? i18n?.projectCompletionMissingOutcome || "Outcome is not defined."
              : !summary.project.dod.trim()
                ? i18n?.projectCompletionMissingDod || "Definition of Done is not defined."
                : "",
    );

    async function confirmCompletion() {
        if (!onConfirm || busy) return;
        busy = true;
        error = "";
        try {
            await onConfirm();
        } catch {
            error = i18n?.projectCompletionFailed || "Unable to complete the project. Try again.";
        } finally {
            busy = false;
        }
    }
</script>

<section
    class="na-project-completion"
    class:na-project-completion--empty={summary.empty}
    aria-labelledby="na-project-completion-title"
>
    <header>
        <div>
            <span class="na-project-completion__eyebrow">
                {summary.empty
                    ? i18n?.projectCompletionEmptyEyebrow || "No actions"
                    : i18n?.projectCompletionCandidateEyebrow || "Completion candidate"}
            </span>
            <h3 id="na-project-completion-title">
                {summary.empty
                    ? i18n?.projectCompletionEmptyTitle || "Close this project without actions?"
                    : i18n?.projectCompletionTitle || "This project may be complete"}
            </h3>
            <p>
                {summary.empty
                    ? i18n?.projectCompletionEmptyHint ||
                      "The project has not been broken down. Review its definition before closing it."
                    : i18n?.projectCompletionHint ||
                      "All leaf actions are complete. Review the intended result before confirming completion."}
            </p>
        </div>
        <NaButton variant="primary" loading={busy} disabled={!onConfirm} onclick={confirmCompletion}>
            {i18n?.projectConfirmComplete || "Confirm complete"}
        </NaButton>
    </header>

    {#if summary.empty}
        <NaInlineNotice
            tone="warning"
            message={i18n?.projectCompletionEmptyWarning ||
                "This project has no actions. Confirm only if closing it is intentional."}
        />
    {/if}
    {#if missingDefinition}
        <NaInlineNotice tone="warning" message={definitionWarning} />
    {/if}
    {#if error}
        <NaInlineNotice tone="error" message={error} />
    {/if}

    <div class="na-project-completion__definition">
        <article>
            <span>{i18n?.outcome || "Outcome"}</span>
            <p class:na-project-completion__missing={!summary.project.outcome.trim()}>
                {summary.project.outcome || i18n?.projectCompletionNotDefined || "Not defined"}
            </p>
        </article>
        <article>
            <span>{i18n?.definitionOfDone || "Definition of Done"}</span>
            <p class:na-project-completion__missing={!summary.project.dod.trim()}>
                {summary.project.dod || i18n?.projectCompletionNotDefined || "Not defined"}
            </p>
        </article>
    </div>

    {#if summary.incompleteNonLeafActions.length > 0}
        <div class="na-project-completion__non-leaf">
            <strong>{i18n?.projectCompletionOpenParents || "Parent actions still marked open"}</strong>
            <p>
                {i18n?.projectCompletionOpenParentsHint ||
                    "These items do not change leaf progress, but should be checked before closing."}
            </p>
            <div>
                {#each summary.incompleteNonLeafActions as task (task.blockId)}
                    <NaButton size="sm" disabled={!onSelectTask} onclick={() => onSelectTask?.(task)}>
                        {task.title}
                    </NaButton>
                {/each}
            </div>
        </div>
    {/if}
</section>

<style lang="scss">
    .na-project-completion {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 14px;
        padding: 12px;
        border: 1px solid var(--na-color-info-border);
        border-left: 3px solid var(--na-color-info);
        border-radius: var(--na-radius-md);
        background: var(--na-color-info-bg);
    }
    .na-project-completion--empty {
        border-color: var(--na-color-warning-border);
        border-left-color: var(--na-color-warning);
        background: var(--na-color-warning-bg);
    }
    .na-project-completion > header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
    }
    .na-project-completion__eyebrow,
    .na-project-completion__definition span {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        font-weight: 700;
    }
    .na-project-completion h3 {
        margin: 2px 0 3px;
        color: var(--na-text-primary);
        font-size: var(--na-font-size-lg);
    }
    .na-project-completion p {
        margin: 0;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
        line-height: 1.5;
    }
    .na-project-completion__definition {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
    }
    .na-project-completion__definition article {
        min-width: 0;
        padding: 8px 10px;
        border: 1px solid var(--na-color-divider);
        background: var(--b3-theme-surface);
    }
    .na-project-completion__definition p {
        margin-top: 4px;
        color: var(--na-text-primary);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }
    .na-project-completion__definition .na-project-completion__missing {
        color: var(--na-color-warning);
        font-style: italic;
    }
    .na-project-completion__non-leaf {
        padding-top: 2px;
    }
    .na-project-completion__non-leaf > strong {
        color: var(--na-text-primary);
        font-size: var(--na-font-size-sm);
    }
    .na-project-completion__non-leaf > div {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 7px;
    }
    @container nextaction-app (max-width: 620px) {
        .na-project-completion > header {
            flex-direction: column;
        }
        .na-project-completion__definition {
            grid-template-columns: 1fr;
        }
    }
</style>
