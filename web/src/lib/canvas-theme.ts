export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

// Older projects stored the former grid default as "lines".
export function resolveCanvasBackgroundMode(mode?: CanvasBackgroundMode): CanvasBackgroundMode {
    return mode === "blank" ? "blank" : "dots";
}

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f4f6f8",
            dot: "rgba(100,116,139,.32)",
            line: "rgba(100,116,139,.10)",
            selectionStroke: "#2f5bff",
            selectionFill: "rgba(47,91,255,.06)",
        },
        node: {
            label: "#475569",
            fill: "#eef1f5",
            panel: "#ffffff",
            stroke: "#dde2e8",
            activeStroke: "#2f5bff",
            placeholder: "#64748b",
            text: "#17212b",
            muted: "#64748b",
            faint: "#94a3b8",
        },
        toolbar: {
            panel: "#ffffff",
            border: "#dde2e8",
            item: "#475569",
            itemHover: "#eef1f5",
            activeBg: "#e9efff",
            activeText: "#2f5bff",
        },
    },
    dark: {
        canvas: {
            background: "#11151d",
            dot: "rgba(148,163,184,.32)",
            line: "rgba(148,163,184,.12)",
            selectionStroke: "#7593ff",
            selectionFill: "rgba(47,91,255,.14)",
        },
        node: {
            label: "#cbd5e1",
            fill: "#222c3b",
            panel: "#181f2b",
            stroke: "#364359",
            activeStroke: "#7593ff",
            placeholder: "#94a3b8",
            text: "#f1f5f9",
            muted: "#a8b5c9",
            faint: "#71829c",
        },
        toolbar: {
            panel: "#181f2b",
            border: "#364359",
            item: "#cbd5e1",
            itemHover: "#222c3b",
            activeBg: "#233664",
            activeText: "#a9bdff",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
