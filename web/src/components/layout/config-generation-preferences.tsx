import { Form, Input, Segmented, Select, Switch, Tooltip } from "antd";
import { Image, Video, AudioLines, Type } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { VideoSettingsPanel } from "@/components/video-settings-panel";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { canvasThemes } from "@/lib/canvas-theme";
import { imageDefaults, videoDefaults } from "@/lib/canvas/generation-preferences";
import { modelMatchesCapability, modelOptionName, resolveModelWorkflowId, useConfigStore, type ModelCapability } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { InfoPopover } from "@/components/ui/compact-controls";
import { ConfigVramPreference } from "@/components/layout/config-vram-preference";

const kinds: ModelCapability[] = ["image", "video", "audio", "text"];
const kindIcons = { image: Image, video: Video, audio: AudioLines, text: Type };

export function ConfigGenerationPreferences() {
    const { i18n, t } = useTranslation();
    const en = i18n.resolvedLanguage === "en-US";
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const updateImageDefaults = useConfigStore((state) => state.updateImageDefaults);
    const updateVideoDefaults = useConfigStore((state) => state.updateVideoDefaults);
    const [kind, setKind] = useState<ModelCapability>("image");
    const [advanced, setAdvanced] = useState(false);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const imageConfig = { ...config, ...imageDefaults(config), model: config.imageModel };
    const videoConfig = { ...config, ...videoDefaults(config), model: config.videoModel };
    const isQwen = resolveModelWorkflowId(config, config.imageModel).startsWith("builtin:qwen-image21-");
    const isImage = kind === "image";
    const media = isImage || kind === "video";
    const last = isImage ? config.lastImageGeneration : config.lastVideoGeneration;
    const available = media && last && modelMatchesCapability(config, last.model, kind);
    const enabled = Boolean(isImage ? config.inheritLastImageSettings : config.inheritLastVideoSettings);
    const switchLabel = isImage ? (en ? "Inherit last successful image settings" : "继承上次成功的图片设置") : (en ? "Inherit last successful video settings" : "继承上次成功的视频设置");
    const label = isImage ? (en ? "Image" : "图片") : t(`config.channelEditor.capabilities.${kind}`);
    const modelKey = `${kind}Model` as const;

    const content = (
            <section key={kind} aria-label={en ? `${label} defaults` : `${label}默认生成配置`} className="min-w-0 space-y-5 pb-2">
                <div className="flex items-center gap-1">
                    <h2 className="config-section-heading">{en ? `${label} defaults` : `${label}默认设置`}</h2>
                    <InfoPopover label={en ? "About defaults" : "默认设置说明"}>
                        {media ? (en ? "Applies to new nodes. Existing nodes keep their settings." : "用于新建节点，已有节点保留原设置。") : (en ? "Save your preferred model and generation settings." : "保存常用模型和生成参数。")}
                    </InfoPopover>
                </div>
                <div className="config-preference-layout">
                    <section className="config-section config-surface config-preference-model space-y-4" aria-label={media ? (en ? "Model & inheritance" : "模型与继承") : (en ? "Default model" : "默认模型")}>
                        <h3 className="text-sm font-semibold">{media ? (en ? "Model & inheritance" : "模型与继承") : (en ? "Default model" : "默认模型")}</h3>
                        <div className="space-y-2">
                            {media ? <div className="text-sm font-medium">{en ? "Default model" : "默认模型"}</div> : null}
                            <ModelPicker config={config} value={config[modelKey]} onChange={(model) => updateConfig(modelKey, model)} capability={kind} fullWidth detailed ariaLabel={en ? `Default ${kind} model` : `默认${label}模型`} />
                        </div>
                        {media ? (
                            <div className="border-t border-stone-200 pt-4 dark:border-stone-700">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="flex items-center gap-1 text-sm font-medium">{switchLabel}<InfoPopover label={en ? "About inheritance" : "继承设置说明"}>{en ? "Use the last successful model and parameters, without prompts or references. Otherwise use the configured defaults." : "开启后优先使用上次成功的模型和参数，不带入提示词或参考素材；否则使用这里的默认值。"}</InfoPopover></span>
                                    <Switch className="shrink-0" aria-label={switchLabel} checked={enabled} onChange={(checked) => updateConfig(isImage ? "inheritLastImageSettings" : "inheritLastVideoSettings", checked)} />
                                </div>
                                {enabled ? <p role="status" className="config-section-description mt-2 break-words">
                                    {available ? `${en ? "Last success" : "最近成功"}：${modelOptionName(last.model)} · ${last.size} · ${new Date(last.completedAt).toLocaleString(en ? "en-US" : "zh-CN")}。${en ? "Configured defaults apply when inheritance is off." : "默认参数在关闭继承后生效。"}` : (en ? "No usable success record yet; defaults will be used." : "暂无可用的成功记录，将使用默认值。")}
                                </p> : null}
                            </div>
                        ) : null}
                    </section>
                    <section className="config-section config-surface config-preference-output space-y-4" aria-label={media ? (en ? "Output parameters" : "输出参数") : kind === "audio" ? (en ? "Audio parameters" : "音频参数") : (en ? "Text parameters" : "文本参数")}>
                        <h3 className="text-sm font-semibold">{media ? (en ? "Output parameters" : "输出参数") : kind === "audio" ? (en ? "Audio parameters" : "音频参数") : (en ? "Text parameters" : "文本参数")}</h3>
                        {media ? <>
                            {isImage ? <>
                                <ImageSettingsPanel config={imageConfig} theme={theme} section="output" quickCount={4} showTitle={false} className="flex min-w-0 flex-col gap-4" onConfigChange={(key, value) => updateImageDefaults({ [key]: value })} />
                                {!isQwen ? <ImageSettingsPanel config={imageConfig} theme={theme} section="quality" showTitle={false} className="min-w-0 space-y-4" onConfigChange={(key, value) => updateImageDefaults({ [key]: value })} /> : null}
                            </> : <VideoSettingsPanel config={videoConfig} theme={theme} section="basic" showTitle={false} className="min-w-0 space-y-4" onConfigChange={(key, value) => updateVideoDefaults({ [key]: value })} />}
                        </> : <Form layout="vertical" requiredMark={false}>
                            {kind === "audio" ? <>
                                <div className="grid gap-x-4 sm:grid-cols-2">
                                    <Form.Item label={t("config.preferences.audioVoice")}>
                                        <Select aria-label={t("config.preferences.audioVoice")} value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.audioFormat")}>
                                        <Select aria-label={t("config.preferences.audioFormat")} value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("config.preferences.audioSpeed")}>
                                        <Input aria-label={t("config.preferences.audioSpeed")} type="number" min={0.25} max={4} step={0.05} value={config.audioSpeed} onChange={(event) => updateConfig("audioSpeed", event.target.value)} onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))} />
                                    </Form.Item>
                                </div>
                                <Form.Item label={t("config.preferences.audioInstructions")} className="mb-0">
                                    <Input.TextArea aria-label={t("config.preferences.audioInstructions")} rows={3} value={config.audioInstructions} placeholder={t("config.preferences.audioInstructionsPlaceholder")} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                </Form.Item>
                            </> : <Form.Item label={t("config.preferences.systemPrompt")} className="mb-0">
                                <Input.TextArea aria-label={t("config.preferences.systemPrompt")} rows={6} value={config.systemPrompt} placeholder={t("config.preferences.systemPromptPlaceholder")} onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                            </Form.Item>}
                        </Form>}
                    </section>
                </div>
                {kind === "video" ? <details open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)} className="config-section config-surface config-preference-advanced">
                    <summary className="cursor-pointer text-sm font-medium">{en ? "Advanced settings" : "高级设置"}</summary>
                    {advanced ? <div className="mt-4">
                        <VideoSettingsPanel config={videoConfig} theme={theme} section="advanced" showTitle={false} className="min-w-0 space-y-4" onConfigChange={(key, value) => updateVideoDefaults({ [key]: value })} />
                    </div> : null}
                </details> : null}
            </section>
    );

    return (
        <div className="config-preference-kinds min-w-0">
            <section aria-label={en ? "Local GPU preferences" : "本地显存设置"} className="config-section config-surface mb-6 space-y-4">
                <h2 className="config-section-heading">{en ? "Local performance" : "本地性能"}</h2>
                <ConfigVramPreference />
            </section>
            <div className="config-preference-nav" style={{ background: theme.node.panel }}>
                <Segmented
                    block
                    size="large"
                    aria-label={en ? "Generation type" : "生成类型"}
                    value={kind}
                    onChange={(value) => { setKind(value as ModelCapability); setAdvanced(false); }}
                    options={kinds.map((value) => { const Icon = kindIcons[value]; const name = value === "image" ? (en ? "Image" : "图片") : t(`config.channelEditor.capabilities.${value}`); return { value, label: <Tooltip title={name}><span aria-label={name} className="inline-flex items-center justify-center gap-2 py-2"><Icon className="size-4" />{name}</span></Tooltip> }; })}
                />
            </div>
            {content}
        </div>
    );
}
