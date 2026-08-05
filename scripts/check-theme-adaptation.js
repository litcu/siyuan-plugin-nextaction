import { existsSync, readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

const checks = [
  {
    name: "theme tokens expose accent and danger colors",
    run() {
      const tokens = read("src/frontend/ui/tokens.scss");
      return tokens.includes("--na-accent:") && tokens.includes("--na-danger:");
    },
  },
  {
    name: "dock My Day provides the shared timeline theme variables",
    run() {
      const dockMyDay = read("src/frontend/components/DockMyDay.svelte");
      return [
        "--na-myday-panel-bg:",
        "--na-myday-panel-border:",
        "--na-myday-panel-soft-bg:",
      ].every((needle) => dockMyDay.includes(needle));
    },
  },
  {
    name: "notification styles use global SiYuan colors for accent states",
    run() {
      const styles = read("src/index.scss");
      const notificationBlock = styles.slice(styles.indexOf(".na-notification-host"));
      return !notificationBlock.includes("var(--na-accent");
    },
  },
  {
    name: "shared select arrow is theme-colored rather than fixed #aaa",
    run() {
      const primitives = read("src/frontend/ui/primitives.scss");
      return !primitives.includes("stroke='%23aaa'");
    },
  },
  {
    name: "filter active states use soft theme tokens instead of solid active color",
    run() {
      const dropdown = read("src/frontend/ui/NaFilterDropdown.svelte");
      return [
        "--na-filter-active-bg",
        "--na-filter-active-bg-hover",
        "--na-filter-active-border",
        "--na-filter-active-fg",
      ].every((needle) => dropdown.includes(needle))
        && !dropdown.includes("background: var(--na-filter-active-color");
    },
  },
  {
    name: "sort dropdown active states reuse filter active tokens",
    run() {
      const sortSelect = read("src/frontend/ui/NaSortSelect.svelte");
      return [
        "--na-filter-active-bg",
        "--na-filter-active-bg-hover",
        "--na-filter-active-border",
        "--na-filter-active-fg",
      ].every((needle) => sortSelect.includes(needle))
        && !sortSelect.includes("rgba(79, 195, 247");
    },
  },
  {
    name: "modern settings pages rely on SiYuan theme variables",
    run() {
      const files = [
        "src/frontend/components/settings/GeneralSettingsPage.svelte",
        "src/frontend/components/settings/CustomFieldsSettingsPage.svelte",
        "src/frontend/components/settings/AiSettingsPage.svelte",
        "src/frontend/components/settings/McpSettingsPage.svelte",
        "src/frontend/components/settings/AdvancedSettingsPage.svelte",
      ];
      return files.every((path) => {
        const source = read(path);
        return source.includes("var(--b3-")
          && !/#(?:fff(?:fff)?|000(?:000)?)\b/i.test(source)
          && !/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\.1\s*\)/i.test(source);
      });
    },
  },
  {
    name: "public Na UI layer uses SiYuan colors only",
    run() {
      const files = readdirSync("src/frontend/ui")
        .filter((name) => name.endsWith(".svelte") || name.endsWith(".scss"));
      return files.every((name) => {
        const source = read(`src/frontend/ui/${name}`);
        return !/(?:#[0-9a-f]{3,8}\b|rgba?\s*\()/i.test(source);
      });
    },
  },
  {
    name: "public Svelte components use the Na prefix",
    run() {
      return readdirSync("src/frontend/ui")
        .filter((name) => name.endsWith(".svelte"))
        .every((name) => name.startsWith("Na"));
    },
  },
  {
    name: "task property panel and dialog hosts use theme-derived colors only",
    run() {
      const files = [
        "src/frontend/components/TaskDetail.svelte",
        "src/frontend/components/NextActionApp.svelte",
        "src/frontend/components/DockSidebar.svelte",
        "src/frontend/dialogs/task-property-dialogs.ts",
      ];
      return files.every((path) => {
        const source = read(path);
        return !/(?:#[0-9a-f]{3,8}\b|rgba?\s*\(|hsla?\s*\()/i.test(source);
      });
    },
  },
  {
    name: "legacy task detail and popup visual layers were removed",
    run() {
      const styles = read("src/index.scss");
      return !styles.includes(".na-detail__")
        && !styles.includes(".na-reminder-popup")
        && !styles.includes(".na-app__detail-pane")
        && !existsSync("src/frontend/components/ReminderPopup.svelte")
        && !existsSync("src/frontend/components/RepeatRuleDialog.svelte");
    },
  },
];

let failed = 0;

for (const check of checks) {
  if (check.run()) {
    console.log(`PASS ${check.name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${check.name}`);
  }
}

process.exitCode = failed === 0 ? 0 : 1;
