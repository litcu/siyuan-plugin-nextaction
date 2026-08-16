/**
 * Kernel RPC integration test.
 *
 * Creates one uniquely named document in an open notebook and removes it in
 * finally. Existing user documents are never selected or modified.
 *
 * Usage: SIYUAN_API_TOKEN=<token> node scripts/test-kernel.js [baseURL]
 * Default baseURL: http://127.0.0.1:6806
 */
const baseURL = process.argv[2] || "http://127.0.0.1:6806";
const apiToken = process.env.SIYUAN_API_TOKEN || "";
const pluginName = "siyuan-plugin-nextaction";

function requestHeaders() {
    return {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Token ${apiToken}` } : {}),
    };
}

let passed = 0;
let failed = 0;
let testDocumentId = "";

async function siyuanAPI(path, body = {}) {
    const response = await fetch(baseURL + path, {
        method: "POST",
        headers: requestHeaders(),
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
        headers: requestHeaders(),
        body: JSON.stringify({ jsonrpc: "2.0", method, params: [params], id: 1 }),
    });
    if (!response.ok) throw new Error(`RPC HTTP failure [${method}]: ${response.status}`);
    return response.json();
}

function assert(condition, testName, detail) {
    if (condition) {
        passed++;
        console.log(`  ✓ ${testName}`);
    } else {
        failed++;
        console.log(`  ✗ ${testName}${detail ? ` — ${detail}` : ""}`);
    }
}

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function localDateAfter(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function waitForIndexedBlock(blockId) {
    for (let attempt = 0; attempt < 40; attempt++) {
        const rows = await siyuanAPI("/api/query/sql", {
            stmt: `SELECT id FROM blocks WHERE id = '${blockId.replace(/'/g, "''")}' LIMIT 1`,
        });
        if (Array.isArray(rows) && rows[0]?.id === blockId) return;
        await sleep(250);
    }
    throw new Error(`Temporary document was not indexed in time: ${blockId}`);
}

async function waitForTaskAttributeIndex(blockId) {
    for (let attempt = 0; attempt < 40; attempt++) {
        const rows = await siyuanAPI("/api/query/sql", {
            stmt: `SELECT value FROM attributes WHERE block_id = '${blockId.replace(/'/g, "''")}' AND name = 'custom-na-task' AND value != '' LIMIT 1`,
        });
        if (Array.isArray(rows) && rows.length > 0) return;
        await sleep(250);
    }
    throw new Error(`Temporary task attributes were not indexed in time: ${blockId}`);
}

async function createTemporaryDocument() {
    const notebooks = await siyuanAPI("/api/notebook/lsNotebooks");
    const notebook = notebooks?.notebooks?.find(item => !item.closed);
    if (!notebook?.id) throw new Error("No open notebook is available for the integration test");

    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const title = `NextAction Stage 1 Test ${unique}`;
    const id = await siyuanAPI("/api/filetree/createDocWithMd", {
        notebook: notebook.id,
        path: `/${title}`,
        markdown: `# ${title}`,
    });
    if (typeof id !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(id)) {
        throw new Error(`SiYuan returned an invalid temporary document ID: ${String(id)}`);
    }
    testDocumentId = id;
    await waitForIndexedBlock(id);
    return { id, title };
}

async function removeTemporaryDocument() {
    if (!testDocumentId) return;
    try {
        await siyuanAPI("/api/filetree/removeDocByID", { id: testDocumentId });
        console.log(`\nCleanup: removed temporary document ${testDocumentId}`);
    } catch (error) {
        failed++;
        console.error(`\nCleanup failed for ${testDocumentId}:`, error);
    } finally {
        testDocumentId = "";
    }
}

