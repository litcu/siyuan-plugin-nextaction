import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const CHANGELOG_CATEGORIES = ["新功能", "优化", "问题修复", "兼容性说明"];

const UNRELEASED_HEADING = "## [Unreleased]";
const VERSION_PATTERN = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

export function createUnreleasedSection() {
    const categories = CHANGELOG_CATEGORIES.map((category) => `### ${category}`).join("\n\n");
    return `${UNRELEASED_HEADING}\n\n<!-- 在下面至少一个分类中填写以 "- " 开头的更新内容。 -->\n\n${categories}`;
}

function normalizeVersion(version) {
    const match = VERSION_PATTERN.exec(version);
    if (!match) {
        throw new Error(`Unsupported release version: ${version}`);
    }
    return match[1];
}

function sectionRange(changelog, headingPattern) {
    const match = headingPattern.exec(changelog);
    if (!match || match.index === undefined) {
        return null;
    }

    const bodyStart = match.index + match[0].length;
    const nextHeading = /^## (?!#)/m.exec(changelog.slice(bodyStart));
    const end = nextHeading ? bodyStart + nextHeading.index : changelog.length;
    return { start: match.index, bodyStart, end };
}

function stripComments(text) {
    return text.replace(/<!--[\s\S]*?-->/g, "").trim();
}

function releaseBodyFromUnreleased(body) {
    const headings = [...body.matchAll(/^### (.+)$/gm)];
    const categories = headings.map((match) => match[1].trim());
    if (
        categories.length !== CHANGELOG_CATEGORIES.length ||
        categories.some((category, index) => category !== CHANGELOG_CATEGORIES[index])
    ) {
        throw new Error(
            `CHANGELOG.md [Unreleased] must contain these categories in order: ${CHANGELOG_CATEGORIES.join(", ")}.`,
        );
    }

    const populatedSections = headings.flatMap((heading, index) => {
        const contentStart = heading.index + heading[0].length;
        const contentEnd = headings[index + 1]?.index ?? body.length;
        const content = stripComments(body.slice(contentStart, contentEnd));
        if (!content) {
            return [];
        }
        if (!/^[-*] \S/m.test(content)) {
            throw new Error(
                `CHANGELOG.md category "${categories[index]}" must contain at least one list item starting with "- ".`,
            );
        }
        return [`### ${categories[index]}\n\n${content}`];
    });

    if (populatedSections.length === 0) {
        throw new Error("CHANGELOG.md [Unreleased] has no release notes. Add at least one list item before releasing.");
    }
    return populatedSections.join("\n\n");
}

export function finalizeUnreleased(changelog, version, date) {
    const normalized = changelog.replace(/\r\n/g, "\n");
    const normalizedVersion = normalizeVersion(version);
    const versionPattern = new RegExp(
        `^## \\[${normalizedVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\](?: - .+)?$`,
        "m",
    );
    if (versionPattern.test(normalized)) {
        throw new Error(`CHANGELOG.md already contains version ${normalizedVersion}.`);
    }

    const unreleased = sectionRange(normalized, /^## \[Unreleased\]$/m);
    if (!unreleased) {
        throw new Error("CHANGELOG.md is missing the [Unreleased] section.");
    }

    const releaseBody = releaseBodyFromUnreleased(normalized.slice(unreleased.bodyStart, unreleased.end));
    const releasedSection = `## [${normalizedVersion}] - ${date}\n\n${releaseBody}`;
    const replacement = `${createUnreleasedSection()}\n\n${releasedSection}\n\n`;
    return normalized.slice(0, unreleased.start) + replacement + normalized.slice(unreleased.end).replace(/^\s*/, "");
}

export function extractReleaseNotes(changelog, version) {
    const normalized = changelog.replace(/\r\n/g, "\n");
    const normalizedVersion = normalizeVersion(version);
    const escapedVersion = normalizedVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const headingPattern = new RegExp(`^## \\[${escapedVersion}\\] - (\\d{4}-\\d{2}-\\d{2})$`, "m");
    const heading = headingPattern.exec(normalized);
    const section = sectionRange(normalized, headingPattern);
    if (!heading || !section) {
        throw new Error(`CHANGELOG.md does not contain release notes for ${normalizedVersion}.`);
    }

    const body = stripComments(normalized.slice(section.bodyStart, section.end));
    if (!body) {
        throw new Error(`CHANGELOG.md release notes for ${normalizedVersion} are empty.`);
    }
    return `> 发布日期：${heading[1]}\n\n${body}\n`;
}

function isDirectExecution() {
    if (!process.argv[1]) return false;
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function main() {
    const [command, version, outputPath] = process.argv.slice(2);
    if (command !== "extract" || !version || !outputPath) {
        throw new Error("Usage: node scripts/changelog.js extract <version> <output-file>");
    }

    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const changelog = fs.readFileSync(path.join(projectRoot, "CHANGELOG.md"), "utf8");
    const notes = extractReleaseNotes(changelog, version);
    fs.writeFileSync(path.resolve(outputPath), notes);
}

if (isDirectExecution()) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
