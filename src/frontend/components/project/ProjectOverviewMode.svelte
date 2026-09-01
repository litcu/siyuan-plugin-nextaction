<script lang="ts">
    import type { ProjectControlRisk, ProjectRisk, ProjectSummary, TaskCacheEntry } from "../../../shared/types";
    import type { I18nStrings } from "../../../shared/i18n";
    import { projectRiskI18nKey, statusI18nKey, translateKey } from "../../i18n";
    import TaskCard from "../TaskCard.svelte";
    import NaIconButton from "../../ui/NaIconButton.svelte";
    import NaTaskList from "../../ui/NaTaskList.svelte";
    import ProjectSupportSection from "./ProjectSupportSection.svelte";
    import type { ProjectSupportData } from "../../../shared/types";
    import { shouldOfferProjectRiskAction } from "../../utils/project-view-state";

    export let summary: ProjectSummary;
    export let risks: ProjectControlRisk[];
    export let selectedTaskId = "";
    export let i18n: I18nStrings;
    export let onSelectTask: ((task: TaskCacheEntry) => void) | undefined = undefined;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let loadProjectSupport: (projectId: string) => Promise<ProjectSupportData>;
    export let onOpenProjectSupport: (blockId: string) => void;
    export let onExtractAction: (sourceBlockId: string, sourceTitle: string, projectId: string) => void;
    export let onAiExtractAction: (sourceBlockId: string, projectId: string) => void;
    export let onCreateAction: ((project: TaskCacheEntry) => void) | undefined = undefined;

    function riskLabel(kind: ProjectRisk["kind"]): string {
        return translateKey(i18n, projectRiskI18nKey(kind), kind);
    }

    function statusLabel(status: string): string {
        return translateKey(i18n, statusI18nKey(status), status);
    }
</script>

