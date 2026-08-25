import test from "node:test";
import assert from "node:assert/strict";
import {
    ProjectDefinitionController,
    ProjectDefinitionControllerRegistry,
    type ProjectDefinitionValues,
} from "../src/frontend/controllers/project-definition-controller.ts";

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

test("保存 Outcome 后采用权威项目定义并清除草稿", async () => {
    const controller = new ProjectDefinitionController(
        { outcome: "旧结果", dod: "旧判定" },
        {
            save: async (field, value): Promise<ProjectDefinitionValues> => {
                assert.equal(field, "outcome");
                assert.equal(value, "新结果");
                return { outcome: "权威结果", dod: "权威判定" };
            },
            formatError: String,
        },
    );

    controller.edit("outcome", "新结果");
    assert.equal(await controller.save("outcome"), true);

    assert.deepEqual(controller.snapshot.outcome, {
        remote: "权威结果",
        draft: "权威结果",
        dirty: false,
        saveState: "saved",
        error: "",
        conflict: null,
    });
    assert.equal(controller.snapshot.dod.remote, "权威判定");
    assert.equal(controller.snapshot.dod.draft, "权威判定");
});

test("取消 DoD 草稿恢复远端值且不写入", () => {
    let wrote = false;
    const controller = new ProjectDefinitionController(
        { outcome: "结果", dod: "远端判定" },
        {
            save: async () => {
                wrote = true;
                return { outcome: "结果", dod: "不应写入" };
            },
            formatError: String,
        },
    );

    controller.edit("dod", "本地判定");
    controller.cancel("dod");

    assert.equal(wrote, false);
    assert.deepEqual(controller.snapshot.dod, {
        remote: "远端判定",
        draft: "远端判定",
        dirty: false,
        saveState: "idle",
        error: "",
        conflict: null,
    });
});

test("保存期间重复提交只产生一次写入", async () => {
    const saving = deferred<ProjectDefinitionValues>();
    const writes: string[] = [];
    const controller = new ProjectDefinitionController(
        { outcome: "旧结果", dod: "判定" },
        {
            save: async (_field, value) => {
                writes.push(value);
                return saving.promise;
            },
            formatError: String,
        },
    );
    controller.edit("outcome", "新结果");

    const first = controller.save("outcome");
    const duplicate = controller.save("outcome");

    assert.equal(controller.snapshot.outcome.saveState, "saving");
    assert.deepEqual(writes, ["新结果"]);
    saving.resolve({ outcome: "新结果", dod: "判定" });
    assert.deepEqual(await Promise.all([first, duplicate]), [true, true]);
});

test("任一字段保存期间拒绝提交另一个字段", async () => {
    const saving = deferred<ProjectDefinitionValues>();
    const writes: string[] = [];
    const controller = new ProjectDefinitionController(
        { outcome: "旧结果", dod: "旧判定" },
        {
            save: async (field) => {
                writes.push(field);
                return saving.promise;
            },
            formatError: String,
        },
    );
    controller.edit("outcome", "新结果");
    controller.edit("dod", "新判定");

    const outcomeSave = controller.save("outcome");
    assert.equal(await controller.save("dod"), false);
    assert.deepEqual(writes, ["outcome"]);
    saving.resolve({ outcome: "新结果", dod: "旧判定" });
    assert.equal(await outcomeSave, true);
    assert.equal(controller.snapshot.dod.draft, "新判定");
});

test("外部更新不会覆盖 Outcome 脏草稿并要求先解决冲突", async () => {
    let wrote = false;
    const controller = new ProjectDefinitionController(
        { outcome: "旧结果", dod: "旧判定" },
        {
            save: async () => {
                wrote = true;
                return { outcome: "本地结果", dod: "远端判定" };
            },
            formatError: String,
        },
    );
    controller.edit("outcome", "本地结果");

    controller.sync({ outcome: "远端结果", dod: "远端判定" });

    assert.deepEqual(controller.snapshot.outcome, {
        remote: "远端结果",
        draft: "本地结果",
        dirty: true,
        saveState: "idle",
        error: "",
        conflict: "远端结果",
    });
    assert.equal(controller.snapshot.dod.draft, "远端判定");
    assert.equal(await controller.save("outcome"), false);
    assert.equal(wrote, false);
});

test("重新载入远端值会丢弃冲突草稿", () => {
    const controller = new ProjectDefinitionController(
        { outcome: "旧结果", dod: "判定" },
        {
            save: async () => ({ outcome: "不应写入", dod: "判定" }),
            formatError: String,
        },
    );
    controller.edit("outcome", "本地结果");
    controller.sync({ outcome: "远端结果", dod: "判定" });

    controller.reloadRemote("outcome");

    assert.deepEqual(controller.snapshot.outcome, {
        remote: "远端结果",
        draft: "远端结果",
        dirty: false,
        saveState: "idle",
        error: "",
        conflict: null,
    });
});

