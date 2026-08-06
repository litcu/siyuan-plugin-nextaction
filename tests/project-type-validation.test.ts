import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const taskServiceSource = readFileSync(new URL("../src/kernel/task-service.ts", import.meta.url), "utf8");
const frontendSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const constantsSource = readFileSync(new URL("../src/shared/constants.ts", import.meta.url), "utf8");

test("单块转换在 knownTextBlock 路径也校验项目必须是文档", () => {
    assert.match(taskServiceSource, /if \(taskType === "2" \|\| !options\.knownTextBlock\)/);
    assert.match(taskServiceSource, /this\.assertProjectBlockType\(taskType, blockType\)/);
    assert.match(taskServiceSource, /blockType !== "d"/);
});

test("属性更新和带子树入口都不能绕过项目类型校验", () => {
    assert.match(taskServiceSource, /if \(attrs\[ATTR_TASK\] === "2"\)/);
    assert.match(taskServiceSource, /async convertToTaskWithChildren/);
    assert.match(taskServiceSource, /if \(taskType === "2"\)[\s\S]*?errProjectRequiresDocument/);
});

test("内核错误码和前端直连回退路径均覆盖项目校验", () => {
    assert.match(constantsSource, /RPC_ERROR_PROJECT_REQUIRES_DOCUMENT = -32009/);
    assert.match(frontendSource, /if \(taskType === "2"\)/);
    assert.match(frontendSource, /blockType !== "d"/);
});
