<script lang="ts">
    import type { I18nStrings } from "../../../shared/i18n";
    import NaIcon from "../../ui/NaIcon.svelte";
    import NaSettingRow from "../../ui/NaSettingRow.svelte";
    import NaSection from "../../ui/NaSection.svelte";

    export let i18n: I18nStrings;
    export let dueWeight: number;
    export let startWeight: number;
    export let importanceWeight: number;
    export let dueDecayTau: number;
    export let overdueGrowth: number;
    export let overdueCap: number;
    export let startHorizon: number;
    export let effortScale: number;
    export let startPreviewDays: number;
    export let weightSum: number;
    export let rebuilding = false;
    export let onResetPriority: () => void;
    export let onRebuildCache: () => void;
</script>

<div class="na-page-stack na-settings-advanced">
    <NaSection
        icon="iconSort"
        title={i18n?.settingWeightDistribution || "Weight distribution"}
        description={i18n?.settingWeightDistributionDesc || "Share of each factor in priority; the sum must be 1.0"}
        actionLabel={i18n?.settingResetSection || i18n?.settingReset || "Reset"}
        onAction={onResetPriority}
    >
        <div class="na-settings-advanced__weights">
            <div><span>{i18n?.settingDueWeight || "Due date"}</span><div class="na-settings-advanced__track"><i class="due" style={`width:${Math.max(0, Math.min(1, dueWeight)) * 100}%`}></i></div><input class="b3-text-field" type="number" min={0} max={1} step={0.05} bind:value={dueWeight} /></div>
            <div><span>{i18n?.settingStartWeight || "Start date"}</span><div class="na-settings-advanced__track"><i class="start" style={`width:${Math.max(0, Math.min(1, startWeight)) * 100}%`}></i></div><input class="b3-text-field" type="number" min={0} max={1} step={0.05} bind:value={startWeight} /></div>
            <div><span>{i18n?.settingImportanceWeight || "Importance"}</span><div class="na-settings-advanced__track"><i class="importance" style={`width:${Math.max(0, Math.min(1, importanceWeight)) * 100}%`}></i></div><input class="b3-text-field" type="number" min={0} max={1} step={0.05} bind:value={importanceWeight} /></div>
            <div class="na-settings-advanced__sum" class:error={weightSum !== 1}><span>{i18n?.settingWeightSum || "Weight sum"}</span><strong>{weightSum.toFixed(2)} <NaIcon symbol={weightSum === 1 ? "iconCheck" : "iconClose"} size={13} /></strong></div>
        </div>
    </NaSection>

    <NaSection icon="iconSort" title={i18n?.settingPriorityParams || "Priority parameters"} description={i18n?.settingPriorityEngineDesc || "Automatic priority calculation parameters — adjust only if you understand their effect."}>
        <NaSettingRow forId="setting-due-decay-tau" title={i18n?.settingDueDecayTau || "Urgency decay"} description={i18n?.settingDueDecayTauDesc || "How quickly urgency drops as due date recedes"}><div class="na-settings-advanced__input"><input id="setting-due-decay-tau" class="b3-text-field" type="number" min={1} max={30} step={1} bind:value={dueDecayTau} /><span>{i18n?.settingDays || "days"}</span></div></NaSettingRow>
        <NaSettingRow forId="setting-overdue-growth" title={i18n?.settingOverdueGrowth || "Overdue growth"} description={i18n?.settingOverdueGrowthDesc || "Priority increase per day past due"}><div class="na-settings-advanced__input"><input id="setting-overdue-growth" class="b3-text-field" type="number" min={0} max={5} step={0.1} bind:value={overdueGrowth} /><span>/{i18n?.settingDays || "days"}</span></div></NaSettingRow>
        <NaSettingRow forId="setting-overdue-cap" title={i18n?.settingOverdueCap || "Overdue cap"} description={i18n?.settingOverdueCapDesc || "Maximum extra priority from being overdue"}><input id="setting-overdue-cap" class="b3-text-field na-settings-advanced__number" type="number" min={0} max={100} step={1} bind:value={overdueCap} /></NaSettingRow>
        <NaSettingRow forId="setting-start-horizon" title={i18n?.settingStartHorizon || "Start date horizon"} description={i18n?.settingStartHorizonDesc || "Future tasks beyond this are deprioritized"}><div class="na-settings-advanced__input"><input id="setting-start-horizon" class="b3-text-field" type="number" min={1} max={60} step={1} bind:value={startHorizon} /><span>{i18n?.settingDays || "days"}</span></div></NaSettingRow>
        <NaSettingRow forId="setting-start-preview-days" title={i18n?.settingStartPreviewDays || "Start preview days"} description={i18n?.settingStartPreviewDaysDesc || "How many days ahead to show upcoming tasks"}><div class="na-settings-advanced__input"><input id="setting-start-preview-days" class="b3-text-field" type="number" min={0} max={14} step={1} bind:value={startPreviewDays} /><span>{i18n?.settingDays || "days"}</span></div></NaSettingRow>
        <NaSettingRow forId="setting-effort-scale" title={i18n?.settingEffortScale || "Effort penalty"} description={i18n?.settingEffortScaleDesc || "Higher effort reduces priority"}><input id="setting-effort-scale" class="b3-text-field na-settings-advanced__number" type="number" min={0} max={0.5} step={0.01} bind:value={effortScale} /></NaSettingRow>
    </NaSection>

    <NaSection icon="iconRefresh" title={i18n?.settingMaintenance || "Maintenance"} description={i18n?.settingMaintenanceDesc || "These actions execute immediately and are not part of the Save operation."}>
        <div class="na-settings-advanced__maintenance">
            <div><div><strong>{i18n?.rebuildCache || "Rebuild cache"}</strong><span>{i18n?.rebuildCacheDesc || "Reload all task data from the database"}</span></div><button type="button" class="b3-button" on:click={onRebuildCache} disabled={rebuilding}>{rebuilding ? "…" : (i18n?.run || "Run")}</button></div>
        </div>
    </NaSection>
