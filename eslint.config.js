import js from "@eslint/js";
import globals from "globals";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";

const typedFiles = ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts"];

export default tseslint.config(
    {
        ignores: ["dist/**", "dev/**", "vendor/**", "kernel.js", "node_modules/**"],
    },
    {
        ...js.configs.recommended,
        files: ["scripts/**/*.js", "*.js"],
        languageOptions: {
            globals: globals.node,
        },
    },
    {
        files: typedFiles,
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                project: ["./tsconfig.frontend.json", "./tsconfig.kernel.json", "./tsconfig.shared.json", "./tsconfig.tests.json"],
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        plugins: {
            "@typescript-eslint": tseslint.plugin,
        },
        rules: {
            "no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": ["error", { "checksVoidReturn": false }],
            "@typescript-eslint/consistent-type-imports": ["error", { "fixStyle": "inline-type-imports" }],
        },
    },
    ...svelte.configs.base,
    {
        files: ["src/**/*.svelte"],
        plugins: {
            "@typescript-eslint": tseslint.plugin,
        },
        languageOptions: {
            parserOptions: {
                parser: tseslint.parser,
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: [".svelte"],
            },
            globals: globals.browser,
        },
        rules: {
            "@typescript-eslint/no-explicit-any": "warn",
        },
    },
    {
        files: ["tests/**/*.ts"],
        rules: {
            "@typescript-eslint/no-floating-promises": "off",
            "@typescript-eslint/no-misused-promises": "off",
        },
    },
);