test("保留冲突草稿后可再次确认并保存", async () => {
    const writes: string[] = [];
    const controller = new ProjectDefinitionController(
        { outcome: "旧结果", dod: "判定" },
        {
            save: async (_field, value) => {
                writes.push(value);
                return { outcome: value, dod: "判定" };
            },
            formatError: String,
        },
    );
    controller.edit("outcome", "本地结果");
    controller.sync({ outcome: "远端结果", dod: "判定" });

    controller.keepDraft("outcome");
    assert.equal(controller.snapshot.outcome.conflict, null);
    assert.equal(controller.snapshot.outcome.dirty, true);
    assert.equal(await controller.save("outcome"), true);
    assert.deepEqual(writes, ["本地结果"]);
});

test("保存一个字段不会覆盖另一个字段的未保存草稿", async () => {
    const controller = new ProjectDefinitionController(
        { outcome: "旧结果", dod: "旧判定" },
        {
            save: async () => ({ outcome: "权威结果", dod: "旧判定" }),
            formatError: String,
        },
    );
    controller.edit("outcome", "本地结果");
    controller.edit("dod", "本地判定");

    await controller.save("outcome");

    assert.deepEqual(controller.snapshot.dod, {
        remote: "旧判定",
        draft: "本地判定",
        dirty: true,
        saveState: "idle",
        error: "",
        conflict: null,
    });
});

test("保存失败保留草稿和字段错误并可重试", async () => {
    let attempts = 0;
    const controller = new ProjectDefinitionController(
        { outcome: "旧结果", dod: "判定" },
        {
            save: async (_field, value) => {
                attempts++;
                if (attempts === 1) throw new Error("索引写入失败");
                return { outcome: value, dod: "判定" };
            },
            formatError: (error) => (error instanceof Error ? error.message : String(error)),
        },
    );
    controller.edit("outcome", "可恢复草稿");

    assert.equal(await controller.save("outcome"), false);
    assert.equal(controller.snapshot.outcome.draft, "可恢复草稿");
    assert.equal(controller.snapshot.outcome.dirty, true);
    assert.equal(controller.snapshot.outcome.saveState, "error");
    assert.equal(controller.snapshot.outcome.error, "索引写入失败");
    assert.equal(await controller.save("outcome"), true);
});

test("清空 DoD 仍作为有效草稿写入", async () => {
    const writes: string[] = [];
    const controller = new ProjectDefinitionController(
        { outcome: "结果", dod: "完成判定" },
        {
            save: async (_field, value) => {
                writes.push(value);
                return { outcome: "结果", dod: value };
            },
            formatError: String,
        },
    );

    controller.edit("dod", "");
    assert.equal(await controller.save("dod"), true);

    assert.deepEqual(writes, [""]);
    assert.equal(controller.snapshot.dod.remote, "");
    assert.equal(controller.snapshot.dod.dirty, false);
});

// Regression: 编辑器卸载并重挂载时曾丢失项目定义草稿，并继续持有旧保存回调。
test("项目定义会话跨编辑器重挂载保留草稿并重新绑定保存边界", async () => {
    const registry = new ProjectDefinitionControllerRegistry();
    const first = registry.acquire(
        "project",
        { outcome: "远端结果", dod: "远端判定" },
        {
            save: async () => {
                throw new Error("不应调用旧保存边界");
            },
            formatError: String,
        },
    );
    first.edit("outcome", "跨导航草稿");

    const writes: string[] = [];
    const remounted = registry.acquire(
        "project",
        { outcome: "远端结果", dod: "远端判定" },
        {
            save: async (_field, value) => {
                writes.push(value);
                return { outcome: value, dod: "远端判定" };
            },
            formatError: String,
        },
    );

    assert.equal(remounted, first);
    assert.equal(remounted.snapshot.outcome.draft, "跨导航草稿");
    assert.equal(await remounted.save("outcome"), true);
    assert.deepEqual(writes, ["跨导航草稿"]);
});

// Regression: 保存中替换编辑器订阅后，异步失败曾不会更新重挂载实例的错误状态。
test("项目定义控制器向重挂载订阅者发布异步保存结果", async () => {
    let rejectSave!: (error: Error) => void;
    const saving = new Promise<ProjectDefinitionValues>((_resolve, reject) => {
        rejectSave = reject;
    });
    const controller = new ProjectDefinitionController(
        { outcome: "远端结果", dod: "远端判定" },
        {
            save: async () => saving,
            formatError: (error) => (error instanceof Error ? error.message : String(error)),
        },
    );
    controller.edit("outcome", "失败草稿");
    const pending = controller.save("outcome");

    const observedStates: string[] = [];
    const unsubscribe = controller.subscribe((snapshot) => observedStates.push(snapshot.outcome.saveState));
    rejectSave(new Error("远端写入失败"));

    assert.equal(await pending, false);
    assert.equal(observedStates[observedStates.length - 1], "error");
    assert.equal(controller.snapshot.outcome.draft, "失败草稿");
    assert.equal(controller.snapshot.outcome.error, "远端写入失败");
    unsubscribe();
});
