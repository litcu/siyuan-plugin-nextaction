<script lang="ts">
    import type {
        ProjectHealth,
        ProjectReviewItem,
        ProjectSummary,
        ReviewData,
        TaskCacheEntry,
    } from "../../shared/types";
    import type { I18nStrings } from "../../shared/i18n";
    import { mergeManualProjectReviews, projectReviewPlanTasks } from "../../shared/review";
    import { projectRiskI18nKey, statusI18nKey, translateKey } from "../i18n";
    import NaAccordion from "../ui/NaAccordion.svelte";
    import NaBadge from "../ui/NaBadge.svelte";
    import NaButton from "../ui/NaButton.svelte";
    import NaEmpty from "../ui/NaEmpty.svelte";
    import NaIconButton from "../ui/NaIconButton.svelte";
    import NaProgressBar from "../ui/NaProgressBar.svelte";
    import NaSearchSelect from "../ui/NaSearchSelect.svelte";
    import TaskCard from "./TaskCard.svelte";
    import { shouldOfferProjectRiskAction, shouldShowProjectCompletionPanel } from "../utils/project-view-state";

    export let reviewData: ReviewData;
    export let i18n: I18nStrings;
    export let selectedTaskId: string;
    export let onSelectTask: (task: TaskCacheEntry) => void;
    export let onEdit: (task: TaskCacheEntry) => void;
    export let onOpenProject: (project: TaskCacheEntry) => void;
    export let onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    export let onMarkReviewed: (blockIds: string[]) => Promise<boolean>;
    export let onCreateAction: ((project: TaskCacheEntry) => void) | undefined = undefined;
    export let onConfirmCompletion: ((summary: ProjectSummary) => Promise<boolean>) | undefined = undefined;
    export let manualProjectIds: string[] = [];
    export let expandedProjectId: string = "";

    let manualProjectId = "";
    let reviewingIds = new Set<string>();
    let completingIds = new Set<string>();

    $: reviewItems = mergeManualProjectReviews(
        reviewData.projectReviews,
        reviewData.reviewableProjects,
        manualProjectIds,
    );
    $: queuedProjectIds = new Set(reviewItems.map((item) => item.summary.project.blockId));
    $: manualOptions = reviewData.reviewableProjects.filter(
        (summary) => !queuedProjectIds.has(summary.project.blockId),
    );
    $: projectLabels = Object.fromEntries(
        reviewData.reviewableProjects.map((summary) => [summary.project.blockId, summary.project.title]),
    );

    function healthPresentation(health: ProjectHealth): {
        label: string;
        badgeTone: "success" | "warning" | "danger" | "info";
        accordionTone: "default" | "success" | "warning" | "danger";
    } {
        if (health === "blocked") {
            return { label: i18n.projectHealthBlocked, badgeTone: "danger", accordionTone: "danger" };
        }
        if (health === "attention") {
            return { label: i18n.projectHealthAttention, badgeTone: "warning", accordionTone: "warning" };
        }
        if (health === "complete") {
            return { label: i18n.statusDone, badgeTone: "success", accordionTone: "success" };
        }
        return { label: i18n.reviewProjectOnTrack, badgeTone: "info", accordionTone: "default" };
    }

    function triggerLabel(item: ProjectReviewItem): string {
        const labels: string[] = [];
        if (item.schedule === "overdue") labels.push(i18n.reviewProjectScheduleOverdue);
        else if (item.schedule === "due") labels.push(i18n.reviewProjectScheduleDue);
        if (item.triggers.includes("risk")) labels.push(i18n.reviewProjectRiskTrigger);
        if (item.triggers.includes("completionCandidate")) labels.push(i18n.projectCompletionCandidateEyebrow);
        if (item.triggers.includes("manual")) labels.push(i18n.reviewProjectManualTrigger);
        return labels.join(" · ");
    }

    function statusLabel(status: string): string {
        return translateKey(i18n, statusI18nKey(status), status);
    }

    function riskSeverityLabel(severity: "high" | "medium" | "low"): string {
        if (severity === "high") return i18n.priorityHigh;
        if (severity === "medium") return i18n.priorityMedium;
        return i18n.priorityLow;
    }

    function attentionTasks(summary: ProjectSummary): TaskCacheEntry[] {
        return Array.from(
            new Map([...summary.waitingTasks, ...summary.blockedTasks].map((task) => [task.blockId, task])).values(),
        );
    }

    async function searchProjects(query: string): Promise<{ id: string; label: string }[]> {
        const normalized = query.trim().toLowerCase();
        return manualOptions
            .filter((summary) => !normalized || summary.project.title.toLowerCase().includes(normalized))
            .slice(0, 8)
            .map((summary) => ({ id: summary.project.blockId, label: summary.project.title }));
    }

    function handleManualProject(event: CustomEvent<{ selected: string | string[] }>) {
        const projectId = typeof event.detail.selected === "string" ? event.detail.selected : "";
        if (!projectId) return;
        manualProjectIds = manualProjectIds.includes(projectId) ? manualProjectIds : [...manualProjectIds, projectId];
        expandedProjectId = projectId;
        manualProjectId = "";
    }

    async function handleReviewed(item: ProjectReviewItem) {
        const projectId = item.summary.project.blockId;
        if (reviewingIds.has(projectId)) return;
        reviewingIds = new Set(reviewingIds).add(projectId);
        try {
            const reviewed = await onMarkReviewed([projectId]);
            if (reviewed) manualProjectIds = manualProjectIds.filter((id) => id !== projectId);
        } finally {
            const next = new Set(reviewingIds);
            next.delete(projectId);
            reviewingIds = next;
        }
    }

    async function handleCompletion(item: ProjectReviewItem) {
        const projectId = item.summary.project.blockId;
        if (!onConfirmCompletion || completingIds.has(projectId)) return;
        completingIds = new Set(completingIds).add(projectId);
        try {
            await onConfirmCompletion(item.summary);
        } finally {
            const next = new Set(completingIds);
            next.delete(projectId);
            completingIds = next;
        }
    }
