import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

const constantsSource = source("../src/shared/constants.ts");
const cacheSource = source("../src/kernel/cache-manager.ts");
const rpcSource = source("../src/kernel/rpc-server.ts");
const bridgeSource = source("../src/frontend/kernel-bridge.ts");

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
