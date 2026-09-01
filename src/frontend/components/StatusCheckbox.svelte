<script lang="ts">
    interface Props {
        status?: string;
        onclick?: ((e: MouseEvent) => void) | undefined;
        focusable?: boolean;
    }

    let { status = "todo", onclick = undefined, focusable = true }: Props = $props();

    function handleClick(event: MouseEvent): void {
        event.stopPropagation();
        onclick?.(event);
    }

    function handlePointerDown(event: PointerEvent): void {
        event.stopPropagation();
    }
</script>

<button
    type="button"
    class="na-status-checkbox"
    class:na-status-checkbox--inbox={status === "inbox"}
    class:na-status-checkbox--doing={status === "doing"}
    class:na-status-checkbox--waiting={status === "waiting"}
    class:na-status-checkbox--someday={status === "someday"}
    class:na-status-checkbox--done={status === "done"}
    onclick={handleClick}
    onpointerdown={handlePointerDown}
    aria-label={status}
    tabindex={focusable ? 0 : -1}
></button>