</script>

<div class="na-project-review">
    <div class="na-project-review__manual">
        <div class="na-project-review__manual-copy">
            <strong>{i18n.reviewProjectManualTitle}</strong>
            <span>{i18n.reviewProjectManualHint}</span>
        </div>
        <div class="na-project-review__manual-select">
            <NaSearchSelect
                bind:selected={manualProjectId}
                placeholder={i18n.reviewProjectManualPlaceholder}
                searchFn={searchProjects}
                initialLabels={projectLabels}
                emptyText={i18n.reviewProjectManualEmpty}
                noMatchText={i18n.noMatches}
                loadingText={i18n.loadingMore}
                clearLabel={i18n.clearSelection}
                fixedDropdown={true}
                on:change={handleManualProject}
            />
        </div>
    </div>

    {#if reviewItems.length === 0}
        <NaEmpty text={i18n.reviewProjectQueueEmpty} />
    {:else}
        <div class="na-project-review__queue">
            {#each reviewItems as item (item.summary.project.blockId)}
                {@const summary = item.summary}
                {@const project = summary.project}
                {@const health = healthPresentation(summary.health)}
                <NaAccordion
                    title={project.title || i18n.untitled}
                    description={triggerLabel(item)}
                    icon="iconFolder"
                    count={item.risks.length}
                    tone={health.accordionTone}
                    open={expandedProjectId === project.blockId}
                    on:openChange={(event) => (expandedProjectId = event.detail ? project.blockId : "")}
                >
                    <svelte:fragment slot="action">
                        <div class="na-project-review__actions">
                            <NaButton
                                size="sm"
                                variant="text"
                                icon="iconOpenWindow"
                                on:click={() => onOpenProject(project)}>{i18n.reviewOpenProject}</NaButton
                            >
                            <NaButton size="sm" variant="text" on:click={() => onEdit(project)}
                                >{i18n.editProject}</NaButton
                            >
                            {#if onConfirmCompletion && shouldShowProjectCompletionPanel(summary)}
                                <NaButton
                                    size="sm"
                                    variant="primary"
                                    loading={completingIds.has(project.blockId)}
                                    disabled={completingIds.has(project.blockId)}
                                    on:click={() => handleCompletion(item)}>{i18n.projectConfirmComplete}</NaButton
                                >
                            {/if}
                            <NaButton
                                size="sm"
                                variant="primary"
                                icon="iconSelect"
                                loading={reviewingIds.has(project.blockId)}
                                on:click={() => handleReviewed(item)}>{i18n.markReviewed}</NaButton
                            >
                        </div>
                    </svelte:fragment>

                    <div class="na-project-review__summary">
                        <div class="na-project-review__meta">
                            <NaBadge text={health.label} tone={health.badgeTone} />
                            <NaBadge text={statusLabel(project.status)} />
                            {#if summary.completionCandidate}
                                <NaBadge text={i18n.projectCompletionCandidateEyebrow} tone="success" />
                            {/if}
                            {#if project.reviewDate}
                                <span>{i18n.reviewDate}: {project.reviewDate}</span>
                            {/if}
                        </div>

                        <section class="na-project-review__check">
                            <h4>{i18n.outcome}</h4>
                            <p class:na-project-review__missing={!project.outcome}>
                                {project.outcome || i18n.projectCompletionNotDefined}
                            </p>
                        </section>
                        <section class="na-project-review__check">
                            <h4>{i18n.definitionOfDone}</h4>
                            <p class:na-project-review__missing={!project.dod} class="na-project-review__multiline">
                                {project.dod || i18n.projectCompletionNotDefined}
                            </p>
                        </section>
                        <section class="na-project-review__check">
                            <h4>{i18n.projectProgressStats}</h4>
                            <NaProgressBar
                                percent={summary.progress}
                                valueLabel={`${summary.doneCount}/${summary.doneCount + summary.openCount}`}
                                tone={summary.completionCandidate ? "success" : "primary"}
                            />
                            {#if summary.empty}<p class="na-project-review__missing">{i18n.projectRiskEmpty}</p>{/if}
                        </section>
                        <section class="na-project-review__check">
                            <h4>{i18n.reviewProjectPlan}</h4>
                            {#if projectReviewPlanTasks(summary).length === 0}
                                <p class="na-project-review__missing">{i18n.projectRiskEmpty}</p>
                            {:else}
                                <div class="na-project-review__tasks">
                                    {#each projectReviewPlanTasks(summary) as task (task.blockId)}
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
                            {/if}
                        </section>
                        <section class="na-project-review__check">
                            <h4>{i18n.projectNextActions}</h4>
                            {#if summary.nextActions.length === 0}
                                <p class="na-project-review__missing">{i18n.projectNoNextActions}</p>
                            {:else}
                                <div class="na-project-review__tasks">
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
                            {/if}
                        </section>
                        <section class="na-project-review__check">
                            <h4>{i18n.reviewProjectWaitingBlocked}</h4>
                            {#if attentionTasks(summary).length === 0}
                                <p>{i18n.reviewProjectNoWaitingBlocked}</p>
                            {:else}
                                <div class="na-project-review__tasks">
                                    {#each attentionTasks(summary) as task (task.blockId)}
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
                            {/if}
                        </section>
                    </div>

                    {#if item.risks.length > 0}
                        <div class="na-project-review__risks" aria-label={i18n.projectRisks}>
                            {#each item.risks as risk (risk.kind + risk.taskId)}
                                <div class="na-project-review__risk-item">
                                    <NaButton size="sm" variant="text" on:click={() => onSelectTask(risk.target)}>
                                        <NaBadge
                                            text={`${translateKey(i18n, projectRiskI18nKey(risk.kind), risk.kind)} · ${riskSeverityLabel(risk.severity)}`}
                                            tone={risk.severity === "high"
                                                ? "danger"
                                                : risk.severity === "medium"
                                                  ? "warning"
                                                  : "info"}
                                        />
                                        <span>{risk.target.title}</span>
                                    </NaButton>
                                    {#if shouldOfferProjectRiskAction(risk) && onCreateAction}
                                        <NaIconButton
                                            symbol="iconAdd"
                                            label={i18n.projectCreateNextAction}
                                            size={14}
                                            compact
                                            on:click={() => onCreateAction?.(project)}
                                        />
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    {/if}
                </NaAccordion>
            {/each}
        </div>
    {/if}
</div>

<style lang="scss">
    .na-project-review,
    .na-project-review__queue,
    .na-project-review__summary,
    .na-project-review__tasks {
        display: flex;
        flex-direction: column;
    }
    .na-project-review {
        gap: var(--na-space-md);
    }
    .na-project-review__queue,
    .na-project-review__summary {
        gap: var(--na-space-sm);
    }
    .na-project-review__manual {
        display: flex;
        align-items: center;
        gap: var(--na-space-lg);
        padding: var(--na-space-md);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        background: var(--b3-theme-surface);
    }
    .na-project-review__manual-copy {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        gap: var(--na-space-xxs);
    }
    .na-project-review__manual-copy strong {
        color: var(--na-text-primary);
        font-size: var(--na-font-size-md);
    }
    .na-project-review__manual-copy span,
    .na-project-review__meta > span {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
    }
    .na-project-review__manual-select {
        width: min(280px, 42%);
    }
    .na-project-review__actions,
    .na-project-review__meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--na-space-xs);
    }
    .na-project-review__summary {
        display: grid;
        grid-template-columns: 1fr 1fr;
        padding-top: var(--na-space-sm);
    }
    .na-project-review__meta {
        grid-column: 1 / -1;
    }
    .na-project-review__check {
        min-width: 0;
        padding: var(--na-space-md);
        background: var(--na-task-card-meta-bg);
    }
    .na-project-review__check h4 {
        margin: 0 0 var(--na-space-xs);
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        font-weight: 600;
    }
    .na-project-review__check p {
        margin: 0;
        color: var(--na-text-primary);
        font-size: var(--na-font-size-sm);
        line-height: 1.5;
    }
    .na-project-review__check .na-project-review__missing {
        color: var(--na-color-warning);
        font-weight: 600;
    }
    .na-project-review__multiline {
        white-space: pre-wrap;
    }
    .na-project-review__tasks {
        gap: var(--na-space-xs);
    }
    .na-project-review__risks {
        display: flex;
        flex-wrap: wrap;
        gap: var(--na-space-xs);
        margin-top: var(--na-space-md);
        padding-top: var(--na-space-md);
        border-top: 1px solid var(--na-color-divider);
    }
    .na-project-review__risk-item {
        display: inline-flex;
        align-items: center;
        min-width: 0;
        gap: var(--na-space-xxs);
    }
    .na-project-review__risks :global(.na-button > span) {
        display: inline-flex;
        align-items: center;
        gap: var(--na-space-xs);
    }
    .na-project-review__risks :global(.na-button > span > span:last-child) {
        color: var(--na-text-primary);
    }

    @container nextaction-app (max-width: 640px) {
        .na-project-review__manual {
            align-items: stretch;
            flex-direction: column;
        }
        .na-project-review__manual-select {
            width: 100%;
        }
        .na-project-review__summary {
            grid-template-columns: 1fr;
        }
        .na-project-review__meta {
            grid-column: auto;
        }
    }
</style>
