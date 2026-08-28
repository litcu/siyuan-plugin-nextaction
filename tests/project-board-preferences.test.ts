import test from "node:test";
import assert from "node:assert/strict";
import {
    DEFAULT_PROJECT_BOARD_PREFERENCE,
    createDefaultProjectBoardPreferences,
    getProjectBoardPreference,
    normalizeProjectBoardPreferences,
    withProjectBoardPreference,
} from "../src/shared/project-board-preferences.ts";
import { ProjectBoardPreferenceManager } from "../src/kernel/project-board-preference-manager.ts";

test("看板偏好默认使用手动顺序降序并按 Project 隔离", () => {
    const initial = createDefaultProjectBoardPreferences();
    assert.deepEqual(getProjectBoardPreference(initial, "p1"), DEFAULT_PROJECT_BOARD_PREFERENCE);
    const next = withProjectBoardPreference(initial, "p1", {
        ...DEFAULT_PROJECT_BOARD_PREFERENCE,
        groupBy: "priority",
        sortBy: "due",
        sortAsc: true,
        narrowColumnIndex: 2,
    });
    assert.equal(getProjectBoardPreference(next, "p1").sortBy, "due");
    assert.deepEqual(getProjectBoardPreference(next, "p2"), DEFAULT_PROJECT_BOARD_PREFERENCE);
});

test("坏数据和未知版本回退默认偏好", () => {
    assert.deepEqual(normalizeProjectBoardPreferences(null), createDefaultProjectBoardPreferences());
    assert.deepEqual(
        normalizeProjectBoardPreferences({ version: 99, projects: {} }),
        createDefaultProjectBoardPreferences(),
    );
    const normalized = normalizeProjectBoardPreferences({
        version: 1,
        projects: {
            good: { groupBy: "status", sortBy: "custom:owner", sortAsc: true, narrowColumnIndex: 1 },
            bad: { groupBy: "unknown", sortBy: "order", sortAsc: false, narrowColumnIndex: 0 },
        },
    });
    assert.equal(normalized.projects.good.sortBy, "custom:owner");
    assert.equal(normalized.projects.bad, undefined);
});

test("Project 偏好写入通过内核锁串行化", async () => {
    let activeWrites = 0;
    let maxActiveWrites = 0;
    let persisted = "";
    let hasData = false;
    const host = {
        storage: {
            async get() {
                if (!hasData) throw new Error("missing");
                return { json: async () => JSON.parse(persisted) };
            },
            async put(_path: string, value: string) {
                activeWrites += 1;
                maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
                await new Promise((resolve) => setTimeout(resolve, 2));
                persisted = value;
                hasData = true;
                activeWrites -= 1;
            },
        },
    };
    const manager = new ProjectBoardPreferenceManager(host);
    await manager.load();
    await Promise.all([
        manager.update("p1", { ...DEFAULT_PROJECT_BOARD_PREFERENCE, sortBy: "due" }),
        manager.update("p2", { ...DEFAULT_PROJECT_BOARD_PREFERENCE, groupBy: "priority" }),
    ]);
    assert.equal(maxActiveWrites, 1);
    const saved = JSON.parse(persisted);
    assert.deepEqual(Object.keys(saved.projects).sort(), ["p1", "p2"]);
    const reloaded = new ProjectBoardPreferenceManager(host);
    assert.equal((await reloaded.get()).projects.p2.groupBy, "priority");
});
