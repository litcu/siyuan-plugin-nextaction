import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isMyDayEntryDone, setMyDayTaskCompletedAt } from "../src/shared/my-day.ts";

const taskServiceSource = readFileSync(new URL("../src/kernel/task-lifecycle-service.ts", import.meta.url), "utf8");
const myDayManagerSource = readFileSync(new URL("../src/kernel/my-day-manager.ts", import.meta.url), "utf8");
const timelineCardSource = readFileSync(
    new URL("../src/frontend/components/timeline/TimelineCard.svelte", import.meta.url),
    "utf8",
);

test("我的一天实例存在完成时间时优先显示完成", () => {
    const state = {
        schema: 1 as const,
        dayKey: "2026-07-16",
        tasks: [
            {
                blockId: "task-1",
                addedAt: 1,
                scheduleStart: 540,
                scheduleEnd: 600,
                order: 0,
            },
        ],
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
        tasks: [
            {
                blockId: "task-1",
                addedAt: 1,
                scheduleStart: null,
                scheduleEnd: null,
                order: 0,
                completedAt: 123456789,
            },
        ],
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

test("任务完成会写入我的一天实例，重复任务内部重开后清除完成状态", () => {
    assert.match(taskServiceSource, /myDayManager\.markTaskCompleted\(blockId, completedAt\)/);
    assert.match(taskServiceSource, /attrs\[ATTR_STATUS\] !== undefined && attrs\[ATTR_STATUS\] !== "done"/);
    assert.match(taskServiceSource, /advanceRepeatState\([\s\S]*"complete",?\s*\)/);
    assert.match(taskServiceSource, /repeatAttrs\[ATTR_STATUS\] = "todo"/);
    assert.match(taskServiceSource, /\[ATTR_REPEAT_STATE\]: JSON\.stringify\(advanced\.state\)/);
    assert.match(
        taskServiceSource,
        /!advanced\.ended && advanced\.state\.status === "active"[\s\S]*myDayManager\.clearTaskCompleted\(blockId\)/,
    );
});

test("移除我的一天任务后广播最新状态", () => {
    const start = myDayManagerSource.indexOf("private async _removeTask(");
    const end = myDayManagerSource.indexOf("async reorderTask(", start);
    const section = myDayManagerSource.slice(start, end);

    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    assert.match(section, /await this\.persist\(\)[\s\S]*rpc\.broadcast\("myDayChanged"/);
    assert.match(section, /tasks:\s*\[\.\.\.this\.state\.tasks\]/);
});

test("时间表完成样式基于我的一天实例状态", () => {
    assert.match(timelineCardSource, /isMyDayEntryDone\(entry, task\.status\)/);
});
