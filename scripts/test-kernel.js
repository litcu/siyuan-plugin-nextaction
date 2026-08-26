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
const integrationCase = process.env.NEXTACTION_INTEGRATION_CASE || "";

function requestHeaders() {
    return {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Token ${apiToken}` } : {}),
    };
}

let passed = 0;
let failed = 0;
const testDocumentIds = [];
const testTaskIds = [];

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

async function waitForReferenceIndex(defBlockId, sourceRootId) {
    for (let attempt = 0; attempt < 40; attempt++) {
        const rows = await siyuanAPI("/api/query/sql", {
            stmt: `SELECT block_id FROM refs WHERE def_block_id = '${defBlockId.replace(/'/g, "''")}' AND root_id = '${sourceRootId.replace(/'/g, "''")}' LIMIT 1`,
        });
        if (Array.isArray(rows) && rows.length > 0) return;
        await sleep(250);
    }
    throw new Error(`Block reference was not indexed in time: ${sourceRootId} -> ${defBlockId}`);
}

async function waitForNativeActions(documentId, expectedCount) {
    for (let attempt = 0; attempt < 40; attempt++) {
        const rows = await siyuanAPI("/api/query/sql", {
            stmt: `SELECT item.id, item.parent_id, item.root_id, item.type, item.subtype, list.parent_id AS list_parent_id FROM blocks item INNER JOIN blocks list ON list.id = item.parent_id WHERE item.root_id = '${documentId.replace(/'/g, "''")}' AND item.type = 'i' ORDER BY item.sort ASC`,
        });
        if (Array.isArray(rows) && rows.length >= expectedCount) return rows;
        await sleep(250);
    }
    throw new Error(`Native Actions were not indexed in time for document: ${documentId}`);
}

async function waitForBlockDocument(blockId, documentId) {
    for (let attempt = 0; attempt < 40; attempt++) {
        const rows = await siyuanAPI("/api/query/sql", {
            stmt: `SELECT root_id FROM blocks WHERE id = '${blockId.replace(/'/g, "''")}' LIMIT 1`,
        });
        if (Array.isArray(rows) && rows[0]?.root_id === documentId) return;
        await sleep(250);
    }
    throw new Error(`Block ${blockId} did not reach document ${documentId} in time`);
}

async function loadSubtreeIds(blockId) {
    const rows = await siyuanAPI("/api/query/sql", {
        stmt: `WITH RECURSIVE selected(id) AS (SELECT id FROM blocks WHERE id = '${blockId.replace(/'/g, "''")}' UNION ALL SELECT child.id FROM blocks child INNER JOIN selected parent ON child.parent_id = parent.id) SELECT id FROM selected`,
    });
    return rows.map((row) => row.id).sort();
}

function taskAttrs(attrs) {
    return Object.fromEntries(
        Object.entries(attrs || {})
            .filter(([key]) => key.startsWith("custom-na-"))
            .sort(([left], [right]) => left.localeCompare(right)),
    );
}

async function createTemporaryDocument(options = {}) {
    const notebooks = await siyuanAPI("/api/notebook/lsNotebooks");
    const notebook = notebooks?.notebooks?.find((item) => !item.closed);
    if (!notebook?.id) throw new Error("No open notebook is available for the integration test");

    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const title = `${options.titlePrefix || "NextAction Stage 1 Test"} ${unique}`;
    const id = await siyuanAPI("/api/filetree/createDocWithMd", {
        notebook: notebook.id,
        path: `/${title}`,
        markdown: options.markdown || `# ${title}`,
    });
    if (typeof id !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(id)) {
        throw new Error(`SiYuan returned an invalid temporary document ID: ${String(id)}`);
    }
    testDocumentIds.push(id);
    await waitForIndexedBlock(id);
    return { id, title };
}

async function removeTemporaryDocuments() {
    for (const documentId of testDocumentIds.reverse()) {
        try {
            await siyuanAPI("/api/filetree/removeDocByID", { id: documentId });
            console.log(`\nCleanup: removed temporary document ${documentId}`);
        } catch (error) {
            failed++;
            console.error(`\nCleanup failed for ${documentId}:`, error);
        }
    }
    testDocumentIds.length = 0;
}

