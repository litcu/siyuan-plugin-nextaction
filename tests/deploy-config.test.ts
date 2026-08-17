import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveDeployTarget } from "../scripts/deploy.js";

test("部署目标跟随每台机器配置的思源插件目录", () => {
    // Regression: 部署路径曾写死为单个开发者的本机目录。
    const firstPluginsRoot = path.resolve("fixtures", "developer-a", "data", "plugins");
    const secondPluginsRoot = path.resolve("fixtures", "developer-b", "data", "plugins");

    const firstTarget = resolveDeployTarget("siyuan-plugin-nextaction", {
        SIYUAN_PLUGINS_DIR: firstPluginsRoot,
    });
    const secondTarget = resolveDeployTarget("siyuan-plugin-nextaction", {
        SIYUAN_PLUGINS_DIR: secondPluginsRoot,
    });

    assert.equal(firstTarget, path.join(firstPluginsRoot, "siyuan-plugin-nextaction"));
    assert.equal(secondTarget, path.join(secondPluginsRoot, "siyuan-plugin-nextaction"));
    assert.notEqual(firstTarget, secondTarget);
});

test("部署配置拒绝缺失或相对的插件目录", () => {
    assert.throws(() => resolveDeployTarget("siyuan-plugin-nextaction", {}), /Missing SIYUAN_PLUGINS_DIR/);
    assert.throws(
        () => resolveDeployTarget("siyuan-plugin-nextaction", { SIYUAN_PLUGINS_DIR: "relative/plugins" }),
        /must be an absolute path/,
    );
});
