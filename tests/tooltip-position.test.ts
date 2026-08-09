import test from "node:test";
import assert from "node:assert/strict";
import { calculateTooltipPosition } from "../src/frontend/utils/tooltip-position.ts";

test("锚点 Tooltip 在顶部空间不足时翻转到底部", () => {
    const result = calculateTooltipPosition({
        anchor: { left: 100, top: 2, right: 130, bottom: 32, width: 30, height: 30 },
        popupWidth: 80,
        popupHeight: 24,
        preferred: "top",
        viewportWidth: 320,
        viewportHeight: 240,
    });
    assert.equal(result.position, "bottom");
    assert.ok(result.top > 32);
});

test("跟随鼠标的 Tooltip 会避开右下边界并限制在视口内", () => {
    const result = calculateTooltipPosition({
        anchor: { left: 250, top: 180, right: 280, bottom: 210, width: 30, height: 30 },
        popupWidth: 100,
        popupHeight: 40,
        preferred: "top",
        viewportWidth: 300,
        viewportHeight: 220,
        cursor: { x: 292, y: 212 },
    });
    assert.equal(result.position, "left");
    assert.ok(result.left >= 8);
    assert.ok(result.left + 100 <= 292);
    assert.ok(result.top >= 8);
    assert.ok(result.top + 40 <= 212);
});
