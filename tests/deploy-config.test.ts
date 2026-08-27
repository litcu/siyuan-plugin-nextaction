import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyDeploymentReadmes, resolveDeployTarget } from "../scripts/deploy.js";

const environmentExample = readFileSync(path.resolve(".env.example"), "utf8");
const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
    scripts: Record<string, string>;
};
const agentInstructions = readFileSync(path.resolve("AGENTS.md"), "utf8");
const localSiyuanInstructions = readFileSync(path.resolve("docs/agents/local-siyuan.md"), "utf8");

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
    // Regression: README 部署测试曾依赖本地残留的 dist/，导致干净 CI 在构建前失败。
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "nextaction-deploy-"));
    const buildRoot = path.join(temporaryRoot, "build");
    const deployedRoot = path.join(temporaryRoot, "plugins", "siyuan-plugin-nextaction");
    const englishReadme = "# NextAction\n";
    const chineseReadme = "# 下一步行动\n";
    mkdirSync(buildRoot);
    writeFileSync(path.join(buildRoot, "README.md"), englishReadme);
    writeFileSync(path.join(buildRoot, "README.zh-CN.md"), chineseReadme);

    try {
        copyDeploymentReadmes(buildRoot, deployedRoot);

        assert.equal(readFileSync(path.join(deployedRoot, "README.md"), "utf8"), englishReadme);
        assert.equal(readFileSync(path.join(deployedRoot, "README.zh-CN.md"), "utf8"), chineseReadme);
    } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test("本地思源配置模板和 Agent 指引覆盖部署、访问授权与 API token", () => {
    assert.match(environmentExample, /^SIYUAN_PLUGINS_DIR=/m);
    assert.match(environmentExample, /^SIYUAN_ACCESS_AUTH_CODE=/m);
    assert.match(environmentExample, /^SIYUAN_API_TOKEN=/m);
    assert.match(packageJson.scripts["test:integration:kernel"], /--env-file-if-exists=\.env\.local/);
    assert.match(packageJson.scripts["test:integration:mcp"], /--env-file-if-exists=\.env\.local/);
    assert.match(agentInstructions, /docs\/agents\/local-siyuan\.md/);
    assert.match(localSiyuanInstructions, /Authorization: Token <SIYUAN_API_TOKEN>/);
    assert.match(localSiyuanInstructions, /不输出值/);
});
