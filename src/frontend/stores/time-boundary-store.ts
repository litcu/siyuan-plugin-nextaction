import { readable } from "svelte/store";
import { findNextTimeBoundary } from "../utils/time-boundary";

const MAX_TIMEOUT_MS = 2_147_483_647;

const registeredDueValues = new Map<string, number>();
let publishNow: ((nowMs: number) => void) | null = null;
let boundaryTimer: ReturnType<typeof setTimeout> | null = null;
let rescheduleQueued = false;

function clearBoundaryTimer(): void {
    if (boundaryTimer !== null) {
        clearTimeout(boundaryTimer);
        boundaryTimer = null;
    }
}

function isDocumentVisible(): boolean {
    return typeof document === "undefined" || document.visibilityState === "visible";
}

function scheduleNextBoundary(): void {
    rescheduleQueued = false;
    clearBoundaryTimer();
    if (!publishNow || !isDocumentVisible()) return;

    const nowMs = Date.now();
    const nextBoundary = findNextTimeBoundary(registeredDueValues.keys(), nowMs);
    if (nextBoundary === null) return;

    const delay = Math.min(MAX_TIMEOUT_MS, Math.max(0, nextBoundary - nowMs));
    boundaryTimer = setTimeout(() => {
        boundaryTimer = null;
        if (!publishNow || !isDocumentVisible()) return;
        publishNow(Date.now());
        scheduleNextBoundary();
    }, delay);
}

function queueReschedule(): void {
    if (rescheduleQueued) return;
    rescheduleQueued = true;
    queueMicrotask(scheduleNextBoundary);
}

function handleVisibilityChange(): void {
    if (!publishNow) return;
    if (isDocumentVisible()) {
        // Background WebViews may freeze timers. Re-evaluate immediately when
        // SiYuan becomes visible, then restore the nearest-boundary timer.
        publishNow(Date.now());
        queueReschedule();
    } else {
        clearBoundaryTimer();
    }
}

/**
 * Shared clock for mounted due labels. It only emits at meaningful display
 * boundaries (or after visibility recovery), never on a fixed polling cadence.
 */
export const timeBoundaryStore = readable(Date.now(), (set) => {
    publishNow = set;
    set(Date.now());
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    queueReschedule();

    return () => {
        if (typeof document !== "undefined") {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        }
        publishNow = null;
        clearBoundaryTimer();
    };
});

/** Register a mounted due label and return its cleanup callback. */
export function registerDueTime(due: string): () => void {
    if (!due) return () => {};

    registeredDueValues.set(due, (registeredDueValues.get(due) || 0) + 1);
    queueReschedule();

    let active = true;
    return () => {
        if (!active) return;
        active = false;

        const count = registeredDueValues.get(due) || 0;
        if (count <= 1) registeredDueValues.delete(due);
        else registeredDueValues.set(due, count - 1);
        queueReschedule();
    };
}
