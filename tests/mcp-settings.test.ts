import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_MCP_SETTINGS, mergeMcpSettings, validateMcpSettings } from "../src/shared/mcp-settings.ts";

test("MCP 当前默认值关闭工具和写权限", () => {
    const merged = mergeMcpSettings(DEFAULT_MCP_SETTINGS, undefined);

    assert.deepEqual(merged, DEFAULT_MCP_SETTINGS);
    assert.equal(merged.enabled, false);
    assert.equal(merged.allowWrite, false);
});

test("MCP 设置只合并当前布尔权限", () => {
    const base = mergeMcpSettings(DEFAULT_MCP_SETTINGS, { allowWrite: true });
    const merged = mergeMcpSettings(base, { enabled: true });

    assert.equal(merged.enabled, true);
    assert.equal(merged.allowWrite, true);
    assert.deepEqual(Object.keys(merged).sort(), ["allowWrite", "enabled"]);
});

test("MCP 设置校验拒绝旧目标字段和非布尔权限", () => {
    assert.match(validateMcpSettings({ defaultCreateTarget: "inbox" } as any) ?? "", /unknown properties/);
    assert.match(validateMcpSettings({ allowWrite: "yes" as any }) ?? "", /allowWrite/);
});
