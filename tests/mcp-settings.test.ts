import test from "node:test";
import assert from "node:assert/strict";

import {
    DEFAULT_MCP_SETTINGS,
    mergeMcpSettings,
    validateMcpSettings,
} from "../src/shared/mcp-settings.ts";

test("旧设置迁移时 MCP 默认关闭且写权限关闭", () => {
    const merged = mergeMcpSettings(DEFAULT_MCP_SETTINGS, undefined);

    assert.deepEqual(merged, DEFAULT_MCP_SETTINGS);
    assert.equal(merged.enabled, false);
    assert.equal(merged.allowWrite, false);
});

test("MCP 设置支持部分合并且不丢失既有目标", () => {
    const base = mergeMcpSettings(DEFAULT_MCP_SETTINGS, {
        inboxDocumentId: "20260802120000-abcdefg",
    });
    const merged = mergeMcpSettings(base, { enabled: true });

    assert.equal(merged.enabled, true);
    assert.equal(merged.allowWrite, false);
    assert.equal(merged.inboxDocumentId, "20260802120000-abcdefg");
});

test("MCP 设置校验拒绝非法目标类型和非布尔权限", () => {
    assert.match(
        validateMcpSettings({ defaultCreateTarget: "somewhere" as any }) ?? "",
        /defaultCreateTarget/,
    );
    assert.match(
        validateMcpSettings({ allowWrite: "yes" as any }) ?? "",
        /allowWrite/,
    );
});
