import { videoOperationLabels, type VideoOperation } from "@/services/api/canvas-video-tools";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App, Dropdown, Modal, Segmented, Tooltip } from "antd";
import { TextNodeActions } from "./canvas-node-appearance";
import { Scissors, Music2, Gauge, Maximize, Download, Ellipsis, FolderPlus, Image as ImageIcon, Info, MessageSquare, Minus, Pencil, Plus, RefreshCw, Settings2, Sparkles, Trash2, Ungroup, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { useCopyText } from "@/hooks/use-copy-text";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import type { CanvasNodeToolbarItem } from "@/types/canvas-plugin";
import { ImageToolSettingsModal, type ImageToolbarSettingsTool } from "./canvas-image-toolbar-settings-modal";
import { IMAGE_QUICK_TOOLS_STORAGE_KEY, buildImageToolbarTools, defaultImageQuickToolIds, readImageQuickToolsConfig, type ImageQuickToolId } from "./canvas-image-toolbar-tools";

type CanvasNodeHoverToolbarProps = {
    node: CanvasNodeData | null;
    viewport: ViewportTransform;
    onKeep: (nodeId: string) => void;
    onLeave: () => void;
    onInfo: (node: CanvasNodeData) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onDecreaseFont: (node: CanvasNodeData) => void;
    onIncreaseFont: (node: CanvasNodeData) => void;
    onToggleDialog: (node: CanvasNodeData) => void;
    onGenerateImage: (node: CanvasNodeData) => void;
    onDownload: (node: CanvasNodeData) => void;
    onSaveAsset: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onVideoTools: (node: CanvasNodeData, operation: VideoOperation) => void;
    onVideoUpscale: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onCancelSeedVr2: (node: CanvasNodeData) => void;
    onDelete: (node: CanvasNodeData) => void;
    onUngroup?: (node: CanvasNodeData) => void;
    extraTools?: CanvasNodeToolbarItem[];
};

type ToolbarTool = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
};

export function positionCanvasNodeToolbar({ canvasWidth, canvasHeight, toolbarWidth, toolbarHeight, nodeCenterX, nodeTop, nodeBottom, labelOffset = 28, preferOutside = false, scale, panelBounds }: {
    canvasWidth: number;
    canvasHeight: number;
    toolbarWidth: number;
    toolbarHeight: number;
    nodeCenterX: number;
    nodeTop: number;
    nodeBottom?: number;
    labelOffset?: number;
    preferOutside?: boolean;
    scale: number;
    panelBounds?: { left: number; right: number; top: number; bottom: number };
}) {
    const safeTop = preferOutside ? 60 : 76, safeBottom = canvasHeight - 76;
    const above = nodeTop - labelOffset * scale - 8;
    const below = (nodeBottom ?? nodeTop) + 8 + toolbarHeight;
    const placement = above - toolbarHeight >= safeTop ? "above" : preferOutside && below <= safeBottom ? "below" : "inside";
    const desiredBottom = placement === "above" ? above : placement === "below" ? below : Math.max(safeTop, nodeTop + 8) + toolbarHeight;
    const position = {
        left: Math.max(80 + toolbarWidth / 2, Math.min(canvasWidth - toolbarWidth / 2 - 16, nodeCenterX)),
        top: Math.max(safeTop + toolbarHeight, Math.min(safeBottom, desiredBottom)),
        placement,
    };
    if (panelBounds && position.left + toolbarWidth / 2 > panelBounds.left && position.left - toolbarWidth / 2 < panelBounds.right && position.top > panelBounds.top - 12 && position.top - toolbarHeight < panelBounds.bottom + 12) {
        position.top = panelBounds.top - 12;
        position.placement = "above-panel";
    }
    return position;
}

