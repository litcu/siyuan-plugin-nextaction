<script lang="ts">
    interface Props {
        status?: string;
        touch?: boolean;
        label?: string;
        onclick?: ((e: MouseEvent) => void) | undefined;
        focusable?: boolean;
    }

    let { status = "todo", touch = false, label = status, onclick = undefined, focusable = true }: Props = $props();

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
    class="na-status-control"
    class:na-status-control--touch={touch}
    onclick={handleClick}
    onpointerdown={handlePointerDown}
    aria-label={label}
    tabindex={focusable ? 0 : -1}
>
    <span
        class="na-status-checkbox"
        class:na-status-checkbox--inbox={status === "inbox"}
        class:na-status-checkbox--doing={status === "doing"}
        class:na-status-checkbox--waiting={status === "waiting"}
        class:na-status-checkbox--someday={status === "someday"}
        class:na-status-checkbox--done={status === "done"}
        aria-hidden="true"
    ></span></button
>

<style>
    .na-status-control {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        border: 0;
        padding: 0;
        background: transparent;
        cursor: pointer;
    }
    .na-status-control--touch {
        width: 44px;
        height: 44px;
    }
</style>
