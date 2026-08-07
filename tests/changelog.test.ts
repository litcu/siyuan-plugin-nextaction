import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    CHANGELOG_CATEGORIES,
    createUnreleasedSection,
    extractReleaseNotes,
    finalizeUnreleased,
} from "../scripts/changelog.js";

function changelogWith(body: string): string {
    return `# 更新日志\n\n${createUnreleasedSection()}\n`.replace(
        createUnreleasedSection(),
        `## [Unreleased]\n\n${body}`,
    );
}

test("发布时封版 Unreleased 并重建固定分类模板", () => {
    const source = changelogWith(`<!-- 提示 -->

### 新功能

- 支持自动生成更新日志

### 优化

### 问题修复

- 修复发布说明只有默认一句话

### 兼容性说明`);
    const finalized = finalizeUnreleased(source, "v0.4.1", "2026-08-07");

    assert.match(finalized, /^## \[Unreleased\]$/m);
    assert.match(finalized, /^## \[0\.4\.1\] - 2026-08-07$/m);
    assert.match(finalized, /### 新功能\n\n- 支持自动生成更新日志/);
    assert.match(finalized, /### 问题修复\n\n- 修复发布说明只有默认一句话/);
    assert.doesNotMatch(finalized, /^## \[0\.4\.1\][\s\S]*### 优化$/m);
    for (const category of CHANGELOG_CATEGORIES) {
        assert.match(finalized.slice(0, finalized.indexOf("## [0.4.1]")), new RegExp(`### ${category}`));
    }
});

test("拒绝发布空白或格式不完整的 Unreleased", () => {
    const empty = `# 更新日志\n\n${createUnreleasedSection()}\n`;
    assert.throws(
        () => finalizeUnreleased(empty, "0.4.1", "2026-08-07"),
        /has no release notes/,
    );

    const missingCategory = empty.replace("\n\n### 兼容性说明", "").replace("### 新功能", "### 新功能\n\n- 一项更新");
    assert.throws(
        () => finalizeUnreleased(missingCategory, "0.4.1", "2026-08-07"),
        /must contain these categories in order/,
    );
});

test("Action 只提取目标版本并生成固定发布日期格式", () => {
    const finalized = finalizeUnreleased(changelogWith(`### 新功能

- 新增功能

### 优化

### 问题修复

### 兼容性说明`), "0.4.1", "2026-08-07");
    const notes = extractReleaseNotes(`${finalized}\n## [0.4.0] - 2026-08-01\n\n- 旧版本\n`, "v0.4.1");

    assert.equal(notes, "> 发布日期：2026-08-07\n\n### 新功能\n\n- 新增功能\n");
    assert.doesNotMatch(notes, /旧版本/);
});

test("发布工作流从 CHANGELOG 提取正文而不是写死默认文案", () => {
    const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
    const releaseScript = readFileSync(new URL("../scripts/release-version.js", import.meta.url), "utf8");

    assert.match(workflow, /node scripts\/changelog\.js extract "\$GITHUB_REF_NAME" release-notes\.md/);
    assert.match(workflow, /fetch-depth: 0/);
    assert.match(workflow, /查看完整变更/);
    assert.match(workflow, /--notes-file release-notes\.md/);
    assert.doesNotMatch(workflow, /Automated release/);
    assert.match(releaseScript, /finalizeUnreleased\(changelog, version, date\)/);
    assert.match(releaseScript, /"CHANGELOG\.md"/);
});