<div class="na-project-overview">
    <section class="na-project-section na-project-section--risks">
        <div class="na-project-section__heading">
            <h3>{i18n?.projectRisks || "Risks"}</h3>
            <span>{risks.length}</span>
        </div>
        {#if risks.length === 0}
            <p class="na-project-muted">{i18n?.projectNoRisks || "No obvious risks"}</p>
        {:else}
            {#each risks as item (item.kind + item.taskId)}
                <div class="na-project-risk-row">
                    <button type="button" class="na-project-risk" on:click={() => onSelectTask?.(item.target)}>
                        <span class="na-project-risk__marker na-project-risk__marker--{item.severity}"></span>
                        <span
                            ><strong>{riskLabel(item.kind)}</strong><small
                                >{item.target.title || i18n?.untitled || "(untitled)"}</small
                            ></span
                        >
                    </button>
                    {#if shouldOfferProjectRiskAction(item) && onCreateAction}
                        <NaIconButton
                            symbol="iconAdd"
                            label={i18n.projectCreateNextAction}
                            size={14}
                            compact
                            onclick={(event) => {
                                event.stopPropagation();
                                onCreateAction?.(summary.project);
                            }}
                        />
                    {/if}
                </div>
            {/each}
        {/if}
    </section>
    <section class="na-project-section">
        <div class="na-project-section__heading">
            <h3>{i18n?.projectNextActions || "Next actions"}</h3>
            <span>{summary.nextActions.length}</span>
        </div>
        {#if summary.nextActions.length === 0}
            <p class="na-project-muted">{i18n?.projectNoNextActions || "No available next action"}</p>
        {:else}
            <NaTaskList>
                <div class="na-project-task-stack">
                    {#each summary.nextActions.slice(0, 5) as task (task.blockId)}
                        <TaskCard
                            {task}
                            selected={task.blockId === selectedTaskId}
                            onSelect={onSelectTask}
                            {onEdit}
                            {onStatusClick}
                            {onContextMenu}
                            {i18n}
                            isRoot={false}
                        />
                    {/each}
                </div>
            </NaTaskList>
        {/if}
    </section>
    <section class="na-project-section">
        <div class="na-project-section__heading"><h3>{i18n?.projectSnapshot || "Snapshot"}</h3></div>
        <dl class="na-project-facts">
            <div>
                <dt>{i18n?.status || "Status"}</dt>
                <dd>{statusLabel(summary.project.status)}</dd>
            </div>
            <div>
                <dt>{i18n?.dueDate || "Due"}</dt>
                <dd>{summary.project.due || i18n?.projectNoDue || "No date"}</dd>
            </div>
            <div>
                <dt>{i18n?.projectWaiting || "Waiting"}</dt>
                <dd>{summary.waitingTasks.length}</dd>
            </div>
            <div>
                <dt>{i18n?.blocked || "Blocked"}</dt>
                <dd>{summary.blockedTasks.length}</dd>
            </div>
        </dl>
    </section>
    <ProjectSupportSection
        projectId={summary.project.blockId}
        {i18n}
        loadSupport={loadProjectSupport}
        onOpen={onOpenProjectSupport}
        onExtract={(sourceBlockId, sourceTitle) => onExtractAction(sourceBlockId, sourceTitle, summary.project.blockId)}
        onAiExtract={(sourceBlockId) => onAiExtractAction(sourceBlockId, summary.project.blockId)}
    />
</div>

<style lang="scss">
    .na-project-overview {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
    }
    .na-project-section {
        min-width: 0;
        padding: 12px;
        border-top: 2px solid var(--na-color-divider);
        background: var(--b3-theme-surface);
    }
    .na-project-overview :global(.na-project-support) {
        grid-column: 1 / -1;
    }
    .na-project-section--risks {
        border-top-color: var(--na-color-warning);
    }
    .na-project-section__heading {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        color: var(--na-text-secondary);
    }
    .na-project-section__heading h3 {
        margin: 0;
        color: var(--na-text-primary);
        font-size: var(--na-font-size-md);
        font-weight: 700;
    }
    .na-project-section__heading > span {
        font-size: var(--na-font-size-xs);
        font-variant-numeric: tabular-nums;
    }
    .na-project-risk {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        width: 100%;
        padding: 7px 0;
        border: 0;
        color: var(--na-text-primary);
        background: transparent;
        text-align: left;
        cursor: pointer;
    }
    .na-project-risk-row {
        display: flex;
        align-items: center;
        gap: var(--na-space-xs);
    }
    .na-project-risk-row .na-project-risk {
        flex: 1;
        min-width: 0;
    }
    .na-project-risk:hover {
        color: var(--na-text-interactive);
    }
    .na-project-risk > span:last-child {
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 2px;
    }
    .na-project-risk strong {
        font-size: var(--na-font-size-sm);
        font-weight: 650;
    }
    .na-project-risk small {
        color: var(--na-text-primary);
        font-size: var(--na-font-size-sm);
    }
    .na-project-risk__marker {
        display: inline-block;
        flex: 0 0 7px;
        width: 7px;
        height: 7px;
        margin-top: 4px;
        border-radius: 50%;
        background: var(--na-color-info);
    }
    .na-project-risk__marker--high {
        background: var(--na-color-error);
    }
    .na-project-risk__marker--medium {
        background: var(--na-color-warning);
    }
    .na-project-risk__marker--low {
        background: var(--na-color-info);
    }
    .na-project-muted {
        margin: 4px 0;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
    }
    .na-project-task-stack {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .na-project-facts {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin: 0;
    }
    .na-project-facts div {
        min-width: 0;
        padding: 7px 8px;
        background: var(--na-task-card-meta-bg);
    }
    .na-project-facts dt {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
    }
    .na-project-facts dd {
        margin: 2px 0 0;
        overflow: hidden;
        color: var(--na-text-primary);
        font-size: var(--na-font-size-sm);
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    @container nextaction-app (max-width: 880px) {
        .na-project-overview {
            grid-template-columns: 1fr;
        }
    }
</style>
