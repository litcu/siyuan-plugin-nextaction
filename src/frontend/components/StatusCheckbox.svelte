<script lang="ts">
    export let status: string = "todo";
    export let onclick: ((e: MouseEvent) => void) | undefined = undefined;
</script>

<span
    class="na-status-checkbox"
    class:na-status-checkbox--inbox={status === "inbox"}
    class:na-status-checkbox--doing={status === "doing"}
    class:na-status-checkbox--waiting={status === "waiting"}
    class:na-status-checkbox--someday={status === "someday"}
    class:na-status-checkbox--done={status === "done"}
    on:click|stopPropagation={(e) => { if (onclick) onclick(e); }}
    on:pointerdown|stopPropagation
></span>
