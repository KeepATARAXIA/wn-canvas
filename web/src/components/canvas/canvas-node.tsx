import { CanvasSafeNodePanel } from "./canvas-safe-node-panel";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { ChevronRight, Clock3, Copy, Download, Group, Image as ImageIcon, Music2, Plus, Puzzle, RefreshCw, Star, Trash2, Upload, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasResizeOptions } from "@/lib/canvas/canvas-node-snapping";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { pickImageSource } from "@/lib/image-thumbnail";
import { previewUrlFor, subscribeImagePreviews, getImagePreviewRevision } from "@/services/image-storage";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { getVideoToolInput } from "@/lib/canvas/video-tool-preview";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasTextEditor } from "./canvas-text-editor";
import { readTextNodeContent, textContentHtml } from "@/lib/canvas/text-rich-content";
import { CanvasVideoPlayer } from "./canvas-video-player";
import { GenerationDots } from "./generation-dots";
import { NodeColorLabel, textNodeColors } from "./canvas-node-appearance";
import { groupNodeColors } from "@/lib/canvas/canvas-group-colors";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage, type CanvasNodeText, type CanvasRichText, type Position } from "@/types/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { NodeGenerationWaiting } from "@/lib/canvas/generation-queue";
import { useTranslation } from "react-i18next";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const selectionBlue = "#2f80ff";

type CanvasNodeProps = {
    data: CanvasNodeData;
    scale: number;
    isSelected: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    referenceSelectionState?: "target" | "disabled" | "available";
    showPanel: boolean;
    showImageInfo: boolean;
    generationWaiting?: NodeGenerationWaiting;
    mentionReferences?: CanvasResourceReference[];
    pluginHost?: CanvasPluginHost;
    registryVersion?: number;
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    groupChildCount?: number;
    isGroupDropTarget?: boolean;
    batchExpanded?: boolean;
    batchViewport?: { x: number; y: number; k: number; width: number; height: number; left: number; top: number };
    onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
    onSelectCapture?: (event: React.MouseEvent, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: React.MouseEvent, nodeId: string, handleType: "source" | "target") => void;
    onResizeStart: (nodeId: string) => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position, options?: CanvasResizeOptions) => void;
    onResizeEnd: (nodeId: string) => void;
    onContentChange: (nodeId: string, content: string, richText?: CanvasRichText) => void;
    onTitleChange: (nodeId: string, title: string) => void;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (nodeId: string, itemId: string) => void;
    onDuplicateBatchImage?: (node: CanvasNodeData, imageId: string) => void;
    onDownloadBatchImage?: (node: CanvasNodeData, imageId: string) => void;
    onRetryBatchImage?: (node: CanvasNodeData, imageId: string) => void;
    onDeleteBatchImage?: (nodeId: string, imageId: string) => void;
    onRetry?: (node: CanvasNodeData) => void;
    onUploadFile?: (nodeId: string) => void;
    onViewImage?: (node: CanvasNodeData, imageId?: string) => void;
    onViewVideo?: (node: CanvasNodeData) => void;
    onSelectReference?: (nodeId: string) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

type NodeContentRendererProps = {
    node: CanvasNodeData;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    isEditingContent: boolean;
    isSelected: boolean;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    scale: number;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    pluginContext?: CanvasNodeContext | null;
    onContentChange: (nodeId: string, content: string, richText?: CanvasRichText) => void;
    onStopEditing: () => void;
    onVideoDimensions: (width: number, height: number) => void;
    videoSource?: string;
    onImageDimensions: (width: number, height: number) => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
    onUploadFile?: (nodeId: string) => void;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: (itemId: string) => void;
    onDuplicateBatchImage?: (imageId: string) => void;
    onDownloadBatchImage?: (imageId: string) => void;
    onRetryBatchImage?: (imageId: string) => void;
    onDeleteBatchImage?: (imageId: string) => void;
    onViewBatchImage?: (imageId: string) => void;
    groupChildCount: number;
};

