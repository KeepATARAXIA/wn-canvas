import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { normalizeH3Resolution } from "@/lib/h3-video-size";
import beforeSuiteMiniMaxH3Script from "@/services/api/templates/comfyui-minimax-h3-before-suite.txt?raw";
import beforeConditioningFixMiniMaxH3Script from "@/services/api/templates/comfyui-minimax-h3-before-conditioning-fix.txt?raw";
import beforeTaskControlMiniMaxH3Script from "@/services/api/templates/comfyui-minimax-h3-before-task-control.txt?raw";
import beforeRecoveryMiniMaxH3Script from "@/services/api/templates/comfyui-minimax-h3-before-recovery.txt?raw";
import beforeTimeoutMiniMaxH3Script from "@/services/api/templates/comfyui-minimax-h3-before-timeout.txt?raw";
import beforeProgressMiniMaxH3Script from "@/services/api/templates/comfyui-minimax-h3-before-progress.txt?raw";
import beforeReferencePreflightMiniMaxH3Script from "@/services/api/templates/comfyui-minimax-h3-before-reference-preflight.txt?raw";
import beforeSubmissionRetryMiniMaxH3Script from "@/services/api/templates/comfyui-minimax-h3-before-submission-retry.txt?raw";
import legacyMiniMaxH3Script from "@/services/api/templates/comfyui-minimax-h3-legacy.txt?raw";
import comfyMiniMaxH3Script from "@/services/api/templates/comfyui-minimax-h3.js?raw";

export type ApiCallFormat = "openai" | "gemini" | "ark";
export type ModelServiceType = "api" | "comfyui" | "ollama" | "lm-studio" | "local-openai";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

export type ImageGenerationSettings = Pick<AiConfig, "size" | "quality" | "background" | "count">;
export type VideoGenerationSettings = Pick<AiConfig, "size" | "vquality" | "videoSeconds" | "videoMode" | "videoGenerateAudio" | "videoWatermark" | "videoH3Mode" | "videoH3SageAttention" | "videoH3TeSpeed">;
export type LastImageGeneration = ImageGenerationSettings & { model: string; completedAt: number };
export type LastVideoGeneration = VideoGenerationSettings & { model: string; completedAt: number };

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    script?: string;
    workflowId?: string;
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    serviceType?: ModelServiceType;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    serviceType?: ModelServiceType;
    channels: ModelChannel[];
    qwenImage21Initialized?: boolean;
    qwenImage21DefaultInitialized?: boolean;
    qwenImage21TurboInitialized?: boolean;
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    videoH3SageAttention: string;
    videoH3TeSpeed: string;
    videoH3Mode: string;
    videoMode: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
    imageGenerationDefaults?: Partial<ImageGenerationSettings>;
    videoGenerationDefaults?: Partial<VideoGenerationSettings>;
    inheritLastImageSettings?: boolean;
    inheritLastVideoSettings?: boolean;
    autoReleaseVram?: boolean;
    lastImageGeneration?: LastImageGeneration;
    lastVideoGeneration?: LastVideoGeneration;
    proxyEnabled: boolean;
    proxyUrl: string;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "status" | "channels" | "local-proxy" | "preferences" | "webdav" | "local-storage";

