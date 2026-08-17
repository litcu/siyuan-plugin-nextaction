export type TooltipPosition = "top" | "bottom" | "left" | "right";

export interface TooltipRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface TooltipPoint {
    x: number;
    y: number;
}

interface TooltipPositionOptions {
    anchor: TooltipRect;
    popupWidth: number;
    popupHeight: number;
    preferred: TooltipPosition;
    viewportWidth: number;
    viewportHeight: number;
    cursor?: TooltipPoint | null;
    gap?: number;
    margin?: number;
}

export interface TooltipCoordinates {
    left: number;
    top: number;
    position: TooltipPosition;
}

function clamp(value: number, min: number, max: number): number {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}

function opposite(position: TooltipPosition): TooltipPosition {
    if (position === "top") return "bottom";
    if (position === "bottom") return "top";
    if (position === "left") return "right";
    return "left";
}

function anchoredCoordinates(
    anchor: TooltipRect,
    popupWidth: number,
    popupHeight: number,
    position: TooltipPosition,
    gap: number,
): TooltipCoordinates {
    if (position === "top") {
        return { left: anchor.left + (anchor.width - popupWidth) / 2, top: anchor.top - popupHeight - gap, position };
    }
    if (position === "bottom") {
        return { left: anchor.left + (anchor.width - popupWidth) / 2, top: anchor.bottom + gap, position };
    }
    if (position === "left") {
        return { left: anchor.left - popupWidth - gap, top: anchor.top + (anchor.height - popupHeight) / 2, position };
    }
    return { left: anchor.right + gap, top: anchor.top + (anchor.height - popupHeight) / 2, position };
}

function fits(
    coordinates: TooltipCoordinates,
    popupWidth: number,
    popupHeight: number,
    viewportWidth: number,
    viewportHeight: number,
    margin: number,
): boolean {
    return (
        coordinates.left >= margin &&
        coordinates.top >= margin &&
        coordinates.left + popupWidth <= viewportWidth - margin &&
        coordinates.top + popupHeight <= viewportHeight - margin
    );
}

export function calculateTooltipPosition(options: TooltipPositionOptions): TooltipCoordinates {
    const gap = options.gap ?? 8;
    const margin = options.margin ?? 8;

    if (options.cursor) {
        let left = options.cursor.x + gap + 4;
        let top = options.cursor.y + gap + 6;
        let position: TooltipPosition = "right";
        if (left + options.popupWidth > options.viewportWidth - margin) {
            left = options.cursor.x - options.popupWidth - gap - 4;
            position = "left";
        }
        if (top + options.popupHeight > options.viewportHeight - margin) {
            top = options.cursor.y - options.popupHeight - gap;
        }
        return {
            left: clamp(left, margin, options.viewportWidth - options.popupWidth - margin),
            top: clamp(top, margin, options.viewportHeight - options.popupHeight - margin),
            position,
        };
    }

    const preferred = anchoredCoordinates(
        options.anchor,
        options.popupWidth,
        options.popupHeight,
        options.preferred,
        gap,
    );
    if (
        fits(preferred, options.popupWidth, options.popupHeight, options.viewportWidth, options.viewportHeight, margin)
    ) {
        return preferred;
    }

    const flipped = anchoredCoordinates(
        options.anchor,
        options.popupWidth,
        options.popupHeight,
        opposite(options.preferred),
        gap,
    );
    const selected = fits(
        flipped,
        options.popupWidth,
        options.popupHeight,
        options.viewportWidth,
        options.viewportHeight,
        margin,
    )
        ? flipped
        : preferred;
    return {
        ...selected,
        left: clamp(selected.left, margin, options.viewportWidth - options.popupWidth - margin),
        top: clamp(selected.top, margin, options.viewportHeight - options.popupHeight - margin),
    };
}