export const CanvasNode = React.memo(function CanvasNode({
    data,
    scale,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    referenceSelectionState,
    showPanel,
    showImageInfo,
    generationWaiting,
    mentionReferences = [],
    pluginHost,
    renderPanel,
    renderNodeContent,
    groupChildCount = 0,
    isGroupDropTarget = false,
    batchExpanded = false,
    onMouseDown,
    onSelectCapture,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onResizeStart,
    onResize,
    onResizeEnd,
    onContentChange,
    onTitleChange,
    onToggleBatch,
    onSetBatchPrimary,
    onDuplicateBatchImage,
    onDownloadBatchImage,
    onRetryBatchImage,
    onDeleteBatchImage,
    onRetry,
    onUploadFile,
    onViewImage,
    onViewVideo,
    onSelectReference,
    onContextMenu,
}: CanvasNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const [hovered, setHovered] = useState(false);
    const definition = getNodeDefinition(data.type);
    const pluginContext = useMemo<CanvasNodeContext | null>(() => (pluginHost ? buildNodeContext(pluginHost, data, theme, scale, isSelected) : null), [pluginHost, data, theme, scale, isSelected]);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(data.title || "");
    const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
    // Imported images are reference material; generation settings belong to downstream nodes.
    // Use existing metadata so saved canvases work without a data migration.
    const isImageAsset = hasImageContent && !data.metadata?.generationType && !data.metadata?.model && !data.metadata?.prompt && !data.metadata?.images?.length;
    const isVideoTool = data.type.startsWith("video-tool:");
    const videoSource = data.type === CanvasNodeType.Video ? data.metadata?.content : isVideoTool ? data.metadata?.content || getVideoToolInput(data, pluginContext?.getUpstream() || []).preview : undefined;
    const hasVideoContent = Boolean(videoSource);
    const [videoDimensions, setVideoDimensions] = useState<{ src: string; ratio: number; width: number; height: number } | null>(null);
    const videoRatio = hasVideoContent && videoDimensions && videoDimensions.src === videoSource ? videoDimensions.ratio : 0;
    const [imageDimensions, setImageDimensions] = useState<{ src: string; ratio: number; width: number; height: number } | null>(null);
    const imageRatio = hasImageContent && imageDimensions && imageDimensions.src === data.metadata?.content ? imageDimensions.ratio : 0;
    const mediaRatio = videoRatio || imageRatio;
    const primaryImage = data.type === CanvasNodeType.Image ? data.metadata?.images?.find((image) => image.id === data.metadata?.primaryImageId) || data.metadata?.images?.find((image) => image.content) : undefined;
    const mediaWidth = data.type === CanvasNodeType.Image && hasImageContent ? primaryImage?.naturalWidth || data.metadata?.naturalWidth || (imageDimensions?.src === data.metadata?.content ? imageDimensions?.width : 0) : data.type === CanvasNodeType.Video && hasVideoContent ? data.metadata?.naturalWidth || (videoDimensions?.src === videoSource ? videoDimensions?.width : 0) : 0;
    const mediaHeight = data.type === CanvasNodeType.Image && hasImageContent ? primaryImage?.naturalHeight || data.metadata?.naturalHeight || (imageDimensions?.src === data.metadata?.content ? imageDimensions?.height : 0) : data.type === CanvasNodeType.Video && hasVideoContent ? data.metadata?.naturalHeight || (videoDimensions?.src === videoSource ? videoDimensions?.height : 0) : 0;
    const hasMediaResolution = Boolean(mediaWidth && mediaHeight);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
    const isGroup = data.type === CanvasNodeType.Group;
    const groupColors = isGroup ? groupNodeColors(data, theme) : null;
    const textColors = textNodeColors(data, theme.node);
    const nodeBackground = data.type === CanvasNodeType.Text ? textColors.background : theme.node.fill;
    const batchCount = data.type === CanvasNodeType.Image ? data.metadata?.images?.length || 0 : data.type === CanvasNodeType.Text ? data.metadata?.texts?.length || 0 : 0;
    const isBatchRoot = batchCount > 1;
    const waitingPresentation = generationWaiting ? { ...generationWaiting, running: generationWaiting.running || data.metadata?.status === "loading" || Boolean(data.metadata?.images?.some(image => image.status === "loading")) } : undefined;
    const waitingPlaceholder = !hasImageContent && !hasVideoContent && !isBatchRoot && (data.type === CanvasNodeType.Image || data.type === CanvasNodeType.Video);
    // Nodes with the interaction/move toggle ignore content pointer events in move mode and allow interaction in interactive mode.
    // forceInteractive states such as editing stay interactive, as do empty nodes so their upload and generation actions remain usable.
    const supportsInteractionToggle = Boolean(definition?.interactionToggle);
    const forceInteractive = supportsInteractionToggle ? Boolean(definition?.forceInteractive?.(data)) : false;
    const contentInteractive = !supportsInteractionToggle || forceInteractive || !data.metadata?.content ? true : Boolean(data.metadata?.interactive);
    // Transparent nodes such as SVGs blend into the canvas while retaining outlines for selected or related states.
    const transparentBg = Boolean(definition?.transparentBackground);
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    const imageBorderColor = isActive ? selectionBlue : isRelated ? theme.node.muted : theme.node.faint;
    const titleInputRef = useRef<HTMLInputElement>(null);
    const resizeRef = useRef({
        isResizing: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        videoRatio: 0,
    });

    const handleVideoDimensions = useCallback((width: number, height: number) => {
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !videoSource) return;
        const ratio = width / height;
        setVideoDimensions(current => current?.src === videoSource && current.width === width && current.height === height ? current : { src: videoSource, ratio, width, height });
    }, [videoSource]);

    const handleImageDimensions = useCallback((width: number, height: number) => {
        if (width <= 0 || height <= 0 || !data.metadata?.content) return;
        const src = data.metadata.content, ratio = width / height;
        setImageDimensions((current) => current?.src === src && current.width === width && current.height === height ? current : { src, ratio, width, height });
    }, [data.metadata?.content]);

    useEffect(() => {
        if (!mediaRatio) return;
        // Match the inner player, excluding the node's two 2px borders. Retain
        // the user's long-edge size and center when correcting old/wrong ratios.
        const longSide = Math.max(1, data.width - 4, data.height - 4);
        const width = (mediaRatio >= 1 ? longSide : longSide * mediaRatio) + 4;
        const height = (mediaRatio >= 1 ? longSide / mediaRatio : longSide) + 4;
        if (Math.abs(width - data.width) < 0.1 && Math.abs(height - data.height) < 0.1) return;
        onResize(data.id, width, height, {
            x: data.position.x + (data.width - width) / 2,
            y: data.position.y + (data.height - height) / 2,
        });
    }, [data.id, data.width, data.height, data.position.x, data.position.y, onResize, mediaRatio]);

    useEffect(() => {
        setTitleDraft(data.title || "");
    }, [data.title]);

    useEffect(() => {
        if (!isEditingTitle) return;
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
    }, [isEditingTitle]);

    const finishTitleEditing = useCallback(() => {
        const title = titleDraft.trim() || data.title || t("canvas.node.untitled");
        setTitleDraft(title);
        setIsEditingTitle(false);
        if (title !== data.title) onTitleChange(data.id, title);
    }, [data.id, data.title, onTitleChange, t, titleDraft]);

    useEffect(() => {
        if (!isEditingTitle) return;
        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && titleInputRef.current?.contains(target)) return;
            finishTitleEditing();
        };
        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [finishTitleEditing, isEditingTitle]);

    const handleResizeMove = useCallback(
        (event: MouseEvent) => {
            if (!resizeRef.current.isResizing) return;

            const dx = (event.clientX - resizeRef.current.startX) / scale;
            const dy = (event.clientY - resizeRef.current.startY) / scale;
            const minWidth = 220;
            const minHeight = 160;
            const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
            const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
            const fromLeft = resizeRef.current.corner.includes("left");
            const fromTop = resizeRef.current.corner.includes("top");
            const rawWidth = Math.max(minWidth, resizeRef.current.startWidth + (fromLeft ? -dx : dx));
            const rawHeight = Math.max(minHeight, resizeRef.current.startHeight + (fromTop ? -dy : dy));
            let width = rawWidth;
            let height = rawHeight;
            if (resizeRef.current.videoRatio) {
                const startWidth = resizeRef.current.startWidth - 4;
                const startHeight = resizeRef.current.startHeight - 4;
                const changeX = (fromLeft ? -dx : dx) / startWidth;
                const changeY = (fromTop ? -dy : dy) / startHeight;
                // Follow the dominant drag axis; small existing videos must not
                // jump to the generic minimum size as soon as a handle is grabbed.
                const factor = Math.max(
                    1 + (Math.abs(changeX) >= Math.abs(changeY) ? changeX : changeY),
                    (Math.min(minWidth, resizeRef.current.startWidth) - 4) / startWidth,
                    (Math.min(minHeight, resizeRef.current.startHeight) - 4) / startHeight,
                );
                width = startWidth * factor + 4;
                height = (width - 4) / resizeRef.current.videoRatio + 4;
            }

            onResize(data.id, width, height, {
                x: fromLeft ? startRight - width : resizeRef.current.startLeft,
                y: fromTop ? startBottom - height : resizeRef.current.startTop,
            }, {
                corner: resizeRef.current.corner,
                minWidth: resizeRef.current.videoRatio ? Math.min(minWidth, resizeRef.current.startWidth) : minWidth,
                minHeight: resizeRef.current.videoRatio ? Math.min(minHeight, resizeRef.current.startHeight) : minHeight,
                videoRatio: resizeRef.current.videoRatio,
            });
        },
        [data.id, onResize, scale],
    );

    const handleResizeUp = useCallback(() => {
        if (!resizeRef.current.isResizing) return;
        resizeRef.current.isResizing = false;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeUp);
        window.removeEventListener("blur", handleResizeUp);
        onResizeEnd(data.id);
    }, [data.id, handleResizeMove, onResizeEnd]);

    const handleResizeMouseDown = (event: React.MouseEvent, corner: ResizeCorner) => {
        event.stopPropagation();
        event.preventDefault();
        onResizeStart(data.id);
        resizeRef.current = {
            isResizing: true,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            // The existing resize/snap contract uses this field for a locked media ratio.
            videoRatio: mediaRatio,
        };
        window.addEventListener("mousemove", handleResizeMove);
        window.addEventListener("mouseup", handleResizeUp);
        window.addEventListener("blur", handleResizeUp);
    };

    useEffect(() => {
        return () => {
            window.removeEventListener("mousemove", handleResizeMove);
            window.removeEventListener("mouseup", handleResizeUp);
            window.removeEventListener("blur", handleResizeUp);
            if (resizeRef.current.isResizing) {
                resizeRef.current.isResizing = false;
                onResizeEnd(data.id);
            }
        };
    }, [data.id, handleResizeMove, handleResizeUp, onResizeEnd]);

    return (
        <div
            data-node-id={data.id}
            data-canvas-text-scroll={data.type === CanvasNodeType.Text && isSelected ? true : undefined}
            className={`node-element group/node absolute flex select-none flex-col transition-shadow duration-200 ${isGroup ? "z-[5]" : isSelected ? "z-50" : batchExpanded ? "z-[45]" : "z-10"} ${referenceSelectionState === "available" ? "cursor-pointer" : referenceSelectionState ? "cursor-not-allowed" : ""}`}
            style={{
                transform: `translate(${data.position.x}px, ${data.position.y}px)`,
                width: data.width,
                height: data.height,
                transition: "box-shadow 200ms ease",
                contain: "layout style",
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
            }}
            onMouseDownCapture={(event) => {
                if (event.target instanceof Element && event.target.closest("[data-rich-text-owner]")) return;
                if (!referenceSelectionState) onSelectCapture?.(event, data.id);
            }}
            onContextMenu={(event) => {
                if (referenceSelectionState) event.preventDefault();
                else onContextMenu(event, data.id);
            }}
        >
            {!referenceSelectionState && (isSelected || hovered || isEditingTitle) && (
                <div data-node-title className={`absolute left-3 top-[-28px] z-[65] min-w-0 ${hasMediaResolution ? "right-32" : "right-3"}`} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    {isEditingTitle ? (
                        <input
                            ref={titleInputRef}
                            value={titleDraft}
                            maxLength={64}
                            className="h-6 w-full min-w-0 border-0 border-b border-dashed bg-transparent px-0 text-left text-xs font-medium outline-none"
                            style={{ borderColor: theme.node.muted, color: theme.node.text }}
                            onChange={(event) => setTitleDraft(event.target.value)}
                            onBlur={finishTitleEditing}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") finishTitleEditing();
                                if (event.key === "Escape") {
                                    setTitleDraft(data.title || "");
                                    setIsEditingTitle(false);
                                }
                            }}
                        />
                    ) : (
                        <button
                            type="button"
                            className="block w-full truncate border-b border-dashed border-transparent px-0 py-0.5 text-left text-xs font-medium opacity-75 transition hover:border-current hover:opacity-100"
                            style={{ color: theme.node.text }}
                            title={t("canvas.node.renameHint")}
                            onDoubleClick={(event) => {
                                event.stopPropagation();
                                setIsEditingTitle(true);
                            }}
                        >
                            {data.title || t("canvas.node.untitled")}
                        </button>
                    )}
                </div>
            )}

            {hasMediaResolution ? <span data-node-resolution className="pointer-events-none absolute -top-7 right-1 z-[65] rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums shadow-sm" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}>{mediaWidth}×{mediaHeight}</span> : null}

            {!referenceSelectionState && pluginContext && (isSelected || hovered || data.metadata?.labelColor) ? <NodeColorLabel node={data} onChange={pluginContext.updateMetadata} /> : null}

            <div
                data-node-body
                className={`relative h-full w-full overflow-visible border-2 ${!referenceSelectionState ? "cursor-grab active:cursor-grabbing" : ""} ${data.type === CanvasNodeType.Text || data.type === CanvasNodeType.Video || isVideoTool ? "rounded-xl" : "rounded-3xl"}`}
                style={{
                    background: groupColors ? groupColors.background : hasImageContent || hasVideoContent || transparentBg ? "transparent" : nodeBackground,
                    borderColor: groupColors ? (isGroupDropTarget || isActive ? selectionBlue : groupColors.border) : hasImageContent ? imageBorderColor : isActive ? selectionBlue : isRelated ? theme.node.muted : transparentBg ? "transparent" : theme.node.stroke,
                    borderStyle: isGroup ? "dashed" : "solid",
                    boxShadow: isGroupDropTarget ? `0 0 0 2px ${selectionBlue}66, inset 0 0 0 999px ${selectionBlue}10` : isActive ? `0 0 0 1px ${selectionBlue}55` : isRelated ? `0 0 0 1px ${theme.node.muted}55, 0 18px 48px rgba(0,0,0,.14)` : undefined,
                }}
                onMouseDown={(event) => {
                    if (event.button !== 0) return;
                    if (!referenceSelectionState) {
                        // Keep native focus/selection and media controls out of the drag path.
                        if (event.target instanceof Element && event.target.closest("button,input,textarea,select,a,audio,video,[contenteditable='true'],[data-canvas-no-zoom]")) return;
                        event.preventDefault();
                        onMouseDown(event, data.id);
                    }
                    else if (event.button === 0 && referenceSelectionState === "available") {
                        event.stopPropagation();
                        onSelectReference?.(data.id);
                    }
                }}
                onDoubleClick={(event) => {
                    if (event.target instanceof Element && event.target.closest("button")) {
                        event.stopPropagation();
                        return;
                    }
                    if (referenceSelectionState) {
                        event.stopPropagation();
                        return;
                    }
                    if (definition?.onDoubleClick && pluginContext) {
                        if (definition.onDoubleClick(pluginContext)) event.stopPropagation();
                        return;
                    }
                    if (data.type === CanvasNodeType.Image && hasImageContent) {
                        event.stopPropagation();
                        onViewImage?.(data);
                        return;
                    }
                    if (data.type === CanvasNodeType.Video && hasVideoContent) {
                        event.stopPropagation();
                        onViewVideo?.(data);
                        return;
                    }
                    if (data.type !== CanvasNodeType.Text) return;
                    event.stopPropagation();
                    setIsEditingContent(true);
                }}
            >
                <div
                    className={`relative flex h-full w-full items-center justify-center rounded-[inherit] ${isBatchRoot ? "overflow-visible" : "overflow-hidden"}`}
                    style={
                        {
                            background: isGroup ? "transparent" : hasImageContent || hasVideoContent || transparentBg ? "transparent" : nodeBackground,
                            pointerEvents: contentInteractive ? undefined : "none",
                        } as React.CSSProperties
                    }
                >
                    <NodeContent
                        node={data}
                        theme={theme}
                        isEditingContent={isEditingContent}
                        isSelected={isSelected}
                        isBatchRoot={isBatchRoot}
                        batchCount={batchCount}
                        batchExpanded={batchExpanded}
                        scale={scale}
                        renderNodeContent={renderNodeContent}
                        pluginContext={pluginContext}
                        mentionReferences={mentionReferences}
                        onContentChange={onContentChange}
                        onVideoDimensions={handleVideoDimensions}
                        videoSource={videoSource}
                        onImageDimensions={handleImageDimensions}
                        onStopEditing={() => setIsEditingContent(false)}
                        onRetry={onRetry}
                        onUploadFile={onUploadFile}
                        onToggleBatch={() => onToggleBatch?.(data.id)}
                        onSetBatchPrimary={(itemId) => onSetBatchPrimary?.(data.id, itemId)}
                        onDuplicateBatchImage={(imageId) => onDuplicateBatchImage?.(data, imageId)}
                        onDownloadBatchImage={(imageId) => onDownloadBatchImage?.(data, imageId)}
                        onRetryBatchImage={(imageId) => onRetryBatchImage?.(data, imageId)}
                        onDeleteBatchImage={(imageId) => onDeleteBatchImage?.(data.id, imageId)}
                        onViewBatchImage={(imageId) => onViewImage?.(data, imageId)}
                        groupChildCount={groupChildCount}
                    />
                </div>

                {showImageInfo && hasImageContent ? <ImageInfoBar node={data} /> : null}

                {waitingPresentation ? <QueueWaitingOverlay theme={theme} waiting={waitingPresentation} placeholder={waitingPlaceholder} /> : null}

                {!isGroup && data.metadata?.status !== "loading" && data.type !== CanvasNodeType.Text && !hasImageContent && !hasVideoContent && !hasAudioContent ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: `linear-gradient(to top, ${theme.canvas.background}66, transparent)` }} /> : null}

                {referenceSelectionState && (referenceSelectionState !== "available" || hovered) ? (
                    <div className="pointer-events-none absolute inset-0 z-[60] grid place-items-center rounded-[inherit]" style={{ background: `color-mix(in srgb, ${theme.canvas.background} ${referenceSelectionState === "target" ? 78 : referenceSelectionState === "disabled" ? 60 : 34}%, transparent)`, boxShadow: referenceSelectionState === "available" ? `inset 0 0 0 2px ${selectionBlue}` : undefined }}>
                        {referenceSelectionState !== "disabled" ? <span className="rounded-lg px-3 py-2 text-sm font-medium shadow-sm" style={{ background: theme.toolbar.panel, color: theme.node.text }}>{t(referenceSelectionState === "target" ? "canvas.references.selecting" : "canvas.references.choose")}</span> : null}
                    </div>
                ) : null}

                {!referenceSelectionState ? <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} /> : null}
                {!referenceSelectionState ? <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} /> : null}
                {!referenceSelectionState ? <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} /> : null}
                {!referenceSelectionState ? <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} /> : null}
            </div>

            {!referenceSelectionState && !isGroup && data.type !== CanvasNodeType.Text && !isImageAsset ? <ConnectionHandleDot side="left" scale={scale} visible={hovered || isSelected || isConnecting} onMouseDown={(event) => onConnectStart(event, data.id, "target")} /> : null}
            {!referenceSelectionState && (definition?.hasSourceHandle ?? true) && data.type !== CanvasNodeType.Config ? <ConnectionHandleDot side="right" scale={scale} visible={hovered || isSelected || isConnecting} onMouseDown={(event) => onConnectStart(event, data.id, "source")} /> : null}

            {showPanel && !isGroup && !isImageAsset && renderPanel ? (
                <CanvasSafeNodePanel width={data.type === CanvasNodeType.Config ? 600 : data.type === CanvasNodeType.Video || data.type === CanvasNodeType.Image || isVideoTool ? 680 : 520}>
                    {renderPanel(data)}
                </CanvasSafeNodePanel>
            ) : null}
        </div>
    );
});

