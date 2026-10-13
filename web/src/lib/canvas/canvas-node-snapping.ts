import { CanvasNodeType, type CanvasNodeData, type Position } from "@/types/canvas";

export type CanvasAlignmentGuide = {
    axis: "x" | "y";
    coordinate: number;
    start: number;
    end: number;
};

type Bounds = { left: number; top: number; right: number; bottom: number };

export type CanvasResizeOptions = {
    corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    minWidth: number;
    minHeight: number;
    videoRatio: number;
};

export function snapCanvasNodeResize(nodes: CanvasNodeData[], node: CanvasNodeData, scale: number, options: CanvasResizeOptions) {
    const fromLeft = options.corner.includes("left");
    const fromTop = options.corner.includes("top");
    const bounds = boundsOf([node]);
    const targets = nodes.filter((target) => target.id !== node.id && target.type !== CanvasNodeType.Group && target.metadata?.groupId !== node.id).map((target) => boundsOf([target]));
    const threshold = 6 / scale;
    const reach = 1200 / scale;
    const edge = (rect: Bounds, axis: "x" | "y") => axis === "x" ? (fromLeft ? rect.left : rect.right) : (fromTop ? rect.top : rect.bottom);
    const candidates: { axis: "x" | "y"; width: number; height: number; distance: number }[] = [];
    for (const axis of ["x", "y"] as const) {
        for (const target of targets) {
            if (!isNearby(bounds, target, axis, reach)) continue;
            for (const coordinate of anchors(target, axis)) {
                const delta = coordinate - edge(bounds, axis);
                if (Math.abs(delta) > threshold) continue;
                let width = node.width + (axis === "x" ? delta * (fromLeft ? -1 : 1) : 0);
                let height = node.height + (axis === "y" ? delta * (fromTop ? -1 : 1) : 0);
                if (options.videoRatio) {
                    if (axis === "x") height = (width - 4) / options.videoRatio + 4;
                    else width = (height - 4) * options.videoRatio + 4;
                }
                if (width < options.minWidth || height < options.minHeight) continue;
                candidates.push({ axis, width, height, distance: Math.hypot(width - node.width, height - node.height) });
            }
        }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    // A video has one degree of freedom: use the closest valid size on either axis.
    const width = (options.videoRatio ? candidates[0] : candidates.find((candidate) => candidate.axis === "x"))?.width ?? node.width;
    const height = (options.videoRatio ? candidates[0] : candidates.find((candidate) => candidate.axis === "y"))?.height ?? node.height;
    const position = { x: fromLeft ? bounds.right - width : bounds.left, y: fromTop ? bounds.bottom - height : bounds.top };
    const snapped = boundsOf([{ ...node, width, height, position }]);
    const guides: CanvasAlignmentGuide[] = [];
    for (const axis of ["x", "y"] as const) {
        if (!candidates.length) break;
        const coordinate = edge(snapped, axis);
        for (const target of targets) {
            if (!isNearby(snapped, target, axis, reach) || !anchors(target, axis).some((value) => Math.abs(value - coordinate) < 0.001)) continue;
            const start = axis === "x" ? Math.min(snapped.top, target.top) : Math.min(snapped.left, target.left);
            const end = axis === "x" ? Math.max(snapped.bottom, target.bottom) : Math.max(snapped.right, target.right);
            const existing = guides.find((guide) => guide.axis === axis);
            if (existing) {
                existing.start = Math.min(existing.start, start);
                existing.end = Math.max(existing.end, end);
            } else guides.push({ axis, coordinate, start, end });
        }
    }
    return { width, height, position, guides };
}

function boundsOf(nodes: CanvasNodeData[]): Bounds {
    return nodes.reduce(
        (bounds, node) => ({
            left: Math.min(bounds.left, node.position.x),
            top: Math.min(bounds.top, node.position.y),
            right: Math.max(bounds.right, node.position.x + node.width),
            bottom: Math.max(bounds.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}

function anchors(bounds: Bounds, axis: "x" | "y") {
    const start = axis === "x" ? bounds.left : bounds.top;
    const end = axis === "x" ? bounds.right : bounds.bottom;
    return [start, (start + end) / 2, end];
}

function isNearby(a: Bounds, b: Bounds, axis: "x" | "y", reach: number) {
    return axis === "x" ? Math.max(a.top - b.bottom, b.top - a.bottom) <= reach : Math.max(a.left - b.right, b.left - a.right) <= reach;
}

// Use the original pointer position so offsets never accumulate and dragging
// beyond the threshold releases the snap immediately.
export function snapCanvasNodeDrag(nodes: CanvasNodeData[], initialPositions: ReadonlyMap<string, Position>, delta: Position, scale: number) {
    const movingIds = new Set(initialPositions.keys());
    const moved = nodes.map((node) => {
        const initial = initialPositions.get(node.id);
        return initial ? { ...node, position: { x: initial.x + delta.x, y: initial.y + delta.y } } : node;
    });
    const roots = moved.filter((node) => movingIds.has(node.id) && (!node.metadata?.groupId || !movingIds.has(node.metadata.groupId)));
    if (!roots.length) return { nodes: moved, guides: [] as CanvasAlignmentGuide[] };

    const movingBounds = boundsOf(roots);
    // Group frames must not attract their own contents while being rearranged.
    const targets = nodes.filter((node) => !movingIds.has(node.id) && node.type !== CanvasNodeType.Group).map((node) => boundsOf([node]));
    const threshold = 6 / scale;
    const reach = 1200 / scale;
    const offset = { x: 0, y: 0 };
    const snappedAxes = new Set<"x" | "y">();
    for (const axis of ["x", "y"] as const) {
        let nearest = threshold + 0.000001;
        for (const target of targets) {
            if (!isNearby(movingBounds, target, axis, reach)) continue;
            for (const from of anchors(movingBounds, axis)) {
                for (const to of anchors(target, axis)) {
                    const distance = to - from;
                    if (Math.abs(distance) > threshold || Math.abs(distance) >= nearest) continue;
                    nearest = Math.abs(distance);
                    offset[axis] = distance;
                    snappedAxes.add(axis);
                }
            }
        }
    }

    const snappedBounds = {
        left: movingBounds.left + offset.x,
        right: movingBounds.right + offset.x,
        top: movingBounds.top + offset.y,
        bottom: movingBounds.bottom + offset.y,
    };
    const guides: CanvasAlignmentGuide[] = [];
    for (const axis of snappedAxes) {
        for (const target of targets) {
            if (!isNearby(snappedBounds, target, axis, reach)) continue;
            for (const coordinate of anchors(snappedBounds, axis)) {
                if (!anchors(target, axis).some((value) => Math.abs(value - coordinate) < 0.001)) continue;
                const start = axis === "x" ? Math.min(snappedBounds.top, target.top) : Math.min(snappedBounds.left, target.left);
                const end = axis === "x" ? Math.max(snappedBounds.bottom, target.bottom) : Math.max(snappedBounds.right, target.right);
                const existing = guides.find((guide) => guide.axis === axis && Math.abs(guide.coordinate - coordinate) < 0.001);
                if (existing) {
                    existing.start = Math.min(existing.start, start);
                    existing.end = Math.max(existing.end, end);
                } else guides.push({ axis, coordinate, start, end });
            }
        }
    }
    return {
        nodes: moved.map((node) => (movingIds.has(node.id) && (offset.x || offset.y) ? { ...node, position: { x: node.position.x + offset.x, y: node.position.y + offset.y } } : node)),
        guides,
    };
}
