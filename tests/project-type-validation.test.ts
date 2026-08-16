import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const taskServiceSource = readFileSync(new URL("../src/kernel/task-lifecycle-service.ts", import.meta.url), "utf8");
const frontendSource = readFileSync(new URL("../src/frontend/controllers/task-command-controller.ts", import.meta.url), "utf8");
const constantsSource = readFileSync(new URL("../src/shared/constants.ts", import.meta.url), "utf8");

test("单块转换在 knownTextBlock 路径也校验项目必须是文档", () => {
    assert.match(taskServiceSource, /if \(taskType === "2" && options\.knownTextBlock\)/);
    assert.match(taskServiceSource, /this\.assertProjectBlockType\(taskType, blockType\)/);
    assert.match(taskServiceSource, /blockType !== "d"/);
});

test("属性更新和带子树入口都不能绕过项目类型校验", () => {
    assert.match(taskServiceSource, /if \(attrs\[ATTR_TASK\] === "2"\)/);
    assert.match(taskServiceSource, /async convertToTaskWithChildren/);
    assert.match(taskServiceSource, /if \(taskType === "2"\)[\s\S]*?errProjectRequiresDocument/);
});

test("任务属性目标只允许文本块和文档块", () => {
    assert.match(taskServiceSource, /blockType !== "p" && blockType !== "h" && blockType !== "d"/);
    assert.match(taskServiceSource, /private async resolveTaskAttributeBlock/);
    assert.match(taskServiceSource, /blockType === "i"[\s\S]*getChildBlocks[\s\S]*child\.type === "p" \|\| child\.type === "h"/);
    assert.match(taskServiceSource, /const cachedTask = this\.cacheManager\.get\(blockId\)/);
    assert.match(taskServiceSource, /if \(attrs\[ATTR_TASK\] === "2" \|\| \(!cachedTask && !hasExistingTaskAttrs\)\)[\s\S]*this\.assertTaskAttributeBlockType\(blockType\);/);
});

test("缓存尚未同步时，已有任务属性仍可更新", () => {
    assert.match(taskServiceSource, /let existingAttrsForValidation: Record<string, string> \| null = null;/);
    assert.match(taskServiceSource, /existingAttrsForValidation = await this\.repository\.getBlockAttrs\(blockId\);/);
    assert.match(taskServiceSource, /const hasExistingTaskAttrs = !!existingAttrsForValidation\?\.\[ATTR_TASK\];/);
    assert.match(taskServiceSource, /if \(attrs\[ATTR_TASK\] === "2" \|\| \(!cachedTask && !hasExistingTaskAttrs\)\)/);
});

test("内核错误码覆盖项目校验且前端不再保留直连回退", () => {
    assert.match(constantsSource, /RPC_ERROR_PROJECT_REQUIRES_DOCUMENT = -32009/);
    assert.doesNotMatch(frontendSource, /\/api\/attr\//);
    assert.doesNotMatch(frontendSource, /\/api\/query\/sql/);
    assert.match(frontendSource, /return this\.getBridge\(\)\.convertToTask\(blockId, cleanTitle, taskType\)/);
});
