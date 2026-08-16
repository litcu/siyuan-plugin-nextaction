import test from "node:test";
import assert from "node:assert/strict";
import { formatError, formatRpcError } from "../src/frontend/error-format.ts";
import { RPC_ERROR_INTERNAL, RPC_ERROR_INVALID_PARAMS } from "../src/shared/constants.ts";

test("RPC 错误按消息规则、错误码和原始消息依次回退", () => {
    const i18n = { errInternal: "内部错误", errInvalidParams: "参数无效", errCircularRef: "循环引用" };
    assert.equal(formatRpcError({ _rpcError: { code: RPC_ERROR_INTERNAL, message: "boom" } }, i18n), "内部错误");
    assert.equal(formatRpcError({ code: RPC_ERROR_INVALID_PARAMS, message: "Circular reference detected" }, i18n), "循环引用");
    assert.equal(formatRpcError({ code: RPC_ERROR_INTERNAL, message: "boom" }, {}), "boom");
    assert.equal(formatError(new Error("plain")), "plain");
    assert.equal(formatError(42), "42");
});
