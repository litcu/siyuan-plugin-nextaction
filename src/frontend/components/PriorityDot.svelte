<script lang="ts">
    import { PRIORITY_COLORS } from "../constants";
    import { toI18nKey } from "../utils";
    export let priority: string = "none";
    export let onclick: (() => void) | undefined = undefined;
    export let i18n: any;
    $: color = PRIORITY_COLORS[priority] || PRIORITY_COLORS.none;
    $: borderColor = priority === "none" ? "var(--b3-theme-on-surface-tertiary)" : color;
</script>

<span
    class="na-priority-dot"
    style="background-color: {color}; border-color: {borderColor}"
    on:click={onclick}
    title={onclick ? (i18n?.markComplete || "Mark done") : (i18n?.[toI18nKey("priority", priority)] || priority)}
></span>

