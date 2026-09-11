import * as siyuan from "siyuan";
import type { App } from "siyuan";
import { createDocumentNavigator, configureDocumentNavigation } from "./document-navigation";

export function configureDocumentNavigationForApp(app: App): void {
    const navigate = createDocumentNavigator({
        openMobile: (id) => siyuan.openMobileFileById(app, id, ["cb-get-context", "cb-get-hl"]),
        openDesktop: (id) =>
            siyuan.openTab({ app, doc: { id, action: ["cb-get-focus", "cb-get-context", "cb-get-hl"] } }),
    });
    configureDocumentNavigation((id) => navigate(siyuan.getFrontend(), id));
}
