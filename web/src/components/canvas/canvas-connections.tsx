import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { Scissors } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";

export function ConnectionPath({
    connection,
    from,
    to,
    active,
    selected = false,
    scale = 1,
    onCut,
    onSelect,
    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    selected?: boolean;
    scale?: number;
    onCut?: () => void;
    onSelect: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [cutPosition, setCutPosition] = useState<Position | null>(null);
    useLayoutEffect(() => {
        if (!selected) setCutPosition(null);
    }, [selected]);
    const startX = from.position.x + from.width;
    const startY = from.position.y + from.height / 2;
    const endX = to.position.x;
    const endY = to.position.y + to.height / 2;
    const dx = Math.abs(endX - startX);
    const curvature = Math.max(dx * 0.5, 50);
    const pathD = `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
    const flowing = active || from.metadata?.status === "loading" || to.metadata?.status === "loading";

    return (
        <g>
            <path
                data-connection-id={connection.id}
                d={pathD}
                stroke="transparent"
                strokeWidth="16"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={(event) => {
                    event.stopPropagation();
                    const matrix = event.currentTarget.getScreenCTM();
                    if (matrix) {
                        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
                        setCutPosition({ x: point.x, y: point.y });
                    }
                    onSelect();
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setCutPosition(null);
                    onContextMenu?.(event);
                }}
            />
            <path
                d={pathD}
                stroke={flowing ? "#0ea5e9" : theme.node.muted}
                strokeWidth="2"
                strokeOpacity={flowing ? 0.8 : 0.82}
                fill="none"
                style={{ pointerEvents: "none" }}
            />
            {flowing ? <ConnectionFlow path={pathD} /> : null}
            {selected && cutPosition && onCut ? (
                <foreignObject x={cutPosition.x - 16 / scale} y={cutPosition.y - 16 / scale} width={32 / scale} height={32 / scale} style={{ overflow: "visible", pointerEvents: "auto" }}>
                    <button
                        type="button"
                        aria-label="剪断连线"
                        title="剪断连线"
                        data-canvas-no-zoom
                        className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-sky-500/20 focus-visible:outline-2 focus-visible:outline-sky-500"
                        style={{ color: theme.node.text, transform: `scale(${1 / scale})`, transformOrigin: "top left", cursor: "pointer" }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => { if (event.key === " ") event.stopPropagation(); }}
                        onKeyUp={(event) => { if (event.key === " ") event.stopPropagation(); }}
                        onClick={(event) => {
                            event.stopPropagation();
                            onCut();
                        }}
                    >
                        <Scissors className="size-4" />
                    </button>
                </foreignObject>
            ) : null}
        </g>
    );
}

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData }) {
    if (!node) return null;

    const startX = handle.handleType === "source" ? node.position.x + node.width : mouseWorld.x;
    const startY = handle.handleType === "source" ? node.position.y + node.height / 2 : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : node.position.y + node.height / 2;
    const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;
    const snappedStartY = handle.handleType === "target" && target ? target.position.y + target.height / 2 : startY;
    const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;
    const snappedEndY = handle.handleType === "source" && target ? target.position.y + target.height / 2 : endY;
    const distance = Math.abs(snappedEndX - snappedStartX);
    const pathD = `M ${snappedStartX} ${snappedStartY} C ${snappedStartX + distance * 0.5} ${snappedStartY}, ${snappedEndX - distance * 0.5} ${snappedEndY}, ${snappedEndX} ${snappedEndY}`;

    return (
        <g style={{ pointerEvents: "none" }}>
            <path d={pathD} stroke="#0ea5e9" strokeOpacity={0.6} strokeWidth="2" fill="none" />
            <ConnectionFlow path={pathD} />
        </g>
    );
}

function ConnectionFlow({ path }: { path: string }) {
    const dark = useThemeStore((state) => state.theme) === "dark";
    const pathRef = useRef<SVGPathElement>(null);
    const [length, setLength] = useState(0);

    useLayoutEffect(() => {
        if (pathRef.current) setLength(pathRef.current.getTotalLength());
    }, [path]);

    // The gap exceeds the whole curve, so only one pulse can be visible.
    // Wait until its 120-unit tail clears the target before restarting.
    const travel = length + 128;
    const period = travel + 128;
    const style = {
        pointerEvents: "none",
        visibility: length > 0 ? "visible" : "hidden",
        "--flow-travel": `${travel}px`,
        "--flow-duration": `${travel / 360}s`,
    } as CSSProperties;

    return (
        <g fill="none" strokeLinecap="round" style={style} aria-hidden="true">
            <path ref={pathRef} className="canvas-connection-flow canvas-connection-flow-glow" d={path} stroke="#0ea5e9" strokeWidth="7" strokeOpacity={0.45} strokeDasharray={`120 ${period - 120}`} />
            <path className="canvas-connection-flow" d={path} stroke={dark ? "#22d3ee" : "#0284c7"} strokeWidth="3" strokeOpacity={0.9} strokeDasharray={`96 ${period - 96}`} />
            <path className="canvas-connection-flow canvas-connection-flow-head" d={path} stroke={dark ? "#67e8f9" : "#06b6d4"} strokeWidth="3.5" strokeDasharray={`24 ${period - 24}`} />
        </g>
    );
}
