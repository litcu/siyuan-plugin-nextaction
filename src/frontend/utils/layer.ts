/**
 * Keep portaled controls above their current host without escaping above the
 * next SiYuan dialog. SiYuan increments this value whenever it opens a window.
 */
export function getCurrentUiZIndex(fallback = 10): number {
    if (typeof window === "undefined") return fallback;
    const current = Number((window as any).siyuan?.zIndex);
    return Number.isFinite(current) ? Math.max(fallback, current) : fallback;
}
