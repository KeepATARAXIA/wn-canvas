import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ImageIcon, List, Music2, Settings2, Upload, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type ConnectionHandle, type Position } from "@/types/canvas";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

export type CanvasUploadKind = "image" | "video" | "audio";

export function ConnectionCreateMenu({
    pending,
    onCreate,
    onClose,
}: {
    pending: PendingConnectionCreate;
    onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio) => void;
    onClose: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    return (
        <div
            className="absolute z-[120] w-[300px] rounded-[18px] border p-3 shadow-2xl backdrop-blur"
            data-connection-create-menu
            style={{ left: pending.position.x, top: pending.position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {t("canvas.createMenu.fromNode")}
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={onClose} aria-label={t("canvas.createMenu.close")}>
                    ×
                </button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title={t("canvas.createMenu.text")} description={t("canvas.createMenu.textDescription")} onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title={t("canvas.createMenu.image")} onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title={t("canvas.createMenu.video")} onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-5" />} title={t("canvas.createMenu.audio")} onClick={() => onCreate(CanvasNodeType.Audio)} />
                <ConnectionCreateOption theme={theme} icon={<Settings2 className="size-5" />} title={t("canvas.createMenu.config")} description={t("canvas.createMenu.configDescription")} onClick={() => onCreate(CanvasNodeType.Config)} />
            </div>
        </div>
    );
}

export function ConnectionCreateOption({ theme, icon, title, description, onClick, compact = false }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; title: string; description?: string; onClick?: () => void; compact?: boolean }) {
    return (
        <button
            type="button"
            className={`flex w-full cursor-pointer items-center rounded-2xl text-left transition ${compact ? "min-h-16 gap-2 px-2 py-2" : "h-16 gap-3 px-3"}`}
            style={{ color: theme.node.text }}
            onClick={onClick}
            onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
        >
            <span className={`grid shrink-0 place-items-center rounded-xl ${compact ? "size-9" : "size-11"}`} style={{ background: theme.node.fill, color: theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className={`block font-semibold leading-5 ${compact ? "text-sm" : "text-base"}`}>{title}</span>
                {description ? (
                    <span className={`mt-1 block ${compact ? "text-xs leading-4" : "truncate text-sm"}`} style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </button>
    );
}

export function NodeCreateMenu({ position, bounds, onCreate, onUpload, onClose }: { position: Position; bounds: { width: number; height: number }; onCreate: (type: string) => void; onUpload: (kind: CanvasUploadKind) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const menuRef = useRef<HTMLDivElement>(null);
    const [availableBounds, setAvailableBounds] = useState(bounds);
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false);
    useLayoutEffect(() => {
        const parent = menuRef.current?.parentElement;
        if (!parent) return;
        const measure = () => {
            const rect = parent.getBoundingClientRect();
            setAvailableBounds({ width: Math.min(rect.width, window.innerWidth - rect.left), height: Math.min(rect.height, window.innerHeight - rect.top) });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(parent);
        window.addEventListener("resize", measure);
        return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
    }, []);
    const width = Math.min(584, Math.max(0, availableBounds.width - 24));
    const columnWidth = (width - 12) / 2;
    const below = availableBounds.height - Math.max(72, position.y) - 12;
    const openBelow = below >= Math.min(320, availableBounds.height - 96);
    const height = Math.max(0, Math.min(640, openBelow ? below : position.y - 84));
    const top = openBelow ? Math.max(72, position.y) : Math.max(72, position.y - height - 8);
    // Close automatically when clicking outside the menu.
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [onClose]);
    return (
        <div
            ref={menuRef}
            className="absolute z-[120] grid grid-cols-2 items-start gap-3"
            data-node-create-menu
            data-canvas-no-zoom
            style={{ width, left: Math.max(12, Math.min(position.x - columnWidth - 12, availableBounds.width - width - 12)), top, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") onClose(); }}
            onKeyUp={(event) => event.stopPropagation()}
        >
                <div className="flex min-h-0 flex-col overflow-hidden rounded-[18px] border p-3 shadow-xl" style={{ maxHeight: height, background: theme.node.panel, borderColor: theme.node.stroke }} data-create-menu-uploads>
                    <div className="flex h-7 shrink-0 items-center px-2 text-sm font-medium" style={{ color: theme.node.muted }}>{t("canvas.createMenu.uploadAssets")}</div>
                    <div className="thin-scrollbar min-h-0 overflow-y-auto pt-2">
                    <ConnectionCreateOption compact theme={theme} icon={<Upload className="size-5" />} title="上传节点" description="先放置节点，再选择文件" onClick={() => onCreate(CanvasNodeType.Upload)} />
                    <div className="mx-2 my-2 border-t" style={{ borderColor: theme.node.stroke }} />
                    <div className="grid gap-1">
                        <ConnectionCreateOption compact theme={theme} icon={<ImageIcon className="size-5" />} title={t("canvas.createMenu.uploadImage")} description={t("canvas.createMenu.uploadOnly")} onClick={() => onUpload("image")} />
                        <ConnectionCreateOption compact theme={theme} icon={<Video className="size-5" />} title={t("canvas.createMenu.uploadVideo")} description={t("canvas.createMenu.uploadOnly")} onClick={() => onUpload("video")} />
                        <ConnectionCreateOption compact theme={theme} icon={<Music2 className="size-5" />} title={t("canvas.createMenu.uploadAudio")} description={t("canvas.createMenu.uploadOnly")} onClick={() => onUpload("audio")} />
                    </div>
                    </div>
                </div>
                <div className="flex min-h-0 flex-col overflow-hidden rounded-[18px] border p-3 shadow-xl" style={{ maxHeight: height, background: theme.node.panel, borderColor: theme.node.stroke }} data-create-menu-nodes>
                    <div className="flex h-7 shrink-0 items-center justify-between px-2">
                        <span className="text-sm font-medium" style={{ color: theme.node.muted }}>创建节点</span>
                        <button type="button" className="grid size-7 shrink-0 place-items-center rounded-lg opacity-55 transition hover:opacity-100" onClick={onClose} aria-label={t("canvas.createMenu.close")}><X className="size-4" /></button>
                    </div>
                    <div className="thin-scrollbar grid min-h-0 gap-1 overflow-y-auto pt-2">
                        {definitions.map((def) => (
                            <ConnectionCreateOption compact key={def.type} theme={theme} icon={def.icon} title={def.title} description={def.description} onClick={() => onCreate(def.type)} />
                        ))}
                    </div>
                </div>
        </div>
    );
}
