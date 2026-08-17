import test from "node:test";
import assert from "node:assert/strict";
import {
    canSaveTaskDetailNow,
    isTaskDateRangeValid,
    shouldConfirmTaskDetailClose,
    shouldContinueTaskDetailSave,
    taskDetailDraftKey,
    type TaskDetailDraft,
} from "../src/frontend/utils/task-detail-draft.ts";

const draft = (overrides: Partial<TaskDetailDraft> = {}): TaskDetailDraft => ({
    status: "todo",
    priority: "medium",
    importance: 4,
    effort: 4,
    due: "",
    start: "",
    note: "",
    contexts: [],
    taskTags: [],
    parentId: "",
    depends: [],
    depMode: "all",
    sequentialEnabled: false,
    taskType: "1",
    reviewInterval: 0,
    reviewDate: "",
    customFieldValues: {},
    ...overrides,
});

test("任务详情草稿键覆盖父任务、任务类型、关系和自定义字段", () => {
    const baseline = taskDetailDraftKey(draft());
    assert.notEqual(taskDetailDraftKey(draft({ parentId: "parent" })), baseline);
    assert.notEqual(taskDetailDraftKey(draft({ taskType: "2" })), baseline);
    assert.notEqual(taskDetailDraftKey(draft({ depends: ["dependency"] })), baseline);
    assert.notEqual(taskDetailDraftKey(draft({ customFieldValues: { score: "1" } })), baseline);
});

test("日期范围兼容纯日期和日期时间并拒绝截止早于开始", () => {
    assert.equal(isTaskDateRangeValid("", "2026-08-06"), true);
    assert.equal(isTaskDateRangeValid("2026-08-06", "2026-08-06"), true);
    assert.equal(isTaskDateRangeValid("2026-08-06T10:00", "2026-08-06T09:00"), false);
    assert.equal(isTaskDateRangeValid("2026-08-07", "2026-08-06"), false);
});

test("立即保存仅在存在合法待同步草稿时启用", () => {
    assert.equal(
        canSaveTaskDetailNow({ dirty: false, saving: false, hasValidationError: false, operationBusy: false }),
        false,
    );
    assert.equal(
        canSaveTaskDetailNow({ dirty: true, saving: false, hasValidationError: false, operationBusy: false }),
        true,
    );
    assert.equal(
        canSaveTaskDetailNow({ dirty: true, saving: true, hasValidationError: false, operationBusy: false }),
        false,
    );
    assert.equal(
        canSaveTaskDetailNow({ dirty: true, saving: false, hasValidationError: true, operationBusy: false }),
        false,
    );
});

test("保存期间出现新草稿时继续队列，失败时保留草稿供重试", () => {
    assert.equal(shouldContinueTaskDetailSave("draft-a", "draft-b", true), true);
    assert.equal(shouldContinueTaskDetailSave("draft-a", "draft-a", true), false);
    assert.equal(shouldContinueTaskDetailSave("draft-a", "draft-b", false), false);
    assert.equal(
        canSaveTaskDetailNow({ dirty: true, saving: false, hasValidationError: false, operationBusy: false }),
        true,
    );
});

test("关闭状态机仅对未保存草稿发出确认", () => {
    assert.equal(shouldConfirmTaskDetailClose(false), false);
    assert.equal(shouldConfirmTaskDetailClose(true), true);
});
