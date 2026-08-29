<script lang="ts">
    export let status: string = "todo";
    export let ariaLabel = "";
    export let onclick: ((e: MouseEvent) => void) | undefined = undefined;
    export let focusable = true;
</script>

<button
    type="button"
    class="na-status-checkbox"
    class:na-status-checkbox--inbox={status === "inbox"}
    class:na-status-checkbox--doing={status === "doing"}
    class:na-status-checkbox--waiting={status === "waiting"}
    class:na-status-checkbox--someday={status === "someday"}
    class:na-status-checkbox--done={status === "done"}
    on:click|stopPropagation={(e) => {
        if (onclick) onclick(e);
    }}
    on:pointerdown|stopPropagation
    aria-label={ariaLabel || status}
    tabindex={focusable ? 0 : -1}
></button>
