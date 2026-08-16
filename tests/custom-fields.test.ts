import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    decodeCustomFieldValue,
    encodeCustomFieldValue,
    isCustomFieldApplicable,
    migrateCustomFieldDefs,
    validateCustomFieldDefinitions,
    type CustomFieldDef,
} from "../src/shared/custom-fields.ts";

function field(type: CustomFieldDef["type"], extra: Partial<CustomFieldDef> = {}): CustomFieldDef {
    return {
        version: 2,
        id: `field-${type}`,
        key: `test-${type}`,
        label: type,
        description: "",
        type,
        status: "active",
        scope: { mode: "all" },
        showOnCard: true,
        ...extra,
    };
}

test("旧字段迁移为 V2，并将合法 Key 归一为小写", () => {
    const result = migrateCustomFieldDefs([
        { key: "delegatedTo", label: "Delegated to", type: "text" },
        { key: "bad_key", label: "Broken", type: "text" },
    ]);
    assert.equal(result.fields[0].key, "delegatedto");
    assert.equal(result.fields[0].status, "active");
    assert.equal(result.fields[1].status, "archived");
    assert.equal(result.fields[1].migrationIssue, "invalid-legacy-key");
    assert.ok(result.issues.length >= 2);
});

test("九种字段类型使用稳定的字符串存储格式", () => {
    assert.equal(encodeCustomFieldValue(field("number"), 12.5), "12.5");
    assert.equal(encodeCustomFieldValue(field("boolean"), true), "1");
    assert.equal(encodeCustomFieldValue(field("date"), "2026-08-01"), "2026-08-01");
    assert.equal(encodeCustomFieldValue(field("datetime"), "2026-08-01T09:30"), "2026-08-01T09:30");
    const select = field("singleSelect", { options: [{ id: "home", label: "Home", status: "active" }] });
    assert.equal(encodeCustomFieldValue(select, "home"), "home");
    const multi = field("multiSelect", { options: [{ id: "home", label: "Home", status: "active" }, { id: "work", label: "Work", status: "active" }] });
    assert.equal(encodeCustomFieldValue(multi, ["home", "work", "home"]), '["home","work"]');
    assert.deepEqual(decodeCustomFieldValue(multi, '["home"]'), ["home"]);
});

test("非法值和不安全链接被拒绝", () => {
    assert.throws(() => encodeCustomFieldValue(field("date"), "2026/08/01"));
    assert.throws(() => encodeCustomFieldValue(field("url"), "javascript:alert(1)"));
    assert.throws(() => encodeCustomFieldValue(field("text"), "x".repeat(501)));
});

test("项目树范围覆盖项目本身和全部后代", () => {
    const project = { blockId: "p", parentId: "", taskType: "2" } as any;
    const child = { blockId: "c", parentId: "p", taskType: "1" } as any;
    const grandChild = { blockId: "g", parentId: "c", taskType: "1" } as any;
    const taskMap = new Map([[project.blockId, project], [child.blockId, child], [grandChild.blockId, grandChild]]);
    const scoped = field("text", { scope: { mode: "projectTree", projectIds: ["p"] } });
    assert.equal(isCustomFieldApplicable(scoped, project, taskMap), true);
    assert.equal(isCustomFieldApplicable(scoped, grandChild, taskMap), true);
    assert.equal(isCustomFieldApplicable(scoped, { blockId: "x", parentId: "", taskType: "1" } as any, taskMap), false);
});

test("字段定义校验拒绝大写、下划线和重复 Key", () => {
    const invalid = field("text", { key: "Bad_Key" });
    assert.match(validateCustomFieldDefinitions([invalid]) ?? "", /lowercase/);
    assert.match(validateCustomFieldDefinitions([field("text"), field("text", { id: "other", key: "test-text" })]) ?? "", /unique/);
});

test("孤立字段清理兼容完整属性名", () => {
    const source = readFileSync(new URL("../src/kernel/task-service.ts", import.meta.url), "utf8");
    assert.match(source, /key\?\.startsWith\(ATTR_EXT_PREFIX\) \? key\.slice\(ATTR_EXT_PREFIX\.length\) : key/);
});
