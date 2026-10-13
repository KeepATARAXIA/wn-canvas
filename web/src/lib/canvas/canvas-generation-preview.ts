import { flattenGenerationInputs, buildNodeGenerationContext, buildNodeGenerationInputs, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import i18n from "@/i18n";
import { normalizeH3Resolution } from "@/lib/h3-video-size";
import { buildImageReferencePromptText, imageReferenceLabel } from "@/lib/image-reference-prompt";
import { buildQwenImagePrompt, isQwenImageEditWorkflow, resolveQwenImageConfig } from "@/lib/qwen-image-mode";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import { getComfyWorkflowPreset } from "@/services/comfy-workflow-storage";
import { buildGenerationConfig, getGenerationCount } from "@/lib/canvas/canvas-generation-helpers";
import { modelOptionLabel, modelOptionName, resolveModelChannel, resolveModelScript, resolveModelWorkflowId, type AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type CanvasGenerationPreviewReference = {
    nodeId: string;
    type: "image" | "video" | "audio" | "text";
    label: string;
    title: string;
    previewUrl?: string;
    text?: string;
};

export type CanvasGenerationPreviewData = {
    nodeId: string;
    mode: CanvasNodeGenerationMode;
    model: string;
    channelName: string;
    prompt: string;
    references: CanvasGenerationPreviewReference[];
    parameters: Array<{ label: string; value: string }>;
    outputDescription: string;
    workflow?: { name: string; outputNodeId: string; imageLimit: number; videoLimit: number; audioLimit: number };
    warnings: string[];
};

export async function buildCanvasGenerationPreview({
    nodeId,
    mode,
    prompt,
    nodes,
    connections,
    config,
}: {
    nodeId: string;
    mode: CanvasNodeGenerationMode;
    prompt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    config: AiConfig;
}): Promise<CanvasGenerationPreviewData> {
    const sourceNode = nodes.find((node) => node.id === nodeId);
    let generationConfig = buildGenerationConfig(config, sourceNode, mode);
    const context = buildNodeGenerationContext(nodeId, nodes, connections, prompt);
    const allInputs = buildNodeGenerationInputs(nodeId, nodes, connections);
    const inputs = selectedInputs(sourceNode, prompt, allInputs);
    const ownImage: Exclude<NodeGenerationInput, { type: "group" }>[] =
        mode !== "image" && sourceNode?.type === CanvasNodeType.Image && sourceNode.metadata?.content
            ? [
                  {
                      nodeId: sourceNode.id,
                      type: "image",
                      title: sourceNode.title,
                      image: {
                          id: sourceNode.id,
                          name: sourceNode.title || `image-${sourceNode.id}.png`,
                          type: sourceNode.metadata.mimeType || "image/png",
                          dataUrl: sourceNode.metadata.content,
                          storageKey: sourceNode.metadata.storageKey,
                      },
                  },
              ]
            : [];
    const resources = flattenGenerationInputs(inputs);
    const combined = [...new Map([...ownImage, ...resources].map((input) => [input.nodeId, input])).values()];
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    const references: CanvasGenerationPreviewReference[] = combined.map((input) => {
        const index = counts[input.type]++;
        return {
            nodeId: input.nodeId,
            type: input.type,
            label: previewLabel(input.type, index),
            title: input.title,
            previewUrl: "image" in input ? input.image?.dataUrl : "video" in input ? input.video?.url : "audio" in input ? input.audio?.url : undefined,
            text: "text" in input ? input.text : undefined,
        };
    });
    const referenceImages = combined.map((input) => input.image).filter((image): image is NonNullable<Exclude<NodeGenerationInput, { type: "group" }>["image"]> => Boolean(image));
    if (mode === "image") generationConfig = resolveQwenImageConfig(generationConfig, referenceImages.length);
    let finalPrompt = mode === "image" ? buildImageReferencePromptText(context.prompt, referenceImages) : context.prompt;
    const channel = resolveModelChannel(config, generationConfig.model);
    const workflowId = resolveModelWorkflowId(config, generationConfig.model);
    if (mode === "image" && workflowId.startsWith("builtin:qwen-image21-")) finalPrompt = buildQwenImagePrompt(finalPrompt, generationConfig.background);
    const preset = workflowId ? await getComfyWorkflowPreset(workflowId) : null;
    const scriptLimits = preset ? null : readScriptLimits(resolveModelScript(config, generationConfig.model));
    const workflow = preset
        ? {
              name: preset.name,
              outputNodeId: preset.mapping.outputNodeId,
              imageLimit: preset.mapping.imageSlots.length,
              videoLimit: preset.mapping.videoSlots.length,
              audioLimit: preset.mapping.audioSlots.length,
          }
        : scriptLimits
          ? { name: i18n.t("canvas.generationPreview.customScript"), outputNodeId: scriptLimits.outputNodeId || i18n.t("canvas.generationPreview.scriptOutput"), imageLimit: scriptLimits.image, videoLimit: scriptLimits.video, audioLimit: scriptLimits.audio }
          : undefined;
    const warnings: string[] = [];
    if (workflowId && !preset) warnings.push(i18n.t("canvas.generationPreview.workflowMissing"));
    if (!finalPrompt.trim() && (mode === "text" || mode === "audio")) warnings.push(i18n.t("canvas.generationPreview.promptMissing"));
    if (workflow) {
        if (counts.image > workflow.imageLimit) warnings.push(i18n.t("canvas.generationPreview.referenceOverflow", { kind: i18n.t("canvas.generationPreview.imageKind"), used: counts.image, limit: workflow.imageLimit }));
        if (counts.video > workflow.videoLimit) warnings.push(i18n.t("canvas.generationPreview.referenceOverflow", { kind: i18n.t("canvas.generationPreview.videoKind"), used: counts.video, limit: workflow.videoLimit }));
        if (counts.audio > workflow.audioLimit) warnings.push(i18n.t("canvas.generationPreview.referenceOverflow", { kind: i18n.t("canvas.generationPreview.audioKind"), used: counts.audio, limit: workflow.audioLimit }));
    }
    const parameters = previewParameters(mode, generationConfig);
    if (mode === "video") parameters.unshift({ label: i18n.t("canvas.generationPreview.parameter.count"), value: String(Math.max(1, Math.min(4, Math.floor(sourceNode?.metadata?.videoCount || 1)))) });
    return {
        nodeId,
        mode,
        model: modelOptionLabel(config, generationConfig.model),
        channelName: channel.name,
        prompt: finalPrompt,
        references,
        parameters,
        outputDescription: outputDescription(sourceNode, mode),
        workflow,
        warnings,
    };
}

function selectedInputs(sourceNode: CanvasNodeData | undefined, prompt: string, inputs: NodeGenerationInput[]) {
    if (sourceNode?.type !== CanvasNodeType.Config || !sourceNode.metadata?.composerContent?.trim()) return inputs;
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
    const selected: NodeGenerationInput[] = [];
    const seen = new Set<string>();
    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        const input = inputByNodeId.get(match[1]);
        if (input && !seen.has(input.nodeId)) {
            selected.push(input);
            seen.add(input.nodeId);
        }
    }
    return selected;
}

function previewLabel(type: CanvasGenerationPreviewReference["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return seedanceReferenceLabel("video", index);
    if (type === "audio") return seedanceReferenceLabel("audio", index);
    return i18n.t("canvas.generationPreview.textReference", { index: index + 1 });
}

function previewParameters(mode: CanvasNodeGenerationMode, config: AiConfig) {
    const p = (key: string) => i18n.t(`canvas.generationPreview.parameter.${key}`);
    if (mode === "image") {
        const workflowId = resolveModelWorkflowId(config, config.model || config.imageModel);
        const isQwen = workflowId.startsWith("builtin:qwen-image21-");
        return [
            { label: p("count"), value: String(getGenerationCount(config.count)) },
            { label: p("size"), value: isQwenImageEditWorkflow(workflowId) ? "参考图原比例 · 约 1K" : config.size },
            ...(isQwen ? [{ label: i18n.t("settingsPanels.image.transparent"), value: i18n.t(config.background === "transparent" ? "canvas.generationPreview.yes" : "canvas.generationPreview.no") }] : [{ label: p("quality"), value: config.quality }]),
        ];
    }
    if (mode === "video") {
        const miniMaxH3 = /minimax[\s_-]*h3/i.test(modelOptionName(config.model || config.videoModel));
        const resolution = miniMaxH3 ? `${normalizeH3Resolution(config.vquality)}p` : ["0.4", "0.9"].includes(config.vquality) ? "720p" : config.vquality;
        return [{ label: p("duration"), value: i18n.t("common.durationSeconds", { seconds: config.videoSeconds }) }, { label: p("size"), value: config.size }, { label: p("quality"), value: resolution }, { label: p("generateAudio"), value: i18n.t(config.videoGenerateAudio === "true" ? "canvas.generationPreview.yes" : "canvas.generationPreview.no") }];
    }
    if (mode === "audio") return [{ label: p("voice"), value: config.audioVoice }, { label: p("format"), value: config.audioFormat }, { label: p("speed"), value: config.audioSpeed }];
    return [{ label: p("count"), value: String(getGenerationCount(config.count)) }, { label: p("reasoning"), value: config.reasoningEffort }];
}

function outputDescription(node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode) {
    if (mode === "image" && node?.type === CanvasNodeType.Image) return i18n.t("canvas.generationPreview.writeBack");
    const emptyOwnNode = node?.type === mode && !node.metadata?.content;
    if (emptyOwnNode) return i18n.t("canvas.generationPreview.writeBack");
    return i18n.t("canvas.generationPreview.createBeside", { kind: i18n.t(`config.channelEditor.capabilities.${mode}`) });
}

function readScriptLimits(script: string) {
    if (!script) return null;
    const arrayLength = (name: string) => {
        const match = script.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\[[^;]+\\])`));
        if (!match) return 0;
        try {
            const parsed = JSON.parse(match[1]);
            return Array.isArray(parsed) ? parsed.length : 0;
        } catch {
            return 0;
        }
    };
    const image = arrayLength("IMAGE_NODE_IDS");
    const video = arrayLength("VIDEO_NODE_IDS");
    const audio = arrayLength("AUDIO_NODE_IDS");
    if (!image && !video && !audio) return null;
    return { image, video, audio, outputNodeId: script.match(/const\s+OUTPUT_NODE_ID\s*=\s*["']([^"']+)/)?.[1] || "" };
}
