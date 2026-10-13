import type { CanvasNodeMetadata } from "@/types/canvas";

const labels: Partial<Record<keyof CanvasNodeMetadata, string>> = { size: "请求尺寸 / 比例", quality: "图片质量", vquality: "视频清晰度", seconds: "请求时长", videoMode: "视频模式", videoH3Mode: "H3 模式", h3SageAttention: "SageAttention", h3TeSpeed: "TE-Speed", generateAudio: "生成声音", watermark: "水印", audioVoice: "音色", audioFormat: "音频格式", audioSpeed: "语速", audioInstructions: "声音指令", reasoningEffort: "推理强度", count: "批量数量", textCount: "文本数量", videoCount: "视频数量", background: "背景", generationType: "生成方式" };

const values: Partial<Record<keyof CanvasNodeMetadata, Record<string, string>>> = {
    quality: { auto: "自动", high: "高", medium: "中", low: "低" },
    background: { auto: "自动", transparent: "透明", opaque: "不透明" },
    generationType: { generation: "生图", edit: "编辑" },
    reasoningEffort: { auto: "自动", high: "高", medium: "中", low: "低", xhigh: "极高" },
    videoMode: { frames: "首尾帧", reference: "参考素材" },
    videoH3Mode: { turbo: "Turbo", normal: "标准", standard: "标准" },
};

export function generationDetailParameters(metadata: CanvasNodeMetadata, modelName: string) {
    // These built-in Qwen models have no independent quality control. Old
    // records retain the saved value for reuse; only its presentation changes.
    const isQwen = /^Qwen-Image 2\.1(?: Turbo)?(?:\s*·\s*(?:生图|编辑))?$/i.test(modelName);
    return Object.entries(labels).flatMap(([name, label]) => {
        const key = name as keyof CanvasNodeMetadata;
        const raw = metadata[key];
        if (raw == null || raw === "" || (key === "quality" && isQwen)) return [];
        const text = String(raw);
        let value = values[key]?.[text] || text;
        if (["generateAudio", "watermark", "h3SageAttention", "h3TeSpeed"].includes(key)) {
            if (["true", "1", "on", "enabled"].includes(text)) value = "开启";
            if (["false", "0", "off", "disabled"].includes(text)) value = "关闭";
        } else if (key === "size") value = text === "auto" ? "自动" : text.replace(/^(\d+)x(\d+)$/i, "$1 × $2 px");
        else if (key === "seconds") value = text === "-1" ? "智能时长" : /^\d+(?:\.\d+)?$/.test(text) ? `${text} 秒` : text;
        else if (key === "vquality" && /^\d+$/.test(text)) value = `${text}p`;
        else if (key === "audioSpeed" && /^\d+(?:\.\d+)?$/.test(text)) value = `${text}×`;
        return [{ key, label: label!, value }];
    });
}
