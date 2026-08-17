import test from "node:test";
import assert from "node:assert/strict";
import { formatError, formatOperationError, formatRpcError } from "../src/frontend/error-format.ts";
import { RPC_ERROR_INTERNAL, RPC_ERROR_INVALID_PARAMS } from "../src/shared/constants.ts";

test("RPC 错误按消息规则、错误码和原始消息依次回退", () => {
    const i18n = { errInternal: "内部错误", errInvalidParams: "参数无效", errCircularRef: "循环引用" };
    assert.equal(formatRpcError({ _rpcError: { code: RPC_ERROR_INTERNAL, message: "boom" } }, i18n), "内部错误");
    assert.equal(
        formatRpcError({ code: RPC_ERROR_INVALID_PARAMS, message: "Circular reference detected" }, i18n),
        "循环引用",
    );
    assert.equal(formatRpcError({ code: RPC_ERROR_INTERNAL, message: "boom" }, {}), "boom");
    assert.equal(formatError(new Error("plain")), "plain");
    assert.equal(formatError(42), "42");
});

test("用户操作错误区分 RPC、传输与普通领域消息", () => {
    const i18n = { errInternal: "内部错误", errInvalidParams: "参数无效", errTransport: "连接失败" };
    assert.equal(
        formatOperationError({ name: "RpcCallError", code: RPC_ERROR_INVALID_PARAMS, message: "bad" }, i18n),
        "参数无效",
    );
    assert.equal(formatOperationError({ kind: "transport", message: "socket closed" }, i18n), "连接失败");
    assert.equal(formatOperationError(new Error("供应商响应解析失败"), i18n), "供应商响应解析失败");
    assert.equal(formatOperationError({}, i18n), "内部错误");
});

test("MCP 写入目标缺失时前端显示具体配置指引", () => {
    const i18n = {
        errInvalidParams: "参数无效",
        errMcpInboxDocumentRequired: "请先配置收件箱文档",
        errMcpDailyNoteNotebookRequired: "请先配置日记本",
    };

    // Regression: 目标缺失的具体 RPC 消息曾被通用“参数无效”覆盖。
    assert.equal(
        formatOperationError(
            {
                name: "RpcCallError",
                code: RPC_ERROR_INVALID_PARAMS,
                message: "MCP inbox document is required",
            },
            i18n,
        ),
        "请先配置收件箱文档",
    );
    assert.equal(
        formatOperationError(
            {
                name: "RpcCallError",
                code: RPC_ERROR_INVALID_PARAMS,
                message: "Daily note notebook is required",
            },
            i18n,
        ),
        "请先配置日记本",
    );
});
