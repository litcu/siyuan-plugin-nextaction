import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDeployTarget } from "../scripts/deploy.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

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

test("发布部署同步中英文 README", () => {
    // Regression: release 构建产物包含 README，但部署脚本没有将其复制到插件目录。
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "nextaction-deploy-"));
    const pluginsRoot = path.join(temporaryRoot, "plugins");
    mkdirSync(pluginsRoot);

    try {
        execFileSync(process.execPath, [path.join(projectRoot, "scripts", "deploy.js")], {
            cwd: projectRoot,
            env: { ...process.env, SIYUAN_PLUGINS_DIR: pluginsRoot },
            stdio: "pipe",
        });

        const deployedRoot = path.join(pluginsRoot, "siyuan-plugin-nextaction");
        assert.equal(
            readFileSync(path.join(deployedRoot, "README.md"), "utf8"),
            readFileSync(path.join(projectRoot, "dist", "README.md"), "utf8"),
        );
        assert.equal(
            readFileSync(path.join(deployedRoot, "README.zh-CN.md"), "utf8"),
            readFileSync(path.join(projectRoot, "dist", "README.zh-CN.md"), "utf8"),
        );
    } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
    }
});
