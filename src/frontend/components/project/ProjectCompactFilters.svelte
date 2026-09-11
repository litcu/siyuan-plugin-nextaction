<script lang="ts">
    import NaPageHost from "../../ui/NaPageHost.svelte";
    import NaButton from "../../ui/NaButton.svelte";
    import NaToggle from "../../ui/NaToggle.svelte";
    import { untrack } from "svelte";
    import type { I18nStrings } from "../../../shared/i18n";
    import type { ProjectRiskFilter, ProjectDateFilter, ProjectActionFilter } from "../../utils/project-view-state";
    interface Values {
        showCompleted: boolean;
        riskFilter: ProjectRiskFilter;
        dateFilter: ProjectDateFilter;
        actionFilter: ProjectActionFilter;
    }
    interface Props extends Values {
        i18n: I18nStrings;
        onClose: () => void;
        onApply: (value: Values) => void;
    }
    let { i18n, showCompleted, riskFilter, dateFilter, actionFilter, onClose, onApply }: Props = $props();
    let draft = $state(untrack(() => ({ showCompleted, riskFilter, dateFilter, actionFilter })));
</script>

<NaPageHost title={i18n.filterAndSort} backLabel={i18n.cancel} onBack={onClose}>
    {#snippet actions()}<NaButton variant="primary" onclick={() => onApply(draft)}>{i18n.apply}</NaButton>{/snippet}
    <div class="na-page-stack na-project-filters">
        <NaToggle
            checked={draft.showCompleted}
            label={i18n.projectShowCompleted}
            showText
            onChange={(value) => (draft.showCompleted = value)}
        />
        <label
            >{i18n.projectFilterRisk}<select class="na-select" bind:value={draft.riskFilter}
                ><option value="all">{i18n.projectFilterAllRisks}</option><option value="attention"
                    >{i18n.projectHealthAttention}</option
                ><option value="blocked">{i18n.projectHealthBlocked}</option></select
            ></label
        >
        <label
            >{i18n.projectFilterDate}<select class="na-select" bind:value={draft.dateFilter}
                ><option value="all">{i18n.projectFilterAllDates}</option><option value="overdue"
                    >{i18n.projectRiskOverdue}</option
                ><option value="week">{i18n.projectMetricDueSoon}</option></select
            ></label
        >
        <label
            >{i18n.projectFilterAction}<select class="na-select" bind:value={draft.actionFilter}
                ><option value="all">{i18n.projectFilterAllActions}</option><option value="missing"
                    >{i18n.projectRiskNoNextAction}</option
                ><option value="available">{i18n.projectNextActions}</option></select
            ></label
        >
        <NaButton
            onclick={() =>
                (draft = { showCompleted: false, riskFilter: "all", dateFilter: "all", actionFilter: "all" })}
            >{i18n.clearFilters}</NaButton
        >
    </div>
</NaPageHost>

<style>
    .na-project-filters {
        padding: 12px;
    }
    label {
        display: grid;
        gap: 8px;
    }
</style>
