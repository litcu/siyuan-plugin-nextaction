import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const delay = (milliseconds: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function browserIsRunning(browserProcess: ChildProcess): boolean {
    return browserProcess.exitCode === null && browserProcess.signalCode === null;
}

async function waitForBrowserExit(browserProcess: ChildProcess, timeout: number): Promise<boolean> {
    if (!browserIsRunning(browserProcess)) return true;
    return Promise.race([once(browserProcess, "exit").then(() => true), delay(timeout).then(() => false)]);
}

export function findBrowserExecutable(): string {
    const playwrightCache = join(process.env.XDG_CACHE_HOME || join(process.env.HOME || "", ".cache"), "ms-playwright");
    const cached = existsSync(playwrightCache)
        ? readdirSync(playwrightCache)
              .filter((entry) => entry.startsWith("chromium_headless_shell-") || entry.startsWith("chromium-"))
              .sort()
              .reverse()
              .flatMap((entry) => [
                  join(playwrightCache, entry, "chrome-headless-shell-linux64", "chrome-headless-shell"),
                  join(playwrightCache, entry, "chrome-linux64", "chrome"),
              ])
        : [];
    const candidates = [
        process.env.NA_LAYOUT_BROWSER,
        ...cached,
        process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined,
        process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined,
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ].filter((candidate): candidate is string => Boolean(candidate));
    const executable = candidates.find((candidate) => existsSync(candidate));
    assert.ok(executable, "未找到浏览器；可通过 NA_LAYOUT_BROWSER 指定 Chrome/Edge 路径");
    return executable;
}

export async function stopBrowserProcess(browserProcess: ChildProcess): Promise<void> {
    if (!browserIsRunning(browserProcess)) return;
    browserProcess.kill();
    if (await waitForBrowserExit(browserProcess, 5_000)) return;

    browserProcess.kill("SIGKILL");
    assert.equal(await waitForBrowserExit(browserProcess, 5_000), true, "浏览器进程未能退出");
}
