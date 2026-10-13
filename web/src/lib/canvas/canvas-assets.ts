import type { Asset } from "@/stores/use-asset-store";
import type { CanvasNodeData } from "@/types/canvas";
import { canvasOutputs, type GenerationRecord } from "./generation-history";

export type AssetDraft = Omit<Asset, "id" | "createdAt" | "updatedAt">;

export function assetResourceKey(asset: AssetDraft) {
    const data = asset.data;
    if ("content" in data) return `text:${data.content}`;
    return `${asset.kind}:${data.storageKey || ("dataUrl" in data ? data.dataUrl : data.url)}`;
}

export function collectCanvasAssets(projectId: string, nodes: CanvasNodeData[], history: GenerationRecord[]): AssetDraft[] {
    // Text nodes are editable documents. Archive their completed generation snapshots,
    // not every keystroke or intermediate stream update.
    const outputs = [...canvasOutputs(nodes).filter((item) => item.kind !== "text"), ...history.filter((r) => r.status === "success").map((r) => ({ ...r, metadata: { ...r.metadata, status: "success" as const } }))];
    const unique = new Map<string, AssetDraft>();
    for (const item of outputs) {
        const m = item.metadata;
        if (!m.content || m.status === "loading" || m.status === "error") continue;
        if (!["image", "video", "audio", "text"].includes(item.kind)) continue;
        const base = { title: item.title || m.prompt?.slice(0, 32) || "画布素材", tags: [], source: "Canvas", coverUrl: item.kind === "image" ? m.content : "", metadata: { source: "canvas", projectId, nodeId: item.nodeId, outputId: item.outputId, prompt: m.prompt, model: m.model } };
        const data = { storageKey: m.storageKey, width: m.naturalWidth || 0, height: m.naturalHeight || 0, bytes: m.bytes || 0, mimeType: m.mimeType || "" };
        const asset: AssetDraft = item.kind === "text" ? { ...base, kind: "text", data: { content: m.content } }
            : item.kind === "image" ? { ...base, kind: "image", data: { ...data, dataUrl: m.content } }
                : { ...base, kind: item.kind as "video" | "audio", data: { ...data, url: m.content } };
        const key = assetResourceKey(asset);
        if (!unique.has(key)) unique.set(key, asset);
    }
    return [...unique.values()];
}
