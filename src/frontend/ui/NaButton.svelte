<script lang="ts">
    import NaIcon from "./NaIcon.svelte";

    export let variant: "default" | "primary" | "danger" | "text" = "default";
    export let size: "md" | "sm" = "md";
    export let icon = "";
    export let disabled = false;
    export let loading = false;
    export let type: "button" | "submit" | "reset" = "button";
</script>

<button
    {type}
    class="na-button"
    class:na-button--primary={variant === "primary"}
    class:na-button--danger={variant === "danger"}
    class:na-button--text={variant === "text"}
    class:na-button--sm={size === "sm"}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    on:click
>
    {#if loading}<span class="na-button__spinner" aria-hidden="true"></span>{:else if icon}<NaIcon symbol={icon} size={size === "sm" ? 13 : 14} />{/if}
    <span><slot /></span>
</button>

<style lang="scss">
    .na-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--na-space-xs);
        min-width: 0;
        height: var(--na-control-height);
        padding: 0 var(--na-space-lg);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        color: var(--b3-theme-on-background);
        background: var(--b3-theme-surface);
        font: 500 var(--na-font-size-md)/1 var(--b3-font-family);
        cursor: pointer;
        white-space: nowrap;
        transition: background-color .15s, border-color .15s, color .15s, opacity .15s;

        &:hover:not(:disabled) { background: var(--b3-theme-surface-light); border-color: var(--b3-theme-primary-light); }
        &:active:not(:disabled) { transform: translateY(1px); }
        &:focus-visible { outline: 2px solid var(--b3-theme-primary); outline-offset: 2px; }
        &:disabled { opacity: .5; cursor: not-allowed; }
    }

    .na-button--sm { height: var(--na-control-height-sm); padding-inline: var(--na-space-md); font-size: var(--na-font-size-sm); border-radius: var(--na-radius-sm); }
    .na-button--primary { color: var(--b3-theme-on-primary); background: var(--b3-theme-primary); border-color: var(--b3-theme-primary); }
    .na-button--primary:hover:not(:disabled) { color: var(--b3-theme-on-primary); background: var(--b3-theme-primary-light); border-color: var(--b3-theme-primary-light); }
    .na-button--danger { color: var(--na-color-error); background: transparent; border-color: var(--na-color-error-border); }
    .na-button--danger:hover:not(:disabled) { color: var(--b3-theme-on-primary); background: var(--na-color-error); border-color: var(--na-color-error); }
    .na-button--text { border-color: transparent; background: transparent; color: var(--b3-theme-primary); }
    .na-button--text:hover:not(:disabled) { background: var(--b3-theme-primary-lightest); border-color: transparent; }
    .na-button__spinner { width: 12px; height: 12px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: na-button-spin .7s linear infinite; }
    @keyframes na-button-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .na-button__spinner { animation: none; } }
</style>
