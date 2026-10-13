import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowUp, ClipboardCheck, Cpu, Ellipsis, ExternalLink, LoaderCircle, Maximize2, Sparkles, Square } from "lucide-react";
import { Button, Dropdown, Modal } from "antd";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, resolveModelForCapability, resolveModelRequestConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsControls } from "./canvas-image-settings-popover";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
import { getNodeComposerPrompt, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeReferenceBar } from "./canvas-node-reference-bar";
import { resolveQwenImageConfig } from "@/lib/qwen-image-mode";

export type CanvasNodeGenerationMode = CanvasGenerationMode;
const CanvasLocalPromptDialog = lazy(() => import("./canvas-local-prompt-dialog"));
const CanvasJimengBridgeDialog = lazy(() => import("./canvas-jimeng-bridge-dialog"));

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onPreview: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    onUseH3PromptSkill?: (node: CanvasNodeData, prompt: string) => void | Promise<void>;
    onImportJimengVideo?: (node: CanvasNodeData, file: File) => void | Promise<void>;
    mentionReferences?: CanvasResourceReference[];
    nodes: CanvasNodeData[];
    connectedNodes?: CanvasNodeData[];
    onDisconnectReference?: (fromNodeId: string, toNodeId: string) => void;
    onStartReferenceSelection?: (nodeId: string) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
    modeOverride?: CanvasNodeGenerationMode; // Plugin nodes set their generation type through useBuiltinPanel.mode.
};