async function removeTemporaryTasks() {
    for (const taskId of testTaskIds.reverse()) {
        try {
            await rpc("removeTask", { blockId: taskId });
            await siyuanAPI("/api/block/deleteBlock", { id: taskId });
            console.log(`\nCleanup: removed temporary task ${taskId}`);
        } catch (error) {
            failed++;
            console.error(`\nCleanup failed for temporary task ${taskId}:`, error);
        }
    }
    testTaskIds.length = 0;
}

async function testActionExtraction() {
    console.log("\n--- Action extraction ---");
    const source = await createTemporaryDocument({
        titlePrefix: "NextAction Extraction Source",
        markdown: "# Extraction source\n\nKeep this source note unchanged.",
    });
    const project = await createTemporaryDocument({ titlePrefix: "NextAction Extraction Project" });
    const projectConversion = await rpc("convertToTask", { blockId: project.id, taskType: "2" });
    assert(
        projectConversion.result?.taskType === "2" && !projectConversion.result?._rpcError,
        "Action extraction target is a Project document",
        JSON.stringify(projectConversion.result),
    );
    const sourceBefore = await siyuanAPI("/api/block/getBlockKramdown", { id: source.id });
    const snapshotBefore = (await rpc("getTaskSnapshotV2")).result;
    const extraction = await snapshotAfter("Action extraction", snapshotBefore, () =>
        rpc("extractAction", {
            sourceBlockId: source.id,
            title: "Verify extracted Action",
            status: "todo",
            actionKind: "stage",
            projectId: project.id,
        }),
    );
    const task = extraction.result?.result?.task;
    const taskId = requireBlockId(task?.blockId, "Action extraction");
    testTaskIds.push(taskId);
    assert(
        task?.parentId === project.id && task?.actionKind === "stage" && task?.status === "todo",
        "Action extraction applies Project, Stage, and status through authoritative task state",
        JSON.stringify(task),
    );
    const actionKramdown = await siyuanAPI("/api/block/getBlockKramdown", { id: taskId });
    assert(
        String(actionKramdown?.kramdown || "").includes(source.id),
        "Extracted Action contains a native reference to its source",
        JSON.stringify(actionKramdown),
    );
    const sourceAfter = await siyuanAPI("/api/block/getBlockKramdown", { id: source.id });
    assert(
        sourceAfter?.kramdown === sourceBefore?.kramdown,
        "Action extraction preserves the source block",
        JSON.stringify({ before: sourceBefore, after: sourceAfter }),
    );

    const unassignedExtraction = await snapshotAfter("Unassigned Action extraction", extraction.snapshot, () =>
        rpc("extractAction", {
            sourceBlockId: source.id,
            title: "Verify unassigned extracted Action",
            status: "inbox",
            actionKind: "action",
        }),
    );
    const unassignedTask = unassignedExtraction.result?.result?.task;
    const unassignedTaskId = requireBlockId(unassignedTask?.blockId, "Unassigned Action extraction");
    testTaskIds.push(unassignedTaskId);
    assert(
        !unassignedTask?.parentId,
        "Action extraction supports an unassigned authoritative result",
        JSON.stringify(unassignedTask),
    );

    const invalidSource = await rpc("extractAction", {
        sourceBlockId: "20991231235959-missing",
        title: "Must not create an Action",
        status: "todo",
        actionKind: "action",
    });
    assert(
        Boolean(invalidSource.result?._rpcError) && !invalidSource.result?.task,
        "Action extraction rejects a nonexistent source without false success",
        JSON.stringify(invalidSource),
    );
}

