import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const sourceRoot = join(root, "src");

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return [".ts", ".svelte"].includes(extname(path)) ? [path] : [];
    });
}

const files = sourceFiles(sourceRoot);
const failures = [];
const textByFile = new Map(files.map(path => [path, readFileSync(path, "utf8")]));

function projectPath(path) {
    return relative(root, path).replace(/\\/g, "/");
}

for (const [path, source] of textByFile) {
    const name = projectPath(path);
    const imports = [...source.matchAll(/(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g)].map(match => match[1]);
    if (name.startsWith("src/frontend/") && imports.some(value => value.includes("/kernel/") || value.startsWith("@kernel/"))) {
        failures.push(`${name}: frontend must not import kernel modules`);
    }
    if (name.startsWith("src/shared/") && imports.some(value => value.includes("/frontend/") || value.includes("/kernel/") || value === "siyuan" || value.startsWith("siyuan/"))) {
        failures.push(`${name}: shared must remain independent from frontend, kernel and SiYuan runtime modules`);
    }
    if (name.startsWith("src/shared/") && /\b(?:window|document|localStorage|sessionStorage|navigator)\s*\./.test(source)) {
        failures.push(`${name}: shared must not use browser-only runtime globals`);
    }
    if (name.startsWith("src/shared/") && /\b(?:HTMLElement|HTML[A-Za-z]+Element|MutationObserver|ResizeObserver)\b/.test(source)) {
        failures.push(`${name}: shared must not depend on DOM-only types`);
    }
}

const frontendWrites = [...textByFile]
    .filter(([path]) => projectPath(path).startsWith("src/frontend/") || projectPath(path) === "src/index.ts")
    .flatMap(([path, source]) => [...source.matchAll(/\/api\/attr\/setBlockAttrs/g)].map(() => projectPath(path)));
if (frontendWrites.length !== 1 || frontendWrites[0] !== "src/index.ts") {
    failures.push(`frontend task-write fallback whitelist expected exactly src/index.ts once, found: ${frontendWrites.join(", ") || "none"}`);
}

for (const [path, source] of textByFile) {
    const name = projectPath(path);
    if (name === "src/kernel/task-service.ts" || name === "src/kernel/siyuan-api.ts") continue;
    if (/\.(?:setBlockAttrs|batchSetBlockAttrs)\s*\(/.test(source)) {
        failures.push(`${name}: task attribute writes must be routed through TaskService`);
    }
}

for (const [path, source] of textByFile) {
    const name = projectPath(path);
    if (name === "src/kernel/siyuan-api.ts" || name === "src/index.ts") continue;
    if (source.includes("/api/attr/setBlockAttrs") || source.includes("/api/attr/batchSetBlockAttrs")) {
        failures.push(`${name}: low-level task attribute endpoints belong in the production API adapter`);
    }
    if (name.startsWith("src/kernel/") && source.includes("/api/query/sql")) {
        failures.push(`${name}: low-level SQL endpoint belongs in the production API adapter`);
    }
}

const duplicateIdPattern = /\\d\{14\}[^\n]{0,80}(?:\{7\}|[+*])/;
for (const [path, source] of textByFile) {
    if (projectPath(path) !== "src/shared/block-id.ts" && duplicateIdPattern.test(source)) {
        failures.push(`${projectPath(path)}: duplicate block ID regular expression`);
    }
}

for (const [path, source] of textByFile) {
    const name = projectPath(path);
    if (!name.startsWith("src/kernel/") && name !== "src/index.ts") continue;
    if (/stmt\s*:\s*(?:"|'|`)[^\n]*\+/.test(source)) failures.push(`${name}: SQL statement concatenates a dynamic value`);
    if (/stmt\s*:\s*`[^`]*\$\{/.test(source) && !/stmt\s*:\s*sql`/.test(source)) failures.push(`${name}: interpolated SQL must use the sql tag`);
    for (const match of source.matchAll(/`(?:\\.|[^`])*`/gs)) {
        const literal = match[0];
        if (!/^`\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE)\b/i.test(literal) || !literal.includes("${")) continue;
        const prefix = source.slice(Math.max(0, (match.index || 0) - 3), match.index || 0);
        if (prefix !== "sql") failures.push(`${name}: dynamic SQL template must use the sql tag`);
    }
}

for (const [path, source] of textByFile) {
    const name = projectPath(path);
    if (name !== "src/shared/sql.ts" && /replace\(\/'\/g,\s*["']''["']\)/.test(source)) {
        failures.push(`${name}: manual SQL escaping is forbidden`);
    }
}

const methodsSource = readFileSync(join(sourceRoot, "shared", "rpc-methods.ts"), "utf8");
const declaredList = [...methodsSource.matchAll(/"([A-Za-z][A-Za-z0-9]+)"/g)].map(match => match[1]);
const declared = new Set(declaredList);
const serverSource = readFileSync(join(sourceRoot, "kernel", "rpc-server.ts"), "utf8");
const bridgeSource = readFileSync(join(sourceRoot, "frontend", "kernel-bridge.ts"), "utf8");
const bound = new Set([...serverSource.matchAll(/\.bind\("([A-Za-z][A-Za-z0-9]+)"/g)].map(match => match[1]));
const called = new Set([...bridgeSource.matchAll(/this\.call(?:<[^>]+>)?\("([A-Za-z][A-Za-z0-9]+)"/g)].map(match => match[1]));
if (declaredList.length !== 45 || declared.size !== 45) {
    failures.push(`RPC method manifest must contain exactly 45 unique methods, found ${declaredList.length}/${declared.size}`);
}
for (const method of declared) {
    if (!bound.has(method)) failures.push(`RPC method ${method} is declared but not bound by the server`);
    if (!called.has(method)) failures.push(`RPC method ${method} is declared but has no KernelBridge call`);
}
for (const method of bound) if (!declared.has(method)) failures.push(`RPC server binds undeclared method ${method}`);
for (const method of called) if (!declared.has(method)) failures.push(`KernelBridge calls undeclared method ${method}`);

if (failures.length) {
    console.error(failures.map(message => `- ${message}`).join("\n"));
    process.exit(1);
}

console.log(`Architecture checks passed (${declared.size} RPC methods).`);
