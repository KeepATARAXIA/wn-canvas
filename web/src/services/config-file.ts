import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { createModelChannel, defaultConfig, defaultWebdavSyncConfig, modelOptionsFromChannels, normalizeModelOptionValue, selectableModelsByCapability, useConfigStore, type AiConfig, type ModelChannel, type WebdavSyncConfig } from "@/stores/use-config-store";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    config: AiConfig;
    webdav: WebdavSyncConfig;
};

// Keep only the last import's previous values in this session, without storing another copy of credentials.
let importBackup: Pick<AppConfigFile, "config" | "webdav"> | undefined;

function invalidFile(): never {
    throw new Error(i18n.t("config.invalidFile"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateChoice(value: unknown, choices: string[]) {
    if (value !== undefined && (typeof value !== "string" || !choices.includes(value))) invalidFile();
}

function validateSettings(value: unknown, keys: string[], complete = false) {
    if (value === undefined && !complete) return;
    if (!isRecord(value)) invalidFile();
    for (const key of keys) {
        if ((complete || value[key] !== undefined) && typeof value[key] !== "string") invalidFile();
    }
}

function parseConfigFile(data: unknown): Pick<AppConfigFile, "config" | "webdav"> {
    if (!isRecord(data) || data.app !== "infinite-canvas" || data.version !== 1 || !isRecord(data.config) || !isRecord(data.webdav)) invalidFile();
    if (data.exportedAt !== undefined && typeof data.exportedAt !== "string") invalidFile();
    const source = data.config;
    const webdavSource = data.webdav;
    // These fields existed before channels and generation preferences were introduced.
    for (const key of ["baseUrl", "apiKey", "model"]) if (typeof source[key] !== "string") invalidFile();
    if (!Array.isArray(source.models) || source.models.some((model) => typeof model !== "string" || !model.trim())) invalidFile();
    for (const [key, fallback] of Object.entries(defaultConfig)) {
        if (source[key] !== undefined && ["string", "boolean"].includes(typeof fallback) && typeof source[key] !== typeof fallback) invalidFile();
    }
    for (const key of ["qwenImage21Initialized", "qwenImage21DefaultInitialized", "qwenImage21TurboInitialized", "inheritLastImageSettings", "inheritLastVideoSettings", "autoReleaseVram"]) {
        if (source[key] !== undefined && typeof source[key] !== "boolean") invalidFile();
    }
    validateChoice(source.channelMode, ["local", "remote"]);
    validateChoice(source.apiFormat, ["openai", "gemini", "ark"]);
    validateChoice(source.serviceType, ["api", "comfyui", "ollama", "lm-studio", "local-openai"]);
    validateChoice(source.reasoningEffort, ["auto", "low", "medium", "high", "xhigh"]);
    validateChoice(source.videoMode, ["frames", "reference"]);
    const imageKeys = ["size", "quality", "background", "count"];
    const videoKeys = ["size", "vquality", "videoSeconds", "videoMode", "videoGenerateAudio", "videoWatermark", "videoH3Mode", "videoH3SageAttention", "videoH3TeSpeed"];
    validateSettings(source.imageGenerationDefaults, imageKeys);
    validateSettings(source.videoGenerationDefaults, videoKeys);
    if (isRecord(source.videoGenerationDefaults)) validateChoice(source.videoGenerationDefaults.videoMode, ["frames", "reference"]);
    for (const [key, keys] of [["lastImageGeneration", imageKeys], ["lastVideoGeneration", videoKeys]] as const) {
        if (source[key] === undefined) continue;
        validateSettings(source[key], keys);
        validateSettings(source[key], ["model"], true);
        const last = source[key] as Record<string, unknown>;
        if (typeof last.completedAt !== "number" || !Number.isFinite(last.completedAt) || last.completedAt < 0) invalidFile();
        if (key === "lastVideoGeneration") validateChoice(last.videoMode, ["frames", "reference"]);
    }
    for (const key of Object.keys(defaultWebdavSyncConfig)) {
        if ((key !== "lastSyncedAt" || webdavSource[key] !== undefined) && typeof webdavSource[key] !== "string") invalidFile();
    }

    let channels: ModelChannel[];
    if (source.channels !== undefined) {
        if (!Array.isArray(source.channels) || !source.channels.length) invalidFile();
        const ids = new Set<string>();
        channels = source.channels.map((channel) => {
            if (!isRecord(channel)) invalidFile();
            for (const key of ["id", "name", "baseUrl", "apiKey", "apiFormat"]) if (typeof channel[key] !== "string") invalidFile();
            const id = (channel.id as string).trim();
            if (!id || id.includes("::") || ids.has(id)) invalidFile();
            ids.add(id);
            validateChoice(channel.apiFormat, ["openai", "gemini", "ark"]);
            validateChoice(channel.serviceType, ["api", "comfyui", "ollama", "lm-studio", "local-openai"]);
            if (!Array.isArray(channel.models)) invalidFile();
            const names = new Set<string>();
            for (const model of channel.models) {
                if (typeof model !== "string" && !isRecord(model)) invalidFile();
                const name = typeof model === "string" ? model.trim() : typeof model.name === "string" ? model.name.trim() : "";
                if (!name || names.has(name)) invalidFile();
                names.add(name);
                if (typeof model !== "string") {
                    validateChoice(model.capability, ["image", "video", "text", "audio"]);
                    for (const key of ["script", "workflowId"]) if (model[key] !== undefined && typeof model[key] !== "string") invalidFile();
                }
            }
            const normalized = createModelChannel(channel as Partial<ModelChannel>);
            return { ...channel, id, models: channel.models.map((model, index) => typeof model === "string" ? normalized.models[index] : { ...model, name: normalized.models[index].name, capability: normalized.models[index].capability }) } as ModelChannel;
        });
    } else {
        channels = [createModelChannel({ id: "default", name: i18n.t("config.channels.defaultName"), baseUrl: source.baseUrl as string, apiKey: source.apiKey as string, apiFormat: source.apiFormat as AiConfig["apiFormat"], serviceType: source.serviceType as AiConfig["serviceType"], models: source.models as unknown as ModelChannel["models"] })];
    }
    const config = { ...defaultConfig, ...source, channelMode: "local", channels, models: modelOptionsFromChannels(channels) } as AiConfig;
    for (const [key, keys] of [["lastImageGeneration", imageKeys], ["lastVideoGeneration", videoKeys]] as const) {
        if (isRecord(source[key])) Object.assign(config, { [key]: { ...Object.fromEntries(keys.map((setting) => [setting, defaultConfig[setting as keyof AiConfig]])), ...source[key] } });
    }
    if (source.channels !== undefined && source.models.some((value) => !config.models.includes(normalizeModelOptionValue(value as string, channels)))) invalidFile();
    const resolveDefault = (key: "imageModel" | "videoModel" | "textModel" | "audioModel", capability: "image" | "video" | "text" | "audio") => {
        const options = selectableModelsByCapability(config, capability);
        if (source[key] !== undefined) {
            const selected = normalizeModelOptionValue(source[key] as string, channels);
            if (source[key] && !options.includes(selected)) invalidFile();
            return selected;
        }
        const legacy = normalizeModelOptionValue(source.model as string, channels);
        return options.includes(legacy) ? legacy : options[0] || "";
    };
    config.imageModel = resolveDefault("imageModel", "image");
    config.videoModel = resolveDefault("videoModel", "video");
    config.textModel = resolveDefault("textModel", "text");
    config.audioModel = resolveDefault("audioModel", "audio");
    const model = normalizeModelOptionValue(source.model as string, channels);
    config.model = config.models.includes(model) ? model : config.imageModel || config.models[0] || "";
    return { config, webdav: { ...defaultWebdavSyncConfig, ...webdavSource } as WebdavSyncConfig };
}

export function hasAppConfigImportBackup() {
    return Boolean(importBackup);
}

export function restoreAppConfigImportBackup() {
    if (!importBackup) return false;
    useConfigStore.setState(importBackup);
    importBackup = undefined;
    return true;
}

export function exportAppConfig() {
    const { config, webdav } = useConfigStore.getState();
    const data: AppConfigFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), config, webdav };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "infinite-canvas-config.json");
}

export async function importAppConfig(file: File) {
    let data: unknown;
    try {
        data = JSON.parse(await file.text());
    } catch {
        throw new Error(i18n.t("config.invalidFile"));
    }
    const candidate = parseConfigFile(data);
    const { config, webdav } = useConfigStore.getState();
    const previous = structuredClone({ config, webdav });
    useConfigStore.setState(candidate);
    importBackup = previous;
}
