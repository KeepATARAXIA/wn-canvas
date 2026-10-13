import type { CanvasNodeData } from "@/types/canvas";

export type GenerationQueueItem = {
    id: string;
    nodeId: string;
    mode: "image" | "video";
    prompt: string;
    title: string;
    status: "queued" | "running";
    startedAt?: number;
    targetNodeIds?: string[];
};

export type NodeGenerationWaiting = { position: number; count: number; running: boolean };

// Waiting is a live queue presentation, separate from saved generation status and timing.
export function waitingGenerationByNode(queue: GenerationQueueItem[], runningNodeId?: string | null) {
    const runningIds = new Set(queue.filter(item => item.status === "running").flatMap(item => [item.nodeId, ...(item.targetNodeIds || [])]));
    if (runningNodeId) runningIds.add(runningNodeId);
    const waiting = new Map<string, NodeGenerationWaiting>();
    let position = 0;
    queue.forEach(item => {
        if (item.status !== "queued") return;
        position += 1;
        const current = waiting.get(item.nodeId);
        if (current) current.count += 1;
        else waiting.set(item.nodeId, { position, count: 1, running: runningIds.has(item.nodeId) });
    });
    return waiting;
}

export function generationQueueDisplay(item: GenerationQueueItem, nodes: CanvasNodeData[]) {
    const source = nodes.find(node => node.id === item.nodeId);
    const targets = item.status === "running" ? (item.targetNodeIds || []).flatMap(id => {
        const node = nodes.find(node => node.id === id);
        return node && node.type === item.mode ? [node] : [];
    }) : [];
    const target = targets.at(-1);
    const m = target?.metadata;
    const current = m?.status === "loading" && m.generationStartedAt != null && m.generationStartedAt >= (item.startedAt || 0);
    const batch = current && m.images && m.images.length > 1 ? m.images : undefined;
    const activeImage = batch?.find(image => image.status === "loading");
    const stage = !current ? "正在准备生成" : batch
        ? `${batch.filter(image => image.status === "success").length}/${batch.length} 张完成${batch.some(image => image.status === "error") ? ` · ${batch.filter(image => image.status === "error").length} 张失败` : ""} · ${activeImage?.progressStage || "正在处理图片"}`
        : m.progressStage || "正在生成，等待后台返回";
    const percent = batch ? batch.filter(image => image.status === "success" || image.status === "error").length * 100 / batch.length
        : current && m.progressIndeterminate !== true && typeof m.progress === "number" && Number.isFinite(m.progress) ? Math.max(0, Math.min(100, m.progress)) : undefined;
    const prompt = (current ? m.prompt : undefined) || item.prompt || source?.metadata?.composerContent || source?.metadata?.prompt || (source?.type === "text" ? source.metadata?.content : "") || "";
    const preview = source?.metadata?.content && ["image", "video"].includes(source.type) ? source : target?.metadata?.content ? target : undefined;
    return { source, target, preview, prompt, stage, percent };
}
