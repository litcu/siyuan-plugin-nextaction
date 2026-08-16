import { performance } from "node:perf_hooks";
import { CacheManager } from "../src/kernel/cache-manager.ts";
import { TaskDerivedStateService } from "../src/kernel/task-derived-state-service.ts";

const TASK_COUNT = 1000;
const RUNS = 30;
const WARMUPS = 5;

const api = {
    request: async () => null,
    getBlockAttrs: async () => ({}),
    setBlockAttrs: async () => {},
    batchGetBlockAttrs: async () => ({}),
    batchSetBlockAttrs: async () => {},
    query: async () => [],
    broadcast: () => {},
    log: () => {},
};

function blockId(index) {
    return `20260816${String(index).padStart(6, "0")}-${index.toString(36).padStart(7, "0")}`;
}

function makeTask(index) {
    const groupStart = index - (index % 10);
    const isProject = index % 10 === 0;
    return {
        blockId: blockId(index),
        parentId: isProject ? "" : blockId(groupStart),
        status: index % 7 === 0 ? "done" : "todo",
        priority: index % 5 === 0 ? "high" : "medium",
        importance: 1 + (index % 8),
        effort: 1 + ((index * 3) % 8),
        due: "",
        start: "",
        context: index % 3 === 0 ? "work" : "",
        depends: index > 1 && index % 6 === 0 ? blockId(index - 1) : "",
        depMode: index % 2 === 0 ? "all" : "any",
        sequential: isProject && index % 20 === 0,
        repeat: "",
        repeatState: "",
        sort: (index % 10) * 10000,
        completed: "",
        note: "",
        created: "2026-08-16T09:00:00",
        tags: index % 4 === 0 ? "phase-four" : "",
        blocked: false,
        blockedReason: "",
        taskType: isProject ? "2" : "1",
        order: index % 100,
        childIds: [],
        title: `Benchmark task ${index}`,
        reviewInterval: 0,
        reviewDate: "",
        reminder: "",
        customFields: {},
    };
}

const fixture = Array.from({ length: TASK_COUNT }, (_, index) => makeTask(index));

function createCache() {
    const cache = new CacheManager(api);
    for (const task of fixture) cache.set({ ...task, childIds: [] });
    return cache;
}

function percentile(sorted, ratio) {
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function measure(name, operation) {
    for (let i = 0; i < WARMUPS; i++) operation();
    const samples = [];
    for (let i = 0; i < RUNS; i++) {
        const startedAt = performance.now();
        operation();
        samples.push(performance.now() - startedAt);
    }
    samples.sort((a, b) => a - b);
    const median = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);
    console.log(`${name.padEnd(24)} median=${median.toFixed(3)}ms p95=${p95.toFixed(3)}ms`);
}

const cache = createCache();
const derivedState = new TaskDerivedStateService(cache);
derivedState.reconcileAll();
cache.consumeAffectedIds();
const parentIds = fixture.filter(task => task.taskType === "2").map(task => task.blockId);
const changedIds = fixture.slice(0, 100).map(task => task.blockId);

console.log(`NextAction phase four sync benchmark (${TASK_COUNT} tasks, ${RUNS} measured runs)`);
measure("index build", () => { createCache(); });
measure("parent queries", () => {
    for (const parentId of parentIds) cache.getByParent(parentId);
});
measure("single cache update", () => {
    const current = cache.get(blockId(501));
    cache.set({ ...current, priority: current.priority === "high" ? "medium" : "high" });
});
measure("incremental derived", () => { derivedState.reconcile(cache.consumeAffectedIds()); });
measure("full derived pass", () => { derivedState.reconcileAll(); });
measure("full snapshot clone", () => {
    cache.getAll().map(task => ({ ...task, childIds: [...task.childIds], customFields: { ...task.customFields } }));
});
measure("broadcast serialization", () => {
    const changeTypes = Object.fromEntries(changedIds.map(id => [id, "update"]));
    JSON.stringify({ changedBlockIds: changedIds, changeTypes });
});
measure("array reducer batch", () => {
    const byId = new Map(cache.getAll().map(task => [task.blockId, task]));
    for (const id of changedIds.slice(0, 10)) byId.set(id, { ...byId.get(id), note: "updated" });
    byId.delete(changedIds[99]);
    [...byId.values()];
});
