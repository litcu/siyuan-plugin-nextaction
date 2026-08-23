import test from "node:test";
import assert from "node:assert/strict";

import {
    isNativeTaskStructure,
    nativeTaskDefaultStatus,
    resolveEffectiveTaskParent,
} from "../src/shared/task-identity.ts";

test("原生任务共享规则同时接受列表项标记和直属列表标记", () => {
    assert.equal(isNativeTaskStructure({ type: "i", subtype: "t" }), true);
    assert.equal(isNativeTaskStructure({ type: "i", subtype: "u", parentType: "l", parentSubtype: "t" }), true);
    assert.equal(isNativeTaskStructure({ type: "i", subtype: "u", parentType: "l", parentSubtype: "u" }), false);
});

test("有效父任务优先使用非空手动值，空值回退结构父任务", () => {
    assert.equal(resolveEffectiveTaskParent("manual-parent", "structural-parent"), "manual-parent");
    assert.equal(resolveEffectiveTaskParent("", "structural-parent"), "structural-parent");
    assert.equal(resolveEffectiveTaskParent(undefined, "structural-parent"), "structural-parent");
});

test("原生 marker 只投影为未完成或完成默认状态", () => {
    assert.equal(nativeTaskDefaultStatus("- [ ] Todo"), "inbox");
    assert.equal(nativeTaskDefaultStatus("- [X] Done"), "done");
    assert.equal(nativeTaskDefaultStatus("- [-] Canceled"), "done");
});
