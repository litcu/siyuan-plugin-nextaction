import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

const constantsSource = source("../src/shared/constants.ts");
const cacheSource = source("../src/kernel/cache-manager.ts");
const lifecycleSource = source("../src/kernel/task-lifecycle-service.ts");
const repeatSource = source("../src/kernel/repeat-task-service.ts");
const rpcSource = source("../src/kernel/rpc-server.ts");
const bridgeSource = source("../src/frontend/kernel-bridge.ts");

function methodSection(name: string, nextName: string): string {
    const start = repeatSource.indexOf(`async ${name}(`);
    const next = repeatSource.indexOf(`async ${nextName}(`, start + 1);
    const end = next === -1 ? repeatSource.length : next;
    assert.notEqual(start, -1, `${name} should exist`);
    return repeatSource.slice(start, end);
}

test("重复状态属性进入共享常量和全量缓存加载", () => {
    assert.match(constantsSource, /ATTR_REPEAT_STATE\s*=\s*"custom-na-repeat-state"/);
    assert.match(cacheSource, /repeatState:\s*attrs\[ATTR_REPEAT_STATE\]\s*\|\|\s*""/);
});

test("内核 RPC 与前端桥接暴露三项系列操作", () => {
    for (const method of ["setRepeatRule", "skipRepeatOccurrence", "setRepeatPaused"]) {
        assert.match(rpcSource, new RegExp(`${method}:`));
        assert.match(bridgeSource, new RegExp(`call\\("${method}"`));
    }
});

test("完成推进保留我的一天完成状态，并广播重开后的最终状态", () => {
    const section = lifecycleSource.slice(
        lifecycleSource.indexOf("async updateTask("),
        lifecycleSource.indexOf("async updateTaskTitle("),
    );
    assert.match(section, /\[ATTR_COMPLETED\]: newCompleted/);
    assert.match(section, /advanceRepeatState\([\s\S]*"complete",?\s*\)/);
    assert.match(section, /repeatAttrs\[ATTR_STATUS\] = "todo"/);
    const repeatAdvanceSection = section.slice(section.indexOf("// 循环/重复任务"), section.indexOf("// 回顾日期推算"));
    assert.doesNotMatch(repeatAdvanceSection, /myDayManager\.clearTaskCompleted\(blockId\)/);
    assert.match(section, /cacheConfirmedEntry\(finalEntry\)/);
    assert.match(section, /repository\.publishChanges\(\)/);
});

test("跳过只推进系列状态，不写完成历史，并保留在我的一天", () => {
    const section = methodSection("skipRepeatOccurrence", "setRepeatPaused");
    assert.match(section, /advanceRepeatState\([\s\S]*"skip"\)/);
    assert.doesNotMatch(section, /ATTR_COMPLETED/);
    assert.match(section, /myDayManager\.clearTaskCompleted\(blockId\)/);
    assert.doesNotMatch(section, /myDayManager\.removeTask\(blockId\)/);
    assert.match(section, /cacheConfirmedEntry\(finalEntry\)/);
    assert.match(section, /repository\.publishChanges\(\)/);
});

test("暂停恢复写回状态，恢复已完成任务时重开同一块", () => {
    const section = methodSection("setRepeatPaused", "recalcAllOrders");
    assert.match(section, /status:\s*paused\s*\?\s*"paused"\s*:\s*"active"/);
    assert.match(section, /!paused && entry\.status === "done"/);
    assert.match(section, /attrs\[ATTR_STATUS\] = "todo"/);
    assert.match(section, /!paused && entry\.status === "done"[\s\S]*myDayManager\.clearTaskCompleted\(blockId\)/);
    assert.match(section, /repository\.publishChanges\(\)/);
});
