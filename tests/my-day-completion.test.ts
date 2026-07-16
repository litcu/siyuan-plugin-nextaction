import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isMyDayEntryDone, setMyDayTaskCompletedAt } from "../src/shared/my-day.ts";

const taskServiceSource = readFileSync(
    new URL("../src/kernel/task-service.ts", import.meta.url),
    "utf8",
);
const timelineCardSource = readFileSync(
    new URL("../src/frontend/components/timeline/TimelineCard.svelte", import.meta.url),
    "utf8",
);

test("重复任务重开后，我的一天仍保留本次实例的完成状态", () => {
    const state = {
        schema: 1 as const,
        dayKey: "2026-07-16",
        tasks: [{
            blockId: "task-1",
            addedAt: 1,
            scheduleStart: 540,
            scheduleEnd: 600,
            order: 0,
        }],
        updatedAt: 1,
    };
    const completedState = setMyDayTaskCompletedAt(state, "task-1", 123456789);

    assert.equal(completedState.tasks[0].completedAt, 123456789);
    assert.equal(completedState.tasks[0].scheduleStart, 540);
    assert.equal(completedState.tasks[0].scheduleEnd, 600);
    assert.equal(isMyDayEntryDone(completedState.tasks[0], "todo"), true);
});

test("用户显式重新打开任务时会清除我的一天实例完成状态", () => {
    const state = {
        schema: 1 as const,
        dayKey: "2026-07-16",
        tasks: [{
            blockId: "task-1",
            addedAt: 1,
            scheduleStart: null,
            scheduleEnd: null,
            order: 0,
            completedAt: 123456789,
        }],
        updatedAt: 1,
    };
    const reopenedState = setMyDayTaskCompletedAt(state, "task-1", undefined);

    assert.equal(reopenedState.tasks[0].completedAt, undefined);
    assert.equal(isMyDayEntryDone(reopenedState.tasks[0], "todo"), false);
});

test("普通已完成任务仍然根据任务自身状态显示完成", () => {
    const entry = {
        blockId: "task-1",
        addedAt: 1,
        scheduleStart: null,
        scheduleEnd: null,
        order: 0,
    };

    assert.equal(isMyDayEntryDone(entry, "done"), true);
    assert.equal(isMyDayEntryDone(entry, "todo"), false);
});

test("任务完成会写入我的一天实例，重复任务内部重开不会走清除分支", () => {
    assert.match(taskServiceSource, /myDayManager\.markTaskCompleted\(blockId, completedAt\)/);
    assert.match(taskServiceSource, /attrs\[ATTR_STATUS\] !== undefined && attrs\[ATTR_STATUS\] !== "done"/);
    assert.match(taskServiceSource, /repeatAttrs[\s\S]*\[ATTR_STATUS\]: "todo"/);
});

test("时间表完成样式基于我的一天实例状态", () => {
    assert.match(timelineCardSource, /isMyDayEntryDone\(entry, task\.status\)/);
});
