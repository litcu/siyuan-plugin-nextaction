<script lang="ts">
    import type { I18nStrings } from "../../../shared/i18n";
    import type { ProjectSupportData, ProjectSupportDirection } from "../../../shared/types";
    import NaBadge from "../../ui/NaBadge.svelte";
    import NaButton from "../../ui/NaButton.svelte";
    import NaEmpty from "../../ui/NaEmpty.svelte";
    import NaIconButton from "../../ui/NaIconButton.svelte";
    import NaInlineNotice from "../../ui/NaInlineNotice.svelte";
    import NaSection from "../../ui/NaSection.svelte";

    interface Props {
        projectId: string;
        i18n: I18nStrings;
        loadSupport: (projectId: string) => Promise<ProjectSupportData>;
        onOpen: (blockId: string) => void;
        onExtract?: ((blockId: string, title: string) => void) | undefined;
        onAiExtract?: ((blockId: string) => void) | undefined;
    }

    let { projectId, i18n, loadSupport, onOpen, onExtract = undefined, onAiExtract = undefined }: Props = $props();

    let data: ProjectSupportData | null = $state(null);
    let loadedProjectId = $state("");
    let loading = $state(false);
    let error = $state("");
    let requestId = 0;

    async function requestSupport(nextProjectId = projectId): Promise<void> {
        loadedProjectId = nextProjectId;
        const currentRequestId = ++requestId;
        if (data?.projectId !== nextProjectId) data = null;
        loading = true;
        error = "";
        try {
            const result = await loadSupport(nextProjectId);
            if (currentRequestId !== requestId || nextProjectId !== projectId) return;
            data = result;
        } catch (cause: unknown) {
            if (currentRequestId !== requestId || nextProjectId !== projectId) return;
            error = cause instanceof Error ? cause.message : String(cause);
        } finally {
            if (currentRequestId === requestId && nextProjectId === projectId) loading = false;
        }
    }

    function directionLabel(directions: ProjectSupportDirection[]): string {
        if (directions.length > 1) return i18n.projectSupportBoth;
        return directions[0] === "backlink" ? i18n.projectSupportBacklink : i18n.projectSupportForward;
    }

    function kindLabel(kind: "block" | "document"): string {
        return kind === "document" ? i18n.projectSupportDocument : i18n.projectSupportBlock;
    }

    $effect(() => {
        if (projectId && projectId !== loadedProjectId) {
            void requestSupport(projectId);
        }
    });
    let errorMessage = $derived(error ? i18n.projectSupportLoadError.replace("{error}", error) : "");
</script>

<div class="na-project-support">
    <NaSection
        title={i18n.projectSupport}
        description={i18n.projectSupportDescription}
        icon="iconLink"
        actionLabel={i18n.projectSupportRefresh}
        onAction={() => requestSupport()}
        actionLoading={loading}
        actionDisabled={loading}
    >
        {#if loading && !data}
            <NaEmpty loading text={i18n.loading} />
        {:else if error}
            <div class="na-project-support__state">
                <NaInlineNotice message={errorMessage} tone="error" />
                <NaButton size="sm" onclick={() => requestSupport()}>{i18n.projectSupportRetry}</NaButton>
            </div>
        {:else if !data || data.items.length === 0}
            <NaEmpty text={i18n.projectSupportEmpty} />
        {:else}
            <div class="na-project-support__list">
                {#each data.items as item (item.blockId)}
                    <article class="na-project-support__item">
                        <button type="button" class="na-project-support__title" onclick={() => onOpen(item.blockId)}>
                            {item.title}
                        </button>
                        <div class="na-project-support__meta">
                            <NaBadge text={kindLabel(item.kind)} />
                            <NaBadge text={directionLabel(item.directions)} tone="info" />
                        </div>
                        <div class="na-project-support__actions">
                            {#if onAiExtract}
                                <NaIconButton
                                    symbol="iconSparkles"
                                    label={i18n.aiExtractTasks}
                                    size={13}
                                    onclick={() => onAiExtract?.(item.blockId)}
                                />
                            {/if}
                            {#if onExtract}
                                <NaIconButton
                                    symbol="iconNextAction"
                                    label={i18n.extractAction}
                                    size={13}
                                    onclick={() => onExtract?.(item.blockId, item.title)}
                                />
                            {/if}
                            <NaIconButton
                                symbol="iconOpenWindow"
                                label={i18n.projectSupportOpen}
                                size={13}
                                onclick={() => onOpen(item.blockId)}
                            />
                        </div>
                    </article>
                {/each}
            </div>
        {/if}
    </NaSection>
</div>

<style lang="scss">
    .na-project-support {
        min-width: 0;
    }
    .na-project-support__state {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--na-space-md);
        padding: var(--na-space-xl) 0;
    }
    .na-project-support__list {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .na-project-support__item {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        gap: var(--na-space-md);
        min-height: 42px;
        padding: var(--na-space-sm) 0;
        border-bottom: 1px solid var(--na-color-divider);
    }
    .na-project-support__item:last-child {
        border-bottom: 0;
    }
    .na-project-support__title {
        min-width: 0;
        padding: var(--na-space-xs) 0;
        border: 0;
        color: var(--na-text-primary);
        background: transparent;
        font: 500 var(--na-font-size-md) / 1.45 var(--b3-font-family);
        overflow-wrap: anywhere;
        text-align: left;
        cursor: pointer;
    }
    .na-project-support__title:hover {
        color: var(--na-text-interactive);
    }
    .na-project-support__meta {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: var(--na-space-xs);
    }
    .na-project-support__actions {
        display: flex;
        align-items: center;
        gap: var(--na-space-xs);
    }
    @container nextaction-app (max-width: 560px) {
        .na-project-support__item {
            grid-template-columns: minmax(0, 1fr) auto;
        }
        .na-project-support__meta {
            grid-column: 1;
            justify-content: flex-start;
        }
    }
</style>
