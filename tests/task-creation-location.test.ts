import test from "node:test";
import assert from "node:assert/strict";
import { TaskTargetResolver } from "../src/kernel/task-target-resolver.ts";
import { TaskCreationService } from "../src/kernel/task-creation-service.ts";
import type { TaskService } from "../src/kernel/task-service.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import { CREATE_TASK_DESTINATION_TYPES, validateTaskCreationSettings } from "../src/shared/task-creation.ts";
import { FakeSiyuanApi, taskFactory } from "./helpers/fakes.ts";

const parentId = "20260909120000-parenta";
const createdId = "20260909120000-created";

function setup(path: string, existingParent = false) {
    const api = new FakeSiyuanApi();
    api.notebooks.push({ id: "source", name: "来源" }, { id: "target", name: "目标" });
    if (existingParent) api.addBlock(parentId, "d", "父文档", "target", path);
    const originalRequest = api.request.bind(api);
    api.request = async <T>(endpoint: string, body: object = {}): Promise<T> => {
        if (endpoint === "/api/filetree/getDocCreateSavePath") {
            api.requests.push({ path: endpoint, body });
            return { box: "target", path } as T;
        }
        if (endpoint === "/api/filetree/getIDsByHPath") {
            return (existingParent && (body as { path: string }).path === path ? [parentId] : []) as T;
        }
        if (endpoint === "/api/filetree/createDocWithMd") {
            api.requests.push({ path: endpoint, body });
            return createdId as T;
        }
        return originalRequest<T>(endpoint, body);
    };
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.taskCreationSettings.dailyNoteNotebookId = "source";
    const resolver = new TaskTargetResolver(api, () => settings);
    return { api, settings, resolver };
}

test("思源默认位置可保存到最近目标和预设", () => {
    // Regression: 新目标应通过目标记忆的类型校验。
    assert.ok(CREATE_TASK_DESTINATION_TYPES.includes("siyuan_default"));
    const target = { type: "siyuan_default" as const, format: "document" as const, notebookId: "source" };
    assert.equal(
        validateTaskCreationSettings({ recentTargets: [target], presets: [{ id: "default", name: "默认", target }] }),
        null,
    );
});

for (const path of ["", "/", "/规划/九月"]) {
    test(`思源默认位置使用原生解析的跨笔记本路径：${path || "根目录"}`, async () => {
        // Regression: siyuan_default 目标通过思源原生 API 解析路径，不硬编码父文档路径。
        const { api, resolver } = setup(path);
        const result = await resolver.createChildDocument("任务", { type: "siyuan_default", format: "document" });
        assert.equal(result.document.notebookId, "target");
        assert.deepEqual(api.requests.find((request) => request.path === "/api/filetree/getDocCreateSavePath")?.body, {
            notebook: "source",
        });
        assert.deepEqual(api.requests.find((request) => request.path === "/api/filetree/createDocWithMd")?.body, {
            notebook: "target",
            path: `${path.replace(/\/$/, "")}/任务`,
            markdown: "",
        });
    });
}

test("思源默认路径对应已有父文档时传入父文档身份", async () => {
    const { api, resolver } = setup("/规划", true);
    const result = await resolver.createChildDocument("任务", {
        type: "siyuan_default",
        notebookId: "source",
        format: "document",
    });
    assert.equal(result.parent.id, parentId);
    assert.deepEqual(api.requests.find((request) => request.path === "/api/filetree/createDocWithMd")?.body, {
        notebook: "target",
        path: "/规划/任务",
        markdown: "",
        parentID: parentId,
    });
});

test("思源默认位置拒绝文本块并允许文档任务和项目", async () => {
    // Regression: 新目标只接受文档格式，项目不再限定指定文档位置。
    const { api, settings, resolver } = setup("");
    const kinds: string[] = [];
    const service = {
        convertToTask: async (_id: string, _title: string | undefined, kind: string) => {
            kinds.push(kind);
            return taskFactory(createdId);
        },
    } as unknown as TaskService;
    const creation = new TaskCreationService(service, api, resolver, () => settings);
    await assert.rejects(
        creation.create({ title: "任务", destination: { type: "siyuan_default", format: "paragraph" } }),
        /require document format/,
    );
    assert.equal(api.requests.length, 0);
    for (const kind of ["task", "project"] as const) {
        const result = await creation.create({
            title: "任务",
            kind,
            destination: { type: "siyuan_default", format: "document" },
        });
        assert.equal(result.task.blockId, createdId);
    }
    assert.deepEqual(kinds, ["1", "2"]);
});