async function runTests() {
    console.log("\nNextAction Kernel RPC Integration Test");
    console.log(`Target: ${baseURL}\n`);

    console.log("\n--- echo ---");
    const echo = await rpc("echo", { params: ["hello", 42] });
    if (echo.error) throw new Error(`NextAction plugin RPC is unavailable: ${echo.error.message || JSON.stringify(echo.error)}`);
    assert(JSON.stringify(echo.result) === JSON.stringify(["hello", 42]), "echo preserves array parameters", JSON.stringify(echo.result));

    const temporary = await createTemporaryDocument();
    console.log(`Setup: created temporary document ${temporary.id}`);
    const blockUri = `siyuan://blocks/${temporary.id}`;

    console.log("\n--- raw/URI input contract ---");
    const uriRejected = await rpc("getTask", { blockId: blockUri });
    assert(uriRejected.result?._rpcError?.code === -32001, "internal RPC rejects block URI", JSON.stringify(uriRejected.result));
    const mcpResolved = await rpc("resolveMcpDocumentTarget", { value: blockUri });
    assert(mcpResolved.result?.id === temporary.id, "MCP document resolver accepts and normalizes block URI", JSON.stringify(mcpResolved.result));

    console.log("\n--- convertToTask ---");
    const converted = await rpc("convertToTask", { blockId: temporary.id });
    assert(!converted.error && !converted.result?._rpcError, "convertToTask succeeds", JSON.stringify(converted));
    assert(converted.result?.blockId === temporary.id, "converted block ID matches");
    assert(converted.result?.status === "inbox", "default status is inbox", converted.result?.status);
    assert(converted.result?.priority === "medium", "default priority is medium", converted.result?.priority);

    const uriConvert = await rpc("convertToTask", { blockId: blockUri });
    assert(uriConvert.result?._rpcError?.code === -32001, "convertToTask rejects URI without mutating the task", JSON.stringify(uriConvert.result));

    console.log("\n--- updateTask/getTask/getNextActions ---");
    const due = localDateAfter(2);
    const updated = await rpc("updateTask", {
        blockId: temporary.id,
        attrs: {
            "na-status": "todo",
            "na-importance": "7",
            "na-priority": "high",
            "na-context": "阶段一集成测试",
            "na-due": due,
        },
    });
    assert(!updated.error && !updated.result?._rpcError, "updateTask succeeds", JSON.stringify(updated));
    assert(updated.result?.status === "todo" && updated.result?.priority === "high", "authoritative update is returned");
    assert(updated.result?.due === due, "due date is updated", updated.result?.due);

    const rawTask = await rpc("getTask", { blockId: temporary.id });
    assert(rawTask.result?.blockId === temporary.id, "getTask accepts raw ID and returns cached task");
    const nextActions = await rpc("getNextActions");
    assert(Array.isArray(nextActions.result) && nextActions.result.some(item => item.blockId === temporary.id), "updated task is a next action");

    console.log("\n--- repeat rule ---");
    const repeated = await rpc("setRepeatRule", {
        blockId: temporary.id,
        rule: { version: 2, frequency: "day", interval: 1 },
    });
    assert(!repeated.error && !repeated.result?._rpcError, "setRepeatRule succeeds", JSON.stringify(repeated));
    assert(Boolean(repeated.result?.repeat && repeated.result?.repeatState), "repeat rule and state are returned");

    console.log("\n--- cache rebuild ---");
    await waitForTaskAttributeIndex(temporary.id);
    const rebuilt = await rpc("rebuildCache");
    assert(rebuilt.result?.success === true, "rebuildCache succeeds", JSON.stringify(rebuilt.result));
    const afterRebuild = await rpc("getTask", { blockId: temporary.id });
    assert(afterRebuild.result?.blockId === temporary.id, "task survives authoritative cache rebuild");

    console.log("\n--- removeTask ---");
    const removed = await rpc("removeTask", { blockId: temporary.id });
    assert(removed.result?.success === true, "removeTask succeeds", JSON.stringify(removed.result));
    const afterRemove = await rpc("getTask", { blockId: temporary.id });
    assert(afterRemove.result == null, "removed task is absent from cache", JSON.stringify(afterRemove.result));

    const attrs = await siyuanAPI("/api/attr/getBlockAttrs", { id: temporary.id });
    assert(!attrs?.["custom-na-task"], "task marker is cleared authoritatively");
}

async function main() {
    try {
        await runTests();
    } catch (error) {
        failed++;
        console.error("Integration test error:", error);
    } finally {
        await removeTemporaryDocument();
    }

    console.log("\n" + "=".repeat(48));
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    process.exitCode = failed > 0 ? 1 : 0;
}

void main();
