import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("我的一天不再受可选启用项控制", () => {
    const files = [
        "../src/shared/settings.ts",
        "../src/frontend/components/SettingsPanel.svelte",
        "../src/frontend/components/settings/GeneralSettingsPage.svelte",
        "../src/frontend/components/NextActionApp.svelte",
        "../src/frontend/components/DockSidebar.svelte",
        "../src/frontend/components/NavRail.svelte",
        "../src/frontend/components/TaskDetail.svelte",
        "../src/index.ts",
    ];
    for (const file of files) assert.doesNotMatch(source(file), /myDayEnabled|setting-myday-enabled/);
});
