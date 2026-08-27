import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractReleaseNotes } from "./changelog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function shouldUseShell(command) {
    return process.platform === "win32" && command === "pnpm";
}

function run(projectDirectory, command, args) {
    execFileSync(command, args, {
        cwd: projectDirectory,
        stdio: "inherit",
        shell: shouldUseShell(command),
    });
}

function output(projectDirectory, command, args) {
    return execFileSync(command, args, {
        cwd: projectDirectory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: shouldUseShell(command),
    }).trim();
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function validateReleaseMetadata(packageVersion, pluginVersion, changelog) {
    if (packageVersion !== pluginVersion) {
        throw new Error(`Version mismatch: package.json=${packageVersion}, plugin.json=${pluginVersion}`);
    }
    extractReleaseNotes(changelog, packageVersion);
    return { tag: `v${packageVersion}`, version: packageVersion };
}

export function publishRelease(options = {}) {
    const projectDirectory = options.projectRoot || projectRoot;
    const runCommand = options.runCommand || ((command, args) => run(projectDirectory, command, args));
    const commandOutput = options.commandOutput || ((command, args) => output(projectDirectory, command, args));

    const status = commandOutput("git", ["status", "--porcelain"]);
    if (status) {
        throw new Error("Working tree is not clean. Commit or stash changes before publishing a release.");
    }

    const branch = commandOutput("git", ["branch", "--show-current"]);
    if (branch !== "main") {
        throw new Error(`Release tags must be published from main; current branch is ${branch || "detached HEAD"}.`);
    }

    runCommand("git", ["fetch", "origin", "main", "--tags"]);

    const head = commandOutput("git", ["rev-parse", "HEAD"]);
    const remoteMain = commandOutput("git", ["rev-parse", "refs/remotes/origin/main"]);
    if (head !== remoteMain) {
        throw new Error("Local main is not synchronized with origin/main. Run git pull --ff-only origin main first.");
    }

    const pkg = readJson(path.join(projectDirectory, "package.json"));
    const plugin = readJson(path.join(projectDirectory, "plugin.json"));
    const changelog = fs.readFileSync(path.join(projectDirectory, "CHANGELOG.md"), "utf8");
    const { tag, version } = validateReleaseMetadata(pkg.version, plugin.version, changelog);

    const remoteTag = commandOutput("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
    if (remoteTag) {
        throw new Error(`Tag ${tag} already exists on origin.`);
    }

    const localTag = commandOutput("git", ["tag", "--list", tag]);
    if (localTag) {
        const taggedCommit = commandOutput("git", ["rev-list", "-n", "1", tag]);
        if (taggedCommit !== head) {
            throw new Error(`Local tag ${tag} points to ${taggedCommit}, not current main ${head}.`);
        }
    } else {
        runCommand("git", ["tag", "-a", tag, "-m", tag]);
    }

    runCommand("git", ["push", "origin", `refs/tags/${tag}`]);

    console.log(`Release tag pushed from main: ${tag}`);
    console.log("GitHub Actions will build package.zip and create the GitHub Release.");

    return { tag, version };
}

function isDirectExecution() {
    if (!process.argv[1]) return false;
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
    try {
        publishRelease();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
