import type { GenerationRecord } from "./generation-history";
import type { CanvasNodeMetadata } from "@/types/canvas";

export function generationRecordTiming(record: GenerationRecord, now: number) {
    const end = record.endedAt ?? (record.status === "loading" ? now : undefined);
    const isWaiting = (name: string) => ["排队", "已提交，正在排队等待执行", "已提交，正在等待后台执行", "任务已提交，正在排队"].includes(name);
    let waiting = 0;
    const stages = record.stages.flatMap(stage => {
        const stageEnd = stage.endedAt ?? (record.status === "loading" ? now : undefined);
        const elapsed = stageEnd == null ? undefined : Math.max(0, stageEnd - stage.startedAt);
        if (isWaiting(stage.name)) {
            waiting += elapsed ?? 0;
            return [];
        }
        return [{ ...stage, elapsed }];
    });
    // Queue events remain in the saved record, but never count as generation work.
    const total = record.startedAt != null && end != null ? Math.max(0, end - record.startedAt - waiting) : undefined;
    const last = record.stages.at(-1);
    const queued = record.status === "loading" && last?.endedAt == null && isWaiting(last?.name || "");
    return { total, waiting, stages, queued };
}

// Keep the existing node grouping. Search selects the matching cover without
// changing the group's count or concealing the other results when expanded.
export function generationHistoryGroups(records: GenerationRecord[], keyword = "", kind = "all") {
    const grouped = new Map<string, GenerationRecord[]>();
    [...records].sort((a, b) => (b.startedAt ?? b.recordedAt) - (a.startedAt ?? a.recordedAt)).forEach(record => {
        if (kind !== "all" && record.kind !== kind) return;
        const group = grouped.get(record.nodeId) || [];
        group.push(record);
        grouped.set(record.nodeId, group);
    });
    const query = keyword.trim().toLowerCase();
    return [...grouped.entries()].flatMap(([nodeId, records]) => {
        const cover = records.find(record => [record.title, record.metadata.prompt, record.metadata.model].join(" ").toLowerCase().includes(query));
        return cover ? [{ nodeId, records, cover }] : [];
    });
}

export function generationHistoryTint(startedAt: number | undefined, now: number, latest: boolean) {
    if (startedAt == null) return 0;
    const days = Math.max(0, now - startedAt) / 86400000;
    if (days >= 7) return 0;
    if (days < 1) return (latest ? 0.16 : 0.10) * (1 - days * 0.4);
    return 0.06 * (7 - days) / 6;
}

// Number all results before filtering so searching never renames a record.
export function generationRecordNumbers(records: GenerationRecord[]) {
    const counts = new Map<string, number>();
    const numbers = new Map<string, number>();
    [...records].sort((a, b) => (a.startedAt ?? a.recordedAt) - (b.startedAt ?? b.recordedAt)).forEach(record => {
        const number = (counts.get(record.nodeId) || 0) + 1;
        counts.set(record.nodeId, number);
        numbers.set(record.id, number);
    });
    return numbers;
}

export function reusableGenerationMetadata(record: GenerationRecord): CanvasNodeMetadata {
    const m = record.metadata;
    // Copy request fields only; never copy outputs, task IDs, status or old references.
    const keys = ["model", "size", "quality", "background", "count", "textCount", "videoCount", "seconds", "vquality", "generateAudio", "watermark", "h3SageAttention", "h3TeSpeed", "videoH3Mode", "videoMode", "audioVoice", "audioFormat", "audioSpeed", "audioInstructions", "reasoningEffort"] as const;
    return { ...Object.fromEntries(keys.filter(key => m[key] !== undefined).map(key => [key, m[key]])), prompt: m.prompt || "", composerContent: m.prompt || "", status: "idle" };
}