function QueueWaitingOverlay({ theme, waiting, placeholder }: { theme: NodeContentRendererProps["theme"]; waiting: NodeGenerationWaiting; placeholder: boolean }) {
    const light = theme === canvasThemes.light;
    const accent = light ? "#2f5bff" : "#a9bdff";
    const centered = placeholder && !waiting.running;
    const label = waiting.running ? `生成中 · 另有 ${waiting.count} 个排队` : `排队中 · 第 ${waiting.position} 位${waiting.count > 1 ? ` · ${waiting.count} 个任务` : ""}`;
    return (
        <div data-node-generation-waiting className="pointer-events-none absolute inset-0 z-40 overflow-hidden rounded-[inherit]">
            {!waiting.running ? <div data-queue-waiting-shade className="absolute inset-0 rounded-[inherit]" style={{ background: centered ? `color-mix(in srgb, ${theme.node.fill} 94%, ${theme.canvas.background})` : "rgba(15,23,42,.14)", boxShadow: `inset 0 0 0 1px ${accent}66, inset 0 0 20px ${accent}14` }} /> : null}
            <div className={`absolute flex max-w-[calc(100%-24px)] items-center gap-2 ${centered ? "left-1/2 top-1/2 w-max -translate-x-1/2 -translate-y-1/2 flex-col" : waiting.running ? "top-3 left-3" : "bottom-3 left-3"}`}>
                {centered ? <div className="grid size-11 place-items-center rounded-2xl border" style={{ color: accent, background: `${accent}12`, borderColor: `${accent}30` }}><Clock3 className="size-5" aria-hidden="true" /></div> : null}
                <span role="status" aria-label={label} className="flex min-w-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium shadow-sm" style={{ background: theme.toolbar.panel, borderColor: `${accent}44`, color: accent }}>
                    {!centered ? <Clock3 className="size-3.5 shrink-0" aria-hidden="true" /> : null}
                    <span className="min-w-0 break-words">{label}</span>
                </span>
            </div>
        </div>
    );
}

