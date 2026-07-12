/**
 * Kernel RPC automated test script
 * Usage: node scripts/test-kernel.js [baseURL]
 * Default baseURL: http://127.0.0.1:6806
 */
const baseURL = process.argv[2] || "http://127.0.0.1:6806";

let passed = 0;
let failed = 0;
let testBlockId = "";

async function siyuanAPI(path, body) {
    const resp = await fetch(baseURL + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return resp.json();
}

async function rpc(method, params) {
    return siyuanAPI("/api/plugin/rpc/nextaction", {
        jsonrpc: "2.0",
        method,
        params: [params],
        id: 1,
    });
}

function assert(condition, testName, detail) {
    if (condition) {
        passed++;
        console.log(`  ✓ ${testName}`);
    } else {
        failed++;
        console.log(`  ✗ ${testName}${detail ? " — " + detail : ""}`);
    }
}

async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function main() {
    console.log(`\nNextAction Kernel RPC Test`);
    console.log(`Target: ${baseURL}\n`);

    // Step 1: Find a document block to use for testing
    console.log("Setup: finding a test document block...");
    const docsResult = await siyuanAPI("/api/query/sql", {
        stmt: "SELECT id, content FROM blocks WHERE type='d' LIMIT 1",
    });
    if (!docsResult.data || docsResult.data.length === 0) {
        console.log("  ✗ No document blocks found, aborting");
        process.exit(1);
    }
    testBlockId = docsResult.data[0].id;
    console.log(`  Using block: ${testBlockId}\n`);

    // Step 2: Clean up — remove any existing task attributes
    console.log("Cleanup: removing existing task attributes...");
    await siyuanAPI("/api/attr/setBlockAttrs", {
        id: testBlockId,
        attrs: {
            "custom-na-task": "",
            "custom-na-status": "",
            "custom-na-priority": "",
            "custom-na-importance": "",
            "custom-na-effort": "",
            "custom-na-due": "",
            "custom-na-start": "",
            "custom-na-context": "",
            "custom-na-parent": "",
        },
    });
    await sleep(500);

    // Step 3: Test echo
    console.log("\n--- echo ---");
    {
        const r = await rpc("echo", ["hello", 42]);
        const result = r.result;
        // echo returns params as-is; SiYuan wraps params array, so result is [["hello",42]]
        assert(result !== undefined && result !== null, "echo returns non-null result", JSON.stringify(result));
    }

    // Step 4: Test convertToTask
    console.log("\n--- convertToTask ---");
    {
        const r = await rpc("convertToTask", { blockId: testBlockId });
        assert(!r.error, "no RPC error", r.error?.data);
        const entry = r.result;
        if (entry && entry._rpcError) {
            assert(false, "convertToTask failed", entry._rpcError.message);
        } else {
            assert(entry && entry.blockId === testBlockId, "blockId matches");
            assert(entry && entry.status === "todo", "status is todo", entry?.status);
            assert(entry && entry.priority === "none", "priority is none", entry?.priority);
            assert(entry && entry.importance === 4, "importance is 4", String(entry?.importance));
            assert(entry && entry.effort === 4, "effort is 4", String(entry?.effort));
            assert(entry && entry.order > 0, "order > 0", String(entry?.order));
            assert(entry && entry.title !== "", "title is not empty", `"${entry?.title}"`);
        }
    }

    // Step 5: Test getTask
    console.log("\n--- getTask ---");
    {
        const r = await rpc("getTask", { blockId: testBlockId });
        assert(!r.error, "no RPC error", r.error?.data);
        assert(r.result && r.result.blockId === testBlockId, "found task in cache");
        assert(r.result && r.result.title !== "", "title preserved in cache", `"${r.result?.title}"`);
    }

    // Step 6: Test getAllTasks
    console.log("\n--- getAllTasks ---");
    {
        const r = await rpc("getAllTasks", {});
        assert(!r.error, "no RPC error", r.error?.data);
        assert(Array.isArray(r.result) && r.result.length >= 1, "at least 1 task returned", `count: ${r.result?.length}`);
    }

    // Step 7: Test getNextActions
    console.log("\n--- getNextActions ---");
    {
        const r = await rpc("getNextActions", {});
        assert(!r.error, "no RPC error", r.error?.data);
        assert(Array.isArray(r.result) && r.result.length >= 1, "at least 1 next action returned");
    }

    // Step 8: Test updateTask (using na-* short keys)
    console.log("\n--- updateTask ---");
    {
        const r = await rpc("updateTask", {
            blockId: testBlockId,
            attrs: {
                "na-importance": "7",
                "na-priority": "high",
                "na-context": "办公室",
                "na-due": "2026-07-03",
            },
        });
        assert(!r.error, "no RPC error", r.error?.data);
        const entry = r.result;
        if (entry && entry._rpcError) {
            assert(false, "updateTask failed", entry._rpcError.message);
        } else {
            assert(entry && entry.importance === 7, "importance updated to 7", String(entry?.importance));
            assert(entry && entry.priority === "high", "priority updated to high", entry?.priority);
            assert(entry && entry.context === "办公室", "context updated", entry?.context);
            assert(entry && entry.due === "2026-07-03", "due date updated", entry?.due);
            assert(entry && entry.title !== "", "title preserved after update", `"${entry?.title}"`);
            assert(entry && entry.order > 120, "order increased after boosting importance/priority", String(entry?.order));
        }
    }

    // Step 9: Test getContexts
    console.log("\n--- getContexts ---");
    {
        const r = await rpc("getContexts", {});
        assert(!r.error, "no RPC error", r.error?.data);
        assert(Array.isArray(r.result) && r.result.includes("办公室"), "办公室 context found", JSON.stringify(r.result));
    }

    // Step 10: Test recalcAllOrders
    console.log("\n--- recalcAllOrders ---");
    {
        const r = await rpc("recalcAllOrders", {});
        assert(!r.error, "no RPC error", r.error?.data);
        assert(r.result && r.result.success === true, "success returned");
    }

    // Step 11: Test rebuildCache
    console.log("\n--- rebuildCache ---");
    {
        const r = await rpc("rebuildCache", {});
        assert(!r.error, "no RPC error", r.error?.data);
        assert(r.result && r.result.success === true, "success returned");

        // Verify cache still has the task after rebuild
        const r2 = await rpc("getTask", { blockId: testBlockId });
        assert(r2.result && r2.result.blockId === testBlockId, "task found after rebuild");
    }

    // Step 12: Wait and verify sync engine doesn't delete cache
    console.log("\n--- sync engine stability (waiting 8s) ---");
    {
        await sleep(8000);
        const r = await rpc("getTask", { blockId: testBlockId });
        assert(!r.error, "no RPC error after sync", r.error?.data);
        assert(r.result && r.result.blockId === testBlockId, "task still in cache after sync cycle");
    }

    // Step 13: Test removeTask
    console.log("\n--- removeTask ---");
    {
        const r = await rpc("removeTask", { blockId: testBlockId });
        assert(!r.error, "no RPC error", r.error?.data);
        assert(r.result && r.result.success === true, "success returned");

        const r2 = await rpc("getTask", { blockId: testBlockId });
        assert(r2.result === null || r2.result === undefined, "task removed from cache", JSON.stringify(r2.result));
    }

    // Step 14: Test error handling
    console.log("\n--- error handling ---");
    {
        const r = await rpc("convertToTask", {});
        assert(r.result && r.result._rpcError, "missing blockId returns rpcError", JSON.stringify(r.result));

        const r2 = await rpc("updateTask", { blockId: "nonexistent", attrs: "invalid" });
        assert(r2.result && r2.result._rpcError, "invalid attrs returns rpcError", JSON.stringify(r2.result));
    }

    // Summary
    console.log("\n" + "=".repeat(40));
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed > 0) {
        console.log("\nSome tests failed!");
        process.exit(1);
    } else {
        console.log("\nAll tests passed!");
    }
}

main().catch((e) => {
    console.error("Test script error:", e);
    process.exit(1);
});
