<script lang="ts">
    export let text: string;
    export let tone: "neutral" | "primary" | "info" | "success" | "warning" | "danger" = "neutral";
</script>

<span class="na-badge na-badge--{tone}">
    {text}
</span>

<style lang="scss">
    .na-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--na-radius-pill);
        font-size: var(--na-font-size-xs);
        font-weight: 600;
        padding: 0 var(--na-space-sm);
        white-space: nowrap;
        letter-spacing: 0;
        line-height: 1.6;
        transition: opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1);
        color: var(--na-text-secondary);
        background: var(--b3-theme-surface-light);
    }

    .na-badge:hover {
        opacity: 0.85;
    }
    .na-badge--primary {
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
    }
    .na-badge--info {
        color: var(--na-color-info);
        background: var(--na-color-info-bg);
    }
    .na-badge--success {
        color: var(--na-color-success);
        background: var(--na-color-success-bg);
    }
    .na-badge--warning {
        color: var(--na-color-warning);
        background: var(--na-color-warning-bg);
    }
    .na-badge--danger {
        color: var(--na-color-error);
        background: var(--na-color-error-bg);
    }
</style>
