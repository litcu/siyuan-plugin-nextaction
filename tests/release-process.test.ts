import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUnreleasedSection, finalizeUnreleased } from "../scripts/changelog.js";
import { publishRelease, validateReleaseMetadata } from "../scripts/release-publish.js";
import { nextVersion, prepareRelease } from "../scripts/release-version.js";

interface CommandCall {
    command: string;
    args: string[];
}

function createProject(version = "1.2.3"): string {
    const projectRoot = mkdtempSync(join(tmpdir(), "nextaction-release-"));
    writeFileSync(join(projectRoot, "package.json"), `${JSON.stringify({ version }, null, 2)}\n`);
    writeFileSync(join(projectRoot, "plugin.json"), `${JSON.stringify({ version }, null, 2)}\n`);
    writeFileSync(
        join(projectRoot, "CHANGELOG.md"),
        `# 更新日志\n\n${createUnreleasedSection().replace("### 问题修复", "### 问题修复\n\n- 修复发布流程")}\n`,
    );
    return projectRoot;
}

test("版本准备只创建发布 commit，不会提前推送分支或 tag", (t) => {
    // Regression: 旧发布脚本会在发布 PR 合并前创建并推送 tag，绕过受保护 main 的合并流程。
    const projectRoot = createProject();
    t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
    const calls: CommandCall[] = [];

    const result = prepareRelease("patch", {
        projectRoot,
        now: new Date(2026, 7, 26),
        commandOutput(command: string, args: string[]): string {
            if (command === "git" && args.join(" ") === "status --porcelain") return "";
            if (command === "git" && args.join(" ") === "branch --show-current") return "release/v1.2.4";
            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        },
        runCommand(command: string, args: string[]): void {
            calls.push({ command, args });
        },
    });

    assert.deepEqual(result, { branch: "release/v1.2.4", tag: "v1.2.4", version: "1.2.4" });
    assert.equal(JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version, "1.2.4");
    assert.equal(JSON.parse(readFileSync(join(projectRoot, "plugin.json"), "utf8")).version, "1.2.4");
    assert.match(readFileSync(join(projectRoot, "CHANGELOG.md"), "utf8"), /^## \[1\.2\.4\] - 2026-08-26$/m);
    assert.deepEqual(calls, [
        { command: "pnpm", args: ["run", "release:package"] },
        { command: "git", args: ["add", "package.json", "plugin.json", "CHANGELOG.md"] },
        { command: "git", args: ["commit", "-m", "chore: release v1.2.4"] },
    ]);
});

test("拒绝直接在 main 上准备发布 commit", (t) => {
    const projectRoot = createProject();
    t.after(() => rmSync(projectRoot, { recursive: true, force: true }));

    assert.throws(
        () =>
            prepareRelease("patch", {
                projectRoot,
                commandOutput(command: string, args: string[]): string {
                    if (command === "git" && args.join(" ") === "status --porcelain") return "";
                    if (command === "git" && args.join(" ") === "branch --show-current") return "main";
                    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
                },
                runCommand(): void {
                    assert.fail("main 分支校验失败后不应执行任何写操作");
                },
            }),
        /main is protected/,
    );
});

test("合并后只从同步的 main 创建并推送版本 tag", (t) => {
    const projectRoot = createProject();
    t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
    const changelog = finalizeUnreleased(
        readFileSync(join(projectRoot, "CHANGELOG.md"), "utf8"),
        "1.2.3",
        "2026-08-26",
    );
    writeFileSync(join(projectRoot, "CHANGELOG.md"), changelog);
    const calls: CommandCall[] = [];

    const result = publishRelease({
        projectRoot,
        commandOutput(command: string, args: string[]): string {
            const invocation = `${command} ${args.join(" ")}`;
            if (invocation === "git status --porcelain") return "";
            if (invocation === "git branch --show-current") return "main";
            if (invocation === "git rev-parse HEAD") return "release-commit";
            if (invocation === "git rev-parse refs/remotes/origin/main") return "release-commit";
            if (invocation === "git ls-remote --tags origin refs/tags/v1.2.3") return "";
            if (invocation === "git tag --list v1.2.3") return "";
            throw new Error(`Unexpected command: ${invocation}`);
        },
        runCommand(command: string, args: string[]): void {
            calls.push({ command, args });
        },
    });

    assert.deepEqual(result, { tag: "v1.2.3", version: "1.2.3" });
    assert.deepEqual(calls, [
        { command: "git", args: ["fetch", "origin", "main", "--tags"] },
        { command: "git", args: ["tag", "-a", "v1.2.3", "-m", "v1.2.3"] },
        { command: "git", args: ["push", "origin", "refs/tags/v1.2.3"] },
    ]);
});

test("发布 tag 前校验版本文件和对应更新日志", () => {
    const changelog = finalizeUnreleased(
        `# 更新日志\n\n${createUnreleasedSection().replace("### 新功能", "### 新功能\n\n- 新版本")}\n`,
        "1.2.3",
        "2026-08-26",
    );

    assert.deepEqual(validateReleaseMetadata("1.2.3", "1.2.3", changelog), {
        tag: "v1.2.3",
        version: "1.2.3",
    });
    assert.throws(() => validateReleaseMetadata("1.2.3", "1.2.2", changelog), /Version mismatch/);
    assert.throws(() => validateReleaseMetadata("1.2.4", "1.2.4", changelog), /does not contain release notes/);
});

test("版本号递增规则保持不变", () => {
    assert.equal(nextVersion("1.2.3", "patch"), "1.2.4");
    assert.equal(nextVersion("1.2.3", "minor"), "1.3.0");
    assert.equal(nextVersion("1.2.3", "major"), "2.0.0");
    assert.equal(nextVersion("1.2.3", "current"), "1.2.3");
    assert.equal(nextVersion("1.2.3", "2.0.0-beta.1"), "2.0.0-beta.1");
});
