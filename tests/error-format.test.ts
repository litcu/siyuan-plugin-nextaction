import test from "node:test";
import assert from "node:assert/strict";
import {
    formatError,
    formatOperationError,
    formatRpcError,
    formatValidationError,
} from "../src/frontend/error-format.ts";
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
    const i18n = {
        errInternal: "内部错误",
        errInvalidParams: "参数无效",
        errInvalidParamsDetail: "参数无效：{message}",
        errTransport: "连接失败",
    };
    assert.equal(
        formatOperationError({ name: "RpcCallError", code: RPC_ERROR_INVALID_PARAMS, message: "bad" }, i18n),
        "参数无效：bad",
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

test("未知参数错误保留具体原因而内部错误继续隐藏细节", () => {
    const i18n = {
        errInternal: "内部错误",
        errInvalidParams: "参数无效",
        errInvalidParamsDetail: "参数无效：{message}",
    };

    // Regression: 未收录的参数错误曾只显示“参数无效”，丢失可操作原因。
    assert.equal(
        formatRpcError({ code: RPC_ERROR_INVALID_PARAMS, message: "title must contain 1-512 characters" }, i18n),
        "参数无效：title must contain 1-512 characters",
    );
    assert.equal(formatRpcError({ code: RPC_ERROR_INVALID_PARAMS, message: "Invalid parameters" }, i18n), "参数无效");
    assert.equal(formatRpcError({ code: RPC_ERROR_INTERNAL, message: "database password leaked" }, i18n), "内部错误");
});

test("设置范围校验显示对应字段限制而不是参数无效", () => {
    const i18n = {
        errDueDecayTauRange: "紧迫度衰减必须在 1–30 天之间。",
        errStartHorizonRange: "开始日期前瞻必须在 1–60 天之间。",
        errEffortScaleRange: "努力惩罚系数必须在 0–0.5 之间。",
        errStartPreviewDaysRange: "提前预览天数必须是 0–14 之间的整数。",
        errMyDayViewModeInvalid: "默认视图必须是时间轴或列表。",
        errMyDayDurationRange: "默认排期时长必须是 15–480 分钟之间的整数。",
    };

    // Regression: 多项设置范围校验曾被统一格式化为“参数无效”。
    assert.equal(formatValidationError("dueDecayTau must be 1-30", i18n), i18n.errDueDecayTauRange);
    assert.equal(formatValidationError("startHorizon must be 1-60", i18n), i18n.errStartHorizonRange);
    assert.equal(formatValidationError("effortScale must be 0-0.5", i18n), i18n.errEffortScaleRange);
    assert.equal(formatValidationError("startPreviewDays must be integer 0-14", i18n), i18n.errStartPreviewDaysRange);
    assert.equal(
        formatValidationError("myDayDefaultViewMode must be 'timeline' or 'list'", i18n),
        i18n.errMyDayViewModeInvalid,
    );
    assert.equal(
        formatValidationError("myDayDefaultDuration must be integer 15-480", i18n),
        i18n.errMyDayDurationRange,
    );
});
