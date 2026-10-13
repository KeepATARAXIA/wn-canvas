import type { CanvasNodeData } from "@/types/canvas";

/** Keep a newly created row together and move it below occupied space. */
export function placeVideoNodes(row: CanvasNodeData[], existing: CanvasNodeData[]) {
    let offset = 0;
    const obstacles = existing.filter(n => n.type !== "group");
    while (true) {
        let nextOffset = offset;
        for (const node of row) for (const other of obstacles) {
            const y = node.position.y + offset;
            if (node.position.x < other.position.x + other.width + 32 && node.position.x + node.width + 32 > other.position.x && y < other.position.y + other.height + 32 && y + node.height + 32 > other.position.y) {
                nextOffset = Math.max(nextOffset, other.position.y + other.height + 64 - node.position.y);
            }
        }
        if (nextOffset === offset) return row.map(n => ({ ...n, position: { ...n.position, y: n.position.y + offset } }));
        offset = nextOffset;
    }
}
