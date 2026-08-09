import test from "node:test";
import assert from "node:assert/strict";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import {
    countReviewAttentionTasks,
    isTaskDueOverdue,
    isTaskReviewDue,
} from "../src/shared/review.ts";

function task(overrides: Partial<TaskCacheEntry>): TaskCacheEntry {
    return {
        blockId: "task",
        parentId: "",
        status: "todo",
        priority: "none",
        importance: 4,
        effort: 4,
        due: "",
        start: "",
        context: "",
        taskType: "1",
        order: 0,
        childIds: [],
        title: "Task",
        depends: "",
        depMode: "all",
        sequential: false,
        blocked: false,
        blockedReason: "",
        completed: "",
        created: "",
        updated: "",
        repeat: "",
        repeatState: "",
        sort: -1,
        note: "",
        tags: "",
        reviewInterval: 0,
        reviewDate: "",
        reminder: "",
        customFields: {},
        ...overrides,
    };
}

test("回顾角标统计待回顾或逾期任务，并对同时命中的任务去重", () => {
    const now = new Date(2026, 7, 9, 12, 0, 0);
    const tasks = [
        task({ blockId: "review", reviewInterval: 7, reviewDate: "2026-08-09" }),
        task({ blockId: "overdue", due: "2026-08-08" }),
        task({ blockId: "both", due: "2026-08-08", reviewInterval: 7, reviewDate: "2026-08-01" }),
        task({ blockId: "today", due: "2026-08-09" }),
        task({ blockId: "done", status: "done", due: "2026-08-01", reviewInterval: 7, reviewDate: "2026-08-01" }),
    ];

    assert.equal(countReviewAttentionTasks(tasks, "2026-08-09", now), 3);
});

test("回顾日期与具体截止时间使用一致的到期边界", () => {
    const now = new Date(2026, 7, 9, 12, 0, 0);
    assert.equal(isTaskReviewDue(task({ reviewInterval: 7, reviewDate: "2026-08-09" }), "2026-08-09"), true);
    assert.equal(isTaskDueOverdue(task({ due: "2026-08-09T11:59" }), "2026-08-09", now), true);
    assert.equal(isTaskDueOverdue(task({ due: "2026-08-09T12:01" }), "2026-08-09", now), false);
    assert.equal(isTaskDueOverdue(task({ due: "2026-08-09" }), "2026-08-09", now), false);
});
