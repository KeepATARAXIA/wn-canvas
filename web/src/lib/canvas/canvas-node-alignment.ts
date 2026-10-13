import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type CanvasNodeAlignment =
    | "left"
    | "center-horizontal"
    | "right"
    | "top"
    | "center-vertical"
    | "bottom"
    | "distribute-horizontal"
    | "distribute-vertical";

export function alignCanvasNodes(nodes: CanvasNodeData[], selectedNodeIds: ReadonlySet<string>, alignment: CanvasNodeAlignment) {
    const roots = nodes.filter((node) => selectedNodeIds.has(node.id) && (!node.metadata?.groupId || !selectedNodeIds.has(node.metadata.groupId)));
    const minimumCount = alignment.startsWith("distribute-") ? 3 : 2;
    if (roots.length < minimumCount) return nodes;

    const left = Math.min(...roots.map((node) => node.position.x));
    const right = Math.max(...roots.map((node) => node.position.x + node.width));
    const top = Math.min(...roots.map((node) => node.position.y));
    const bottom = Math.max(...roots.map((node) => node.position.y + node.height));
    const alignedPositions = new Map<string, CanvasNodeData["position"]>();

    if (alignment === "distribute-horizontal") {
        const sorted = [...roots].sort((a, b) => a.position.x - b.position.x);
        const gap = (right - left - sorted.reduce((total, node) => total + node.width, 0)) / (sorted.length - 1);
        let x = left;
        sorted.forEach((node) => {
            alignedPositions.set(node.id, { x, y: node.position.y });
            x += node.width + gap;
        });
    } else if (alignment === "distribute-vertical") {
        const sorted = [...roots].sort((a, b) => a.position.y - b.position.y);
        const gap = (bottom - top - sorted.reduce((total, node) => total + node.height, 0)) / (sorted.length - 1);
        let y = top;
        sorted.forEach((node) => {
            alignedPositions.set(node.id, { x: node.position.x, y });
            y += node.height + gap;
        });
    } else {
        roots.forEach((node) => {
            let { x, y } = node.position;
            if (alignment === "left") x = left;
            if (alignment === "center-horizontal") x = (left + right - node.width) / 2;
            if (alignment === "right") x = right - node.width;
            if (alignment === "top") y = top;
            if (alignment === "center-vertical") y = (top + bottom - node.height) / 2;
            if (alignment === "bottom") y = bottom - node.height;
            alignedPositions.set(node.id, { x, y });
        });
    }

    const selectedGroupOffsets = new Map<string, CanvasNodeData["position"]>();
    roots.forEach((node) => {
        if (node.type !== CanvasNodeType.Group) return;
        const nextPosition = alignedPositions.get(node.id);
        if (!nextPosition) return;
        selectedGroupOffsets.set(node.id, {
            x: nextPosition.x - node.position.x,
            y: nextPosition.y - node.position.y,
        });
    });

    let changed = false;
    const nextNodes = nodes.map((node) => {
        const alignedPosition = alignedPositions.get(node.id);
        const groupOffset = node.metadata?.groupId ? selectedGroupOffsets.get(node.metadata.groupId) : undefined;
        const nextPosition = alignedPosition || (groupOffset ? { x: node.position.x + groupOffset.x, y: node.position.y + groupOffset.y } : undefined);
        if (!nextPosition || (nextPosition.x === node.position.x && nextPosition.y === node.position.y)) return node;
        changed = true;
        return { ...node, position: nextPosition };
    });

    return changed ? nextNodes : nodes;
}
