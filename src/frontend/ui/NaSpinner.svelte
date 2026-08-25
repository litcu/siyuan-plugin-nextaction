<script lang="ts">
    export let size: "sm" | "lg" = "sm";
</script>

<span class="na-spinner" class:na-spinner--lg={size === "lg"} aria-hidden="true"></span>

<style lang="scss">
    .na-spinner {
        display: inline-block;
        width: 12px;
        height: 12px;
        box-sizing: border-box;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        animation: na-spinner-spin 0.7s linear infinite;
    }

    .na-spinner--lg {
        width: 24px;
        height: 24px;
        border-width: 2.5px;
    }

    @keyframes na-spinner-spin {
        to {
            transform: rotate(360deg);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .na-spinner {
            animation: none;
        }
    }
</style>
