import test from "node:test";
import assert from "node:assert/strict";

import { CacheManager } from "../src/kernel/cache-manager.ts";
import { Mutex } from "../src/kernel/mutex.ts";
import { materializeTask } from "../src/kernel/task-materializer.ts";
import { TaskRepository } from "../src/kernel/task-repository.ts";
import type { TaskIdentityResolver } from "../src/kernel/task-identity-resolver.ts";
import {
    ATTR_EFFORT,
    ATTR_EXT_PREFIX,
    ATTR_IMPORTANCE,
    ATTR_PARENT,
    ATTR_PRIORITY,
    ATTR_REVIEW_INTERVAL,
    ATTR_SORT,
    ATTR_STATUS,
    ATTR_TASK,
} from "../src/shared/constants.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import type { TaskHostIdentity } from "../src/shared/task-identity.ts";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import { FakeSiyuanApi, FakeTaskChangePublisher, taskFactory } from "./helpers/fakes.ts";

const TASK_ID = "20260831120000-taskmat";
const OTHER_ID = "20260831120001-otherid";

function identity(overrides: Partial<TaskHostIdentity> = {}): TaskHostIdentity {
    return {
        blockId: TASK_ID,
        identificationSource: "document",
        attrHostId: TASK_ID,
        structuralParentId: "structural-parent",
        effectiveParentId: "old-effective-parent",
        taskType: "1",
        defaultStatus: "inbox",
        title: "Fresh title",
        sort: 42,
        updated: "20260831120000",
        ...overrides,
    };
}

function baseFacts(entry: TaskCacheEntry): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...entry };
    delete copy.blocked;
    delete copy.blockedReason;
    delete copy.childIds;
    delete copy.order;
    delete copy._warning;
    return copy;
}

test("任务物化按证据类别执行稳定的字段优先级", () => {
    const existing = taskFactory(TASK_ID, {
        parentId: "existing-parent",
        status: "todo",
        title: "Existing title",
        taskType: "1",
        updated: "20260830000000",
    });
    const facts = materializeTask({
        blockId: TASK_ID,
        confirmedAttrs: {
            [ATTR_PARENT]: "persisted-parent",
            [ATTR_STATUS]: "doing",
            [ATTR_PRIORITY]: "high",
            [ATTR_TASK]: "1",
        },
        defaults: DEFAULT_SETTINGS,
        existingTask: existing,
        freshIdentity: identity(),
        observations: [
            { kind: "renamed", title: "Confirmed rename" },
            { kind: "effective-parent-confirmed", parentId: "observed-parent" },
            { kind: "task-type-confirmed", taskType: "2" },
        ],
    });

    assert.equal(facts.status, "doing");
    assert.equal(facts.priority, "high");
    assert.equal(facts.parentId, "observed-parent");
    assert.equal(facts.title, "Confirmed rename");
    assert.equal(facts.taskType, "2");
    assert.equal(facts.actionKind, "");
    assert.equal(facts.updated, "20260831120000");

    assert.equal(
        materializeTask({
            blockId: TASK_ID,
            confirmedAttrs: { [ATTR_PARENT]: "persisted-parent" },
            defaults: DEFAULT_SETTINGS,
            freshIdentity: identity(),
        }).parentId,
        "persisted-parent",
    );
    assert.equal(
        materializeTask({
            blockId: TASK_ID,
            confirmedAttrs: {},
            defaults: DEFAULT_SETTINGS,
            freshIdentity: identity(),
        }).parentId,
        "structural-parent",
    );
    assert.equal(
        materializeTask({
            blockId: TASK_ID,
            confirmedAttrs: {},
            defaults: DEFAULT_SETTINGS,
            existingTask: existing,
        }).parentId,
        "existing-parent",
    );
});

