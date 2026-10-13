import { getNodeDefinition } from "./node-registry";
import type { CanvasNodeData } from "@/types/canvas";

// Preview inputs without publishing them as this tool's generated output.
export function getVideoToolInput(node: CanvasNodeData, upstream: CanvasNodeData[]) {
    const videos = upstream.flatMap(input => {
        const resource = getNodeDefinition(input.type)?.resource?.(input);
        return resource?.kind === "video" && resource.url ? [{ id: input.id, url: resource.url }] : [];
    });
    const source = String(node.metadata?.videoToolSettings?.source || (videos.length === 1 ? videos[0].id : "")) || undefined;
    return { source, preview: videos.find(video => video.id === source)?.url };
}
