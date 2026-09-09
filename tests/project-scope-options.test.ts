import test from "node:test";
import assert from "node:assert/strict";
import { projectScopeOptions } from "../src/frontend/utils/project-scope-options.ts";
import type { TaskCacheEntry } from "../src/shared/types.ts";

const tasks = [
    { blockId: "p1", title: "产品发布", taskType: "2", identificationSource: "document", status: "doing" },
    { blockId: "p2", title: "历史发布", taskType: "2", identificationSource: "document", status: "done" },
    { blockId: "p3", title: "Website", taskType: "2", identificationSource: "document", status: "todo" },
    { blockId: "t1", title: "发布任务", taskType: "1", identificationSource: "document", status: "todo" },
] as TaskCacheEntry[];

test("指定项目按名称搜索全部项目，包含已完成项目并排除普通任务", () => {
    // Regression: 指定项目原先只能手填块 ID，无法按名称搜索并选择多个项目。
    assert.deepEqual(
        projectScopeOptions(tasks, " 发布 ").map((option) => option.id),
        ["p1", "p2"],
    );
    assert.equal(projectScopeOptions(tasks, "").length, 3);
    assert.deepEqual(projectScopeOptions(tasks, "WEB"), [{ id: "p3", label: "Website" }]);
    assert.deepEqual(projectScopeOptions(tasks, "不存在"), []);
});

test("同名项目保留独立身份，无标题项目回退到块 ID", () => {
    const options = projectScopeOptions(
        [...tasks, { ...tasks[0], blockId: "p4" }, { ...tasks[0], blockId: "p5", title: " " }],
        "",
    );
    assert.equal(options.filter((option) => option.label === "产品发布").length, 2);
    assert.deepEqual(
        options.find((option) => option.id === "p5"),
        { id: "p5", label: "p5" },
    );
});
