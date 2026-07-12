import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const releaseArg = process.argv[2];
const packageJsonPath = path.join(projectRoot, "package.json");
const pluginJsonPath = path.join(projectRoot, "plugin.json");

function run(command, args, options = {}) {
    execFileSync(resolveCommand(command), args, {
        cwd: projectRoot,
        stdio: "inherit",
        ...options,
    });
}

function output(command, args) {
    return execFileSync(resolveCommand(command), args, {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function resolveCommand(command) {
    if (process.platform === "win32" && command === "pnpm") {
        return "pnpm.cmd";
    }
    return command;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertCleanWorktree() {
    const status = output("git", ["status", "--porcelain"]);
    if (status) {
        throw new Error("Working tree is not clean. Commit or stash changes before creating a release.");
    }
}

function parseVersion(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(version);
    if (!match) {
        throw new Error(`Unsupported version format: ${version}`);
    }
    return match.slice(1, 4).map(Number);
}

function nextVersion(current, bump) {
    const [major, minor, patch] = parseVersion(current);
    switch (bump) {
        case "current":
            return current;
        case "major":
            return `${major + 1}.0.0`;
        case "minor":
            return `${major}.${minor + 1}.0`;
        case "patch":
            return `${major}.${minor}.${patch + 1}`;
        default:
            if (/^\d+\.\d+\.\d+(?:-.+)?$/.test(bump)) {
                return bump;
            }
            throw new Error("Usage: pnpm run release:current | release:patch | release:minor | release:major | release:version -- <x.y.z>");
    }
}

function replaceVersion(filePath, version) {
    const text = fs.readFileSync(filePath, "utf8");
    const updated = text.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${version}"`);
    fs.writeFileSync(filePath, updated);
}

function main() {
    if (!releaseArg) {
        throw new Error("Missing release version. Use patch, minor, major, or an explicit x.y.z version.");
    }

    assertCleanWorktree();

    const pkg = readJson(packageJsonPath);
    const plugin = readJson(pluginJsonPath);
    if (pkg.version !== plugin.version) {
        throw new Error(`Version mismatch: package.json=${pkg.version}, plugin.json=${plugin.version}`);
    }

    const version = nextVersion(pkg.version, releaseArg);
    const tag = `v${version}`;

    const shouldCommitVersion = version !== pkg.version;
    if (shouldCommitVersion) {
        replaceVersion(packageJsonPath, version);
        replaceVersion(pluginJsonPath, version);
    }

    run("pnpm", ["run", "release:package"]);

    if (shouldCommitVersion) {
        run("git", ["add", "package.json", "plugin.json"]);
        run("git", ["commit", "-m", `chore: release ${tag}`]);
    }
    run("git", ["tag", tag]);
    run("git", ["push", "origin", "HEAD"]);
    run("git", ["push", "origin", tag]);

    console.log(`Release tag pushed: ${tag}`);
    console.log("GitHub Actions will build package.zip and create the GitHub Release.");
}

main();