async function testProjectSupport() {
    console.log("\n--- Project Support ---");
    const indirectTarget = await createTemporaryDocument({ titlePrefix: "NextAction Support Indirect Target" });
    const firstTarget = await createTemporaryDocument({
        titlePrefix: "NextAction Support First Target",
        markdown: `# Project Support first target\n\nIndirect support: ((${indirectTarget.id} "Indirect support"))`,
    });
    const secondTarget = await createTemporaryDocument({ titlePrefix: "NextAction Support Second Target" });
    const project = await createTemporaryDocument({
        titlePrefix: "NextAction Support Project",
        markdown: `# Project Support integration\n\nForward first: ((${firstTarget.id} "Forward first"))\n\n## Forward second ((${secondTarget.id} "Forward second"))`,
    });
    const backlink = await createTemporaryDocument({
        titlePrefix: "NextAction Support Backlink",
        markdown: `# Project Support backlink\n\nBacklink: ((${project.id} "Project Support integration"))`,
    });
    await Promise.all([
        waitForReferenceIndex(indirectTarget.id, firstTarget.id),
        waitForReferenceIndex(firstTarget.id, project.id),
        waitForReferenceIndex(secondTarget.id, project.id),
        waitForReferenceIndex(project.id, backlink.id),
    ]);

    const conversion = await rpc("convertToTask", { blockId: project.id, taskType: "2" });
    assert(
        conversion.result?.taskType === "2" && !conversion.result?._rpcError,
        "Project Support target is converted to a Project document",
        JSON.stringify(conversion.result),
    );
    const snapshotBefore = (await rpc("getTaskSnapshotV2")).result;
    const support = await rpc("getProjectSupport", { projectId: project.id });
    assert(!support.result?._rpcError, "getProjectSupport succeeds", JSON.stringify(support.result));
    const items = support.result?.items || [];
    const forward = items.find((item) => item.blockId === firstTarget.id);
    const directBacklink = items.find((item) => item.documentId === backlink.id);
    assert(
        forward?.directions?.includes("forward"),
        "Project Support returns the direct forward document reference",
        JSON.stringify(items),
    );
    assert(
        directBacklink?.directions?.includes("backlink"),
        "Project Support returns the direct backlink source",
        JSON.stringify(items),
    );
    // Regression: forward support follows its first occurrence in the Project document, not block-type sort weight.
    assert(
        items.findIndex((item) => item.blockId === firstTarget.id) <
            items.findIndex((item) => item.blockId === secondTarget.id),
        "Project Support keeps direct forward references in document occurrence order",
        JSON.stringify(items),
    );
    // Regression: Project Support does not traverse references found inside a direct support target.
    assert(
        !items.some((item) => item.blockId === indirectTarget.id),
        "Project Support does not include second-level references",
        JSON.stringify(items),
    );
    const snapshotAfterRead = (await rpc("getTaskSnapshotV2")).result;
    assert(
        snapshotAfterRead?.revision === snapshotBefore?.revision,
        "Project Support reads do not enter the task snapshot or advance its revision",
        `${snapshotBefore?.revision} -> ${snapshotAfterRead?.revision}`,
    );

    const ordinaryTarget = await rpc("getProjectSupport", { projectId: firstTarget.id });
    assert(
        ordinaryTarget.result?._rpcError?.code === -32001,
        "getProjectSupport rejects a non-Project document",
        JSON.stringify(ordinaryTarget.result),
    );
}