function NodeContent(props: NodeContentRendererProps) {
    if (props.node.type === CanvasNodeType.Upload) return <UploadNodeContent {...props} />;
    if (props.node.type.startsWith("video-tool:")) {
        const Status = getNodeDefinition(props.node.type)?.Content;
        return <><VideoNodeContent {...props} />{Status && props.pluginContext ? <Status ctx={props.pluginContext} /> : null}</>;
    }
    if (props.node.type === CanvasNodeType.Config && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (props.node.type === CanvasNodeType.Image && (props.isBatchRoot || props.node.metadata?.content)) return <ImageNodeContent {...props} />;
    if (props.node.type === CanvasNodeType.Text && props.node.metadata?.texts?.length && (props.node.metadata.status !== "error" || props.node.metadata.texts.some((text) => text.content))) return <TextContent {...props} />;
    if (!props.node.type.startsWith("video-tool:") && props.node.metadata?.status === "loading") return <LoadingContent node={props.node} theme={props.theme} />;
    if (!props.node.type.startsWith("video-tool:") && props.node.metadata?.status === "error") return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />;

    const Renderer = nodeContentRenderers[props.node.type as CanvasNodeType];
    if (Renderer) return <Renderer {...props} />;

    // Render plugin nodes with their registered renderer, or show the missing-plugin placeholder.
    const definition = getNodeDefinition(props.node.type);
    if (definition?.Content && props.pluginContext) {
        const PluginContent = definition.Content;
        return <PluginContent ctx={props.pluginContext} />;
    }
    return <MissingPluginContent theme={props.theme} type={props.node.type} />;
}

const nodeContentRenderers = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
    [CanvasNodeType.Upload]: UploadNodeContent,
    [CanvasNodeType.Group]: GroupNodeContent,
} satisfies Record<CanvasNodeType, (props: NodeContentRendererProps) => ReactNode>;

