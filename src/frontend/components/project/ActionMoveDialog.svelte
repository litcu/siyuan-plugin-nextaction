<script lang="ts">
    import { onMount } from "svelte";
    import type { ActionMovePlacement, ActionMovePreview, ActionMoveResult } from "../../../shared/action-move";
    import {
        RPC_ERROR_ACTION_MOVE_NOT_MOVED,
        RPC_ERROR_ACTION_MOVE_RECOVERED,
        RPC_ERROR_ACTION_MOVE_RECOVERY_FAILED,
    } from "../../../shared/constants";
    import type { I18nStrings } from "../../../shared/i18n";
    import type { TaskCacheEntry } from "../../../shared/types";
    import type { KernelBridge } from "../../kernel-bridge";
    import { formatOperationError } from "../../error-format";
    import NaButton from "../../ui/NaButton.svelte";
    import NaDialogShell from "../../ui/NaDialogShell.svelte";
    import NaInlineNotice from "../../ui/NaInlineNotice.svelte";
    import NaSpinner from "../../ui/NaSpinner.svelte";

    export let bridge: KernelBridge;
    export let i18n: I18nStrings;
    export let task: TaskCacheEntry;
    export let project: TaskCacheEntry;
    export let onMoved: ((result: ActionMoveResult) => void) | undefined = undefined;
    export let onClose: (() => void) | undefined = undefined;

    let preview: ActionMovePreview | null = null;
    let loading = true;
    let moving = false;
    let error = "";
    let selectedPlacementId = "";

    onMount(loadPreview);

    async function loadPreview(): Promise<void> {
        loading = true;
        error = "";
        try {
            preview = await bridge.previewActionMove(task.blockId, project.blockId);
            selectedPlacementId =
                preview.placements.find(
                    (placement) =>
                        placement.destination.previousId === preview?.destination.previousId &&
                        placement.destination.nextId === preview?.destination.nextId,
                )?.id ||
                preview.placements[preview.placements.length - 1]?.id ||
                "";
        } catch (cause: unknown) {
            const detail = formatOperationError(cause, i18n);
            error = (i18n.moveActionPreviewFailed || "Cannot preview move: {error}").replace("{error}", detail);
        } finally {
            loading = false;
        }
    }

    function placementLabel(placement: ActionMovePlacement): string {
        if (placement.documentEnd) return i18n.moveActionDestinationEnd || "Project document end";
        if (!placement.previousTitle) {
            return i18n.moveActionDestinationStart || "Project document start";
        }
        return (i18n.moveActionDestinationBetween || "Between {previous} and {next}")
            .replace("{previous}", placement.previousTitle)
            .replace("{next}", placement.nextTitle);
    }

    function selectedPlacement(): ActionMovePlacement | undefined {
        return preview?.placements.find((placement) => placement.id === selectedPlacementId);
    }

    function moveFailureMessage(cause: unknown): string {
        const code = (cause as { code?: unknown } | null)?.code;
        if (code === RPC_ERROR_ACTION_MOVE_NOT_MOVED) return i18n.moveActionNotMoved;
        if (code === RPC_ERROR_ACTION_MOVE_RECOVERED) return i18n.moveActionRecovered;
        if (code === RPC_ERROR_ACTION_MOVE_RECOVERY_FAILED) return i18n.moveActionRecoveryFailed;
        return formatOperationError(cause, i18n);
    }

    async function submit(): Promise<void> {
        if (!preview || moving) return;
        moving = true;
        error = "";
        try {
            const result = await bridge.moveActionToProject(
                task.blockId,
                project.blockId,
                selectedPlacement()?.destination || preview.destination,
            );
            onMoved?.(result);
        } catch (cause: unknown) {
            error = moveFailureMessage(cause);
        } finally {
            moving = false;
        }
    }
</script>

<NaDialogShell
    variant="dialog"
    title={i18n.moveActionTitle || "Move Action"}
    subtitle={i18n.moveActionDescription || "Move the native Action and its full subtree."}
    closeLabel={i18n.close}
    onClose={() => onClose?.()}
>
    {#snippet notice()}
        <div>
            {#if error}<NaInlineNotice message={error} tone="error" />{/if}
        </div>
    {/snippet}

    <div class="na-action-move" aria-busy={loading || moving}>
        {#if loading}
            <div class="na-action-move__loading" role="status">
                <NaSpinner />
                <span>{i18n.loading}</span>
            </div>
        {:else if preview}
            <dl class="na-action-move__route">
                <div>
                    <dt>{i18n.moveActionSource || "Source"}</dt>
                    <dd>{preview.source.title}</dd>
                </div>
                <div>
                    <dt>{i18n.moveActionTarget || "Target"}</dt>
                    <dd>{preview.target.title}</dd>
                    <label for="na-action-move-destination">{i18n.moveActionDestination || "Destination"}</label>
                    <select
                        id="na-action-move-destination"
                        class="na-select"
                        bind:value={selectedPlacementId}
                        disabled={moving}
                    >
                        {#each preview.placements as placement (placement.id)}
                            <option value={placement.id}>{placementLabel(placement)}</option>
                        {/each}
                    </select>
                </div>
            </dl>
            <NaInlineNotice
                message={preview.explicitParentPreserved
                    ? i18n.moveActionParentUnchanged || "Explicit parent is preserved."
                    : preview.effectiveParentWillChange
                      ? i18n.moveActionParentChange || "Effective parent will change."
                      : i18n.moveActionEffectiveParentUnchanged || "Effective parent will not change."}
                tone={preview.effectiveParentWillChange ? "warning" : "info"}
            />
        {/if}
    </div>

    {#snippet footerStart()}
        <div>
            {#if !loading && !preview}
                <NaButton size="sm" disabled={moving} onclick={loadPreview}>{i18n.retry}</NaButton>
            {/if}
        </div>
    {/snippet}
    {#snippet footerEnd()}
        <div>
            <NaButton disabled={moving} onclick={() => onClose?.()}>{i18n.cancel}</NaButton>
            <NaButton variant="primary" loading={moving} disabled={!preview || loading} onclick={submit}
                >{i18n.moveActionConfirm || "Move to project document"}</NaButton
            >
        </div>
    {/snippet}
</NaDialogShell>

<style lang="scss">
    .na-action-move {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: var(--na-space-lg);
        padding: var(--na-space-lg);
    }
    .na-action-move__loading {
        display: flex;
        min-height: 96px;
        align-items: center;
        justify-content: center;
        gap: var(--na-space-sm);
        color: var(--na-text-secondary);
    }
    .na-action-move__route {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--na-space-md);
        margin: 0;
    }
    .na-action-move__route > div {
        min-width: 0;
        padding: var(--na-space-md);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        background: var(--b3-theme-background);
    }
    .na-action-move__route dt,
    .na-action-move__route label {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
    }
    .na-action-move__route dd {
        margin: var(--na-space-xs) 0;
        overflow-wrap: anywhere;
        color: var(--na-text-primary);
        font-weight: 600;
    }
    .na-action-move__route label {
        display: block;
        margin: var(--na-space-sm) 0 var(--na-space-xs);
    }
    @media (max-width: 420px) {
        .na-action-move {
            padding: var(--na-space-md);
        }
        .na-action-move__route {
            grid-template-columns: minmax(0, 1fr);
        }
    }
</style>
