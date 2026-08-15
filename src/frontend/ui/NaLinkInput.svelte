<script lang="ts">
    import { createEventDispatcher } from "svelte";

    export let value = "";
    export let placeholder = "";
    export let disabled = false;
    export let openLabel = "";
    export let i18n: any = null;

    const dispatch = createEventDispatcher<{
        input: { value: string };
        open: { value: string };
    }>();

    $: normalizedValue = value.trim();
    $: canOpen = isSupportedLink(normalizedValue);
    $: resolvedPlaceholder = placeholder || i18n?.urlPlaceholder || "URL";
    $: resolvedOpenLabel = openLabel || i18n?.openLink || "Open link";

    function isSupportedLink(raw: string): boolean {
        if (!raw) return false;
        try {
            const url = new URL(raw);
            return url.protocol === "http:" || url.protocol === "https:" || (url.protocol === "siyuan:" && raw.startsWith("siyuan://blocks/"));
        } catch (_error) {
            return false;
        }
    }

    function handleInput(event: Event) {
        value = (event.currentTarget as HTMLInputElement).value;
        dispatch("input", { value });
    }

    function handleOpen() {
        if (!canOpen || disabled) return;
        dispatch("open", { value: normalizedValue });
    }
</script>

<div class="na-link-input" class:na-link-input--disabled={disabled}>
    <input
        class="na-link-input__control"
        type="url"
        {value}
        placeholder={resolvedPlaceholder}
        {disabled}
        on:input={handleInput}
    />
    <button
        class="na-link-input__open b3-tooltips b3-tooltips__n"
        type="button"
        disabled={!canOpen || disabled}
        aria-label={resolvedOpenLabel}
        on:click={handleOpen}
    >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9.5 2.5h4v4" />
            <path d="M7 9l6.5-6.5" />
            <path d="M12.5 9.5v3a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3" />
        </svg>
    </button>
</div>

<style lang="scss">
    .na-link-input {
        display: flex;
        align-items: center;
        width: 100%;
        height: var(--na-control-height);
        overflow: hidden;
        background: var(--b3-theme-background);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        transition: border-color 0.15s, box-shadow 0.15s;

        &:hover:not(.na-link-input--disabled) {
            border-color: var(--b3-theme-primary-light);
        }

        &:focus-within {
            border-color: var(--b3-theme-primary);
            box-shadow: 0 0 0 2px color-mix(in srgb, var(--b3-theme-primary) 14%, transparent);
        }
    }

    .na-link-input--disabled { opacity: 0.45; }

    .na-link-input__control {
        flex: 1 1 auto;
        min-width: 0;
        height: 100%;
        padding: 0 var(--na-space-md);
        color: var(--b3-theme-on-background);
        background: transparent;
        border: none;
        outline: none;
        font: inherit;

        &::placeholder { color: var(--b3-theme-on-surface-light); }
    }

    .na-link-input .na-link-input__control:focus-visible,
    .na-link-input .na-link-input__open:focus-visible {
        outline: none;
    }

    .na-link-input__open {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 100%;
        padding: 0;
        flex: 0 0 34px;
        color: var(--b3-theme-primary);
        background: transparent;
        border: none;
        border-left: 1px solid var(--na-color-divider);
        cursor: pointer;
        transition: color 0.15s, background 0.15s;

        &:hover:not(:disabled) {
            color: var(--b3-theme-on-primary);
            background: var(--b3-theme-primary);
        }

        &:disabled {
            color: var(--b3-theme-on-surface-light);
            cursor: default;
            opacity: 0.45;
        }
    }
</style>