export function CanvasNodePromptPanel({ node, nodes, isRunning, onPromptChange, onConfigChange, onGenerate, onPreview, onStop, onUseH3PromptSkill, onImportJimengVideo, mentionReferences = [], connectedNodes = [], onDisconnectReference, onStartReferenceSelection, onImageSettingsOpenChange, modeOverride }: CanvasNodePromptPanelProps) {
    const { t } = useTranslation();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = modeOverride ?? defaultMode(node.type);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const baseConfig = buildNodeConfig(globalConfig, node, mode);
    const hasReferenceImage = mentionReferences.some((reference) => reference.kind === "image" && reference.nodeId !== node.id);
    const config = mode === "image" ? resolveQwenImageConfig(baseConfig, hasReferenceImage ? 1 : 0) : baseConfig;
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [prompt, setPrompt] = useState(() => getNodeComposerPrompt(node, mentionReferences));
    const [expanded, setExpanded] = useState(false);
    const [openingH3Skill, setOpeningH3Skill] = useState(false);
    const [localPromptOpen, setLocalPromptOpen] = useState(false);
    const [jimengOpen, setJimengOpen] = useState(false);

    // Restore prompts only when switching nodes; preserve the current input after generation on the same node.
    useEffect(() => {
        setPrompt(getNodeComposerPrompt(node, mentionReferences));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (mode === "image" || isEditingExistingContent) onConfigChange(node.id, { composerContent: value });
        else onPromptChange(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();
        if ((!text && !connectedNodes.length) || isRunning) return;
        onGenerate(node.id, mode, text);
    };

    const openExpandedEditor = () => {
        setExpanded(true);
    };

    const openH3PromptSkill = async () => {
        if (!onUseH3PromptSkill || openingH3Skill) return;
        setOpeningH3Skill(true);
        try {
            await onUseH3PromptSkill(node, prompt);
        } finally {
            setOpeningH3Skill(false);
        }
    };

    return (
        <div
            data-canvas-no-zoom
            className="relative rounded-[22px] border p-4 shadow-xl"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="pr-9"><CanvasNodeReferenceBar nodeId={node.id} nodes={nodes} connectedNodes={connectedNodes} onDisconnect={onDisconnectReference} onStartSelection={onStartReferenceSelection} /></div>
            <button type="button" aria-label={t("canvas.promptPanel.expandEditor")} title={t("canvas.promptPanel.expandEditor")} className="absolute right-4 top-4 grid size-7 place-items-center rounded-lg opacity-50 hover:opacity-100" onClick={openExpandedEditor}><Maximize2 className="size-3.5" /></button>
            <CanvasPromptChipInput
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                className="thin-scrollbar w-full cursor-text resize-none rounded-xl px-0 py-2 text-sm leading-6 outline-none"
                style={{ height: 104, background: "transparent", color: theme.node.text }}
                placeholder={t(`canvas.promptPanel.${mode === "image" && hasReferenceImage ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
            />

            <div className={`mt-2 flex min-w-0 flex-wrap ${mode === "image" ? "items-end" : "items-center"} justify-between gap-2`}>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                    {mode === "image" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" onMissingConfig={() => openConfigDialog(true)} className="!h-8 !min-w-0 max-w-[190px] !gap-1.5 !rounded-lg !border-0 !px-2 !text-xs !shadow-none" />
                            <CanvasImageSettingsControls
                                key={node.id}
                                config={config}
                                placement="topLeft"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="video" onMissingConfig={() => openConfigDialog(true)} className="!h-8 !min-w-0 max-w-[190px] !gap-1.5 !rounded-lg !border-0 !px-2 !text-xs !shadow-none" />
                            <CanvasVideoSettingsPopover config={config} count={node.metadata?.videoCount || 1} onCountChange={(videoCount) => onConfigChange(node.id, { videoCount })} onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                            <CanvasVideoSettingsPopover section="mode" config={config} onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                            <CanvasVideoSettingsPopover section="duration" config={config} onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                            <CanvasVideoSettingsPopover section="extras" config={config} onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" onMissingConfig={() => openConfigDialog(true)} className="!h-8 !min-w-0 max-w-[190px] !gap-1.5 !rounded-lg !border-0 !px-2 !text-xs !shadow-none" />
                            {(["voice", "format", "speed", "extras"] as const).map((section) => <CanvasAudioSettingsPopover key={section} section={section} config={config} buttonClassName="!h-8 !max-w-[170px] !justify-start !rounded-lg !px-2 !text-xs" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />)}
                        </>
                    ) : (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} className="!h-8 !min-w-0 max-w-[190px] !gap-1.5 !rounded-lg !border-0 !px-2 !text-xs !shadow-none" />
                            {(["reasoning", "count"] as const).map((section) => <CanvasTextSettingsPopover key={section} section={section} config={config} count={node.metadata?.textCount || 1} onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })} onCountChange={(textCount) => onConfigChange(node.id, { textCount })} />)}
                        </>
                    )}
                </div>
                <Dropdown trigger={["click"]} placement="topRight" menu={{ items: [
                    { key: "preview", label: t("canvas.promptPanel.preview"), icon: <ClipboardCheck className="size-4" />, disabled: isRunning || (!prompt.trim() && !connectedNodes.length), onClick: () => onPreview(node.id, mode, prompt.trim()) },
                    ...(mode === "video" ? [
                        { key: "local", label: "本地提示词", icon: <Cpu className="size-4" />, disabled: isRunning, onClick: () => setLocalPromptOpen(true) },
                        ...(onImportJimengVideo ? [{ key: "jimeng", label: t("canvas.jimeng.button"), icon: <ExternalLink className="size-4" />, disabled: isRunning, onClick: () => setJimengOpen(true) }] : []),
                        ...(onUseH3PromptSkill ? [{ key: "h3", label: t("canvas.promptPanel.h3Skill"), icon: <Sparkles className="size-4" />, disabled: isRunning || openingH3Skill, onClick: () => void openH3PromptSkill() }] : []),
                    ] : []),
                ] }}><button type="button" className="grid size-8 shrink-0 place-items-center rounded-full opacity-60 hover:opacity-100" aria-label="更多生成工具"><Ellipsis className="size-4" /></button></Dropdown>
                <Button
                    type="primary"
                    className="!h-9 !min-w-9 shrink-0 !rounded-full !px-2.5"
                    danger={isRunning}
                    disabled={!isRunning && !prompt.trim() && !connectedNodes.length}
                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                    aria-label={t(isRunning ? "canvas.promptPanel.stopGeneration" : "canvas.promptPanel.generate")}
                >
                    <span className="flex items-center gap-1.5">
                        {isRunning ? (
                            <>
                                <LoaderCircle className="size-4 animate-spin" />
                                <Square className="size-3.5 fill-current" />
                                <span className="text-xs font-medium">{t("canvas.promptPanel.stop")}</span>
                            </>
                        ) : (
                            <ArrowUp className="size-4" />
                        )}
                    </span>
                </Button>
            </div>
            {localPromptOpen ? <Suspense fallback={null}><CanvasLocalPromptDialog key={node.id} prompt={prompt} seconds={config.videoSeconds} ratio={config.size} references={mentionReferences} comfyUrl={resolveModelRequestConfig(config, config.model).baseUrl} onClose={() => setLocalPromptOpen(false)} onApply={(value) => {
                setPrompt(value);
                onConfigChange(node.id, { prompt: value, composerContent: value });
                setLocalPromptOpen(false);
            }} /></Suspense> : null}
            {jimengOpen && onImportJimengVideo ? <Suspense fallback={null}><CanvasJimengBridgeDialog prompt={prompt} seconds={config.videoSeconds} ratio={config.size} references={mentionReferences} onClose={() => setJimengOpen(false)} onImport={(file) => onImportJimengVideo(node, file)} /></Suspense> : null}
            <Modal title={t("canvas.promptPanel.editorTitle")} open={expanded} centered width={760} footer={null} onCancel={() => setExpanded(false)} destroyOnHidden>
                <div data-canvas-no-zoom className="pt-2" onWheelCapture={(event) => event.stopPropagation()}>
                    <CanvasNodeReferenceBar nodeId={node.id} nodes={nodes} connectedNodes={connectedNodes} onDisconnect={onDisconnectReference} onStartSelection={(nodeId) => { setExpanded(false); onStartReferenceSelection?.(nodeId); }} />
                    <CanvasPromptChipInput
                        value={prompt}
                        references={mentionReferences}
                        onChange={updatePrompt}
                        className="thin-scrollbar h-[52dvh] min-h-80 w-full cursor-text overflow-y-auto rounded-xl border p-4 text-[15px] leading-6 outline-none"
                        style={{ background: "transparent", borderColor: theme.toolbar.border, color: theme.node.text }}
                        placeholder={t(`canvas.promptPanel.${mode === "image" && hasReferenceImage ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
                    />
                </div>
            </Modal>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    return {
        ...globalConfig,
        model: resolveModelForCapability(globalConfig, node.metadata?.model, mode),
        reasoningEffort: node.metadata?.reasoningEffort || globalConfig.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        background: node.metadata?.background ?? globalConfig.background ?? defaultConfig.background,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        videoH3SageAttention: node.metadata?.h3SageAttention || globalConfig.videoH3SageAttention || defaultConfig.videoH3SageAttention,
        videoH3TeSpeed: node.metadata?.h3TeSpeed || globalConfig.videoH3TeSpeed || defaultConfig.videoH3TeSpeed,
        videoH3Mode: node.metadata?.videoH3Mode || globalConfig.videoH3Mode || defaultConfig.videoH3Mode,
        videoMode: node.metadata?.videoMode || globalConfig.videoMode || defaultConfig.videoMode,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoH3SageAttention") return { h3SageAttention: value };
    if (key === "videoH3TeSpeed") return { h3TeSpeed: value };
    if (key === "videoMode") return { videoMode: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
