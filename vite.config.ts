import { resolve } from "path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteStaticCopy } from "vite-plugin-static-copy";

const isDev = process.env.NODE_ENV === "development";

export default defineConfig({
    css: {
        preprocessorOptions: {
            scss: {
                api: "modern-compiler",
            },
        },
    },

    plugins: [
        svelte(),

        viteStaticCopy({
            targets: [
                { src: "./plugin.json", dest: "./" },
                { src: "./icon.png", dest: "./" },
                { src: "./preview.png", dest: "./" },
                { src: "./src/i18n/*", dest: "./i18n/" },
            ],
        }),

        // Auto copy to SiYuan plugins directory in dev mode
        ...(isDev
            ? [
                  {
                      name: "auto-copy-to-siyuan",
                      writeBundle() {
                          try {
                              const { execSync } = require("child_process");
                              execSync("node --no-warnings ./scripts/make_dev_copy.js", {
                                  stdio: "inherit",
                                  cwd: process.cwd(),
                              });
                          } catch (error: any) {
                              console.warn("Auto copy to SiYuan failed:", error.message);
                          }
                      },
                  },
              ]
            : []),
    ],

    build: {
        outDir: isDev ? "dev" : "dist",
        emptyOutDir: false,
        sourcemap: isDev ? "inline" : false,
        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            fileName: "index",
            formats: ["cjs"],
        },
        rollupOptions: {
            external: ["siyuan", "process"],
            output: {
                entryFileNames: "[name].js",
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === "style.css") {
                        return "index.css";
                    }
                    return assetInfo.name as string;
                },
                manualChunks: undefined,
                inlineDynamicImports: true,
            },
        },
    },
});
