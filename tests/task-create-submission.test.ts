import test from "node:test";
import assert from "node:assert/strict";
import { createTaskSubmission } from "../src/frontend/controllers/task-create-submission.ts";

test("创建成功后回读失败，重试只读取同一任务", async () => {
    // Regression: 创建 RPC 已完成但回读失败，再次提交会创建第二个任务。
    let creates = 0;
    let reads = 0;
    const submission = createTaskSubmission({
        create: async () => {
            creates++;
            return { task: { id: "created", title: "任务" }, warnings: [], destination: {} };
        },
        resolve: async (id) => {
            reads++;
            if (reads === 1) throw new Error("离线");
            return { id };
        },
    });
    await assert.rejects(submission.submit({ title: "任务" }), /离线/);
    assert.equal(submission.createdId, "created");
    assert.deepEqual((await submission.submit({ title: "任务" })).task, { id: "created" });
    assert.equal(creates, 1);
});
