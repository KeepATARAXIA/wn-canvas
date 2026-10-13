import { encodeChannelModel, resolveModelChannel, resolveModelWorkflowId, type AiConfig } from "@/stores/use-config-store";

const workflowPairs = [
    ["builtin:qwen-image21-t2i", "builtin:qwen-image21-edit"],
    ["builtin:qwen-image21-turbo-t2i", "builtin:qwen-image21-turbo-edit"],
];

export function isQwenImageEditWorkflow(workflowId: string) {
    return workflowPairs.some((pair) => pair[1] === workflowId);
}

export function isQwenImageGenerationWorkflow(workflowId: string) {
    return workflowPairs.some((pair) => pair[0] === workflowId);
}

/** Qwen's native RGBA output is selected by the prompt, rather than an API background field. */
export function buildQwenImagePrompt(prompt: string, background?: string) {
    if (background?.trim().toLowerCase() !== "transparent") return prompt;
    return `${prompt}\n\nOutput an RGBA image with an alpha channel and a transparent background. Make the area outside the subject fully transparent, keeping the subject opaque. Do not draw a checkerboard or a solid backdrop.`;
}

/** Match the built-in Qwen workflow to the images actually sent, keeping the selected channel. */
export function resolveQwenImageConfig(config: AiConfig, referenceCount: number): AiConfig {
    const selected = config.model || config.imageModel;
    const workflowId = resolveModelWorkflowId(config, selected);
    const pair = workflowPairs.find((item) => item.includes(workflowId));
    if (!pair) return config;
    const targetWorkflowId = pair[referenceCount > 0 ? 1 : 0];
    if (workflowId === targetWorkflowId) return config;
    const channel = resolveModelChannel(config, selected);
    const target = channel.models.find((model) => model.capability === "image" && model.workflowId?.trim() === targetWorkflowId);
    return target ? { ...config, model: encodeChannelModel(channel.id, target.name) } : config;
}
