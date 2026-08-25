import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { findTemplateLiterals } from "../scripts/text-scanner.js";

test("模板字符串扫描在线性时间内处理反斜杠密集的未闭合输入", () => {
    // Regression: 回溯型正则会在反斜杠密集的未闭合模板字符串上长时间阻塞架构检查。
    const source = `\`${"\\".repeat(40_000)}`;
    const startedAt = performance.now();

    assert.deepEqual(findTemplateLiterals(source), []);
    assert.ok(performance.now() - startedAt < 250);
});

test("模板字符串扫描保留字面量位置并跳过转义反引号", () => {
    const source = 'const query = sql`SELECT "escaped \\` tick" FROM tasks WHERE id = ${id}`;';

    assert.deepEqual(findTemplateLiterals(source), [
        {
            index: source.indexOf("`"),
            literal: '`SELECT "escaped \\` tick" FROM tasks WHERE id = ${id}`',
        },
    ]);
});