function UploadNodeContent({ node, theme, onUploadFile }: NodeContentRendererProps) {
    if (node.metadata?.status === "loading") return <LoadingContent node={{ ...node, metadata: { ...node.metadata, progressStage: node.metadata.progressStage || "上传中" } }} theme={theme} />;
    const content = node.metadata?.content;
    const failed = node.metadata?.status === "error";
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-5 py-4 text-center" style={{ color: theme.node.text }}>
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl" style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}>
                <Upload className="size-6" />
            </div>
            {content ? (
                <div className="w-full min-w-0">
                    <div className="truncate text-sm font-medium" title={node.title}>{node.title}</div>
                    <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>{formatBytes(node.metadata?.bytes || 0)}</div>
                </div>
            ) : <span className="text-xs" style={{ color: theme.node.muted }}>图片、视频、音频或其他文件</span>}
            {failed ? <div className="max-h-10 overflow-y-auto break-words text-xs leading-5 text-red-700 dark:text-red-300" role="alert">{node.metadata?.errorDetails || "上传失败，请重新选择文件"}</div> : null}
            <div className="flex items-center gap-2" onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
                {content ? (
                    <a href={content} download={node.title} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition hover:opacity-80" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                        <Download className="size-3.5" />下载
                    </a>
                ) : null}
                <button
                    type="button"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }}
                    disabled={!onUploadFile}
                    onClick={(event) => { event.stopPropagation(); onUploadFile?.(node.id); }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                >
                    <Upload className="size-4" />{content ? "替换文件" : "上传文件"}
                </button>
            </div>
        </div>
    );
}

function GroupNodeContent({ node, theme, groupChildCount }: NodeContentRendererProps) {
    const { t } = useTranslation();
    const colors = groupNodeColors(node, theme);
    return (
        <div className="pointer-events-none flex h-full w-full p-3">
            <div className="flex h-7 max-w-full items-center gap-2 px-1 text-xs font-medium" style={{ color: theme.node.text }}>
                <Group className="size-3.5 shrink-0" style={{ color: colors.accent }} />
                <span className="truncate">{node.title || t("canvas.node.group")}</span>
                <span className="shrink-0 text-[11px] font-normal" style={{ color: theme.node.muted }}>
                    {t("canvas.node.nodeCount", { count: groupChildCount })}
                </span>
            </div>
        </div>
    );
}

function LoadingContent({ node, theme }: Pick<NodeContentRendererProps, "node" | "theme">) {
    return <GenerationPlaceholder theme={theme} percent={node.metadata?.progress} stage={node.metadata?.progressStage} indeterminate={node.metadata?.progressIndeterminate} startedAt={node.metadata?.generationStartedAt} />;
}

function GenerationPlaceholder({ theme, percent, stage, indeterminate, startedAt }: { theme: NodeContentRendererProps["theme"]; percent?: number; stage?: string; indeterminate?: boolean; startedAt?: number }) {
    return (
        <div className="relative h-full w-full overflow-hidden rounded-[inherit]" style={{ background: theme === canvasThemes.light ? "#fcfdff" : theme.node.fill }}>
            <GenerationDots />
            <GenerationProgress theme={theme} percent={percent} stage={stage} indeterminate={indeterminate} startedAt={startedAt} dots />
        </div>
    );
}

function GenerationProgress({ theme, percent, stage, startedAt, indeterminate = false, floating = false, dots = false }: { theme: NodeContentRendererProps["theme"]; percent?: number; stage?: string; startedAt?: number; indeterminate?: boolean; floating?: boolean; dots?: boolean }) {
    const { t } = useTranslation();
    const fallbackStartedAt = useRef(Date.now());
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const update = () => setNow(Date.now());
        const timer = window.setInterval(update, 1000);
        document.addEventListener("visibilitychange", update);
        window.addEventListener("focus", update);
        return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update); window.removeEventListener("focus", update); };
    }, []);
    const seconds = Math.floor(Math.max(0, now - (startedAt || fallbackStartedAt.current)) / 1000);
    const hasPercent = !indeterminate && typeof percent === "number" && Number.isFinite(percent);
    const value = hasPercent ? Math.max(0, Math.min(100, percent)) : 0;
    if (dots) return (
        <div className="pointer-events-none absolute inset-x-4 bottom-3 z-10 flex items-center justify-between gap-2 text-[11px] tabular-nums" role="progressbar" aria-label={stage || t("canvas.node.generating")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={hasPercent ? Math.floor(value) : undefined} aria-valuetext={stage}>
            <span className="min-w-0 break-words" style={{ color: theme.node.muted }}>{stage || t("canvas.node.generating")}<span className={stage ? "mt-1 block opacity-60" : "ml-2 opacity-60"}>{formatDuration(seconds * 1000)}</span></span>
            {hasPercent && <span className="shrink-0 rounded-full border px-3 py-1 text-xs shadow-sm" style={{ background: theme === canvasThemes.light ? "#ffffff" : theme.node.panel, borderColor: theme.node.stroke, color: theme === canvasThemes.light ? "#1670ef" : "#79afff" }}>{Math.floor(value)}%</span>}
        </div>
    );
    return (
        <div className={floating ? "rounded-lg px-3 py-2 backdrop-blur-md" : "w-full max-w-[260px]"} style={floating ? { background: theme.toolbar.panel, color: theme.node.text } : undefined}>
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium opacity-70">
                <span>{stage || formatDuration(seconds * 1000)}</span>
                <span>{hasPercent ? `${Math.floor(value)}%` : formatDuration(seconds * 1000)}</span>
            </div>
            {hasPercent ? <div className="h-1.5 overflow-hidden rounded-full" style={{ background: `${theme.node.stroke}99` }}>
                <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${value}%`, background: theme.node.activeStroke }} />
            </div> : null}
        </div>
    );
}

function ErrorContent({ node, theme, onRetry }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry">) {
    const { t } = useTranslation();
    return (
        <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
            <div className="text-xs leading-5 text-red-700 dark:text-red-300">{node.metadata?.errorDetails || t("canvas.node.failed")}</div>
            <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onRetry?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <RefreshCw className="size-3.5" />
                {node.metadata?.seedVr2TaskId ? "查询原超分任务" : t("canvas.node.retry")}
            </button>
        </div>
    );
}

function MissingPluginContent({ theme, type }: Pick<NodeContentRendererProps, "theme"> & { type: string }) {
    const { t } = useTranslation();
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.placeholder }}>
            <Puzzle className="size-7 opacity-40" />
            <span className="text-sm">{t("canvas.node.missingPlugin")}</span>
            <span className="text-[11px] opacity-70">{t("canvas.node.missingPluginDescription", { type })}</span>
        </div>
    );
}

function TextContent({ node, theme, isEditingContent, mentionReferences, batchExpanded, onContentChange, onStopEditing, onToggleBatch, onSetBatchPrimary }: NodeContentRendererProps) {
    const { t } = useTranslation();
    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.8)}px`, ...textNodeColors(node, theme.node), boxSizing: "border-box" } as React.CSSProperties;
    const texts = node.metadata?.texts || [];
    const batchCount = texts.length;
    const isBatchRoot = batchCount > 1;
    const primaryText = texts.find((text) => text.id === node.metadata?.primaryTextId) || texts[0];
    const primaryTextId = primaryText?.id;
    const { content, richText } = readTextNodeContent(node);
    // Selection updates run during mousedown capture. Preserve the same DOM so
    // the original text target survives and the bubbling drag handler can run.
    const markup = useMemo(() => ({ __html: textContentHtml(content, richText) }), [content, richText]);
    const paddingClass = isBatchRoot ? "px-4 pb-4 pt-14" : "p-4";

    return (
        <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded}>
            {batchExpanded
                ? texts
                      .filter((text) => text.id !== primaryTextId)
                      .map((text, index) => <ExpandedTextCard key={text.id} node={node} text={text} index={index} onSetPrimary={() => onSetBatchPrimary?.(text.id)} />)
                : null}
            <div className="flex h-full w-full flex-col overflow-hidden rounded-xl">
                {isEditingContent ? (
                    <CanvasTextEditor
                        key={`${node.id}:${primaryTextId || "content"}`}
                        nodeId={node.id}
                        className={`block h-full w-full border-none bg-transparent m-0 ${paddingClass}`}
                        style={textStyle}
                        content={content}
                        richText={richText}
                        references={mentionReferences}
                        onChange={(value, format) => onContentChange(node.id, value, format)}
                        onStopEditing={onStopEditing}
                    />
                ) : content ? (
                    <div className={`canvas-rich-text thin-scrollbar block h-full w-full overflow-y-auto overscroll-contain bg-transparent ${paddingClass}`} style={textStyle} dangerouslySetInnerHTML={markup} />
                ) : primaryText ? (
                    <TextSlotStatus text={primaryText} />
                ) : (
                    <div className="p-4 opacity-50" style={{ color: textStyle.color }}>
                        {t("canvas.node.editText")}
                    </div>
                )}
            </div>
            {isBatchRoot ? (
                <button
                    type="button"
                    className="absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-[0_6px_18px_rgba(28,25,23,.12)] backdrop-blur-md transition hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }}
                    aria-label={batchExpanded ? t("canvas.node.textBatchExpanded") : t("canvas.node.textBatchCollapsed")}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleBatch?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <span className="leading-none">{t("canvas.controls.texts", { count: batchCount })}</span>
                    <ChevronRight className={`size-3.5 opacity-80 transition-transform ${batchExpanded ? "rotate-90" : ""}`} />
                </button>
            ) : null}
        </BatchFrame>
    );
}