export type ChannelCredentialsImportResult = {
    status: "created" | "updated" | "missing-base-url" | "invalid-base-url";
    channelName?: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
export const LOCAL_PROXY_PACKAGE = "@basketikun/canvas-proxy";
export const DEFAULT_LOCAL_PROXY_URL = "http://127.0.0.1:23210";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    serviceType: "api",
    channels: [
        {
            id: "local-comfyui",
            name: "本地 ComfyUI · MiniMax-H3",
            baseUrl: "http://localhost:3000/api/comfyui",
            apiKey: "",
            apiFormat: "openai",
            serviceType: "comfyui",
            models: [{ name: "MiniMax-H3", capability: "video", script: comfyMiniMaxH3Script }],
        },
        {
            id: "default",
            name: i18n.t("config.channels.defaultName"),
            baseUrl: OPENAI_BASE_URL,
            apiKey: "",
            apiFormat: "openai",
            serviceType: "api",
            models: [
                { name: "gpt-image-2", capability: "image" },
                { name: "grok-imagine-video", capability: "video" },
                { name: "gpt-5.5", capability: "text" },
                { name: "gpt-4o-mini-tts", capability: "audio" },
            ],
        },
        {
            id: "local-qwen-image21",
            name: "本地 ComfyUI · Qwen-Image 2.1",
            baseUrl: "http://127.0.0.1:8189",
            apiKey: "",
            apiFormat: "openai",
            serviceType: "comfyui",
            models: [
                { name: "Qwen-Image 2.1 · 生图", capability: "image", workflowId: "builtin:qwen-image21-t2i" },
                { name: "Qwen-Image 2.1 · 编辑", capability: "image", workflowId: "builtin:qwen-image21-edit" },
                { name: "Qwen-Image 2.1 Turbo · 生图", capability: "image", workflowId: "builtin:qwen-image21-turbo-t2i" },
                { name: "Qwen-Image 2.1 Turbo · 编辑", capability: "image", workflowId: "builtin:qwen-image21-turbo-edit" },
            ],
        },
    ],
    qwenImage21Initialized: true,
    qwenImage21DefaultInitialized: true,
    qwenImage21TurboInitialized: true,
    model: "local-qwen-image21::Qwen-Image 2.1 · 生图",
    imageModel: "local-qwen-image21::Qwen-Image 2.1 · 生图",
    videoModel: "local-comfyui::MiniMax-H3",
    textModel: "default::gpt-5.5",
    audioModel: "default::gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "5",
    vquality: "480",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    videoH3SageAttention: "false",
    videoH3TeSpeed: "true",
    videoH3Mode: "te",
    videoMode: "frames",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: ["local-comfyui::MiniMax-H3", "default::gpt-image-2", "default::grok-imagine-video", "default::gpt-5.5", "default::gpt-4o-mini-tts", "local-qwen-image21::Qwen-Image 2.1 · 生图", "local-qwen-image21::Qwen-Image 2.1 · 编辑", "local-qwen-image21::Qwen-Image 2.1 Turbo · 生图", "local-qwen-image21::Qwen-Image 2.1 Turbo · 编辑"],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
    inheritLastImageSettings: false,
    inheritLastVideoSettings: false,
    autoReleaseVram: false,
    proxyEnabled: false,
    proxyUrl: DEFAULT_LOCAL_PROXY_URL,
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    updateImageDefaults: (patch: Partial<ImageGenerationSettings>) => void;
    updateVideoDefaults: (patch: Partial<VideoGenerationSettings>) => void;
    importChannelCredentials: (input: { baseUrl?: string | null; apiKey?: string | null }) => ChannelCredentialsImportResult;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["seedance", "video", "sora", "veo", "kling", "wan", "hailuo"];

export function boolConfig(value: string, fallback: boolean) {
    return value ? value === "true" : fallback;
}
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const defaultModel = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    const fallbackModel = capability === "image" ? defaultConfig.imageModel : capability === "video" ? defaultConfig.videoModel : capability === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    if (currentModel && modelMatchesCapability(config, currentModel, capability)) return currentModel;
    if (defaultModel && modelMatchesCapability(config, defaultModel, capability)) return defaultModel;
    return fallbackModel;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

export function resolveModelWorkflowId(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.workflowId?.trim() || "";
}

function isAiConfigReady(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channel.baseUrl.trim() && (!channelRequiresApiKey(channel) || channel.apiKey.trim()));
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            updateImageDefaults: (patch) => set((state) => ({ config: { ...state.config, imageGenerationDefaults: { ...state.config.imageGenerationDefaults, ...patch } } })),
            updateVideoDefaults: (patch) => set((state) => ({ config: { ...state.config, videoGenerationDefaults: { ...state.config.videoGenerationDefaults, ...patch } } })),
            importChannelCredentials: (input) => {
                const currentConfig = get().config;
                const result = upsertChannelCredentials(currentConfig, input);
                if (result.config !== currentConfig) set({ config: result.config });
                return { status: result.status, channelName: result.channelName };
            },
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "channels") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config, webdav: state.webdav }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                if (!Array.isArray(persistedConfig.channels)) config.channels = Object.keys(persistedConfig).length ? [] : defaultConfig.channels;
                const channels = normalizeChannels(config);
                const hadLocalComfyUI = channels.some((channel) => channel.id === "local-comfyui");
                if (!hadLocalComfyUI) channels.unshift(createModelChannel(defaultConfig.channels[0]));
                if (!persistedConfig.qwenImage21Initialized && !channels.some((channel) => channel.id === "local-qwen-image21")) {
                    channels.push(createModelChannel(defaultConfig.channels[2]));
                }
                // Add Turbo once to the bundled Qwen channel; retain deletions, names and custom scripts.
                const localQwen = channels.find((channel) => channel.id === "local-qwen-image21");
                if (!persistedConfig.qwenImage21TurboInitialized && localQwen?.models.some((model) => ["builtin:qwen-image21-t2i", "builtin:qwen-image21-edit"].includes(model.workflowId || ""))) {
                    for (const model of defaultConfig.channels[2].models.filter((item) => item.workflowId?.startsWith("builtin:qwen-image21-turbo-"))) {
                        if (!localQwen.models.some((item) => item.workflowId === model.workflowId || item.name === model.name)) localQwen.models.push({ ...model });
                    }
                }
                // Upgrade the bundled script only; preserve user-authored channel scripts.
                for (const channel of channels) {
                    for (const model of channel.models) {
                        if ([legacyMiniMaxH3Script, beforeSuiteMiniMaxH3Script, beforeConditioningFixMiniMaxH3Script, beforeTaskControlMiniMaxH3Script, beforeProgressMiniMaxH3Script, beforeRecoveryMiniMaxH3Script, beforeTimeoutMiniMaxH3Script, beforeTimeoutMiniMaxH3Script.replace("timeoutMs: 3600000", "timeoutMs: 7200000"), beforeReferencePreflightMiniMaxH3Script, beforeSubmissionRetryMiniMaxH3Script].some(stock => model.script?.replace(/\r\n/g, "\n").trim() === stock.replace(/\r\n/g, "\n").trim())) model.script = comfyMiniMaxH3Script;
                    }
                }
                const models = modelOptionsFromChannels(channels);
                // Move the previous bundled default once; retain custom choices and later changes.
                if (!persistedConfig.qwenImage21DefaultInitialized && models.includes(defaultConfig.imageModel)) {
                    if (!persistedConfig.imageModel || ["default::gpt-image-2", "gpt-image-2"].includes(persistedConfig.imageModel)) config.imageModel = defaultConfig.imageModel;
                    if (!persistedConfig.model || ["default::gpt-image-2", "gpt-image-2"].includes(persistedConfig.model)) config.model = defaultConfig.model;
                }
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    config: {
                        ...config,
                        channelMode: "local",
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        qwenImage21Initialized: true,
                        qwenImage21DefaultInitialized: true,
                        qwenImage21TurboInitialized: true,
                        models,
                        imageModel: normalizeModelOptionValue(config.imageModel || config.model, channels),
                        videoModel: normalizeModelOptionValue(hadLocalComfyUI ? config.videoModel : defaultConfig.videoModel, channels),
                        textModel: normalizeModelOptionValue(config.textModel || config.model, channels),
                        audioModel: normalizeModelOptionValue(config.audioModel || defaultConfig.audioModel, channels),
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        reasoningEffort: config.reasoningEffort || "auto",
                        videoSeconds: config.videoSeconds || "5",
                        vquality: /minimax[\s_-]*h3/i.test(config.videoModel) ? normalizeH3Resolution(config.vquality) : config.vquality || "480",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        videoH3SageAttention: config.videoH3SageAttention || "false",
                        videoH3TeSpeed: config.videoH3TeSpeed || "true",
                        videoH3Mode: config.videoH3Mode || "te",
                        videoMode: config.videoMode === "reference" ? "reference" : "frames",
                        canvasImageCount: config.canvasImageCount || "3",
                        proxyEnabled: Boolean(config.proxyEnabled),
                        proxyUrl: config.proxyUrl || DEFAULT_LOCAL_PROXY_URL,
                    },
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability || guessCapability(name);
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        const workflowId = typeof item === "string" ? undefined : item.workflowId?.trim() || undefined;
        result.push({ name, capability, script, workflowId });
    }
    return result;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || i18n.t("config.channels.newName"),
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        serviceType: normalizeServiceType(channel?.serviceType),
        models: normalizeChannelModels(channel?.models),
    };
}

