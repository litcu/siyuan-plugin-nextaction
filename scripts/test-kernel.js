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

function requireBlockId(value, name) {
    if (typeof value !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(value)) {
        throw new Error(`${name} did not return a valid block ID: ${String(value)}`);
    }
    return value;
}

async function snapshotAfter(testName, previous, operation) {
    const result = await operation();
    if (result.error || result.result?._rpcError) {
        throw new Error(`${testName} RPC failed: ${JSON.stringify(result.error || result.result._rpcError)}`);
    }
    const response = await rpc("getTaskSnapshotV2");
    const snapshot = response.result;
    assert(
        snapshot?.schema === 2 && typeof snapshot.streamId === "string" && snapshot.streamId.length > 0,
        `${testName} returns a valid V2 snapshot`,
        JSON.stringify(snapshot),
    );
    assert(snapshot?.streamId === previous.streamId, `${testName} keeps the active stream`);
    assert(
        snapshot?.revision > previous.revision,
        `${testName} advances snapshot revision`,
        `${previous.revision} -> ${snapshot?.revision}`,
    );
    return { result, snapshot };
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    const notebook = notebooks?.notebooks?.find((item) => !item.closed);
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
    if (echo.error)
        throw new Error(`NextAction plugin RPC is unavailable: ${echo.error.message || JSON.stringify(echo.error)}`);
    assert(
        JSON.stringify(echo.result) === JSON.stringify(["hello", 42]),
        "echo preserves array parameters",
        JSON.stringify(echo.result),
    );

    const temporary = await createTemporaryDocument();
    console.log(`Setup: created temporary document ${temporary.id}`);
    const blockUri = `siyuan://blocks/${temporary.id}`;
    const initialSnapshotResponse = await rpc("getTaskSnapshotV2");
    const initialSnapshot = initialSnapshotResponse.result;
    assert(initialSnapshot?.schema === 2, "getTaskSnapshotV2 exposes schema 2", JSON.stringify(initialSnapshot));

    console.log("\n--- raw/URI input contract ---");
    const uriRejected = await rpc("getTask", { blockId: blockUri });
    assert(
        uriRejected.result?._rpcError?.code === -32001,
        "internal RPC rejects block URI",
        JSON.stringify(uriRejected.result),
    );
    const mcpResolved = await rpc("resolveMcpDocumentTarget", { value: blockUri });
    assert(
        mcpResolved.result?.id === temporary.id,
        "MCP document resolver accepts and normalizes block URI",
        JSON.stringify(mcpResolved.result),
    );

    console.log("\n--- convertToTask ---");
    const conversion = await snapshotAfter("task creation", initialSnapshot, () =>
        rpc("convertToTask", { blockId: temporary.id }),
    );
    const converted = conversion.result;
    assert(!converted.error && !converted.result?._rpcError, "convertToTask succeeds", JSON.stringify(converted));
    assert(converted.result?.blockId === temporary.id, "converted block ID matches");
    assert(converted.result?.status === "inbox", "default status is inbox", converted.result?.status);
    assert(converted.result?.priority === "medium", "default priority is medium", converted.result?.priority);

    const uriConvert = await rpc("convertToTask", { blockId: blockUri });
    assert(
        uriConvert.result?._rpcError?.code === -32001,
        "convertToTask rejects URI without mutating the task",
        JSON.stringify(uriConvert.result),
    );

    console.log("\n--- updateTask/getTask/getNextActions ---");
    const due = localDateAfter(2);
    const update = await snapshotAfter("task update", conversion.snapshot, () =>
        rpc("updateTask", {
            blockId: temporary.id,
            attrs: {
                "na-status": "todo",
                "na-importance": "7",
                "na-priority": "high",
                "na-context": "阶段四集成测试",
                "na-due": due,
            },
        }),
    );
    const updated = update.result;
    assert(!updated.error && !updated.result?._rpcError, "updateTask succeeds", JSON.stringify(updated));
    assert(
        updated.result?.status === "todo" && updated.result?.priority === "high",
        "authoritative update is returned",
    );
    assert(updated.result?.due === due, "due date is updated", updated.result?.due);

    const rawTask = await rpc("getTask", { blockId: temporary.id });
    assert(rawTask.result?.blockId === temporary.id, "getTask accepts raw ID and returns cached task");
    const nextActions = await rpc("getNextActions");
    assert(
        Array.isArray(nextActions.result) && nextActions.result.some((item) => item.blockId === temporary.id),
        "updated task is a next action",
    );

    console.log("\n--- createTask/reorderTask ---");
    const firstCreation = await snapshotAfter("first child creation", update.snapshot, () =>
        rpc("createTask", {
            title: "Stage four first child",
            destination: { type: "block", parentBlockId: temporary.id },
        }),
    );
    const firstChildId = requireBlockId(firstCreation.result?.result?.task?.id, "first child creation");
    assert(true, "first child task is created");

    const secondCreation = await snapshotAfter("second child creation", firstCreation.snapshot, () =>
        rpc("createTask", {
            title: "Stage four second child",
            destination: { type: "block", parentBlockId: temporary.id },
        }),
    );
    const secondChildId = requireBlockId(secondCreation.result?.result?.task?.id, "second child creation");
    assert(true, "second child task is created");

    const reorder = await snapshotAfter("task reorder", secondCreation.snapshot, () =>
        rpc("reorderTask", {
            blockId: firstChildId,
            parentId: temporary.id,
            afterId: secondChildId,
        }),
    );
    assert(
        reorder.result?.result?.blockId === firstChildId,
        "reorderTask returns the moved child",
        JSON.stringify(reorder.result),
    );

    console.log("\n--- repeat rule ---");
    const repeatRule = await snapshotAfter("repeat rule update", reorder.snapshot, () =>
        rpc("setRepeatRule", {
            blockId: temporary.id,
            rule: { version: 2, frequency: "day", interval: 1 },
        }),
    );
    const repeated = repeatRule.result;
    assert(!repeated.error && !repeated.result?._rpcError, "setRepeatRule succeeds", JSON.stringify(repeated));
    assert(Boolean(repeated.result?.repeat && repeated.result?.repeatState), "repeat rule and state are returned");

    const repeatAdvance = await snapshotAfter("repeat advance", repeatRule.snapshot, () =>
        rpc("skipRepeatOccurrence", {
            blockId: temporary.id,
        }),
    );
    assert(
        !repeatAdvance.result.error && !repeatAdvance.result.result?._rpcError,
        "skipRepeatOccurrence succeeds",
        JSON.stringify(repeatAdvance.result),
    );

    console.log("\n--- cache rebuild ---");
    await waitForTaskAttributeIndex(temporary.id);
    const rebuild = await snapshotAfter("cache rebuild reset", repeatAdvance.snapshot, () => rpc("rebuildCache"));
    const rebuilt = rebuild.result;
    assert(rebuilt.result?.success === true, "rebuildCache succeeds", JSON.stringify(rebuilt.result));
    const afterRebuild = await rpc("getTask", { blockId: temporary.id });
    assert(afterRebuild.result?.blockId === temporary.id, "task survives authoritative cache rebuild");

    console.log("\n--- removeTask ---");
    const childRemoval = await snapshotAfter("child deletion", rebuild.snapshot, () =>
        rpc("removeTask", { blockId: secondChildId }),
    );
    assert(
        childRemoval.result?.result?.success === true,
        "child removeTask succeeds",
        JSON.stringify(childRemoval.result),
    );
    const parentRemoval = await snapshotAfter("parent deletion", childRemoval.snapshot, () =>
        rpc("removeTask", { blockId: temporary.id }),
    );
    const removed = parentRemoval.result;
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
