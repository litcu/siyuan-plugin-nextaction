import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { materializeTask } from "../src/kernel/task-materializer.ts";
import { ATTR_REPEAT_STATE } from "../src/shared/constants.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

const rpcSource = source("../src/kernel/rpc-server.ts");
const bridgeSource = source("../src/frontend/kernel-bridge.ts");

test("重复状态属性进入共享常量和统一任务物化", () => {
    assert.equal(ATTR_REPEAT_STATE, "custom-na-repeat-state");
    const repeatState = '{"version":1,"status":"active"}';
    const task = materializeTask({
        blockId: "20260831130000-repeatx",
        confirmedAttrs: { [ATTR_REPEAT_STATE]: repeatState },
        defaults: DEFAULT_SETTINGS,
        freshIdentity: {
            blockId: "20260831130000-repeatx",
            identificationSource: "document",
            attrHostId: "20260831130000-repeatx",
            structuralParentId: "",
            effectiveParentId: "",
            taskType: "1",
            defaultStatus: "todo",
            title: "Repeat",
            sort: -1,
            updated: "",
        },
    });
    assert.equal(task.repeatState, repeatState);
});

test("内核 RPC 与前端桥接暴露三项系列操作", () => {
    for (const method of ["setRepeatRule", "skipRepeatOccurrence", "setRepeatPaused"]) {
        assert.match(rpcSource, new RegExp(`${method}:`));
        assert.match(bridgeSource, new RegExp(`call\\("${method}"`));
    }
});
