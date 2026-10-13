import { Focus, Map, Share2 } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { Dropdown, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasZoomControlsProps = {
    scale: number;
    onScaleChange: (scale: number) => void;
    onReset: () => void;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
    showConnections: boolean;
    onToggleConnections: () => void;
};

export function CanvasZoomControls({ scale, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap, showConnections, onToggleConnections }: CanvasZoomControlsProps) {
    const [zoomOpen, setZoomOpen] = useState(false);
    const { t } = useTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const dockStyle = {
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.toolbar.item,
        "--dock-hover": theme.toolbar.itemHover,
    } as CSSProperties;
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const buttonClass = "grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-[var(--dock-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400";
    const connectionsLabel = showConnections ? "隐藏连线" : "显示连线";

    return (
        <div className="absolute bottom-3 left-3 z-50" data-canvas-no-zoom data-canvas-shortcuts-ignore onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") setZoomOpen(false); }} onKeyUp={(event) => event.stopPropagation()}>
            <div className="flex h-9 w-32 items-center gap-1 rounded-[10px] border px-1" style={dockStyle} role="group" aria-label="画布视图工具栏">
                <Tooltip title={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}>
                    <button
                        type="button"
                        className={buttonClass}
                        style={isMiniMapOpen ? activeStyle : undefined}
                        onClick={onToggleMiniMap}
                        aria-pressed={isMiniMapOpen}
                        aria-label={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}
                    ><Map className="size-3.5" /></button>
                </Tooltip>
                <Tooltip title={connectionsLabel}>
                    <button type="button" className={buttonClass} style={showConnections ? activeStyle : undefined} onClick={onToggleConnections} aria-pressed={showConnections} aria-label={connectionsLabel}>
                        <Share2 className="size-3.5 rotate-180" />
                    </button>
                </Tooltip>
                <div className="h-4 w-px shrink-0" style={{ background: theme.toolbar.border }} />
                <Dropdown
                    trigger={["click"]}
                    placement="topLeft"
                    open={zoomOpen}
                    onOpenChange={setZoomOpen}
                    menu={{
                        selectable: true,
                        selectedKeys: [String(scale * 100)],
                        items: [
                            ...[25, 50, 75, 100, 150, 200, 500].map((percent) => ({ key: String(percent), label: `${percent}%` })),
                            { type: "divider" },
                            { key: "reset", icon: <Focus className="size-3.5" />, label: t("canvas.resetView") },
                        ],
                        onClick: ({ key }) => {
                            if (key === "reset") onReset();
                            else onScaleChange(Number(key) / 100);
                            setZoomOpen(false);
                        },
                    }}
                    popupRender={(menu) => (
                        <div data-canvas-no-zoom data-canvas-shortcuts-ignore onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") setZoomOpen(false); }} onKeyUp={(event) => event.stopPropagation()}>
                            <div className="w-44 rounded-xl border p-1 shadow-lg" style={dockStyle}>
                                <div className="flex items-center gap-2 px-2 py-2">
                                    <input type="range" min="5" max="500" step="1" value={Math.round(scale * 100)} className="min-w-0 flex-1 accent-sky-400" onChange={(event) => onScaleChange(Number(event.target.value) / 100)} aria-label={t("canvas.zoom")} />
                                    <span className="w-9 text-right text-[11px] tabular-nums">{Math.round(scale * 100)}%</span>
                                </div>
                                {menu}
                            </div>
                        </div>
                    )}
                >
                    <button
                        type="button"
                        className="h-7 min-w-0 flex-1 cursor-pointer rounded-md text-[11px] tabular-nums transition-colors hover:bg-[var(--dock-hover)] focus-visible:outline-2 focus-visible:outline-sky-400"
                        style={{ color: theme.toolbar.activeText, background: zoomOpen ? activeStyle.background : undefined }}
                        aria-label={t("canvas.zoom")}
                        aria-haspopup="menu"
                        aria-expanded={zoomOpen}
                    >{Math.round(scale * 100)}%</button>
                </Dropdown>
            </div>
        </div>
    );
}
