<script lang="ts">
    import type { I18nStrings } from "../../shared/i18n";
    import type { ActionMoveUndoFeedback } from "../stores/action-move-undo-store";
    import NaButton from "../ui/NaButton.svelte";
    import NaIconButton from "../ui/NaIconButton.svelte";
    import NaInlineNotice from "../ui/NaInlineNotice.svelte";

    export let feedback: ActionMoveUndoFeedback;
    export let i18n: I18nStrings;
    export let onUndo: () => void;
    export let onDismiss: () => void;
</script>

<section class="na-action-move-undo" role="status" aria-live="polite" aria-atomic="true">
    <header>
        <strong
            >{feedback.kind === "projectBoard"
                ? i18n.projectBoardMoveSuccess || "Task moved"
                : i18n.moveActionUndoTitle || "Action moved"}</strong
        >
        <NaIconButton symbol="iconCloseRound" label={i18n.close || "Close"} size={14} compact onclick={onDismiss} />
    </header>
    <p>{feedback.status === "success" ? feedback.resultSummary : feedback.undo.summary}</p>
    {#if feedback.status === "success"}
        <NaInlineNotice
            message={feedback.kind === "projectBoard"
                ? i18n.projectBoardMoveUndoSuccess || "Move undone."
                : i18n.moveActionUndoSuccess || "Move undone."}
            tone="success"
        />
    {:else if feedback.status === "error"}
        <NaInlineNotice message={feedback.error} tone="error" />
    {:else}
        <div class="na-action-move-undo__actions">
            <NaButton size="sm" variant="primary" loading={feedback.status === "working"} onclick={onUndo}
                >{i18n.moveActionUndo || "Undo move"}</NaButton
            >
            <kbd>{i18n.moveActionUndoShortcut || "Ctrl/⌘+Z"}</kbd>
        </div>
    {/if}
</section>

<style lang="scss">
    .na-action-move-undo {
        pointer-events: auto;
        display: flex;
        width: min(340px, calc(100vw - 32px));
        box-sizing: border-box;
        flex-direction: column;
        gap: var(--na-space-md);
        padding: var(--na-space-lg);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        color: var(--na-text-primary);
        background: var(--b3-theme-surface);
        box-shadow: var(--na-shadow-toast);
    }
    header,
    .na-action-move-undo__actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--na-space-md);
    }
    p {
        margin: 0;
        overflow-wrap: anywhere;
        font-size: var(--na-font-size-md);
        line-height: 1.5;
    }
    kbd {
        color: var(--na-text-secondary);
        font: inherit;
        font-size: var(--na-font-size-sm);
    }
</style>