export function upsertChannelCredentials(
    config: AiConfig,
    input: { baseUrl?: string | null; apiKey?: string | null },
): ChannelCredentialsImportResult & { config: AiConfig } {
    const rawBaseUrl = input.baseUrl?.trim() || "";
    if (!rawBaseUrl) return { status: "missing-base-url", config };
    if (!isHttpBaseUrl(rawBaseUrl)) return { status: "invalid-base-url", config };

    const baseUrl = normalizeImportedBaseUrl(rawBaseUrl);
    const apiKey = input.apiKey?.trim() || "";
    const matchingIndex = config.channels.findIndex((channel) => normalizedBaseUrlKey(channel.baseUrl) === normalizedBaseUrlKey(baseUrl));

    if (matchingIndex >= 0) {
        const existing = config.channels[matchingIndex];
        if (existing.baseUrl === baseUrl && (!apiKey || existing.apiKey === apiKey)) {
            return { status: "updated", channelName: existing.name, config };
        }
        const updated = { ...existing, baseUrl, ...(apiKey ? { apiKey } : {}) };
        const channels = config.channels.map((channel, index) => (index === matchingIndex ? updated : channel));
        return { status: "updated", channelName: existing.name, config: { ...config, channels } };
    }

    const channel = createModelChannel({
        name: importedChannelName(baseUrl),
        baseUrl,
        apiKey,
        apiFormat: "openai",
        models: [],
    });
    return { status: "created", channelName: channel.name, config: { ...config, channels: [...config.channels, channel] } };
}

function isHttpBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
    } catch {
        return false;
    }
}

function normalizedBaseUrlKey(baseUrl: string) {
    try {
        return stripTrailingApiVersion(normalizeImportedBaseUrl(baseUrl));
    } catch {
        return stripTrailingApiVersion(baseUrl.trim().replace(/\/+$/, ""));
    }
}

function normalizeImportedBaseUrl(baseUrl: string) {
    const url = new URL(baseUrl.trim());
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
}

function stripTrailingApiVersion(baseUrl: string) {
    return baseUrl.replace(/\/v1$/i, "");
}

function importedChannelName(baseUrl: string) {
    const hostname = new URL(baseUrl).hostname;
    return hostname.replace(/^(?:www|api)\./i, "") || i18n.t("config.channels.newName");
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.some((item) => item.name === decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model)) || channels[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: i18n.t("config.channels.defaultName"), baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
        serviceType: channel.serviceType,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? i18n.t("config.channels.defaultName") : i18n.t("config.channels.indexedName", { index: index + 1 })),
            models: normalizeChannelModels(channel.models),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: i18n.t("config.channels.defaultName"),
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: normalizeChannelModels([config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel].map(modelOptionName)),
            }),
        );
    }
    return channels;
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return GEMINI_BASE_URL;
    if (apiFormat === "ark") return ARK_BASE_URL;
    return OPENAI_BASE_URL;
}

export function isLocalServiceUrl(baseUrl: string) {
    const value = baseUrl.trim();
    if (!value) return false;
    try {
        const hostname = new URL(value.includes("://") ? value : `http://${value}`).hostname.toLowerCase().replace(/^\[|\]$/g, "");
        if (hostname === "localhost" || hostname === "::1" || hostname === "0.0.0.0" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return true;
        if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
        const match = hostname.match(/^172\.(\d{1,3})\./);
        return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
    } catch {
        return false;
    }
}

export function isLocalModelChannel(channel: Pick<ModelChannel, "baseUrl" | "serviceType">) {
    return Boolean(channel.serviceType && channel.serviceType !== "api") || isLocalServiceUrl(channel.baseUrl);
}

export function channelRequiresApiKey(channel: Pick<ModelChannel, "baseUrl" | "serviceType">) {
    return !isLocalModelChannel(channel);
}

export function isModelChannelReady(channel: ModelChannel) {
    return Boolean(channel.baseUrl.trim() && channel.models.length && (!channelRequiresApiKey(channel) || channel.apiKey.trim()));
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" || apiFormat === "ark" ? apiFormat : "openai";
}

function normalizeServiceType(serviceType: unknown): ModelServiceType {
    return serviceType === "comfyui" || serviceType === "ollama" || serviceType === "lm-studio" || serviceType === "local-openai" ? serviceType : "api";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    const normalizedBaseUrl = normalizeArkPlanBaseUrl(baseUrl.trim().replace(/\/+$/, ""));
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return withLocalProxy(`${apiBaseUrl}${path}`);
}

export function normalizeLocalProxyUrl(value: string) {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/** Prefix an outgoing request with the local forwarding proxy so the browser is not blocked by CORS. */
export function withLocalProxy(url: string) {
    const { proxyEnabled, proxyUrl } = useConfigStore.getState().config;
    if (!proxyEnabled || !/^https?:\/\//i.test(url)) return url;
    const base = normalizeLocalProxyUrl(proxyUrl);
    if (!base || url.startsWith(`${base}/`)) return url;
    return `${base}/${url}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
