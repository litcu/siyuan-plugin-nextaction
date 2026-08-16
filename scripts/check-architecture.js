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

const frontendTaskFallbacks = [...textByFile]
    .filter(([path]) => projectPath(path).startsWith("src/frontend/") || projectPath(path) === "src/index.ts")
    .flatMap(([path, source]) => [...source.matchAll(/\/api\/(?:attr\/(?:getBlockAttrs|setBlockAttrs|batchGetBlockAttrs|batchSetBlockAttrs)|query\/sql)/g)].map(() => projectPath(path)));
if (frontendTaskFallbacks.length !== 0) {
    failures.push(`frontend task fallback endpoints are forbidden, found: ${frontendTaskFallbacks.join(", ")}`);
}

for (const [path, source] of textByFile) {
    const name = projectPath(path);
    if (name === "src/kernel/task-repository.ts" || name === "src/kernel/siyuan-api.ts") continue;
    if (/\b(?:this\.)?api\.(?:getBlockAttrs|batchGetBlockAttrs|setBlockAttrs|batchSetBlockAttrs)\s*\(/.test(source)) {
        failures.push(`${name}: task attribute access must be routed through TaskRepository`);
    }
}

for (const [path, source] of textByFile) {
    const name = projectPath(path);
    if (name === "src/kernel/siyuan-api.ts") continue;
    if (/\/api\/attr\/(?:getBlockAttrs|setBlockAttrs|batchGetBlockAttrs|batchSetBlockAttrs)/.test(source)) {
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
const declaredList = [...methodsSource.matchAll(/^ {4}([A-Za-z][A-Za-z0-9]+): defineRpc/gm)].map(match => match[1]);
const declared = new Set(declaredList);
const serverSource = readFileSync(join(sourceRoot, "kernel", "rpc-server.ts"), "utf8");
const bridgeSource = readFileSync(join(sourceRoot, "frontend", "kernel-bridge.ts"), "utf8");
const handled = new Set([...serverSource.matchAll(/^ {8}([A-Za-z][A-Za-z0-9]+):/gm)].map(match => match[1]));
const called = new Set([...bridgeSource.matchAll(/this\.call(?:<[^>]+>)?\("([A-Za-z][A-Za-z0-9]+)"/g)].map(match => match[1]));
if (declaredList.length !== declared.size || declared.size === 0) {
    failures.push(`RPC contract must contain unique methods, found ${declaredList.length}/${declared.size}`);
}
for (const method of declared) {
    if (!handled.has(method)) failures.push(`RPC method ${method} is declared but has no server handler`);
    if (!called.has(method)) failures.push(`RPC method ${method} is declared but has no KernelBridge call`);
}
for (const method of handled) if (!declared.has(method)) failures.push(`RPC server handles undeclared method ${method}`);
for (const method of called) if (!declared.has(method)) failures.push(`KernelBridge calls undeclared method ${method}`);
if (!serverSource.includes("for (const method of RPC_METHOD_NAMES)")) failures.push("RPC server must bind methods from the shared contract");
if ([...serverSource.matchAll(/\bcatch\s*\(/g)].length !== 1) failures.push("RPC server must use one shared exception boundary");

const rpcResultDefinitions = [...textByFile]
    .filter(([, source]) => /(?:interface|type)\s+RpcResult\b/.test(source))
    .map(([path]) => projectPath(path));
if (rpcResultDefinitions.length !== 1 || rpcResultDefinitions[0] !== "src/shared/rpc-methods.ts") {
    failures.push(`RpcResult must have one shared definition, found: ${rpcResultDefinitions.join(", ") || "none"}`);
}

const taskFacadeSource = readFileSync(join(sourceRoot, "kernel", "task-service.ts"), "utf8");
if (taskFacadeSource.split(/\r?\n/).length > 160) failures.push("TaskService compatibility facade must remain below 160 lines");
for (const forbidden of ["new Mutex", "setBlockAttrs(", "publishChanges(", "/api/"]) {
    if (taskFacadeSource.includes(forbidden)) failures.push(`TaskService facade contains business implementation marker: ${forbidden}`);
}
for (const service of [
    "TaskRuntimeState",
    "TaskLifecycleService",
    "TaskQueryService",
    "TaskRelationshipService",
    "RepeatTaskService",
    "TaskReviewService",
    "TaskCustomFieldService",
]) {
    if (!taskFacadeSource.includes(`new ${service}`)) failures.push(`TaskService facade must compose ${service}`);
}

const mcpExecutorSource = readFileSync(join(sourceRoot, "kernel", "mcp-tool-executor.ts"), "utf8");
if (/\/api\/attr\/|\bsetBlockAttrs\s*\(|\bbatchSetBlockAttrs\s*\(/.test(mcpExecutorSource)) {
    failures.push("MCP executor must not write task attributes directly");
}
const mcpUtilsSource = readFileSync(join(sourceRoot, "kernel", "mcp-utils.ts"), "utf8");
const readToolSection = mcpUtilsSource.match(/READ_MCP_TOOL_NAMES = \[([\s\S]*?)\] as const/)?.[1] || "";
const writeToolSection = mcpUtilsSource.match(/WRITE_MCP_TOOL_NAMES = \[([\s\S]*?)\] as const/)?.[1] || "";
const mcpToolNames = [...readToolSection.matchAll(/"([a-z_]+)"/g), ...writeToolSection.matchAll(/"([a-z_]+)"/g)].map(match => match[1]);
if (mcpToolNames.length !== 14 || new Set(mcpToolNames).size !== 14) {
    failures.push(`MCP catalog must contain 14 unique tools, found ${mcpToolNames.length}/${new Set(mcpToolNames).size}`);
}
for (const name of mcpToolNames) {
    if (!new RegExp(`^ {12}${name}:`, "m").test(mcpExecutorSource)) failures.push(`MCP tool ${name} has no executor definition`);
}
const capabilitySource = readFileSync(join(sourceRoot, "kernel", "mcp-capability-manager.ts"), "utf8");
if (!capabilitySource.includes("executor.getCatalog()")) failures.push("MCP capability registration must use the shared catalog");

const frontendEntrySource = readFileSync(join(sourceRoot, "index.ts"), "utf8");
if (frontendEntrySource.split(/\r?\n/).length > 100) failures.push("frontend entry must remain below 100 lines");
for (const controller of ["PanelHostRegistrar", "TaskCommandController", "EditorTaskIntegration", "FrontendRuntime"]) {
    if (!frontendEntrySource.includes(controller)) failures.push(`frontend entry must delegate to ${controller}`);
}
if (/\b(?:Menu|Dialog|openTab|addEventListener|rpc\.bind)\b/.test(frontendEntrySource)) {
    failures.push("frontend entry must not implement UI hosts or runtime listeners directly");
}

if (failures.length) {
    console.error(failures.map(message => `- ${message}`).join("\n"));
    process.exit(1);
}

console.log(`Architecture checks passed (${declared.size} RPC methods, ${mcpToolNames.length} MCP tools).`);
