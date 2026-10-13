import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Modal } from "antd";
import { ChevronLeft, ChevronRight, Expand, FileText, Hand, Image as ImageIcon, Maximize, Minimize, Minus, Music, Pause, Play, Shrink, Square, Video, Volume2, VolumeX, X, ZoomIn, ZoomOut } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import "./canvas-image-viewer.css";

export type CanvasViewerItem = { id: string; kind: "image" | "video" | "audio" | "text"; content: string; title?: string };

type Props = {
    kind?: "image" | "video";
    src: string;
    title: string;
    images?: { id: string; content: string }[];
    initialImageId?: string | null;
    gallery?: CanvasViewerItem[];
    onActiveItemChange?: (item: CanvasViewerItem, index: number) => void;
    renderDetails?: (item: CanvasViewerItem, index: number) => ReactNode;
    openRequest?: number;
    onClose: () => void;
};
type View = { scale: number | null; x: number; y: number };
const fittedView: View = { scale: null, x: 0, y: 0 };

export function CanvasMediaViewer({ kind = "image", src, title, images, initialImageId, gallery, onActiveItemChange, renderDetails, openRequest, onClose }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const items = useMemo<CanvasViewerItem[]>(() => gallery?.length ? gallery : images?.length ? images.map((image) => ({ ...image, kind })) : [{ id: src, content: src, kind }], [gallery, images, src, kind]);
    const [activeId, setActiveId] = useState(() => items.find((image) => image.id === initialImageId)?.id || items.find((image) => image.content === src)?.id || items[0].id);
    const lastRequestRef = useRef(initialImageId);
    const pendingNavigationRef = useRef<string[]>([]);
    const lastOpenRequestRef = useRef(openRequest);
    const requestChanged = Boolean(gallery && initialImageId && initialImageId !== lastRequestRef.current);
    const echoIndex = requestChanged ? pendingNavigationRef.current.lastIndexOf(initialImageId!) : -1;
    const requestedId = requestChanged && echoIndex < 0 && items.some((item) => item.id === initialImageId) ? initialImageId : null;
    const index = Math.max(0, items.findIndex((image) => image.id === (requestedId || activeId)));
    const activeItem = items[index];
    const activeSrc = activeItem.content;
    const activeKind = activeItem.kind;
    const activeTitle = activeItem.title ?? title;
    const visual = activeKind === "image" || activeKind === "video";
    const notifiedRef = useRef<{ id: string; index: number } | null>(null);
    const viewerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const viewportObserverRef = useRef<ResizeObserver | null>(null);
    const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
    const [dragging, setDragging] = useState(false);
    const [view, setView] = useState<View>(fittedView);
    const [minimized, setMinimized] = useState(false);
    const [maximized, setMaximized] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [notice, setNotice] = useState("");
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(false);
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [loaded, setLoaded] = useState<{ src: string; kind: "image" | "video"; width: number; height: number } | null>(null);
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const natural = loaded?.src === activeSrc && loaded.kind === activeKind ? loaded : null;
    const gutter = items.length > 1 ? size.width < 600 ? 40 : 104 : 24;
    const fitScale = natural && size.width && size.height ? Math.min(1, Math.max(1, size.width - gutter * 2) / natural.width, Math.max(1, size.height - 48) / natural.height) : 1;
    const scale = view.scale ?? fitScale;

    // Modal mounts its portal after the parent effect; observe the actual viewport mount.
    const observeViewport = useCallback((viewport: HTMLDivElement | null) => {
        viewportObserverRef.current?.disconnect();
        viewportRef.current = viewport;
        if (!viewport) return;
        setSize({ width: viewport.clientWidth, height: viewport.clientHeight });
        const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
        observer.observe(viewport);
        viewportObserverRef.current = observer;
    }, []);

    // Parent navigation echoes can arrive after another next/previous action and
    // must not move it backwards. Only an explicit open request restores a window.
    useEffect(() => {
        if (!requestChanged) return;
        lastRequestRef.current = initialImageId;
        if (echoIndex >= 0) pendingNavigationRef.current.splice(0, echoIndex + 1);
        else if (requestedId) {
            pendingNavigationRef.current = [];
            setActiveId(requestedId);
        }
    }, [initialImageId]);

    useEffect(() => {
        if (openRequest !== undefined && openRequest !== lastOpenRequestRef.current) setMinimized(false);
        lastOpenRequestRef.current = openRequest;
    }, [openRequest]);

    useEffect(() => {
        if (activeId !== activeItem.id) setActiveId(activeItem.id);
        if (notifiedRef.current?.id === activeItem.id && notifiedRef.current.index === index) return;
        notifiedRef.current = { id: activeItem.id, index };
        if (onActiveItemChange && gallery && initialImageId !== activeItem.id) pendingNavigationRef.current.push(activeItem.id);
        onActiveItemChange?.(activeItem, index);
    }, [activeId, activeItem, index, onActiveItemChange]);

    useEffect(() => {
        setView(fittedView);
        dragRef.current = null;
        setDragging(false);
        setPlaying(false);
        setTime(0);
        setDuration(0);
        setNotice("");
    }, [activeItem.id, activeSrc, activeKind]);

    useEffect(() => {
        const media = activeKind === "video" ? videoRef.current : activeKind === "audio" ? audioRef.current : null;
        return () => { media?.pause(); };
    }, [activeItem.id, activeSrc, activeKind]);

    useEffect(() => {
        const onFullscreenChange = () => {
            setFullscreen(document.fullscreenElement === viewerRef.current);
            viewportRef.current?.focus({ preventScroll: true });
        };
        document.addEventListener("fullscreenchange", onFullscreenChange);
        return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
    }, []);

    const zoom = (next: number, clientX?: number, clientY?: number) => {
        if (!natural) return;
        viewportRef.current?.focus({ preventScroll: true });
        const nextScale = Math.max(Math.min(0.05, fitScale), Math.min(8, next));
        const rect = viewportRef.current?.getBoundingClientRect();
        const cx = rect && clientX != null ? clientX - rect.left - rect.width / 2 : 0;
        const cy = rect && clientY != null ? clientY - rect.top - rect.height / 2 : 0;
        setView((current) => {
            const currentScale = current.scale ?? fitScale;
            return { scale: nextScale, x: cx - (cx - current.x) * nextScale / currentScale, y: cy - (cy - current.y) * nextScale / currentScale };
        });
    };

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport || minimized || !visual) return;
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.deltaY) zoom(scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX, event.clientY);
        };
        viewport.addEventListener("wheel", onWheel, { passive: false });
        return () => viewport.removeEventListener("wheel", onWheel);
    }, [scale, fitScale, natural, size.width, size.height, minimized, visual]);

    const exitViewerFullscreen = async () => {
        if (document.fullscreenElement !== viewerRef.current) return;
        try { await document.exitFullscreen(); }
        catch { setNotice("无法退出全屏，请使用浏览器的 Esc 键退出。"); }
    };
    const toggleFullscreen = async () => {
        setNotice("");
        try {
            if (document.fullscreenElement === viewerRef.current) await document.exitFullscreen();
            else await viewerRef.current?.requestFullscreen();
        } catch { setNotice("当前浏览器无法进入全屏，可使用最大化窗口。"); }
    };
    const closeViewer = async () => {
        videoRef.current?.pause();
        audioRef.current?.pause();
        await exitViewerFullscreen();
        onClose();
    };
    const minimizeViewer = async () => {
        videoRef.current?.pause();
        audioRef.current?.pause();
        await exitViewerFullscreen();
        dragRef.current = null;
        setDragging(false);
        setMinimized(true);
    };
    const togglePlay = async () => {
        const video = videoRef.current;
        if (!video) return;
        if (!video.paused) return video.pause();
        try { await video.play(); setNotice(""); }
        catch { setNotice("视频无法播放，请检查文件是否可用。"); }
    };

    const changeImage = (next: number) => {
        if (next < 0 || next >= items.length || next === index) return;
        videoRef.current?.pause();
        audioRef.current?.pause();
        viewportRef.current?.focus({ preventScroll: true });
        setActiveId(items[next].id);
        setView(fittedView);
        dragRef.current = null;
        setDragging(false);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        // Keep viewer tools and navigation separate from the canvas shortcuts.
        event.stopPropagation();
        if (event.nativeEvent.isComposing || (event.key !== "Escape" && event.target instanceof Element && event.target.closest("input, textarea, select, audio, video, [contenteditable]:not([contenteditable='false']), [role='slider'], [role='combobox'], [role='textbox'], [role='menu'], [role='menuitem'], [role='listbox'], [role='option']"))) return;
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === "Escape") {
            event.preventDefault();
            if (fullscreen) void exitViewerFullscreen();
            else void closeViewer();
        }
        else if (event.key === "ArrowLeft") { event.preventDefault(); changeImage(index - 1); }
        else if (event.key === "ArrowRight") { event.preventDefault(); changeImage(index + 1); }
        else if (event.key.toLowerCase() === "h") viewportRef.current?.focus({ preventScroll: true });
        else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(scale * 1.25); }
        else if (event.key === "-") { event.preventDefault(); zoom(scale / 1.25); }
        else if (event.key === "0") setView(fittedView);
        else if (event.key === " " && activeKind === "video" && event.target === viewportRef.current) { event.preventDefault(); void togglePlay(); }
    };
    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !natural) return;
        event.currentTarget.focus();
        event.preventDefault();
        dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y };
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        setView((current) => ({ ...current, x: drag.x + event.clientX - drag.clientX, y: drag.y + event.clientY - drag.clientY }));
    };
    const endDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        dragRef.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const buttonClass = "flex h-[70px] w-full shrink-0 flex-col items-center justify-center gap-2 rounded-xl text-[13px] transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-default disabled:opacity-30 dark:hover:bg-white/10 max-[480px]:h-14 max-[480px]:text-[10px]";
    const windowButtonClass = "grid size-10 shrink-0 place-items-center rounded-lg hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:bg-white/10 max-[480px]:size-8";
    const mediaLabel = { image: "图片", video: "视频", audio: "音频", text: "文本" }[activeKind];

    return <>
        <Modal forceRender open={!minimized} centered width={maximized ? "calc(100vw - 24px)" : "min(1440px, calc(100vw - 32px))"} title={activeTitle || `${mediaLabel}查看器`} footer={null} closable={false} onCancel={() => void closeViewer()} focusTriggerAfterClose={!minimized} afterOpenChange={(open) => { if (open) viewportRef.current?.focus({ preventScroll: true }); }}
            style={{ maxWidth: "calc(100vw - 24px)", paddingBottom: 0 }}
            styles={{ wrapper: { overflow: "hidden" }, header: { display: "none" }, container: { padding: 0, borderRadius: 16, overflow: "hidden", border: `1px solid ${theme.node.stroke}`, background: theme.node.panel }, body: { height: maximized ? "calc(100dvh - 26px)" : "min(88dvh, 1000px)", padding: 0 } }}
            wrapProps={{ "data-canvas-shortcuts-ignore": true, "data-canvas-no-zoom": true }}>
            <div ref={viewerRef} data-media-viewer data-image-viewer={activeKind === "image" ? "" : undefined} data-video-viewer={activeKind === "video" ? "" : undefined} data-media-preview-kind={activeKind} data-media-preview-id={activeItem.id} data-window-mode={fullscreen ? "fullscreen" : maximized ? "maximized" : "normal"} className="relative flex h-full w-full min-h-0 flex-col [&:fullscreen]:h-screen [&:fullscreen]:w-screen" style={{ color: theme.node.text, background: theme.node.panel }} onKeyDown={onKeyDown} onKeyUp={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-5 max-[480px]:px-3" style={{ borderColor: theme.node.stroke }}>
                    <h2 className="min-w-0 truncate text-[18px] font-semibold max-[480px]:text-sm" title={activeTitle}>{activeTitle || `${mediaLabel}查看器`}</h2>
                    <div className="flex shrink-0 items-center gap-1" style={{ color: theme.toolbar.item }}>
                        <button type="button" aria-label={fullscreen ? "退出预览全屏" : "全屏预览"} title={fullscreen ? "退出全屏 (Esc)" : "全屏"} className={windowButtonClass} onClick={() => void toggleFullscreen()}>{fullscreen ? <Shrink className="size-[18px]" /> : <Expand className="size-[18px]" />}</button>
                        <span className="mx-2 h-5 border-l max-[480px]:mx-1" style={{ borderColor: theme.node.stroke }} />
                        <button type="button" aria-label="最小化查看器" title="最小化" className={windowButtonClass} onClick={() => void minimizeViewer()}><Minus className="size-[18px]" /></button>
                        <button type="button" aria-label={maximized ? "还原查看器窗口" : "最大化查看器"} title={maximized ? "还原窗口" : "最大化"} className={windowButtonClass} onClick={() => { setMaximized(!maximized); viewportRef.current?.focus({ preventScroll: true }); }}>{maximized ? <Minimize className="size-4" /> : <Square className="size-4" />}</button>
                        <button type="button" aria-label={`关闭${mediaLabel}查看器`} title="关闭 (Esc)" className={`${windowButtonClass} hover:!bg-red-500/15 hover:!text-red-500`} onClick={() => void closeViewer()}><X className="size-[18px]" /></button>
                    </div>
                </header>
                <div className={`canvas-media-viewer-body flex min-h-0 flex-1${renderDetails ? " canvas-media-viewer-with-details" : ""}`}>
                  <div className="canvas-media-viewer-stage flex min-h-0 min-w-0 flex-1">
                    {visual ? <aside role="toolbar" aria-label={`${mediaLabel}查看工具`} aria-orientation="vertical" className="flex w-[84px] shrink-0 flex-col gap-3 overflow-y-auto border-r px-3 py-6 max-[480px]:w-14 max-[480px]:gap-2 max-[480px]:px-1 max-[480px]:py-3" style={{ borderColor: theme.node.stroke, color: theme.toolbar.item }}>
                        <button type="button" aria-label="抓手工具" aria-pressed={true} title="抓手 (H) · 拖动平移" className={buttonClass} style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }} onClick={() => viewportRef.current?.focus({ preventScroll: true })}><Hand className="size-6 max-[480px]:size-5" /><span>抓手</span></button>
                        <button type="button" aria-label="放大预览" title="放大 (+)" disabled={!natural || scale >= 8} className={buttonClass} onClick={() => zoom(scale * 1.25)}><ZoomIn className="size-6 max-[480px]:size-5" /><span>放大</span></button>
                        <button type="button" aria-label="缩小预览" title="缩小 (-)" disabled={!natural || scale <= Math.min(0.05, fitScale)} className={buttonClass} onClick={() => zoom(scale / 1.25)}><ZoomOut className="size-6 max-[480px]:size-5" /><span>缩小</span></button>
                        <button type="button" aria-label="适合窗口" title="适合窗口 (0)" disabled={!natural} className={buttonClass} onClick={() => setView(fittedView)}><Maximize className="size-6 max-[480px]:size-5" /><span>适应</span></button>
                    </aside> : null}
                    <div className="relative min-w-0 flex-1" style={{ background: theme.canvas.background }}>
                        <div ref={observeViewport} data-media-preview-viewport tabIndex={0} aria-label={`${mediaLabel}浏览区域`} className={`absolute inset-0 outline-none ${visual ? "touch-none overflow-hidden" : "overflow-auto"}${gallery && activeKind === "image" ? " canvas-media-preview-checker" : ""}`} style={{ cursor: visual ? dragging ? "grabbing" : "grab" : undefined }} onPointerDown={visual ? onPointerDown : undefined} onPointerMove={visual ? onPointerMove : undefined} onPointerUp={visual ? endDrag : undefined} onPointerCancel={visual ? endDrag : undefined} onLostPointerCapture={visual ? endDrag : undefined}>
                            {visual ? <>
                                <div className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${scale})`, transformOrigin: "center" }}>
                                    {activeKind === "image" ? activeSrc ? <img key={activeSrc} src={activeSrc} alt={activeTitle || "图片预览"} draggable={false} className="shrink-0 select-none" style={{ width: natural?.width, height: natural?.height, maxWidth: "none", visibility: natural ? "visible" : "hidden" }} onLoad={(event) => setLoaded({ src: activeSrc, kind: "image", width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailedSrc(activeSrc)} /> : null :
                                        activeSrc ? <video ref={videoRef} key={activeSrc} src={activeSrc} playsInline preload="metadata" draggable={false} className="shrink-0 select-none" style={{ width: natural?.width, height: natural?.height, maxWidth: "none", visibility: natural ? "visible" : "hidden" }} onLoadedMetadata={(event) => { const video = event.currentTarget; setLoaded({ src: activeSrc, kind: "video", width: video.videoWidth, height: video.videoHeight }); setDuration(Number.isFinite(video.duration) ? video.duration : 0); }} onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onVolumeChange={(event) => setMuted(event.currentTarget.muted)} onError={() => setFailedSrc(activeSrc)} /> : null}
                                </div>
                                {!natural ? <div role="status" className="absolute inset-0 flex items-center justify-center px-12 text-center text-sm" style={{ color: theme.node.muted }}>{!activeSrc || failedSrc === activeSrc ? `无法加载${mediaLabel}，可切换其他内容或关闭查看器` : `正在加载${mediaLabel}…`}</div> : null}
                            </> : activeKind === "text" ? <article data-media-preview-text className="canvas-media-preview-text whitespace-pre-wrap break-words text-sm leading-7">{activeSrc || "正文未记录"}</article> :
                                <div className="canvas-media-preview-audio flex min-h-full flex-col items-center justify-center gap-6 text-center">
                                    <Music className="size-14" style={{ color: theme.node.muted }} /><p className="break-words text-lg">{activeTitle || "音频"}</p>
                                    {activeSrc ? <audio ref={audioRef} key={activeSrc} src={activeSrc} controls preload="metadata" className="w-full" onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onError={() => setFailedSrc(activeSrc)} /> : null}
                                    {!activeSrc || failedSrc === activeSrc ? <p role="status" className="text-sm" style={{ color: theme.node.muted }}>无法加载音频，可切换其他内容或关闭查看器</p> : null}
                                </div>}
                        </div>
                        {items.length > 1 ? <nav aria-label={gallery ? "浏览筛选素材" : "浏览本组图片"} className="pointer-events-none absolute inset-0 flex items-center justify-between px-7 max-[600px]:px-2">
                            <button type="button" aria-label={gallery ? "上一个素材" : "上一张图片"} title={gallery ? "上一个 (←)" : "上一张 (←)"} disabled={index === 0} className="pointer-events-auto grid size-[58px] shrink-0 place-items-center rounded-full border transition-colors hover:brightness-125 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-default disabled:opacity-25 max-[600px]:size-8" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }} onClick={() => changeImage(index - 1)}><ChevronLeft className="size-6 max-[600px]:size-5" /></button>
                            <button type="button" aria-label={gallery ? "下一个素材" : "下一张图片"} title={gallery ? "下一个 (→)" : "下一张 (→)"} disabled={index === items.length - 1} className="pointer-events-auto grid size-[58px] shrink-0 place-items-center rounded-full border transition-colors hover:brightness-125 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-default disabled:opacity-25 max-[600px]:size-8" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }} onClick={() => changeImage(index + 1)}><ChevronRight className="size-6 max-[600px]:size-5" /></button>
                        </nav> : null}
                    </div>
                  </div>
                  {renderDetails ? <aside data-media-preview-details aria-label="素材信息" className="canvas-media-viewer-details" style={{ borderColor: theme.node.stroke }}>{renderDetails(activeItem, index)}</aside> : null}
                </div>
                {activeKind === "video" ? <div data-media-preview-timeline className="flex h-11 shrink-0 items-center gap-3 border-t px-5 max-[480px]:gap-2 max-[480px]:px-3" style={{ borderColor: theme.node.stroke, color: theme.toolbar.item }}>
                    <button type="button" aria-label={playing ? "暂停预览视频" : "播放预览视频"} title={playing ? "暂停 (空格)" : "播放 (空格)"} className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" disabled={!natural} onClick={() => void togglePlay()}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
                    <span className="shrink-0 text-xs tabular-nums max-[480px]:text-[10px]">{timeLabel(time)} / {timeLabel(duration)}</span>
                    <input type="range" aria-label="预览视频进度" className="min-w-0 flex-1 accent-[#7593ff]" min={0} max={duration || 1} step={0.01} value={Math.min(time, duration || 1)} disabled={!duration} onChange={(event) => { const nextTime = Number(event.target.value); setTime(nextTime); if (videoRef.current) videoRef.current.currentTime = nextTime; }} />
                    <button type="button" aria-label={muted ? "取消预览静音" : "静音预览视频"} className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; }}>{muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</button>
                </div> : null}
                <footer className="flex h-[60px] shrink-0 items-center gap-3 border-t px-7 max-[480px]:h-12 max-[480px]:gap-2 max-[480px]:px-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex min-w-0 items-center gap-6 text-[13px] max-[480px]:gap-2 max-[480px]:text-[11px]">
                        <span data-image-preview-position data-media-preview-position aria-live="polite" aria-atomic="true" className="shrink-0 tabular-nums">{index + 1} / {items.length}</span>
                        <span className="h-5 border-l" style={{ borderColor: theme.node.stroke }} />
                        <span className="truncate tabular-nums" style={{ color: theme.node.muted }} data-media-preview-dimensions>{natural ? `${natural.width} × ${natural.height}` : activeKind === "text" ? "文本" : activeKind === "audio" && duration ? timeLabel(duration) : !activeSrc || failedSrc === activeSrc ? "加载失败" : "加载中…"}</span>
                        <span className="sr-only" data-image-preview-scale data-media-preview-scale>{natural ? `${Math.round(scale * 100)}%` : "—"}</span>
                    </div>
                </footer>
                {notice ? <div role="alert" className="absolute bottom-16 left-24 right-8 rounded-lg border px-3 py-2 text-xs max-[480px]:left-16 max-[480px]:right-3" style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}>{notice}</div> : null}
            </div>
        </Modal>
        {minimized ? createPortal(<div data-media-viewer-minimized data-canvas-shortcuts-ignore data-canvas-no-zoom className="fixed bottom-4 left-1/2 z-[1001] flex w-[360px] max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-xl border px-4 py-3 shadow-lg" style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }} onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
            <button autoFocus type="button" aria-label={`恢复${mediaLabel}查看器`} className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm" onClick={() => setMinimized(false)}>{activeKind === "image" ? <ImageIcon className="size-4 shrink-0" /> : activeKind === "video" ? <Video className="size-4 shrink-0" /> : activeKind === "audio" ? <Music className="size-4 shrink-0" /> : <FileText className="size-4 shrink-0" />}<span className="truncate">{activeTitle || `${mediaLabel}查看器`}</span><span className="shrink-0 text-xs" style={{ color: theme.node.muted }}>{index + 1} / {items.length}</span></button>
            <button type="button" aria-label={`关闭${mediaLabel}查看器`} className="grid size-7 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" onClick={() => void closeViewer()}><X className="size-4" /></button>
        </div>, document.body) : null}
    </>;
}

function timeLabel(seconds: number) {
    const value = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
