import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
