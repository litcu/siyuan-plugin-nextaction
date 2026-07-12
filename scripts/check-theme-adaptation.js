import { readFileSync } from "node:fs";

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
