import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const groupPalette = ["#2f5bff", "#059669", "#9333ea", "#ea580c", "#db2777", "#0891b2", "#ca8a04", "#4f46e5"];
const colorKey = (color: string) => color.trim().toLowerCase();

export function ensureGroupColors(nodes: CanvasNodeData[], previousNodes?: CanvasNodeData[]): CanvasNodeData[] {
    const previousIds = previousNodes ? new Set(previousNodes.filter((node) => node.type === CanvasNodeType.Group).map((node) => node.id)) : null;
    const usedColors = new Set<string>();
    // Reserve existing colors before processing copies, even if a copy precedes its source.
    for (const node of nodes) {
        if (node.type !== CanvasNodeType.Group) continue;
        if (node.metadata?.labelColor) usedColors.add(colorKey(node.metadata.labelColor));
        if (node.metadata?.groupColor && (!previousIds || previousIds.has(node.id))) usedColors.add(colorKey(node.metadata.groupColor));
    }

    let extraColorIndex = 1;
    const nextColor = () => {
        const available = groupPalette.find((color) => !usedColors.has(colorKey(color)));
        if (available) return available;
        let generated: string;
        do {
            generated = `hsl(${(extraColorIndex++ * 137.508) % 360} 72% 48%)`;
        } while (usedColors.has(colorKey(generated)));
        return generated;
    };

    let changed = false;
    const nextNodes = nodes.map((node) => {
        if (node.type !== CanvasNodeType.Group) return node;
        const color = node.metadata?.groupColor;
        if (color && (!previousIds || previousIds.has(node.id) || !usedColors.has(colorKey(color)))) {
            usedColors.add(colorKey(color));
            return node;
        }
        const groupColor = nextColor();
        usedColors.add(colorKey(groupColor));
        changed = true;
        return { ...node, metadata: { ...node.metadata, groupColor } };
    });
    return changed ? nextNodes : nodes;
}

export function getGroupAccent(node: CanvasNodeData): string {
    return node.metadata?.labelColor || node.metadata?.groupColor || groupPalette[0];
}

export function groupNodeColors(node: CanvasNodeData, theme: CanvasTheme) {
    const accent = getGroupAccent(node);
    const dark = theme.canvas.background === canvasThemes.dark.canvas.background;
    return {
        background: `color-mix(in srgb, ${accent} ${dark ? 18 : 13}%, transparent)`,
        border: `color-mix(in srgb, ${accent} ${dark ? 60 : 45}%, ${theme.canvas.background})`,
        accent: dark ? `color-mix(in srgb, ${accent} 70%, white)` : accent,
    };
}
