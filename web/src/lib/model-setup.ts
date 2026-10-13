import { createModelChannel, defaultConfig, type ModelChannel } from "@/stores/use-config-store";

export type LocalSetupModel = "qwen" | "h3";

// Both presets use ComfyUI. Match the intended model instead of the service type alone.
export function findModelSetupChannel(channels: ModelChannel[], kind: LocalSetupModel): ModelChannel | undefined {
    const id = kind === "qwen" ? "local-qwen-image21" : "local-comfyui";
    return channels.find((channel) => channel.serviceType === "comfyui" && channel.id === id)
        || channels.find((channel) => channel.serviceType === "comfyui" && channel.models.some((model) => kind === "qwen"
            ? model.workflowId?.startsWith("builtin:qwen-image21-")
            : model.name === "MiniMax-H3" || model.script?.includes("minimax-h3-local-api.json")));
}

export function modelSetupChannelDraft(channels: ModelChannel[], kind: LocalSetupModel): ModelChannel {
    const existing = findModelSetupChannel(channels, kind);
    // Opening the guide must never persist or silently rewrite existing credentials or URLs.
    if (existing) return structuredClone(existing);
    const preset = defaultConfig.channels.find((channel) => channel.id === (kind === "qwen" ? "local-qwen-image21" : "local-comfyui"))!;
    const { id: _id, ...template } = structuredClone(preset);
    return createModelChannel({ ...template, baseUrl: kind === "qwen" ? "http://127.0.0.1:8189" : "http://127.0.0.1:8188" });
}

export function comfyStartCommand(kind: LocalSetupModel, origin: string): string {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.origin !== origin) {
        throw new Error("Open this guide from the local canvas address.");
    }
    return `.\\python_embeded\\python.exe -s ComfyUI\\main.py --windows-standalone-build --listen 127.0.0.1 --port ${kind === "qwen" ? "8189" : "8188"} --enable-cors-header ${url.origin}`;
}
