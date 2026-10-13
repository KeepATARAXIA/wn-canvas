import { getStateStorageStatus, subscribeStateStorage } from "@/lib/localforage-storage";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bot, Settings2, Download, Eraser, ExternalLink, Home, Images, Layers3, Menu, PanelLeftClose, PanelLeftOpen, Plus, Redo2, Trash2, Undo2, Upload, Video } from "lucide-react";
import { Button, Dropdown, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { canvasShortcutModifier } from "@/components/canvas/canvas-shortcuts-dialog";
import { CanvasColorLabels } from "@/components/canvas/canvas-color-labels";
import { CanvasResourceMonitor } from "@/components/canvas/canvas-resource-monitor";
import type { CanvasNodeData } from "@/types/canvas";
import { generationQueueDisplay, type GenerationQueueItem } from "@/lib/canvas/generation-queue";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useConfigStore } from "@/stores/use-config-store";
import "./canvas-generation-queue-status.css";

export function CanvasTopBar({
    nodes,
    generationQueue,
    onFocusNode,
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onHome,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onExportProject,
    onImportImage,
    onUndo,
    onRedo,
    onClear,
    agentOpen,
    compactAgentStatus,
    onToggleAgent,
}: {
    nodes: CanvasNodeData[];
    generationQueue: GenerationQueueItem[];
    onFocusNode: (nodeId: string) => void;
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onHome: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onExportProject: () => void;
    onImportImage: () => void;
    onOpenPlugins: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onClear: () => void;
    agentOpen: boolean;
    compactAgentStatus: { connected: boolean; enabled: boolean; activity: string };
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const { t } = useTranslation();
    const theme = canvasThemes[colorTheme];
    const modifier = canvasShortcutModifier();
    const storage = useSyncExternalStore(subscribeStateStorage, getStateStorageStatus);
    const isSaving = storage.pending > 0;
    const [showSaving, setShowSaving] = useState(false);
    const savedLabel = storage.readError || storage.writeError ? "保存失败，请导出备份" : isSaving && showSaving ? "正在保存…" : "自动保存到此浏览器";
    useEffect(() => {
        if (!isSaving) {
            setShowSaving(false);
            return;
        }
        const timer = setTimeout(() => setShowSaving(true), 2000);
        return () => clearTimeout(timer);
    }, [isSaving]);
    const titleRef = useRef<HTMLDivElement>(null);
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const toggleSidePanel = useCanvasSidePanelStore((state) => state.togglePanel);
    const openQueue = useCanvasSidePanelStore((state) => state.openQueue);
    const running = generationQueue.find((item) => item.status === "running");
    const queuedCount = generationQueue.filter((item) => item.status === "queued").length;
    const queueProgress = running ? generationQueueDisplay(running, nodes) : undefined;
    const queuePercent = queueProgress?.percent;

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <div data-canvas-topbar className="absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between gap-2 border-b px-3" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2">
                    <Tooltip title={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}>
                        <button
                            type="button"
                            onClick={toggleSidePanel}
                            aria-label={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}
                            className="grid size-7 shrink-0 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10"
                            style={{ color: theme.node.text }}
                        >
                            {sidePanelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                        </button>
                    </Tooltip>
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "home", icon: <Home className="size-4" />, label: t("canvas.home"), onClick: onHome },
                                { key: "projects", icon: <Images className="size-4" />, label: t("canvas.projects"), onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: t("canvas.create"), onClick: onCreateProject },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: t("canvas.deleteCurrent"), onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: t("canvas.importAsset"), onClick: onImportImage },
                                { key: "export", icon: <Download className="size-4" />, label: t("canvas.exportCurrent"), onClick: onExportProject },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text={t("canvas.undo")} shortcut={`${modifier} Z`} />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text={t("canvas.redo")} shortcut={`${modifier} Shift Z`} />, onClick: onRedo },
                                { key: "clear", danger: true, icon: <Eraser className="size-4" />, label: t("canvas.toolbar.clear"), disabled: nodes.length === 0, onClick: onClear },
                                { type: "divider" },
                                { key: "comfy", icon: <ExternalLink className="size-4" />, label: <a href="http://localhost:8188/" target="_blank" rel="noopener noreferrer">{t("canvas.openComfyUi")}</a> },
                            ],
                        }}
                    >
                        <button type="button" className="grid size-7 shrink-0 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label={t("canvas.openMenu")}>
                            <Menu className="size-4" />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="hidden min-w-0 flex-1 flex-col items-start overflow-hidden min-[480px]:flex">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="w-full max-w-[280px] bg-transparent p-0 text-left text-sm font-semibold tracking-normal outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="max-w-full truncate border-b border-dashed border-transparent text-left text-sm font-semibold tracking-normal transition hover:border-current"
                                onDoubleClick={onStartTitleEditing}
                                title={t("canvas.renameHint")}
                            >
                                {title}
                            </button>
                        )}
                        <span role="status" title="作品保存在当前浏览器；换电脑或清理浏览器前请导出项目备份。" className="max-w-full truncate text-[10px]" style={{ color: storage.readError || storage.writeError ? "#dc2626" : theme.node.muted }}>{savedLabel}</span>
                    </div>
                </div>

                <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
                    <CanvasResourceMonitor nodes={nodes} generationQueue={generationQueue} />
                    <CanvasColorLabels nodes={nodes} onFocusNode={onFocusNode} />
                    <AnimatedThemeToggler theme={colorTheme} onThemeChange={setTheme} className="grid size-8 shrink-0 place-items-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/10 [&_svg]:size-4" style={{ color: theme.node.text }} aria-label={t(colorTheme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} title={t(colorTheme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} />
                    <Button type="text" className="!px-2" aria-label={t("navigation.config")} title={t("navigation.config")} onClick={() => openConfigDialog(false, "status")} icon={<Settings2 className="size-4" />}><span className="hidden min-[640px]:inline">{t("navigation.config")}</span></Button>
                    <Button
                        type="text"
                        className="!h-10 !rounded-xl !px-2 !font-medium min-[480px]:!px-3"
                        style={{ background: agentOpen ? theme.toolbar.activeBg : theme.toolbar.panel, color: theme.node.text, border: `1px solid ${theme.toolbar.border}` }}
                        icon={<Bot className="size-4" />}
                        aria-label="打开或收起 Agent"
                        aria-pressed={agentOpen}
                        title={compactAgentStatus.connected ? "Agent 已连接" : compactAgentStatus.enabled ? "Agent 连接中" : "Agent 未连接"}
                        onClick={onToggleAgent}
                    >
                        <span>Agent</span>
                        <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: compactAgentStatus.connected ? "#22c55e" : compactAgentStatus.enabled ? "#f59e0b" : theme.node.faint }} />
                    </Button>
                </div>
            </div>
            {nodes.length === 0 ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-16 top-20 z-10 flex items-center justify-center pl-16 pr-5" data-canvas-empty-state>
                    <section className="max-w-sm text-center" style={{ color: theme.node.text }}>
                        <h2 className="text-xl font-semibold tracking-tight">从一个想法开始</h2>
                        <p className="mt-3 text-sm leading-6" style={{ color: theme.node.muted }}>拖入图片、视频或音频，开始你的创作</p>
                        <div className="pointer-events-auto mt-6 flex flex-wrap justify-center gap-2" data-canvas-no-zoom data-canvas-shortcuts-ignore>
                            <Button type="primary" size="large" icon={<Upload className="size-4" />} onClick={onImportImage}>添加素材</Button>
                            <Button size="large" icon={<Bot className="size-4" />} onClick={() => {
                                const agent = useAgentStore.getState();
                                agent.setAgentState({ activeTab: agent.connected ? "chat" : "setup" });
                                agent.openPanel();
                            }}>让 Agent 创建</Button>
                        </div>
                        <p className="text-xs" style={{ color: theme.node.muted, marginTop: 16 }}>也可以双击空白处添加节点</p>
                    </section>
                </div>
            ) : null}
            {generationQueue.length > 0 ? (
                <button
                    type="button"
                    data-generation-queue-status
                    data-canvas-no-zoom
                    data-canvas-shortcuts-ignore
                    onClick={openQueue}
                    aria-label={`打开生成队列：${running ? "1 个生成中" : "准备生成"}，${queuedCount} 个等待${queuePercent != null ? `，进度 ${Math.round(queuePercent)}%` : ""}`}
                    title={queueProgress ? `${queueProgress.stage} · 点击查看生成队列` : "打开生成队列"}
                    className="canvas-generation-queue-status absolute left-1/2 top-[76px] z-[70] flex min-w-[200px] max-w-[calc(100%-24px)] -translate-x-1/2 flex-col gap-2 overflow-hidden rounded-2xl border px-3.5 py-2.5 text-xs font-semibold transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    style={{ background: "linear-gradient(110deg, #1e3a8a 0%, #1e40af 45%, #1d4ed8 100%)", borderColor: "#60a5fa", color: "#ffffff", boxShadow: "0 4px 16px rgba(37, 99, 235, .24)" }}
                >
                    <span className="relative z-10 flex w-full items-center gap-2">
                        {(running || generationQueue[0]).mode === "video" ? <Video className="size-4 shrink-0" /> : <Images className="size-4 shrink-0" />}
                        <span className="whitespace-nowrap">{running ? `${running.mode === "video" ? "视频" : "图片"}生成中` : "准备中"}</span>
                        {queuedCount > 0 ? <span className="flex items-center gap-1 border-l border-white/30 pl-2"><Layers3 className="size-3.5" /><span className="whitespace-nowrap tabular-nums">{queuedCount} 等待</span></span> : null}
                        <span className="ml-auto whitespace-nowrap tabular-nums">{queuePercent != null ? `${Math.round(queuePercent)}%` : running ? "处理中" : "等待中"}</span>
                        <span aria-hidden="true" className="text-sm opacity-70">›</span>
                    </span>
                    <span role="progressbar" aria-label="当前生成任务进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={queuePercent} aria-valuetext={queuePercent != null ? `${Math.round(queuePercent)}%` : queueProgress?.stage || "等待开始"} className="relative z-10 block h-1.5 w-full overflow-hidden rounded-full bg-white/25">
                        <span className={`block h-full rounded-full bg-white/95 ${queuePercent == null ? "motion-safe:animate-pulse" : "transition-[width] duration-300 motion-reduce:transition-none"}`} style={{ width: queuePercent != null ? `${queuePercent}%` : "35%" }} />
                    </span>
                </button>
            ) : null}
        </>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}