function ExpandedTextCard({ node, text, index, onSetPrimary }: { node: CanvasNodeData; text: CanvasNodeText; index: number; onSetPrimary: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const html = useMemo(() => textContentHtml(text.content, text.richText), [text.content, text.richText]);
    const count = node.metadata?.texts?.length || 0;
    const columns = Math.min(count, 4);
    const rows = Math.ceil(count / columns);
    const rootSlot = (rows - 1) * columns;
    const slot = index >= rootSlot ? index + 1 : index;
    const x = (slot % columns) * (node.width + 18);
    const y = (Math.floor(slot / columns) - rows + 1) * (node.height + 18);

    return (
        <div
            className="absolute z-20 overflow-hidden rounded-3xl border shadow-[0_18px_50px_rgba(28,25,23,.14)]"
            style={
                {
                    left: x,
                    top: y,
                    width: node.width,
                    height: node.height,
                    background: theme.node.panel,
                    borderColor: theme.node.stroke,
                    "--batch-from-x": `${-x}px`,
                    "--batch-from-y": `${-y}px`,
                    "--batch-from-rotate": `${4 + index * 2}deg`,
                    animation: `canvas-batch-child-in 320ms ${index * 35}ms cubic-bezier(.2,.85,.18,1) both`,
                } as React.CSSProperties
            }
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {text.content ? (
                <>
                    <div className="canvas-rich-text thin-scrollbar h-full overflow-y-auto overscroll-contain px-4 pb-4 pt-14 text-sm leading-6" style={{ color: theme.node.text }} dangerouslySetInnerHTML={{ __html: html }} />
                    <button type="button" className="pointer-events-none absolute right-2.5 top-2.5 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium opacity-0 transition duration-150 hover:bg-black/5 group-hover/node:pointer-events-auto group-hover/node:opacity-100 dark:hover:bg-white/10" style={{ color: theme.node.text }} onClick={(event) => (event.stopPropagation(), onSetPrimary())}>
                        <Star className="size-3.5" style={{ color: selectionBlue }} />
                        {t("canvas.node.setPrimaryText")}
                    </button>
                </>
            ) : (
                <TextSlotStatus text={text} />
            )}
        </div>
    );
}

function TextSlotStatus({ text }: { text: CanvasNodeText }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const failed = text.status === "error";
    const loading = text.status === "loading";
    if (loading) return <GenerationPlaceholder theme={theme} />;
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: theme.node.fill, color: failed ? theme.node.text : theme.node.activeStroke }}>
            {failed ? <span className="text-xs leading-5">{text.errorDetails || t("canvas.node.failed")}</span> : <span className="text-xs">{t("apiErrors.noContent")}</span>}
        </div>
    );
}

function ImageNodeContent(props: NodeContentRendererProps) {
    if (!props.node.metadata?.content && !props.isBatchRoot) return <EmptyImageContent {...props} />;

    return (
        <ImageContent
            node={props.node}
            isSelected={props.isSelected}
            batchExpanded={props.batchExpanded}
            scale={props.scale}
            onImageDimensions={props.onImageDimensions}
            onToggleBatch={props.onToggleBatch}
            onSetBatchPrimary={props.onSetBatchPrimary}
            onDuplicateBatchImage={props.onDuplicateBatchImage}
            onDownloadBatchImage={props.onDownloadBatchImage}
            onRetryBatchImage={props.onRetryBatchImage}
            onDeleteBatchImage={props.onDeleteBatchImage}
            onViewBatchImage={props.onViewBatchImage}
        />
    );
}

function EmptyImageContent({ theme }: NodeContentRendererProps) {
    const { t } = useTranslation();
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
            <div className="flex size-14 items-center justify-center rounded-2xl" style={{ background: theme.toolbar.activeBg }}>
                <ImageIcon className="size-6 opacity-30" />
            </div>
            <span className="text-[10px] tracking-[0.18em] opacity-50">{t("canvas.node.emptyImage")}</span>
        </div>
    );
}

function VideoNodeContent({ node, theme, onVideoDimensions, videoSource }: NodeContentRendererProps) {
    const { t } = useTranslation();
    if (!videoSource)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
                <Video className="size-7 opacity-35" />
                <span className="text-sm">{t("canvas.node.emptyVideo")}</span>
            </div>
        );
    return <CanvasVideoPlayer key={videoSource} src={videoSource} nodeId={node.id} onDimensions={onVideoDimensions} />;
}

function AudioNodeContent({ node, theme }: NodeContentRendererProps) {
    const { t } = useTranslation();
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.placeholder }}>
                <Music2 className="size-7 opacity-35" />
                <span className="text-sm">{t("canvas.node.emptyAudio")}</span>
            </div>
        );
    return (
        <div className="flex h-full w-full flex-col justify-center gap-3 px-4" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex min-w-0 items-center gap-2 text-sm opacity-70">
                <Music2 className="size-4 shrink-0" />
                <span className="truncate">{t("canvas.node.audio")}</span>
            </div>
            <audio src={node.metadata.content} controls className="w-full" data-canvas-no-zoom />
        </div>
    );
}

