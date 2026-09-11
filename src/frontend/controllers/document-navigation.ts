export function createDocumentNavigator(api: {
    openMobile(id: string): void;
    openDesktop(id: string): Promise<unknown>;
}) {
    return async (frontend: string, blockId: string): Promise<void> => {
        if (frontend === "mobile" || frontend === "browser-mobile") api.openMobile(blockId);
        else await api.openDesktop(blockId);
    };
}

let navigator: ((blockId: string) => Promise<void>) | undefined;
export function configureDocumentNavigation(value: typeof navigator): void {
    navigator = value;
}
export function getDocumentNavigator() {
    return navigator;
}
