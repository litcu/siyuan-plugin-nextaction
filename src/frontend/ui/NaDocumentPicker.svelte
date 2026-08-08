<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte";
    import type { KernelBridge } from "../kernel-bridge";
    import NaIcon from "./NaIcon.svelte";
    import NaIconButton from "./NaIconButton.svelte";
    import NaSearchInput from "./NaSearchInput.svelte";

    export interface DocumentSelection {
        id: string;
        title: string;
        notebookId: string;
        notebookName: string;
        path: string;
        icon: string;
    }

    type DocumentItem = {
        id: string;
        title: string;
        notebookId: string;
        notebookName?: string;
        path: string;
        icon: string;
        hasChildren: boolean;
    };

    export let bridge: KernelBridge;
    export let i18n: any;
    export let value: DocumentSelection | null = null;
    export let disabled = false;

    const dispatch = createEventDispatcher<{ change: DocumentSelection | null }>();
    let query = "";
    let results: DocumentItem[] = [];
    let loading = false;
    let searched = false;
    let error = "";
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    let searchVersion = 0;

    onDestroy(() => {
        if (searchTimer) clearTimeout(searchTimer);
        searchVersion++;
    });

    function scheduleSearch() {
        if (searchTimer) clearTimeout(searchTimer);
        const keyword = query.trim();
        const version = ++searchVersion;
        error = "";
        if (!keyword) {
            results = [];
            searched = false;
            loading = false;
            return;
        }
        loading = true;
        searched = false;
        searchTimer = setTimeout(async () => {
            try {
                const next = await bridge.searchMcpTargetDocuments(keyword);
                if (version !== searchVersion) return;
                results = next;
                searched = true;
            } catch (cause: any) {
                if (version !== searchVersion) return;
                results = [];
                searched = true;
                error = cause?.message || String(cause);
            } finally {
                if (version === searchVersion) loading = false;
            }
        }, 220);
    }

    async function choose(item: DocumentItem) {
        loading = true;
        error = "";
        try {
            const resolved = await bridge.resolveMcpDocumentTarget(item.id);
            value = {
                id: item.id,
                title: resolved.title || item.title || i18n?.untitled || "Untitled",
                notebookId: item.notebookId,
                notebookName: item.notebookName || "",
                path: resolved.path || item.path || "",
                icon: item.icon || "",
            };
            query = "";
            results = [];
            searched = false;
            dispatch("change", value);
        } catch (cause: any) {
            value = null;
            error = cause?.message || String(cause);
        } finally {
            loading = false;
        }
    }

    function clearSelection() {
        value = null;
        query = "";
        results = [];
        searched = false;
        error = "";
        dispatch("change", null);
    }
</script>

<div class="na-document-picker" class:na-document-picker--disabled={disabled}>
    {#if value}
        <div class="na-document-picker__selected">
            <span class="na-document-picker__icon"><NaIcon symbol="iconFile" size={14} /></span>
            <span class="na-document-picker__selected-copy">
                <strong>{value.title || i18n?.untitled || "Untitled"}</strong>
                <small>{[value.notebookName, value.path].filter(Boolean).join(" · ")}</small>
            </span>
            <NaIconButton symbol="iconClose" label={i18n?.clear || "Clear"} compact {disabled} on:click={clearSelection} />
        </div>
    {/if}

    <NaSearchInput
        bind:value={query}
        {disabled}
        placeholder={i18n?.createSearchDocuments || "Search documents"}
        ariaLabel={i18n?.createSearchDocuments || "Search documents"}
        on:input={scheduleSearch}
    />

    {#if query.trim()}
        <div class="na-document-picker__results" aria-busy={loading} aria-live="polite">
            {#if loading}
                <div class="na-document-picker__state">{i18n?.loading || "Loading..."}</div>
            {:else if error}
                <div class="na-document-picker__state na-document-picker__state--error" role="alert">{error}</div>
            {:else if searched && results.length === 0}
                <div class="na-document-picker__state">{i18n?.createNoDocuments || "No documents found"}</div>
            {:else}
                {#each results as document (document.id)}
                    <button type="button" class="na-document-picker__result" disabled={disabled} on:click={() => choose(document)}>
                        <span class="na-document-picker__icon"><NaIcon symbol="iconFile" size={14} /></span>
                        <span>
                            <strong>{document.title || i18n?.untitled || "Untitled"}</strong>
                            <small>{[document.notebookName, document.path].filter(Boolean).join(" · ")}</small>
                        </span>
                    </button>
                {/each}
            {/if}
        </div>
    {/if}
</div>

<style lang="scss">
    .na-document-picker { display: grid; gap: 7px; min-width: 0; }
    .na-document-picker--disabled { opacity: .52; }
    .na-document-picker__selected { display: grid; grid-template-columns: 28px minmax(0, 1fr) 28px; align-items: center; gap: 7px; min-height: 38px; padding: 5px 7px; box-sizing: border-box; border: 1px solid var(--na-color-divider); border-radius: var(--na-radius-sm); background: var(--b3-theme-background); }
    .na-document-picker__selected-copy, .na-document-picker__result > span:last-child { min-width: 0; }
    .na-document-picker__selected strong, .na-document-picker__selected small, .na-document-picker__result strong, .na-document-picker__result small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .na-document-picker__selected strong, .na-document-picker__result strong { color: var(--b3-theme-on-surface); font-size: var(--na-font-size-md); font-weight: 500; }
    .na-document-picker__selected small, .na-document-picker__result small { margin-top: 1px; color: var(--b3-theme-on-surface-light); font-size: var(--na-font-size-xs); }
    .na-document-picker__icon { display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--na-radius-sm); color: var(--b3-theme-on-surface-light); background: var(--b3-theme-surface); }
    .na-document-picker__results { max-height: 190px; overflow-y: auto; border: 1px solid var(--na-color-divider); border-radius: var(--na-radius-sm); background: var(--b3-theme-background); }
    .na-document-picker__result { display: grid; grid-template-columns: 28px minmax(0, 1fr); align-items: center; gap: 7px; width: 100%; min-width: 0; min-height: 40px; padding: 6px 8px; border: 0; border-bottom: 1px solid var(--na-color-divider); color: inherit; background: transparent; text-align: left; cursor: pointer; }
    .na-document-picker__result:last-child { border-bottom: 0; }
    .na-document-picker__result:hover, .na-document-picker__result:focus-visible { outline: 0; background: var(--b3-list-hover); }
    .na-document-picker__state { display: grid; place-items: center; min-height: 48px; padding: 8px 10px; color: var(--b3-theme-on-surface-light); font-size: var(--na-font-size-sm); text-align: center; }
    .na-document-picker__state--error { color: var(--na-color-error); }
</style>
