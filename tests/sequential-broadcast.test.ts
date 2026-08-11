import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

const prioritySource = source("../src/kernel/priority-engine.ts");
const serviceSource = source("../src/kernel/task-service.ts");
const helperSection = prioritySource.slice(prioritySource.indexOf("export function getSequentialBroadcastIds("));
const updateSection = serviceSource.slice(serviceSource.indexOf("async updateTask("), serviceSource.indexOf("async updateTaskTitle("));
const reorderSection = serviceSource.slice(serviceSource.indexOf("async reorderTask("), serviceSource.indexOf("// ---- Read operations ----", serviceSource.indexOf("async reorderTask(")));

test("顺序广播 helper 导出并处理项目开关及全部子任务", () => {
    assert.match(prioritySource, /export function getSequentialBroadcastIds\(/);
    assert.match(helperSection, /attrs\[ATTR_SEQUENTIAL\] !== undefined && updatedEntry\.taskType === "2"/);
    assert.match(helperSection, /for \(const childId of updatedEntry\.childIds\)/);
});

test("顺序父任务中的状态变化广播其他兄弟", () => {
    assert.match(helperSection, /attrs\[ATTR_STATUS\] !== undefined && updatedEntry\.parentId !== ""/);
    assert.match(helperSection, /if \(parent && parent\.sequential\)/);
    assert.match(helperSection, /if \(siblingId !== blockId\) result\.push\(siblingId\)/);
});

test("父任务变化覆盖旧父和新父的顺序兄弟", () => {
    assert.match(helperSection, /attrs\[ATTR_PARENT\] !== undefined && previousEntry && previousEntry\.parentId !== updatedEntry\.parentId/);
    assert.match(helperSection, /const oldParent = cache\[previousEntry\.parentId\]/);
    assert.match(helperSection, /const newParent = cache\[updatedEntry\.parentId\]/);
});

test("依赖关系和被依赖任务状态变化会广播关联任务", () => {
    assert.match(helperSection, /attrs\[ATTR_DEPENDS\] !== undefined \|\| attrs\[ATTR_STATUS\] !== undefined/);
    assert.match(helperSection, /other\.depends && other\.depends\.includes\(blockId\)/);
    assert.match(helperSection, /result\.push\(other\.blockId\)/);
});

test("仅重要性等非阻塞属性变化不会进入副作用分支", () => {
    assert.doesNotMatch(helperSection, /ATTR_IMPORTANCE/);
});

test("任务服务将状态纳入项目排序字段并移除 done 专用分支", () => {
    assert.match(updateSection, /const orderFields = \[ATTR_IMPORTANCE, ATTR_EFFORT, ATTR_PRIORITY, ATTR_DUE, ATTR_START, ATTR_STATUS\]/);
    assert.doesNotMatch(updateSection, /If status changed to done, check parent/);
});

test("updateTask 在广播前登记顺序副作用任务", () => {
    assert.match(updateSection, /const affectedIds = getSequentialBroadcastIds\([\s\S]*?syncEngine\.broadcastChanges\(\)/);
    assert.match(updateSection, /for \(let i = 0; i < affectedIds\.length; i\+\+\)/);
    assert.match(updateSection, /addPendingChange\(affectedIds\[i\], "update"\)/);
});

test("reorderTask 在顺序父任务中广播全部兄弟", () => {
    assert.match(reorderSection, /if \(parentId\)/);
    assert.match(reorderSection, /if \(parentEntry && parentEntry\.sequential\)/);
    assert.match(reorderSection, /addPendingChange\(parentEntry\.childIds\[i\], "update"\)/);
});
