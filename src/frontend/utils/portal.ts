export function portal(node: HTMLElement, enabled = true) {
    let active = false;
    let originalParent: Node | null = node.parentNode;
    let originalNextSibling: Node | null = node.nextSibling;
    const hadThemeScope = node.classList.contains("nextaction");

    function mountToBody() {
        if (!enabled || active || typeof document === "undefined") return;
        originalParent = node.parentNode;
        originalNextSibling = node.nextSibling;
        node.classList.add("nextaction");
        document.body.appendChild(node);
        active = true;
    }

    function restore() {
        if (!active) return;
        if (originalParent && originalParent.isConnected) {
            originalParent.insertBefore(
                node,
                originalNextSibling && originalNextSibling.parentNode === originalParent ? originalNextSibling : null,
            );
        } else {
            node.remove();
        }
        if (!hadThemeScope) node.classList.remove("nextaction");
        active = false;
    }

    mountToBody();

    return {
        update(nextEnabled: boolean) {
            enabled = nextEnabled;
            if (enabled) mountToBody();
            else restore();
        },
        destroy() {
            if (active) node.remove();
        },
    };
}
