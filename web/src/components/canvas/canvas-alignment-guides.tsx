import type { CanvasAlignmentGuide } from "@/lib/canvas/canvas-node-snapping";

export function CanvasAlignmentGuides({ guides, scale }: { guides: CanvasAlignmentGuide[]; scale: number }) {
    if (!guides.length) return null;
    const first = guides[0];
    const labelX = first.axis === "x" ? first.coordinate : first.start;
    const labelY = first.axis === "x" ? first.start : first.coordinate;

    return (
        <svg className="pointer-events-none absolute left-0 top-0 z-[80] h-px w-px overflow-visible" aria-hidden="true">
            {guides.map((guide) => (
                <line
                    key={`${guide.axis}-${guide.coordinate}`}
                    x1={guide.axis === "x" ? guide.coordinate : guide.start - 12 / scale}
                    y1={guide.axis === "x" ? guide.start - 12 / scale : guide.coordinate}
                    x2={guide.axis === "x" ? guide.coordinate : guide.end + 12 / scale}
                    y2={guide.axis === "x" ? guide.end + 12 / scale : guide.coordinate}
                    stroke="#00b8db"
                    strokeWidth={1 / scale}
                    strokeDasharray={`${2 / scale} ${3 / scale}`}
                />
            ))}
            <g transform={`translate(${labelX}, ${labelY}) scale(${1 / scale})`}>
                <rect x="8" y="-28" width="68" height="20" rx="5" fill="#007f99" />
                <text x="42" y="-14" textAnchor="middle" fontSize="11" fill="white">
                    正在对齐
                </text>
            </g>
        </svg>
    );
}
