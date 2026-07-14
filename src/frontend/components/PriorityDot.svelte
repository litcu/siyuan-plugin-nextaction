<script lang="ts">
    import { normalizePriority, PRIORITY_COLORS } from "../constants";
    import { toI18nKey } from "../utils";
    export let priority: string = "medium";
    export let onclick: (() => void) | undefined = undefined;
    export let i18n: any;
    $: displayPriority = normalizePriority(priority);
    $: color = PRIORITY_COLORS[displayPriority] || PRIORITY_COLORS.medium;
    $: borderColor = color;
</script>

<span
    class="na-priority-dot"
    style="background-color: {color}; border-color: {borderColor}"
    on:click={onclick}
    title={onclick ? (i18n?.markComplete || "Mark done") : (i18n?.[toI18nKey("priority", displayPriority)] || displayPriority)}
></span>