function ImageContent({
    node,
    isSelected,
    batchExpanded,
    scale,
    onImageDimensions,
    onToggleBatch,
    onSetBatchPrimary,
    onDuplicateBatchImage,
    onDownloadBatchImage,
    onRetryBatchImage,
    onDeleteBatchImage,
    onViewBatchImage,
}: {
    node: CanvasNodeData;
    isSelected: boolean;
    batchExpanded: boolean;
    scale: number;
    onImageDimensions: (width: number, height: number) => void;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: (imageId: string) => void;
    onDuplicateBatchImage?: (imageId: string) => void;
    onDownloadBatchImage?: (imageId: string) => void;
    onRetryBatchImage?: (imageId: string) => void;
    onDeleteBatchImage?: (imageId: string) => void;
    onViewBatchImage?: (imageId: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const images = node.metadata?.images || [];
    const batchCount = images.length;
    const isBatchRoot = batchCount > 1;
    const primaryImageId = node.metadata?.primaryImageId || images.find((image) => image.content)?.id || images[0]?.id;
    const primaryImage = images.find((image) => image.id === primaryImageId);
    const primaryContent = primaryImage?.content || node.metadata?.content;
    const completedCount = images.filter((image) => image.status === "success" || image.status === "error").length;
    const failedCount = images.filter((image) => image.status === "error").length;
    const isGenerating = images.some((image) => image.status === "loading" || image.status === "idle");
    const controlsClass = isSelected ? "" : "invisible opacity-0 group-hover/primary:visible group-hover/primary:opacity-100 group-focus-within/primary:visible group-focus-within/primary:opacity-100";
    const primaryPreviewUrl = previewUrlFor(primaryImage?.storageKey || node.metadata?.storageKey);
    const primarySource = primaryContent
        ? pickImageSource({
              previewUrl: primaryPreviewUrl,
              originalUrl: primaryContent,
              naturalWidth: primaryImage?.naturalWidth || node.metadata?.naturalWidth,
              naturalHeight: primaryImage?.naturalHeight || node.metadata?.naturalHeight,
              renderedWidth: node.width,
              renderedHeight: node.height,
              scale,
          })
        : undefined;

    return (
        <>
        <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded}>
            {batchExpanded
                ? images.filter((image) => image.id !== primaryImageId).map((image, index) => <ExpandedImageCard key={image.id} node={node} image={image} index={index} scale={scale} busy={isGenerating} onView={() => onViewBatchImage?.(image.id)} onSetPrimary={() => onSetBatchPrimary?.(image.id)} onDuplicate={() => onDuplicateBatchImage?.(image.id)} onDownload={() => onDownloadBatchImage?.(image.id)} onRetry={() => onRetryBatchImage?.(image.id)} onDelete={() => onDeleteBatchImage?.(image.id)} />)
                : null}
            <div className="group/primary relative h-full w-full">
            <div className="h-full w-full overflow-hidden rounded-3xl">
                {primaryContent ? (
                    <img
                        src={primarySource}
                        onLoad={(event) => onImageDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
                        alt={node.title}
                        draggable={false}
                        onDragStart={(event) => event.preventDefault()}
                        className="pointer-events-none block h-full w-full select-none object-contain"
                    />
                ) : (
                    <ImageSlotStatus image={primaryImage} />
                )}
            </div>
            {primaryImage?.status === "error" ? <BatchImageFailureActions placement="left" disabled={isGenerating} onRetry={() => onRetryBatchImage?.(primaryImage.id)} onDelete={() => onDeleteBatchImage?.(primaryImage.id)} /> : null}
            {isBatchRoot && primaryContent && !isGenerating ? <span className={`pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/65 px-2.5 py-1 text-xs font-medium text-white transition-opacity duration-150 ${controlsClass}`}>{t("canvas.node.primaryImage")}</span> : null}
            {isGenerating && primaryContent ? (
                <div className="pointer-events-none absolute inset-x-3 bottom-3 z-30">
                    <GenerationProgress theme={theme} percent={isBatchRoot ? (completedCount / batchCount) * 100 : node.metadata?.progress} stage={isBatchRoot ? `${completedCount}/${batchCount}` : node.metadata?.progressStage} indeterminate={isBatchRoot ? false : node.metadata?.progressIndeterminate} startedAt={node.metadata?.generationStartedAt} floating />
                </div>
            ) : null}
            {isBatchRoot ? (
                <button
                    type="button"
                    className={`absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-[0_6px_18px_rgba(28,25,23,.16)] backdrop-blur-md transition hover:scale-[1.02] ${controlsClass}`}
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }}
                    aria-label={`${t(batchExpanded ? "canvas.node.collapseBatch" : "canvas.node.expandBatch")}，${t("canvas.controls.images", { count: batchCount })}${failedCount ? `，${t("canvas.node.failedImages", { count: failedCount })}` : ""}`}
                    aria-expanded={batchExpanded}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleBatch?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <span className="leading-none">{t("canvas.controls.images", { count: batchCount })}</span>
                    {failedCount > 0 ? <span className="rounded-full bg-red-500/15 px-1.5 text-red-600 dark:text-red-300">{t("canvas.node.failedImages", { count: failedCount })}</span> : null}
                    <ChevronRight className={`size-3.5 opacity-80 transition-transform ${batchExpanded ? "rotate-90" : ""}`} />
                </button>
            ) : null}
            </div>
        </BatchFrame>
        </>
    );
}

function ExpandedImageCard({ node, image, index, scale, busy, onView, onSetPrimary, onDuplicate, onDownload, onRetry, onDelete }: { node: CanvasNodeData; image: CanvasNodeImage; index: number; scale: number; busy: boolean; onView: () => void; onSetPrimary: () => void; onDuplicate: () => void; onDownload: () => void; onRetry: () => void; onDelete: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const [loadedSize, setLoadedSize] = useState<{ content: string; width: number; height: number } | null>(null);
    const naturalSize = image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : loadedSize?.content === image.content ? loadedSize : { width: 0, height: 0 };
    const ratio = naturalSize?.width && naturalSize.height ? naturalSize.width / naturalSize.height : (node.width - 4) / (node.height - 4);
    const fitted = (node.width - 4) / (node.height - 4) > ratio
        ? { width: (node.height - 4) * ratio, height: node.height - 4 }
        : { width: node.width - 4, height: (node.width - 4) / ratio };
    const count = node.metadata?.images?.length || 0;
    const columns = Math.min(count, 4);
    const rows = Math.ceil(count / columns);
    const rootSlot = (rows - 1) * columns;
    const slot = index >= rootSlot ? index + 1 : index;
    const column = slot % columns;
    const row = Math.floor(slot / columns);
    const x = column * (node.width + 18);
    const y = (row - rows + 1) * (node.height + 90);
    const source = image.content
        ? pickImageSource({
              previewUrl: previewUrlFor(image.storageKey),
              originalUrl: image.content,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
              renderedWidth: fitted.width,
              renderedHeight: fitted.height,
              scale,
          })
        : undefined;

    return (
        <div
            data-batch-image-id={image.id}
            className="group/card absolute z-20 rounded-3xl motion-reduce:!animate-none"
            style={{
                left: x, top: y, width: fitted.width + 4, height: fitted.height + 4,
                "--batch-from-x": `${-x}px`, "--batch-from-y": `${-y}px`, "--batch-from-rotate": `${4 + index * 2}deg`,
                animation: `canvas-batch-child-in 320ms ${index * 35}ms cubic-bezier(.2,.85,.18,1) both`,
            } as React.CSSProperties}
            tabIndex={image.content ? 0 : undefined}
            aria-label={t("canvas.node.candidateStatus", { index: index + 1, status: t(image.status === "error" ? "canvas.node.failed" : image.status === "idle" ? "canvas.node.queued" : image.status === "loading" ? "canvas.node.generating" : "canvas.node.completed") })}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => { if (image.content && event.key === "Enter" && event.target === event.currentTarget) onView(); }}
            onDoubleClick={(event) => {
                event.stopPropagation();
                if (!image.content || (event.target instanceof Element && event.target.closest("button"))) return;
                onView();
            }}
        >
            <div className="h-full w-full overflow-hidden rounded-[inherit] border-2" style={{ background: theme.node.fill, borderColor: theme.node.faint }}>
                {image.content ? <img src={source} onLoad={(event) => setLoadedSize({ content: image.content, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} alt={`${t("canvas.node.candidateImage", { index: index + 1 })}：${node.title}`} draggable={false} className="pointer-events-none h-full w-full select-none object-contain" /> : <ImageSlotStatus image={image} />}
            </div>
            {image.content && naturalSize.width && naturalSize.height ? <span className={`pointer-events-none absolute right-1 z-30 rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums shadow-sm ${fitted.width + 4 < 216 ? "-top-14" : "-top-7"}`} style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}>{naturalSize.width}×{naturalSize.height}</span> : null}
            {image.content ? (
                <div data-batch-image-actions className="invisible absolute bottom-full left-0 w-max pb-1 opacity-0 transition-opacity duration-150 group-hover/card:visible group-hover/card:opacity-100 group-focus-within/card:visible group-focus-within/card:opacity-100">
                <div className="flex h-7 items-center gap-1 rounded-lg border px-1" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }}>
                    <button type="button" className="grid size-6 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" title={t("common.download")} aria-label={t("canvas.node.candidateDownload", { index: index + 1 })} onClick={(event) => (event.stopPropagation(), onDownload())}>
                        <Download className="size-3 shrink-0" />
                    </button>
                    <button type="button" className="grid size-6 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" title={t("canvas.node.createCopy")} aria-label={t("canvas.node.candidateCopy", { index: index + 1 })} onClick={(event) => (event.stopPropagation(), onDuplicate())}>
                        <Copy className="size-3 shrink-0" />
                    </button>
                    <button type="button" className="grid size-6 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" title={t("canvas.node.setPrimary")} aria-label={t("canvas.node.candidateSetPrimary", { index: index + 1 })} onClick={(event) => (event.stopPropagation(), onSetPrimary())}>
                        <Star className="size-3 shrink-0" style={{ color: selectionBlue }} />
                    </button>
                    <button type="button" disabled={busy} className="grid size-6 place-items-center rounded-md hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40" title={t("common.delete")} aria-label={t("canvas.node.candidateRemove", { index: index + 1 })} onClick={(event) => (event.stopPropagation(), onDelete())}><Trash2 className="size-3.5" /></button>
                </div>
                </div>
            ) : null}
            {image.status === "error" ? <BatchImageFailureActions placement="right" disabled={busy} onRetry={onRetry} onDelete={onDelete} /> : null}
        </div>
    );
}

