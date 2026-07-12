<script lang="ts">
    export let text: string;
    export let color: string | undefined = undefined;

    // Generate muted pastel background from hex color
    // Uses lower opacity for minimalist feel
    $: bgStyle = color && color.startsWith('#')
        ? `background: ${color}12; color: ${color}cc; border: 1px solid ${color}20;`
        : 'background: var(--b3-theme-surface-light); color: var(--b3-theme-on-surface-secondary); border: 1px solid transparent;';
</script>

<span class="na-badge" style={bgStyle}>
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
        letter-spacing: 0.03em;
        line-height: 1.6;
        text-transform: uppercase;
        transition: opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .na-badge:hover {
        opacity: 0.85;
    }
</style>
