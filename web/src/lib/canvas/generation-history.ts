import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

export type GenerationRecord = {
    id: string;
    nodeId: string;
    outputId: string;
    title: string;
    kind: string;
    status: "loading" | "success" | "error" | "canceled" | "interrupted";
    recordedAt: number;
    startedAt?: number;
    endedAt?: number;
    resumed?: boolean;
    stages: { name: string; startedAt: number; endedAt?: number }[];
    metadata: CanvasNodeMetadata;
};

export function canvasOutputs(nodes: CanvasNodeData[]) {
    return nodes.flatMap((node) => {
        const m = node.metadata;
        if (!m || node.type === "config" || node.type === "group" || node.type === "upload") return [];
        const kind = ["image", "video", "audio", "text"].includes(node.type) ? node.type : m.mimeType?.split("/")[0];
        if (!kind || !["image", "video", "audio", "text"].includes(kind)) return [];
        const { images, texts, ...metadata } = m;
        const batch = kind === "image" ? images : kind === "text" ? texts : undefined;
        return batch?.length
            ? batch.map((item) => ({ nodeId: node.id, outputId: item.id, title: node.title, kind, metadata: { ...metadata, ...item } as CanvasNodeMetadata }))
            : [{ nodeId: node.id, outputId: node.id, title: node.title, kind, metadata }];
    });
}

const outputKey = (item: { nodeId: string; outputId: string }) => `${item.nodeId}/${item.outputId}`;
const fileIdentity = (m: CanvasNodeMetadata) => m.storageKey || m.content || "";
const generated = (m: CanvasNodeMetadata) => Boolean(m.model || m.generationType || m.videoTaskId);
const stageName = (name?: string) => name?.replace(/\s+\d+\s*\/\s*\d+\s*步/g, "");

export function backfillGenerationHistory(nodes: CanvasNodeData[], history: GenerationRecord[], now: number) {
    // A page reload cannot reconstruct events missed while the page was closed.
    let next = history.map((record) => record.status === "loading" ? { ...record, status: "interrupted" as const } : record);
    const known = new Set(history.map(outputKey));
    for (const item of canvasOutputs(nodes)) {
        const m = item.metadata;
        const key = outputKey(item);
        if (!m.content || !generated(m) || known.has(key) || m.status === "loading" || m.status === "error") continue;
        known.add(key);
        next = [...next, { ...item, id: `legacy:${key}`, status: "success", recordedAt: now, stages: [] }];
    }
    return next;
}

export function recordGenerationChanges(before: CanvasNodeData[], after: CanvasNodeData[], history: GenerationRecord[], now: number, eventId: string) {
    if (before === after) return history;
    if (before.length === after.length && after.every((node, index) => node.id === before[index].id && node.type === before[index].type && node.metadata === before[index].metadata)) return history;
    const previous = new Map(canvasOutputs(before).map((item) => [outputKey(item), item]));
    const outputs = canvasOutputs(after);
    let next = history;
    const active = new Map(history.flatMap((record, index) => record.status === "loading" ? [[outputKey(record), index] as const] : []));
    for (const item of outputs) {
        const key = outputKey(item);
        const old = previous.get(key);
        const m = item.metadata;
        let index = active.get(key) ?? -1;
        if (m.status === "loading" && index < 0) {
            const record: GenerationRecord = { ...item, id: `${eventId}:${key}`, status: "loading", recordedAt: now, startedAt: now, resumed: Boolean(m.videoTaskId), stages: [{ name: stageName(m.progressStage) || "请求与生成（未提供细分事件）", startedAt: now }], metadata: { ...m, content: undefined, storageKey: undefined, bytes: undefined, naturalWidth: undefined, naturalHeight: undefined } };
            next = [...next, record];
            index = next.length - 1;
            active.set(key, index);
        }
        if (index < 0) {
            if (!old && m.content && m.status === "success" && generated(m) && !next.some((r) => fileIdentity(r.metadata) === fileIdentity(m))) {
                next = [...next, { ...item, id: `${eventId}:${key}`, status: "success", recordedAt: now, stages: [] }];
            }
            continue;
        }
        const record = next[index];
        if (m.status === "loading") {
            const stage = stageName(m.progressStage);
            const last = record.stages.at(-1);
            if (stage && stage !== last?.name) {
                next = next.map((r, i) => i === index ? { ...r, stages: [...r.stages.map((s, j) => j === r.stages.length - 1 ? { ...s, endedAt: now } : s), { name: stage, startedAt: now }] } : r);
            }
            continue;
        }
        const status = m.status === "idle" || /取消|cancel/i.test(m.errorDetails || "") ? "canceled" : m.status === "error" || m.errorDetails ? "error" : m.content ? "success" : "canceled";
        const result = status === "success" ? { content: m.content, storageKey: m.storageKey, naturalWidth: m.naturalWidth, naturalHeight: m.naturalHeight, bytes: m.bytes, mimeType: m.mimeType, durationMs: m.durationMs } : {};
        next = next.map((r, i) => i === index ? { ...r, status, endedAt: now, stages: r.stages.map((s) => s.endedAt == null ? { ...s, endedAt: now } : s), metadata: { ...r.metadata, ...result, model: r.metadata.model || m.model, errorDetails: m.errorDetails } } : r);
    }
    const present = new Set(outputs.map(outputKey));
    if (next.some((r) => r.status === "loading" && !present.has(outputKey(r)))) {
        next = next.map((r) => r.status === "loading" && !present.has(outputKey(r)) ? { ...r, status: "canceled", endedAt: now, stages: r.stages.map((s) => s.endedAt == null ? { ...s, endedAt: now } : s) } : r);
    }
    return next;
}
