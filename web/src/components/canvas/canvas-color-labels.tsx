import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Popover } from "antd";
import { FileText, Image as ImageIcon, Music2, Settings2, Square, Type, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { labelColors, labelNames } from "@/components/canvas/canvas-node-appearance";
import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { previewUrlFor, subscribeImagePreviews, getImagePreviewRevision } from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const nodeIcons: Record<string, typeof Square> = {
    image: ImageIcon, video: Video, audio: Music2, text: Type, config: Settings2, group: Square,
};

export function CanvasColorLabels({ nodes, onFocusNode }: { nodes: CanvasNodeData[]; onFocusNode: (nodeId: string) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const [activeColor, setActiveColor] = useState<string | null>(null);
    const triggerRef = useRef<HTMLDivElement>(null);
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const groups = useMemo(() => {
        const grouped = new Map<string, CanvasNodeData[]>();
        for (const node of nodes) {
            const color = node.metadata?.labelColor;
            if (!color) continue;
            const group = grouped.get(color);
            if (group) group.push(node);
            else grouped.set(color, [node]);
        }
        return [...grouped].sort(([a], [b]) => labelColors.indexOf(a) - labelColors.indexOf(b));
    }, [nodes]);

    useEffect(() => {
        if (activeColor && !groups.some(([color]) => color === activeColor)) setActiveColor(null);
    }, [activeColor, groups]);

    useEffect(() => {
        if (!activeColor) return;
        const close = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            setActiveColor(null);
        };
        window.addEventListener("keydown", close, true);
        const closeOutside = (event: PointerEvent) => {
            const target = event.target as Element;
            if (!triggerRef.current?.contains(target) && !target.closest("[data-canvas-color-index-popup]")) setActiveColor(null);
        };
        window.addEventListener("pointerdown", closeOutside, true);
        return () => {
            window.removeEventListener("keydown", close, true);
            window.removeEventListener("pointerdown", closeOutside, true);
        };
    }, [activeColor]);

    if (!groups.length) return null;

    return (
        <div
            ref={triggerRef}
            className="flex shrink-0 items-center gap-0.5 rounded-xl border p-1"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            data-canvas-no-zoom
            aria-label="颜色标签导航"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
        >
            {groups.map(([color, items]) => {
                const name = labelNames[labelColors.indexOf(color)] || color;
                return (
                    <Popover
                        key={color}
                        trigger="click"
                        placement="bottomRight"
                        arrow={false}
                        open={activeColor === color}
                        onOpenChange={(open) => setActiveColor((current) => open ? color : current === color ? null : current)}
                        styles={{ container: { padding: 0, background: theme.node.panel, color: theme.node.text, border: `1px solid ${theme.toolbar.border}`, borderRadius: 14 } }}
                        content={
                            <section aria-label={`${name}节点`} className="w-[300px] max-w-[calc(100vw-32px)] p-2" data-canvas-no-zoom data-canvas-color-index-popup onWheel={(event) => event.stopPropagation()}>
                                <div className="flex items-center gap-2 px-2 pb-2 pt-1">
                                    <span className="size-2 rounded-full" style={{ background: color }} />
                                    <span className="text-sm font-semibold">{name}</span>
                                    <span className="text-xs tabular-nums opacity-50">{items.length}</span>
                                    <button type="button" aria-label="关闭颜色节点列表" className="ml-auto grid size-7 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" onClick={() => setActiveColor(null)}><X className="size-3.5" /></button>
                                </div>
                                <div className="thin-scrollbar max-h-[min(420px,60vh)] overflow-y-auto">
                                    {items.map((node) => {
                                        const Icon = nodeIcons[node.type] || FileText;
                                        const kind = getNodeDefinition(node.type)?.title || t(`canvas.sidePanel.filter.${node.type}`, { defaultValue: node.type });
                                        const title = node.title || kind;
                                        const image = node.type === CanvasNodeType.Image ? previewUrlFor(node.metadata?.storageKey) || node.metadata?.content : undefined;
                                        return (
                                            <button
                                                key={node.id}
                                                type="button"
                                                className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] dark:hover:bg-white/10"
                                                title={title}
                                                aria-label={`定位节点：${title}`}
                                                onClick={() => { onFocusNode(node.id); setActiveColor(null); }}
                                            >
                                                <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-md" style={{ background: theme.toolbar.itemHover }}>
                                                    {image ? <img src={image} alt="" loading="lazy" className="size-full object-cover" /> : <Icon className="size-5 opacity-60" />}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm font-medium">{title}</span>
                                                    <span className="mt-0.5 block truncate text-xs opacity-50">{kind}</span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        }
                    >
                        <button type="button" aria-label={`${name}标签，${items.length}个节点`} aria-expanded={activeColor === color} title={`${name} · ${items.length}`} className="grid size-8 place-items-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/10" style={{ background: activeColor === color ? theme.toolbar.itemHover : undefined }}>
                            <span className="size-4 rounded-full" style={{ background: color }} />
                        </button>
                    </Popover>
                );
            })}
        </div>
    );
}