export function CanvasNodeHoverToolbar({
    node,
    viewport,
    onKeep,
    onLeave,
    onInfo,
    onConfigChange,
    onDecreaseFont,
    onIncreaseFont,
    onToggleDialog,
    onGenerateImage,
    onDownload,
    onSaveAsset,
    onMaskEdit,
    onCrop,
    onSplit,
    onUpscale,
    onSuperResolve,
    onVideoTools,
    onAngle,
    onViewImage,
    onReversePrompt,
    onRetry,
    onCancelSeedVr2,
    onDelete,
    onUngroup,
    extraTools = [],
}: CanvasNodeHoverToolbarProps) {
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    const [quickImageToolIds, setQuickImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [showImageToolLabels, setShowImageToolLabels] = useState(false);
    const [draftImageToolIds, setDraftImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [draftShowImageToolLabels, setDraftShowImageToolLabels] = useState(false);
    const [imageToolSettingsOpen, setImageToolSettingsOpen] = useState(false);
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
            if (!stored) return;
            const parsed = JSON.parse(stored) as unknown;
            const config = readImageQuickToolsConfig(parsed);
            setQuickImageToolIds(config.ids);
            setShowImageToolLabels(config.showLabels);
        } catch {
            window.localStorage.removeItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
        }
    }, []);

    useEffect(() => {
        setImageToolSettingsOpen(false);
    }, [node?.id]);

    const toolbarRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const element = toolbarRef.current, parent = element?.parentElement;
        if (!element || !parent || !node) return;
        let frame = 0;
        const place = () => {
            const width = parent.clientWidth, height = parent.clientHeight;
            element.style.maxWidth = `${Math.max(160, width - 96)}px`;
            const box = element.getBoundingClientRect();
            const parentBox = parent.getBoundingClientRect();
            const panel = Array.from(document.querySelectorAll<HTMLElement>("[data-canvas-safe-panel]")).find((item) => item.dataset.panelNodeId === node.id);
            const panelBox = panel?.getBoundingClientRect();
            const position = positionCanvasNodeToolbar({
                canvasWidth: width, canvasHeight: height, toolbarWidth: box.width, toolbarHeight: box.height,
                nodeCenterX: viewport.x + (node.position.x + node.width / 2) * viewport.k,
                nodeTop: viewport.y + node.position.y * viewport.k,
                nodeBottom: viewport.y + (node.position.y + node.height) * viewport.k,
                labelOffset: node.type === CanvasNodeType.Image && (node.metadata?.images?.length || 0) > 1 ? 42 : 28,
                preferOutside: node.type === CanvasNodeType.Image && Boolean(node.metadata?.content),
                scale: viewport.k,
                panelBounds: panelBox ? { left: panelBox.left - parentBox.left, right: panelBox.right - parentBox.left, top: panelBox.top - parentBox.top, bottom: panelBox.bottom - parentBox.top } : undefined,
            });
            element.style.left = `${position.left}px`;
            element.style.top = `${position.top}px`;
            element.dataset.placement = position.placement;
        };
        const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
        const observer = new ResizeObserver(() => { place(); window.dispatchEvent(new Event("canvas-node-toolbar-size")); });
        window.addEventListener("canvas-node-panel-layout", schedule);
        observer.observe(parent); observer.observe(element); place();
        return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("canvas-node-panel-layout", schedule); };
    }, [node, viewport]);

    if (!node) return null;

    const activeNode = node;
    const left = viewport.x + (node.position.x + node.width / 2) * viewport.k;
    const top = viewport.y + node.position.y * viewport.k - 36 * viewport.k;
    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const compactVideoTools = isVideo || node.type.startsWith("video-tool:");
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const hasVideo = isVideo && Boolean(node.metadata?.content);
    const hasAudio = isAudio && Boolean(node.metadata?.content);
    const isText = node.type === CanvasNodeType.Text;
    const isConfig = node.type === CanvasNodeType.Config;
    const pendingVideoTask = isVideo && !hasVideo && Boolean(node.metadata?.videoTaskId || node.metadata?.seedVr2TaskId);
    const canRetry = node.type !== CanvasNodeType.Upload && node.metadata?.status === "error" && !pendingVideoTask;
    const canQueryVideoTask = pendingVideoTask && node.metadata?.status !== "loading";
    const quickImageToolIdSet = new Set(quickImageToolIds);
    const copyImagePrompt = (target: CanvasNodeData) => {
        const prompt = target.metadata?.prompt?.trim();
        if (!prompt) {
            message.warning(t("canvas.nodeToolbar.noPrompt"));
            return;
        }
        copyText(prompt, t("common.promptCopied"));
    };
    const imageTools = buildImageToolbarTools(node, { onMaskEdit, onCrop, onSplit, onUpscale, onSuperResolve, onAngle, onViewImage, onCopyPrompt: copyImagePrompt, onReversePrompt });

    function openImageToolSettings() {
        onKeep(activeNode.id);
        setDraftImageToolIds(quickImageToolIds);
        setDraftShowImageToolLabels(showImageToolLabels);
        setImageToolSettingsOpen(true);
    }

    const baseToolbarTools: ToolbarTool[] = [
        { id: "info", title: t("canvas.nodeToolbar.infoTitle"), label: t("canvas.nodeToolbar.info"), icon: <Info className="size-4" />, onClick: () => onInfo(node) },
        ...(node.type === CanvasNodeType.Group && onUngroup ? [{ id: "ungroup", title: t("canvas.nodeToolbar.ungroupTitle"), label: t("canvas.nodeToolbar.ungroup"), icon: <Ungroup className="size-4" />, onClick: () => onUngroup(node) }] : []),
        { id: "delete", title: t("canvas.nodeToolbar.removeTitle"), label: t("common.delete"), icon: <Trash2 className="size-4" />, onClick: () => onDelete(node), danger: true },
    ];
    const nodeToolbarTools: ToolbarTool[] = [
        ...(canQueryVideoTask ? [{ id: "queryVideoTask", title: t("canvas.nodeToolbar.queryVideoTaskTitle"), label: t("canvas.nodeToolbar.queryVideoTask"), icon: <RefreshCw className="size-4" />, onClick: () => onRetry(node) }] : []),
        ...(isVideo && Boolean(node.metadata?.seedVr2TaskId) && node.metadata?.status === "loading" ? [{ id: "cancelSeedVr2", title: "取消本次视频超分", label: "取消超分", icon: <Square className="size-4" />, onClick: () => onCancelSeedVr2(node), danger: true }] : []),
        ...(canRetry ? [{ id: "retry", title: t("canvas.nodeToolbar.retryTitle"), label: t("canvas.node.retry"), icon: <RefreshCw className="size-4" />, onClick: () => onRetry(node) }] : []),
        ...(hasImage || hasVideo || isText ? [{ id: "saveAsset", title: t("common.addToAssets"), label: t("canvas.nodeToolbar.saveAsset"), icon: <FolderPlus className="size-4" />, onClick: () => onSaveAsset(node) }] : []),
        ...(hasImage || hasVideo || hasAudio ? [{ id: "download", title: t(hasAudio ? "canvas.nodeToolbar.downloadAudio" : hasVideo ? "canvas.nodeToolbar.downloadVideo" : "canvas.nodeToolbar.downloadImage"), label: t("common.download"), icon: <Download className="size-4" />, onClick: () => onDownload(node) }] : []),
        ...(isVideo ? [{ id: "edit", title: t("common.edit"), label: t("common.edit"), icon: <MessageSquare className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "generateImage", title: t("canvas.node.generateImage"), label: t("canvas.node.generate"), icon: <ImageIcon className="size-4" />, onClick: () => onGenerateImage(node) }] : []),
        ...(isConfig ? [{ id: "config", title: t("canvas.configNode.title"), label: t("canvas.configNode.title"), icon: <Settings2 className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "decreaseFont", title: t("canvas.nodeToolbar.decreaseFont"), label: t("canvas.nodeToolbar.zoomOut"), icon: <Minus className="size-4" />, onClick: () => onDecreaseFont(node) }] : []),
        ...(isText ? [{ id: "increaseFont", title: t("canvas.nodeToolbar.increaseFont"), label: t("canvas.nodeToolbar.zoomIn"), icon: <Plus className="size-4" />, onClick: () => onIncreaseFont(node) }] : []),
        ...(hasVideo ? (["interpolate", "upscale", "trim", "audio"] as const).map(operation => ({ id: `video-${operation}`, title: videoOperationLabels[operation], label: ({ interpolate: "补帧", upscale: "放大", trim: "剪切", audio: "音轨" })[operation], icon: ({ interpolate: <Gauge className="size-4" />, upscale: <Maximize className="size-4" />, trim: <Scissors className="size-4" />, audio: <Music2 className="size-4" /> })[operation], onClick: () => onVideoTools(node, operation) })) : []),
        ...(hasVideo ? [{ id: "videoUpscale", title: t("canvas.videoUpscale.title"), label: t("canvas.videoUpscale.action"), icon: <Sparkles className="size-4" />, onClick: () => onVideoTools(node, "restore") }] : []),
        ...(hasImage ? imageTools.map((tool) => ({ id: tool.id, title: tool.title, label: tool.label, icon: tool.icon, active: tool.active, onClick: tool.onClick })) : []),
    ];
    const imageIconOnlyIds = new Set(["view", "download", "delete"]);
    const imageToolbarTools = [...baseToolbarTools, ...nodeToolbarTools];
    const toolbarTools = hasImage ? imageToolbarTools.filter((tool) => quickImageToolIdSet.has(tool.id as ImageQuickToolId)) : [...baseToolbarTools, ...nodeToolbarTools, ...extraTools];
    const visibleImageTools = hasImage ? [...toolbarTools.filter((tool) => !imageIconOnlyIds.has(tool.id)), ...["view", "download", "delete"].flatMap((id) => toolbarTools.filter((tool) => tool.id === id))] : toolbarTools;
    const overflowImageTools = hasImage ? imageToolbarTools.filter((tool) => !toolbarTools.includes(tool)) : [];
    const selectableImageToolbarTools = [...baseToolbarTools, ...nodeToolbarTools].filter((tool) => tool.id !== "retry") as ImageToolbarSettingsTool[];

    const closeImageToolSettings = () => {
        setImageToolSettingsOpen(false);
        onLeave();
    };

    const setDraftImageToolVisible = (id: ImageQuickToolId, visible: boolean) => {
        setDraftImageToolIds((current) => {
            const selected = new Set(current);
            if (visible) selected.add(id);
            else selected.delete(id);
            return selectableImageToolbarTools.filter((tool) => selected.has(tool.id)).map((tool) => tool.id);
        });
    };

    const saveImageToolSettings = () => {
        const config = { ids: draftImageToolIds, showLabels: draftShowImageToolLabels };
        setQuickImageToolIds(config.ids);
        setShowImageToolLabels(config.showLabels);
        window.localStorage.setItem(IMAGE_QUICK_TOOLS_STORAGE_KEY, JSON.stringify(config));
        closeImageToolSettings();
    };

    return (
        <>
            <div
                ref={toolbarRef}
                data-canvas-node-toolbar
                data-toolbar-node-id={node.id}
                data-text-node-toolbar={isText ? node.id : undefined}
                className={`absolute z-[70] flex ${hasImage || compactVideoTools ? "w-max" : ""} -translate-x-1/2 -translate-y-full flex-wrap items-center overflow-visible rounded-[18px] border text-sm shadow-lg backdrop-blur [body:has([data-batch-image-id]:hover)_&]:invisible [body:has([data-batch-image-id]:focus-within)_&]:invisible`}
                style={{ background: theme.toolbar.panel, color: theme.toolbar.item, borderColor: theme.toolbar.border, left, top }}
                onMouseEnter={() => onKeep(node.id)}
                onMouseLeave={() => {
                    if (!imageToolSettingsOpen) onLeave();
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
            >
                {isText ? <>
                    <TextNodeActions key={node.id} node={node} onChange={(patch) => onConfigChange(node.id, patch)} />
                    <Dropdown trigger={["click"]} menu={{ items: toolbarTools.map((tool) => ({ key: tool.id, label: tool.label, icon: tool.icon, danger: tool.danger, onClick: tool.onClick })) }}>
                        <button type="button" aria-label="更多文本操作" className="mr-1 grid size-9 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"><Ellipsis className="size-4" /></button>
                    </Dropdown>
                </> : visibleImageTools.map((tool, index) => (
                    <ToolbarAction key={tool.id} {...tool} compact={hasImage || compactVideoTools} edge={(hasImage || compactVideoTools) && index === 0 ? "start" : undefined} showLabel={isImage ? showImageToolLabels && !imageIconOnlyIds.has(tool.id) : !compactVideoTools} />
                ))}
                {hasImage ? <Dropdown trigger={["click"]} onOpenChange={(open) => { if (open) onKeep(node.id); }} menu={{ items: [
                    ...overflowImageTools.map((tool) => ({ key: tool.id, label: tool.label, icon: tool.icon, danger: tool.danger, onClick: tool.onClick })),
                    ...(overflowImageTools.length ? [{ type: "divider" as const }] : []),
                    { key: "configure", label: t("canvas.imageTools.configure"), icon: <Settings2 className="size-4" />, onClick: openImageToolSettings },
                ] }}><span><ToolbarAction id="more" title={t("canvas.imageTools.more")} label={t("canvas.imageTools.more")} icon={<Ellipsis className="size-4" />} active={imageToolSettingsOpen} onClick={() => {}} compact edge="end" showLabel={showImageToolLabels} /></span></Dropdown> : null}
            </div>
            {hasImage ? (
                <ImageToolSettingsModal
                    open={imageToolSettingsOpen}
                    tools={selectableImageToolbarTools}
                    selectedIds={draftImageToolIds}
                    showLabels={draftShowImageToolLabels}
                    onToggle={setDraftImageToolVisible}
                    onShowLabelsChange={setDraftShowImageToolLabels}
                    onCancel={closeImageToolSettings}
                    onSave={saveImageToolSettings}
                />
            ) : null}
        </>
    );
}

export function CanvasNodeInfoModal({ node, open, onClose }: { node: CanvasNodeData | null; open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const [view, setView] = useState<"info" | "json">("info");
    const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.images?.length || 0 : 0;
    const json = useMemo(() => {
        if (!node) return "";
        return JSON.stringify(
            node,
            (key, value) => {
                if (key === "content" && typeof value === "string" && value.startsWith("data:image/")) {
                    return "[base64 image]";
                }
                return value;
            },
            2,
        );
    }, [node]);

    useEffect(() => {
        if (open) setView("info");
    }, [node?.id, open]);

    const title = (
        <div className="flex items-center justify-between gap-4 pr-12">
            <span>{t("canvas.nodeToolbar.nodeInfo")}</span>
            <Segmented
                size="small"
                value={view}
                onChange={(value) => setView(value as "info" | "json")}
                options={[
                    { label: t("canvas.nodeToolbar.info"), value: "info" },
                    { label: "JSON", value: "json" },
                ]}
            />
        </div>
    );

    return (
        <Modal className="canvas-node-info-modal" title={title} open={open && Boolean(node)} centered footer={null} onCancel={onClose}>
            {node ? (
                <div className="h-[56vh] min-h-[360px] select-text text-sm" data-canvas-shortcuts-ignore>
                    {view === "info" ? (
                        <div className="thin-scrollbar h-full space-y-3 overflow-auto pr-1">
                            <InfoRow label="ID" value={node.id} />
                            <InfoRow label={t("canvas.nodeToolbar.name")} value={node.title || t("canvas.node.untitled")} />
                            <InfoRow label={t("canvas.nodeToolbar.type")} value={node.type === CanvasNodeType.Group ? t("canvas.node.group") : node.type === CanvasNodeType.Config ? t("canvas.configNode.title") : [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(node.type as CanvasNodeType) ? t(`assets.kinds.${node.type}`) : getNodeDefinition(node.type)?.title || node.type} />
                            <InfoRow label={t("canvas.nodeToolbar.size")} value={`${Math.round(node.width)} x ${Math.round(node.height)}`} />
                            <InfoRow label={t("canvas.nodeToolbar.position")} value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />
                            <InfoRow label={t("canvas.nodeToolbar.status")} value={node.metadata?.status || "idle"} />
                            {batchCount > 1 ? <InfoRow label={t("canvas.nodeToolbar.imageGroup")} value={t("canvas.configNode.images", { count: batchCount })} /> : null}
                            {node.metadata?.prompt ? <InfoRow label={t("canvas.configNode.prompt")} value={node.metadata.prompt} /> : null}
                            {node.metadata?.videoTaskId ? <InfoRow label={t("canvas.nodeToolbar.videoTaskId")} value={node.metadata.videoTaskId} /> : null}
                            {imageBytes ? <InfoRow label={t("canvas.nodeToolbar.imageSize")} value={formatBytes(imageBytes)} /> : null}
                            {node.metadata?.errorDetails ? (
                                <div className="rounded-lg border p-3 text-red-400" style={{ borderColor: theme.node.stroke }}>
                                    {node.metadata.errorDetails}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <pre className="thin-scrollbar h-full overflow-auto rounded-lg border p-3 text-xs leading-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
                            {json}
                        </pre>
                    )}
                </div>
            ) : null}
        </Modal>
    );
}

function ToolbarAction({ id, title, label, icon, onClick, showLabel, compact = false, edge, active = false, danger = false }: ToolbarTool & { showLabel: boolean; compact?: boolean; edge?: "start" | "end" }) {
    const hasText = showLabel && Boolean(label);
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} trigger={["hover", "focus"]} >
            <button type="button" data-toolbar-action={id} className={`group relative flex ${compact ? "h-10 px-0" : "h-12 px-1.5"} items-center whitespace-nowrap ${danger ? "text-[#ef4444]" : ""}`} onClick={onClick} aria-label={title}>
                <span className={`flex ${compact ? "h-full" : "h-9"} items-center ${hasText ? "gap-2 px-2.5" : "justify-center px-2.5"} ${edge === "start" ? "rounded-l-[17px] rounded-r-lg" : edge === "end" ? "rounded-l-lg rounded-r-[17px]" : "rounded-lg"} transition group-hover:bg-black/5 dark:group-hover:bg-white/10 ${active ? "bg-black/5 dark:bg-white/10" : ""}`}>
                    {icon}
                    {hasText ? <span>{label}</span> : null}
                </span>
            </button>
        </Tooltip>
    );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
            <span className="opacity-50">{label}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{value}</span>
        </div>
    );
}
