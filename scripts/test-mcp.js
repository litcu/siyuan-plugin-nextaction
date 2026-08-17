/**
 * Destructive-scope-safe real MCP integration test.
 *
 * The script only mutates one uniquely named temporary document, restores the
 * previous MCP settings, and removes the document through SiYuan's API in finally.
 * Usage: SIYUAN_API_TOKEN=<token> node scripts/test-mcp.js [baseURL]
 */
const baseURL = process.argv[2] || "http://127.0.0.1:6806";
const apiToken = process.env.SIYUAN_API_TOKEN || "";
const pluginName = "siyuan-plugin-nextaction";
const toolNames = [
    "get_task_metadata",
    "search_tasks",
    "get_tasks",
    "get_next_actions",
    "list_projects",
    "get_my_day",
    "get_review",
    "get_statistics",
    "create_tasks",
    "update_tasks",
    "delete_tasks",
    "convert_blocks_to_tasks",
    "update_my_day",
    "mark_tasks_reviewed",
];

let requestId = 1;
let sessionId = "";
let testDocumentId = "";
let settingsSnapshot = null;
const registeredToolNames = new Map();

function headers(includeSession = true) {
    return {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(apiToken ? { Authorization: `Token ${apiToken}` } : {}),
        ...(includeSession && sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    };
}

async function siyuanAPI(path, body = {}) {
    const response = await fetch(baseURL + path, {
        method: "POST",
        headers: headers(false),
        body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || (typeof result.code === "number" && result.code !== 0)) {
        throw new Error(`SiYuan API failed [${path}]: ${result.msg || response.statusText}`);
    }
    return result.data;
}

async function rpc(method, params = {}) {
    const response = await fetch(`${baseURL}/api/plugin/rpc/${pluginName}`, {
        method: "POST",
        headers: headers(false),
        body: JSON.stringify({ jsonrpc: "2.0", method, params: [params], id: requestId++ }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error || payload.result?._rpcError) {
        throw new Error(`Plugin RPC failed [${method}]: ${JSON.stringify(payload.error || payload.result?._rpcError)}`);
    }
    return payload.result;
}

function parseMcpPayload(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{")) return JSON.parse(trimmed);
    const data = trimmed
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);
    return data.length ? JSON.parse(data[data.length - 1]) : null;
}

async function mcp(method, params = {}, notification = false) {
    const body = { jsonrpc: "2.0", method, params, ...(!notification ? { id: requestId++ } : {}) };
    const response = await fetch(`${baseURL}/mcp`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
    });
    const returnedSession = response.headers.get("mcp-session-id");
    if (returnedSession) sessionId = returnedSession;
    const payload = parseMcpPayload(await response.text());
    if (!response.ok || payload?.error)
        throw new Error(`MCP failed [${method}]: ${JSON.stringify(payload?.error || response.statusText)}`);
    return payload?.result;
}

async function createTemporaryDocument() {
    const notebooks = await siyuanAPI("/api/notebook/lsNotebooks");
    const notebook = notebooks?.notebooks?.find((item) => !item.closed);
    if (!notebook?.id) throw new Error("No open notebook is available for the MCP integration test");
    const title = `NextAction MCP Stage 3 ${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    testDocumentId = await siyuanAPI("/api/filetree/createDocWithMd", {
        notebook: notebook.id,
        path: `/${title}`,
        markdown: `# ${title}`,
    });
    if (!/^\d{14}-[0-9a-z]{7}$/.test(testDocumentId))
        throw new Error(`Invalid temporary document ID: ${testDocumentId}`);
    for (let attempt = 0; attempt < 40; attempt++) {
        const rows = await siyuanAPI("/api/query/sql", {
            stmt: `SELECT id FROM blocks WHERE id = '${testDocumentId.replace(/'/g, "''")}' LIMIT 1`,
        });
        if (Array.isArray(rows) && rows[0]?.id === testDocumentId) return { id: testDocumentId, title };
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Temporary document was not indexed in time: ${testDocumentId}`);
}

function findTool(tools, localName) {
    const registeredName = registeredToolNames.get(localName);
    const tool = tools.find((item) => item.name === registeredName || item.name === localName);
    if (!tool) throw new Error(`MCP tool is missing: ${localName}`);
    return tool.name;
}

async function callTool(tools, localName, args) {
    const result = await mcp("tools/call", { name: findTool(tools, localName), arguments: args });
    if (result?.isError) throw new Error(`Tool ${localName} returned isError: ${JSON.stringify(result)}`);
    console.log(`  ✓ ${localName}`);
    return result;
}

async function main() {
    console.log(`\nNextAction real MCP integration test\nTarget: ${baseURL}\n`);
    try {
        settingsSnapshot = await rpc("getSettings");
        await rpc("updateSettings", {
            settings: {
                mcpSettings: { ...settingsSnapshot.mcpSettings, enabled: true, allowWrite: true },
            },
        });
        const status = await rpc("getMcpStatus");
        if (!status.supported || status.tools?.length !== toolNames.length) {
            throw new Error(
                `MCP capability registration incomplete: ${JSON.stringify({ supported: status.supported, count: status.tools?.length, lastError: status.lastError })}`,
            );
        }
        for (const tool of status.tools) registeredToolNames.set(tool.localName, tool.fullName);
        const temporary = await createTemporaryDocument();
        console.log(`Setup: created temporary document ${temporary.id}`);

        await mcp("initialize", {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "nextaction-stage3-integration", version: "1.0.0" },
        });
        await mcp("notifications/initialized", {}, true);
        const listed = await mcp("tools/list");
        const tools = listed?.tools || [];
        for (const name of toolNames) findTool(tools, name);
        console.log(`  ✓ tools/list returned all ${toolNames.length} tools`);

        await callTool(tools, "convert_blocks_to_tasks", { items: [{ blockId: temporary.id, kind: "project" }] });
        await callTool(tools, "create_tasks", {
            items: [{ title: "MCP integration child", destination: { type: "block", parentBlockId: temporary.id } }],
        });
        const allTasks = await rpc("getAllTasks", {});
        const childId = allTasks.find((item) => item.title === "MCP integration child")?.blockId;
        if (!childId) throw new Error("Created child task was not returned by authoritative RPC");

        await callTool(tools, "update_tasks", {
            items: [{ id: childId, patch: { status: "todo", note: "stage3 integration" } }],
        });
        await callTool(tools, "update_my_day", { items: [{ id: childId, action: "add" }] });
        await callTool(tools, "mark_tasks_reviewed", { ids: [childId] });
        await callTool(tools, "get_task_metadata", {});
        await callTool(tools, "search_tasks", { query: "MCP integration child", limit: 10 });
        await callTool(tools, "get_tasks", { ids: [temporary.id, childId], includeRelations: ["children", "parent"] });
        await callTool(tools, "get_next_actions", { limit: 10 });
        await callTool(tools, "list_projects", { includeCompleted: true, limit: 10 });
        await callTool(tools, "get_my_day", {});
        await callTool(tools, "get_review", {});
        await callTool(tools, "get_statistics", { period: "week" });
        await callTool(tools, "delete_tasks", { ids: [childId] });
        console.log(`\nPassed: initialized one session and called all ${toolNames.length} tools.`);
    } finally {
        if (settingsSnapshot) {
            try {
                await rpc("updateSettings", { settings: { mcpSettings: settingsSnapshot.mcpSettings } });
                console.log("Cleanup: restored MCP settings");
            } catch (error) {
                console.error("Cleanup failed while restoring MCP settings:", error);
            }
        }
        if (testDocumentId) {
            try {
                await siyuanAPI("/api/filetree/removeDocByID", { id: testDocumentId });
                console.log(`Cleanup: removed temporary document ${testDocumentId}`);
            } catch (error) {
                console.error(`Cleanup failed for ${testDocumentId}:`, error);
            }
        }
    }
}

main().catch((error) => {
    console.error("\nMCP integration failed:", error);
    process.exitCode = 1;
});