test("任务物化拒绝缺失、错配和冲突的结构证据", () => {
    assert.throws(
        () =>
            materializeTask({
                blockId: TASK_ID,
                confirmedAttrs: {},
                defaults: DEFAULT_SETTINGS,
            }),
        /requires identity evidence/,
    );
    assert.throws(
        () =>
            materializeTask({
                blockId: TASK_ID,
                confirmedAttrs: {},
                defaults: DEFAULT_SETTINGS,
                freshIdentity: identity({ blockId: OTHER_ID }),
            }),
        /block ID mismatch/,
    );
    assert.throws(
        () =>
            materializeTask({
                blockId: TASK_ID,
                confirmedAttrs: {},
                defaults: DEFAULT_SETTINGS,
                freshIdentity: identity({ identificationSource: "native", taskType: "1" }),
                observations: [{ kind: "task-type-confirmed", taskType: "2" }],
            }),
        /Native task cannot be materialized as a Project/,
    );
    assert.throws(
        () =>
            materializeTask({
                blockId: TASK_ID,
                confirmedAttrs: {},
                defaults: DEFAULT_SETTINGS,
                freshIdentity: identity(),
                observations: [
                    { kind: "renamed", title: "First" },
                    { kind: "renamed", title: "Second" },
                ],
            }),
        /Duplicate task materialization observation: renamed/,
    );
});

test("任务物化容忍历史非法数字和未知属性并使用运行时默认值", () => {
    const customKey = `${ATTR_EXT_PREFIX}estimate`;
    const facts = materializeTask({
        blockId: TASK_ID,
        confirmedAttrs: {
            [ATTR_IMPORTANCE]: "not-a-number",
            [ATTR_EFFORT]: "Infinity",
            [ATTR_SORT]: "broken",
            [ATTR_REVIEW_INTERVAL]: "NaN",
            [customKey]: "three points",
            "custom-na-unknown": "ignored",
        },
        defaults: { defaultImportance: 7, defaultEffort: 8 },
        freshIdentity: identity({ identificationSource: "native", taskType: "1", sort: 123 }),
    });

    assert.equal(facts.importance, 7);
    assert.equal(facts.effort, 8);
    assert.equal(facts.sort, 123);
    assert.equal(facts.reviewInterval, 0);
    assert.deepEqual({ ...facts.customFields }, { estimate: "three points" });
    assert.equal("unknown" in facts.customFields, false);
});

test("全量加载与确认写入适配器生成等价缓存条目", async () => {
    // Regression: full reload and confirmed writes previously used divergent field mappings.
    const attrs = {
        [ATTR_TASK]: "1",
        [ATTR_STATUS]: "doing",
        [ATTR_PRIORITY]: "high",
        [ATTR_SORT]: "invalid",
    };
    const freshIdentity = identity({
        identificationSource: "native",
        contentBlockId: OTHER_ID,
        taskType: "1",
        sort: 456,
    });
    const defaults = { defaultImportance: 6, defaultEffort: 9 };
    const api = new FakeSiyuanApi();
    const identities = {
        loadAll: async () => ({ records: [{ identity: freshIdentity, attrs }] }),
    } as unknown as TaskIdentityResolver;
    const loadedCache = new CacheManager(api, identities);
    loadedCache.updateMaterializationDefaults(defaults);
    await loadedCache.loadAll(async () => ({ [TASK_ID]: attrs }));

    const writtenCache = new CacheManager(api);
    const repository = new TaskRepository(api, writtenCache, new Mutex(), new FakeTaskChangePublisher(), defaults);
    const written = await repository.withConfirmedChanges((changes) =>
        Promise.resolve(
            changes.refreshEntry({
                blockId: TASK_ID,
                attrs,
                freshIdentity,
            }),
        ),
    );

    assert.deepEqual(baseFacts(written), baseFacts(loadedCache.get(TASK_ID)!));
    assert.equal(written.importance, 6);
    assert.equal(written.effort, 9);
    assert.equal(written.sort, 456);
    assert.equal(written.updated, freshIdentity.updated);
});