function BatchImageFailureActions({ placement, disabled, onRetry, onDelete }: { placement: "left" | "right"; disabled?: boolean; onRetry: () => void; onDelete: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    return (
        <div className={`absolute top-3 z-30 flex items-center gap-1.5 ${placement === "left" ? "left-3" : "right-3"}`}>
            <button type="button" disabled={disabled} className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-sm transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => (event.stopPropagation(), onRetry())}>
                <RefreshCw className="size-3.5" />
                {t("canvas.node.retry")}
            </button>
            <button type="button" disabled={disabled} className="grid size-8 place-items-center rounded-lg border shadow-sm transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => (event.stopPropagation(), onDelete())} aria-label={t("common.delete")} title={t("common.delete")}>
                <Trash2 className="size-3.5" />
            </button>
        </div>
    );
}

function ImageSlotStatus({ image }: { image?: CanvasNodeImage }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const failed = image?.status === "error";
    if (image?.status === "idle") return <div className="flex h-full w-full items-center justify-center text-xs" style={{ background: theme.node.fill, color: theme.node.muted }}>{t("canvas.node.queued")}</div>;
    if (!failed) return <GenerationPlaceholder theme={theme} stage={image?.progressStage} startedAt={image?.generationStartedAt} />;
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: theme.node.fill, color: failed ? theme.node.text : theme.node.activeStroke }}>
            <span className="text-xs leading-5">{image.errorDetails || t("canvas.node.failed")}</span>
        </div>
    );
}

function ImageInfoBar({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
            <span className="max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
                {width} x {height}
                {size ? ` · ${size}` : ""}
            </span>
        </div>
    );
}

function BatchFrame({ batchCount, batchExpanded, children }: { batchCount: number; batchExpanded: boolean; children: ReactNode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchRoot = batchCount > 1;
    return (
        <div className="group/batch relative h-full w-full overflow-visible rounded-[inherit]">
            {isBatchRoot ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible rounded-[inherit]">
                    {Array.from({ length: Math.min(batchCount - 1, 3) }).map((_, index) => (
                        <div
                            key={index}
                            className="absolute rounded-[inherit] border shadow-[0_10px_24px_rgba(68,64,60,.12)] transition-all duration-300 group-hover/batch:translate-x-1"
                            style={{
                                inset: 0,
                                background: `linear-gradient(135deg, ${theme.node.panel}, ${theme.node.fill})`,
                                borderColor: theme.node.stroke,
                                opacity: batchExpanded ? 0 : 1,
                                transform: `translate(${10 + index * 6}px, ${4 + index * 3}px) rotate(${1.5 + index}deg)`,
                                zIndex: -index - 1,
                            }}
                        />
                    ))}
                </div>
            ) : null}
            {children}
        </div>
    );
}
function ResizeHandle({ corner, onMouseDown }: { corner: ResizeCorner; onMouseDown: (event: React.MouseEvent, corner: ResizeCorner) => void }) {
    const positionClass = {
        "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
        "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
        "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
        "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize",
    }[corner];

    return <div data-resize-corner={corner} className={`absolute z-50 size-7 ${positionClass}`} onMouseDown={(event) => onMouseDown(event, corner)} />;
}

function ConnectionHandleDot({ side, scale, visible, onMouseDown }: { side: "left" | "right"; scale: number; visible: boolean; onMouseDown: (event: React.MouseEvent) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [pointer, setPointer] = useState<Position | null>(null);
    const followPointer = (event: React.MouseEvent<HTMLDivElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        setPointer({ x: (event.clientX - bounds.left) / scale, y: (event.clientY - bounds.top) / scale });
    };

    return (
        <div
            data-connection-handle={side}
            className={`group/handle absolute top-1/2 z-30 flex -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 hover:opacity-100 ${visible ? "opacity-100" : "opacity-0"}`}
            // Keep the approach area stable while the icon follows the pointer inside it.
            // Leave the corners free for resizing, including when zoomed out.
            style={{ width: 76 / scale, height: 144 / scale, maxHeight: `calc(100% - ${32 / scale}px)`, [side]: -72 / scale }}
            onMouseEnter={followPointer}
            onMouseMove={followPointer}
            onMouseLeave={() => setPointer(null)}
            onMouseDown={(event) => {
                event.stopPropagation();
                if (event.button !== 0) return;
                event.preventDefault();
                onMouseDown(event);
            }}
        >
            <div className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border" style={{ left: pointer ? pointer.x : (side === "left" ? 52 : 24) / scale, top: pointer ? pointer.y : "50%", width: 24, height: 24, borderWidth: 1, background: theme.node.panel, borderColor: theme.node.muted, color: theme.node.text }}>
                <Plus aria-hidden="true" style={{ width: 14, height: 14 }} strokeWidth={1.75} />
            </div>
        </div>
    );
}
