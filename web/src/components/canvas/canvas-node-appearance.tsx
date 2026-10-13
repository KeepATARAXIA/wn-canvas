import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Popover } from "antd";
import { Download, Maximize2, Tag, X } from "lucide-react";
import { saveAs } from "file-saver";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { readTextNodeContent, textContentHtml } from "@/lib/canvas/text-rich-content";
import "./canvas-text-editor.css";

export const labelColors = ["#06b6d4", "#6366f1", "#a855f7", "#f97316", "#eab308"];
export const labelNames = ["青色", "蓝色", "紫色", "橙色", "黄色"];
const backgroundColors = ["#242424", "#f1f3f5", "#e2f0ee", "#e7eafd", "#f4e7fa", "#fff0db"];
const backgroundNames = ["深灰", "浅灰", "浅青", "浅蓝", "浅紫", "浅橙"];

export function textNodeColors(node: CanvasNodeData, fallback: { fill: string; text: string }) {
    const background = node.metadata?.textBackground || (fallback === canvasThemes.light.node ? "#e8eef5" : fallback.fill);
    const hex = background.match(/^#([\da-f]{6})$/i)?.[1];
    const luminance = hex ? 0.299 * parseInt(hex.slice(0, 2), 16) + 0.587 * parseInt(hex.slice(2, 4), 16) + 0.114 * parseInt(hex.slice(4, 6), 16) : null;
    return { background, color: luminance === null ? fallback.text : luminance > 150 ? "#202329" : "#f3f4f6" };
}

export function NodeColorLabel({ node, onChange }: { node: CanvasNodeData; onChange: (patch: CanvasNodeMetadata) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        // Canvas pointer capture can suppress mousedown, which Popover uses to dismiss.
        const close = (event: PointerEvent) => {
            if (!triggerRef.current?.contains(event.target as Node) && !popupRef.current?.contains(event.target as Node)) setOpen(false);
        };
        window.addEventListener("pointerdown", close, true);
        return () => window.removeEventListener("pointerdown", close, true);
    }, [open]);
    return (
        <div ref={triggerRef} className="absolute -bottom-7 right-1 z-[66]" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <Popover trigger="click" placement="topRight" open={open} onOpenChange={setOpen} content={<div ref={popupRef}><ColorOptions colors={labelColors} names={labelNames} value={node.metadata?.labelColor} onChange={(labelColor) => { onChange({ labelColor }); setOpen(false); }} /></div>}>
                <button
                    type="button"
                    aria-label="节点颜色标签"
                    title="节点颜色标签"
                    className="grid size-6 place-items-center rounded-md transition hover:bg-black/10 dark:hover:bg-white/10"
                    style={{ color: node.metadata?.labelColor || theme.node.muted }}
                >
                    {node.metadata?.labelColor ? <span className="size-2.5 rounded-full" style={{ background: node.metadata.labelColor }} /> : <Tag className="size-3.5" />}
                </button>
            </Popover>
        </div>
    );
}

export function TextNodeActions({ node, onChange }: { node: CanvasNodeData; onChange: (patch: CanvasNodeMetadata) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [expanded, setExpanded] = useState(false);
    const { content, richText } = readTextNodeContent(node);
    const html = useMemo(() => textContentHtml(content, richText), [content, richText]);
    const colors = textNodeColors(node, theme.node);
    const download = () => saveAs(new Blob([content], { type: "text/plain;charset=utf-8" }), `${(node.title || "文本").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80)}.txt`);
    return (
        <div className="flex items-center gap-1 px-1.5" data-canvas-no-zoom>
            <Popover trigger="click" placement="bottom" content={<ColorOptions colors={backgroundColors} names={backgroundNames} value={node.metadata?.textBackground} onChange={(textBackground) => onChange({ textBackground })} />}>
                <button type="button" className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-xs hover:bg-black/5 dark:hover:bg-white/10" aria-label="文本背景色">
                    <span className="size-4 rounded border border-current/20" style={{ background: colors.background }} />
                    背景色
                </button>
            </Popover>
            <span className="mx-1 h-4 border-l opacity-20" />
            <button type="button" className="grid size-9 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10" aria-label="全屏查看文本" title="全屏查看文本" onClick={() => setExpanded(true)}>
                <Maximize2 className="size-4" />
            </button>
            <button type="button" className="grid size-9 place-items-center rounded-lg hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10" aria-label="下载文本" title="下载文本" disabled={!content} onClick={download}>
                <Download className="size-4" />
            </button>
            <Modal title={node.title || "文本"} open={expanded} onCancel={() => setExpanded(false)} footer={null} width="calc(100vw - 48px)" centered styles={{ body: { height: "calc(100dvh - 160px)" } }}>
                <div
                    data-canvas-shortcuts-ignore
                    data-canvas-no-zoom
                    className="canvas-rich-text thin-scrollbar h-full select-text overflow-auto rounded-xl p-8 text-base leading-8"
                    style={colors}
                    onWheel={(event) => event.stopPropagation()}
                    dangerouslySetInnerHTML={{ __html: content ? html : "暂无文本内容" }}
                />
            </Modal>
        </div>
    );
}

function ColorOptions({ colors, names, value, onChange }: { colors: string[]; names: string[]; value?: string; onChange: (value: string | undefined) => void }) {
    return (
        <div className="flex items-center gap-2" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" className="grid size-7 place-items-center rounded-full border border-current/20" title="恢复默认颜色" aria-label="恢复默认颜色" onClick={() => onChange(undefined)}>
                <X className="size-3.5" />
            </button>
            {colors.map((color, index) => (
                <button
                    type="button"
                    key={color}
                    aria-label={names[index]}
                    aria-pressed={value === color}
                    title={names[index]}
                    onClick={() => onChange(color)}
                    className="size-6 rounded-full border-2 transition hover:scale-110"
                    style={{ background: color, borderColor: value === color ? "currentColor" : "transparent", outline: value === color ? "2px solid #8a8a8a" : undefined, outlineOffset: 2 }}
                />
            ))}
        </div>
    );
}
