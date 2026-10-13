import { defaultConfig, modelMatchesCapability, resolveModelForCapability, type AiConfig, type ImageGenerationSettings, type VideoGenerationSettings, type LastImageGeneration, type LastVideoGeneration } from "@/stores/use-config-store";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { GenerationRecord } from "./generation-history";

export function imageDefaults(config: AiConfig): ImageGenerationSettings {
    return {
        size: config.size || defaultConfig.size,
        quality: config.quality || defaultConfig.quality,
        background: config.background ?? defaultConfig.background,
        count: config.canvasImageCount || defaultConfig.canvasImageCount,
        ...config.imageGenerationDefaults,
    };
}

export function videoDefaults(config: AiConfig): VideoGenerationSettings {
    return {
        size: config.size || defaultConfig.size,
        vquality: config.vquality || defaultConfig.vquality,
        videoSeconds: config.videoSeconds || defaultConfig.videoSeconds,
        videoMode: config.videoMode || defaultConfig.videoMode,
        videoGenerateAudio: config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: config.videoWatermark || defaultConfig.videoWatermark,
        videoH3Mode: config.videoH3Mode || defaultConfig.videoH3Mode,
        videoH3SageAttention: config.videoH3SageAttention || defaultConfig.videoH3SageAttention,
        videoH3TeSpeed: config.videoH3TeSpeed || defaultConfig.videoH3TeSpeed,
        ...config.videoGenerationDefaults,
    };
}

export function newGenerationMetadata(config: AiConfig, kind: "image" | "video"): CanvasNodeMetadata {
    if (kind === "image") {
        const last = config.inheritLastImageSettings && config.lastImageGeneration;
        const inherited = last && modelMatchesCapability(config, last.model, kind) ? last : undefined;
        const settings = { ...imageDefaults(config), ...inherited };
        return {
            model: resolveModelForCapability(config, inherited?.model, kind),
            size: settings.size,
            quality: settings.quality,
            background: settings.background,
            count: Math.max(1, Math.min(15, Math.floor(Math.abs(Number(settings.count)) || 1))),
        };
    }
    const last = config.inheritLastVideoSettings && config.lastVideoGeneration;
    const inherited = last && modelMatchesCapability(config, last.model, kind) ? last : undefined;
    const settings = { ...videoDefaults(config), ...inherited };
    return {
        model: resolveModelForCapability(config, inherited?.model, kind),
        size: settings.size,
        seconds: settings.videoSeconds,
        vquality: settings.vquality,
        videoMode: settings.videoMode,
        generateAudio: settings.videoGenerateAudio,
        watermark: settings.videoWatermark,
        videoH3Mode: settings.videoH3Mode,
        h3SageAttention: settings.videoH3SageAttention,
        h3TeSpeed: settings.videoH3TeSpeed,
    };
}

export type GenerationPreferenceCompletions = { image?: LastImageGeneration; video?: LastVideoGeneration };

// Use the history's frozen request parameters, not node edits made while a task was running.
// Only a completed transition counts: restoring, importing and editing existing media do not.
export function completedGenerationPreferences(before: CanvasNodeData[], after: CanvasNodeData[], history: GenerationRecord[]): GenerationPreferenceCompletions {
    const completed: GenerationPreferenceCompletions = {};
    const previous = new Map(before.map((node) => [node.id, node]));
    for (const node of after) {
        if (node.type !== "image" && node.type !== "video") continue;
        const old = previous.get(node.id)?.metadata;
        const m = node.metadata;
        if (old?.status !== "loading" || m?.status !== "success" || !m.content || m.errorDetails || old.seedVr2TaskId || old.videoToolJobId) continue;
        if (m.images?.some((image) => image.status !== "success" || !image.content)) continue;
        const record = history.filter((item) => item.nodeId === node.id && item.kind === node.type && item.status === "success" && item.startedAt != null && item.endedAt != null)
            .reduce<GenerationRecord | undefined>((latest, item) => !latest || item.endedAt! >= latest.endedAt! ? item : latest, undefined);
        if (!record?.metadata.model || record.endedAt == null) continue;
        const saved = record.metadata;
        const common = { model: saved.model!, completedAt: record.endedAt };
        if (node.type === "image") {
            if (completed.image && completed.image.completedAt > common.completedAt) continue;
            completed.image = { ...common, size: saved.size || defaultConfig.size, quality: saved.quality || defaultConfig.quality, background: saved.background ?? "", count: String(saved.count || 1) };
        } else {
            if (completed.video && completed.video.completedAt > common.completedAt) continue;
            completed.video = {
                ...common, size: saved.size || defaultConfig.size,
                vquality: saved.vquality || defaultConfig.vquality,
                videoSeconds: saved.seconds || defaultConfig.videoSeconds,
                videoMode: saved.videoMode || defaultConfig.videoMode,
                videoGenerateAudio: saved.generateAudio || defaultConfig.videoGenerateAudio,
                videoWatermark: saved.watermark || defaultConfig.videoWatermark,
                videoH3Mode: saved.videoH3Mode || defaultConfig.videoH3Mode,
                videoH3SageAttention: saved.h3SageAttention || defaultConfig.videoH3SageAttention,
                videoH3TeSpeed: saved.h3TeSpeed || defaultConfig.videoH3TeSpeed,
            };
        }
    }
    return completed;
}
