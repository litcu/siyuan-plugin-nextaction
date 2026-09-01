import test from "node:test";
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";

test("生产前端入口只通过统一边界挂载和销毁 Svelte 组件", () => {
    const violations: string[] = [];
    for (const file of globSync("src/frontend/**/*.ts")) {
        const source = readFileSync(file, "utf8");
        if (
            !file.endsWith("/svelte-mount.ts") &&
            /import\s*\{[^}]*\b(?:mount|unmount)\b[^}]*\}\s*from\s*"svelte"/s.test(source)
        ) {
            violations.push(`${file}: direct Svelte mount API import`);
        }
        if (/\bnew\s+[A-Za-z_$][\w$]*\s*\(\s*\{\s*target\b/m.test(source)) {
            violations.push(`${file}: direct component construction`);
        }
        if (/\$destroy\s*\(/.test(source)) {
            violations.push(`${file}: direct $destroy call`);
        }
    }

    // 静态架构守卫；生命周期行为由 svelte-mount-browser.test.ts 覆盖。
    assert.deepEqual(violations, []);
});