</div>

<style lang="scss">
    .na-settings-advanced__weights { display: flex; flex-direction: column; gap: 13px; padding: 8px 0 14px; }
    .na-settings-advanced__weights > div:not(.na-settings-advanced__sum) { display: grid; grid-template-columns: 72px minmax(0, 1fr) 72px; align-items: center; gap: 10px; }
    .na-settings-advanced__weights > div > span { color: var(--b3-theme-on-surface-light); font-size: 11px; }
    .na-settings-advanced__track { height: 6px; overflow: hidden; border-radius: 999px; background: var(--b3-theme-background); }
    .na-settings-advanced__track i { display: block; height: 100%; border-radius: inherit; transition: width 150ms ease; }
    .na-settings-advanced__track i.due { background: var(--b3-card-error-color); }
    .na-settings-advanced__track i.start { background: var(--b3-card-info-color); }
    .na-settings-advanced__track i.importance { background: var(--b3-card-warning-color); }
    .na-settings-advanced__weights :global(.b3-text-field) { width: 72px; }
    .na-settings-advanced__sum { display: flex; justify-content: space-between; padding: 11px 0 2px; border-top: 1px solid var(--b3-border-color); color: var(--b3-theme-on-surface-light); font-size: 11px; }
    .na-settings-advanced__sum strong { display: inline-flex; align-items: center; gap: 4px; color: var(--b3-card-success-color); font-size: 12px; }
    .na-settings-advanced__sum.error strong { color: var(--b3-theme-error); }
    .na-settings-advanced__input { display: inline-flex; align-items: center; gap: 7px; color: var(--b3-theme-on-surface-light); font-size: 11px; }
    .na-settings-advanced__input :global(.b3-text-field), :global(.na-settings-advanced__number) { width: 82px; }
    .na-settings-advanced__maintenance { padding: 4px 0; }
    .na-settings-advanced__maintenance > div { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--b3-border-color); }
    .na-settings-advanced__maintenance > div:last-child { border-bottom: 0; }
    .na-settings-advanced__maintenance strong, .na-settings-advanced__maintenance span { display: block; }
    .na-settings-advanced__maintenance strong { color: var(--b3-theme-on-surface); font-size: 12px; }
    .na-settings-advanced__maintenance span { margin-top: 2px; color: var(--b3-theme-on-surface-light); font-size: 10px; }
    @media (max-width: 560px) { .na-settings-advanced__weights > div:not(.na-settings-advanced__sum) { grid-template-columns: 70px minmax(0, 1fr); } .na-settings-advanced__weights :global(.b3-text-field) { grid-column: 2; width: 82px; } }
</style>
