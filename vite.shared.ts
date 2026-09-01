import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export const frontendViteAliases = {
    "chrono-node/en": resolve(projectRoot, "node_modules/chrono-node/dist/esm/locales/en/index.js"),
    "chrono-node/zh/hans": resolve(projectRoot, "node_modules/chrono-node/dist/esm/locales/zh/hans/index.js"),
};

export const frontendInlineDynamicImports = true;
