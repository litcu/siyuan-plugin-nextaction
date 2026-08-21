export const NATIVE_TASK_ITEM_SELECTOR =
    '[data-type="NodeListItem"][data-subtype="t"], [data-type="NodeList"][data-subtype="t"] > [data-type="NodeListItem"]';

export function getOwnedNativeTaskActions(taskBlock: HTMLElement): HTMLElement[] {
    return Array.from(taskBlock.querySelectorAll<HTMLElement>(".protyle-action--task")).filter(
        (action) => action.closest(NATIVE_TASK_ITEM_SELECTOR) === taskBlock,
    );
}
