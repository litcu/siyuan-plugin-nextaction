export const NATIVE_TASK_ITEM_SELECTOR =
    '[data-type="NodeListItem"][data-subtype="t"], [data-type="NodeList"][data-subtype="t"] > [data-type="NodeListItem"]';

export interface EditorTaskTarget {
    blockId: string;
    identificationSource: "native" | "document";
    taskElement: HTMLElement;
    ownedActions: HTMLElement[];
}

function ownedNativeActions(taskElement: HTMLElement): HTMLElement[] {
    return Array.from(taskElement.querySelectorAll<HTMLElement>(".protyle-action--task")).filter(
        (action) => action.closest(NATIVE_TASK_ITEM_SELECTOR) === taskElement,
    );
}

function toTarget(taskElement: HTMLElement, identificationSource: "native" | "document"): EditorTaskTarget | null {
    const blockId = taskElement.dataset.nodeId || "";
    if (!blockId) return null;
    return {
        blockId,
        identificationSource,
        taskElement,
        ownedActions: identificationSource === "native" ? ownedNativeActions(taskElement) : [],
    };
}

export function closestTaskTarget(target: HTMLElement): EditorTaskTarget | null {
    const native = target.closest(`[data-node-id]:is(${NATIVE_TASK_ITEM_SELECTOR})`) as HTMLElement | null;
    if (native) return toTarget(native, "native");
    const documentTask = target.matches("[data-node-id][custom-na-task]") ? target : null;
    return documentTask ? toTarget(documentTask, "document") : null;
}

export function scanNativeTaskTargets(root: ParentNode): EditorTaskTarget[] {
    const elements: HTMLElement[] = [];
    if (root instanceof Element) {
        if (root.matches(`[data-node-id]:is(${NATIVE_TASK_ITEM_SELECTOR})`)) elements.push(root as HTMLElement);
        const closest = root.closest(`[data-node-id]:is(${NATIVE_TASK_ITEM_SELECTOR})`) as HTMLElement | null;
        if (closest) elements.push(closest);
    }
    elements.push(...Array.from(root.querySelectorAll<HTMLElement>(`[data-node-id]:is(${NATIVE_TASK_ITEM_SELECTOR})`)));
    return [...new Set(elements)]
        .map((element) => toTarget(element, "native"))
        .filter((target): target is EditorTaskTarget => !!target);
}

export function indexNativeTaskTargets(root: ParentNode): Map<string, EditorTaskTarget[]> {
    const targetsById = new Map<string, EditorTaskTarget[]>();
    for (const target of scanNativeTaskTargets(root)) {
        const targets = targetsById.get(target.blockId);
        if (targets) targets.push(target);
        else targetsById.set(target.blockId, [target]);
    }
    return targetsById;
}

export function containsNativeTaskTarget(root: ParentNode): boolean {
    if (root instanceof Element && root.matches(`[data-node-id]:is(${NATIVE_TASK_ITEM_SELECTOR})`)) return true;
    return !!root.querySelector(`[data-node-id]:is(${NATIVE_TASK_ITEM_SELECTOR})`);
}