async function testActionMove() {
    console.log("\n--- Action move ---");
    const actionTitle = "Move integration parent";
    const childTitle = "Move integration nested child";
    const source = await createTemporaryDocument({
        titlePrefix: "NextAction Move Source",
        markdown: `# Move source\n\n- [ ] ${actionTitle}\n  - [ ] ${childTitle}`,
    });
    const project = await createTemporaryDocument({
        titlePrefix: "NextAction Move Project",
        markdown: "# Move project\n\nExisting project content must stay before the moved Action.",
    });
    const nativeActions = await waitForNativeActions(source.id, 2);
    const actionId = requireBlockId(
        nativeActions.find((row) => nativeActions.some((child) => child.list_parent_id === row.id))?.id,
        "Action move source",
    );
    const childId = requireBlockId(
        nativeActions.find((row) => row.list_parent_id === actionId)?.id,
        "Action move nested child",
    );
    const sourceListId = nativeActions.find((row) => row.id === actionId)?.parent_id;

    const projectConversion = await rpc("convertToTask", { blockId: project.id, taskType: "2" });
    assert(
        projectConversion.result?.taskType === "2" && !projectConversion.result?._rpcError,
        "Action move target is a Project document",
        JSON.stringify(projectConversion.result),
    );
    await waitForTaskAttributeIndex(project.id);
    await rpc("rebuildCache");
    const cachedAction = await rpc("getTask", { blockId: actionId });
    assert(
        cachedAction.result?.identificationSource === "native" && cachedAction.result?.taskType === "1",
        "Action move source is discovered as one native Action",
        JSON.stringify(cachedAction.result),
    );

    const updated = await rpc("updateTask", {
        blockId: actionId,
        attrs: {
            "na-status": "doing",
            "na-note": "Preserve this move integration note",
            "na-depends": childId,
        },
    });
    assert(
        updated.result?.status === "doing" && updated.result?.depends === childId,
        "Action move fixture has authoritative task attributes",
        JSON.stringify(updated.result),
    );
    const attrsBefore = taskAttrs(await siyuanAPI("/api/attr/getBlockAttrs", { id: actionId }));
    const subtreeBefore = await loadSubtreeIds(actionId);

    const preview = await rpc("previewActionMove", { actionId, projectId: project.id });
    assert(
        preview.result?.source?.documentId === source.id && preview.result?.target?.projectId === project.id,
        "Action move preview names the authoritative source and target",
        JSON.stringify(preview.result),
    );
    assert(
        preview.result?.nextEffectiveParentId === project.id && preview.result?.effectiveParentWillChange === true,
        "Action move preview reports the structural effective-parent change",
        JSON.stringify(preview.result),
    );

    const snapshotBefore = (await rpc("getTaskSnapshotV2")).result;
    const move = await snapshotAfter("Action move", snapshotBefore, () =>
        rpc("moveActionToProject", { actionId, projectId: project.id }),
    );
    const movedTask = move.result?.result?.task;
    assert(
        movedTask?.blockId === actionId && movedTask?.parentId === project.id,
        "Action move preserves identity and refreshes the effective Project parent",
        JSON.stringify(movedTask),
    );
    await waitForBlockDocument(actionId, project.id);

    const attrsAfter = taskAttrs(await siyuanAPI("/api/attr/getBlockAttrs", { id: actionId }));
    assert(
        JSON.stringify(attrsAfter) === JSON.stringify(attrsBefore),
        "Action move preserves every task attribute",
        JSON.stringify({ before: attrsBefore, after: attrsAfter }),
    );
    const subtreeAfter = await loadSubtreeIds(actionId);
    assert(
        JSON.stringify(subtreeAfter) === JSON.stringify(subtreeBefore),
        "Action move preserves the complete Action subtree",
        JSON.stringify({ before: subtreeBefore, after: subtreeAfter }),
    );

    const actionRows = await siyuanAPI("/api/query/sql", {
        stmt: `SELECT parent_id, root_id FROM blocks WHERE id = '${actionId}' LIMIT 1`,
    });
    const targetListId = actionRows[0]?.parent_id;
    const targetListRows = await siyuanAPI("/api/query/sql", {
        stmt: `SELECT parent_id FROM blocks WHERE id = '${targetListId}' LIMIT 1`,
    });
    const targetTail = await siyuanAPI("/api/query/sql", {
        stmt: `SELECT id, type FROM blocks WHERE parent_id = '${targetListRows[0]?.parent_id}' ORDER BY sort DESC LIMIT 1`,
    });
    assert(
        actionRows[0]?.root_id === project.id && targetTail[0]?.id === targetListId && targetTail[0]?.type === "l",
        "Action move appends its native task list at the Project document end",
        JSON.stringify({ actionRows, targetTail }),
    );
    const sourceResidue = await siyuanAPI("/api/query/sql", {
        stmt: `SELECT id, content FROM blocks WHERE root_id = '${source.id}' AND (id = '${sourceListId}' OR content LIKE 'NextAction temporary move%')`,
    });
    assert(
        sourceResidue.length === 0,
        "Action move removes the empty source list and all temporary structure",
        JSON.stringify(sourceResidue),
    );
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

    if (integrationCase === "action-move") {
        await testActionMove();
        return;
    }

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

    await testProjectSupport();
    await testActionExtraction();
    await testActionMove();
}

async function main() {
    try {
        await runTests();
    } catch (error) {
        failed++;
        console.error("Integration test error:", error);
    } finally {
        await removeTemporaryTasks();
        await removeTemporaryDocuments();
    }

    console.log("\n" + "=".repeat(48));
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    process.exitCode = failed > 0 ? 1 : 0;
}

void main();
