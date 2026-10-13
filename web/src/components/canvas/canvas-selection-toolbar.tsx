import { useLayoutEffect, useRef, type ReactNode } from "react";
import { AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, Columns3, Group, Rows3, Trash2, Ungroup } from "lucide-react";
import { Dropdown, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import type { CanvasNodeAlignment } from "@/lib/canvas/canvas-node-alignment";
import { positionCanvasNodeToolbar } from "@/components/canvas/canvas-node-hover-toolbar";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

const SELECTION_PAD = 14;

export function CanvasSelectionToolbar({
    nodes,
    viewport,
    showToolbar,
    canGroup,
    canUngroup,
    onGroup,
    onUngroup,
    onAlign,
    onDelete,
}: {
    nodes: CanvasNodeData[];
    viewport: ViewportTransform;
    showToolbar: boolean;
    canGroup: boolean;
    canUngroup: boolean;
    onGroup: () => void;
    onUngroup: () => void;
    onAlign: (alignment: CanvasNodeAlignment) => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const toolbarRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const element = toolbarRef.current, parent = element?.parentElement;
        if (!element || !parent) return;
        const place = () => {
            const bounds = nodeBounds(nodes);
            element.style.maxWidth = `${Math.max(160, parent.clientWidth - 96)}px`;
            const box = element.getBoundingClientRect();
            const position = positionCanvasNodeToolbar({
                canvasWidth: parent.clientWidth, canvasHeight: parent.clientHeight, toolbarWidth: box.width, toolbarHeight: box.height,
                nodeCenterX: viewport.x + (bounds.left + bounds.right) / 2 * viewport.k,
                nodeTop: viewport.y + bounds.top * viewport.k, scale: viewport.k,
            });
            element.style.left = `${position.left}px`;
            element.style.top = `${Math.max(position.top, parent.clientWidth <= 480 ? 130 + box.height : 0)}px`;
        };
        const observer = new ResizeObserver(place);
        observer.observe(parent); observer.observe(element); place();
        return () => observer.disconnect();
    }, [nodes, viewport, showToolbar, canGroup, canUngroup]);
    if (nodes.length < 2) return null;

    const bounds = nodeBounds(nodes);
    const left = viewport.x + bounds.left * viewport.k - SELECTION_PAD;
    const top = viewport.y + bounds.top * viewport.k - SELECTION_PAD;
    const width = (bounds.right - bounds.left) * viewport.k + SELECTION_PAD * 2;
    const height = (bounds.bottom - bounds.top) * viewport.k + SELECTION_PAD * 2;
    const showActions = showToolbar;

    return (
        <>
            <svg className="pointer-events-none absolute z-[65] overflow-visible" style={{ left, top, width, height }}>
                <rect
                    x={1}
                    y={1}
                    width={Math.max(width - 2, 0)}
                    height={Math.max(height - 2, 0)}
                    rx={16}
                    ry={16}
                    fill={theme.canvas.selectionFill}
                    stroke={theme.canvas.selectionStroke}
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                    strokeDasharray="7 5"
                    strokeLinecap="round"
                />
            </svg>
            {showActions ? (
                <div
                    ref={toolbarRef}
                    data-canvas-selection-toolbar
                    data-canvas-no-zoom
                    data-canvas-shortcuts-ignore
                    className="absolute z-[70] flex min-h-12 w-max -translate-x-1/2 -translate-y-full flex-wrap items-center justify-center rounded-[18px] border text-sm shadow-lg"
                    style={{ left: left + width / 2, top: top - 8, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    {canGroup ? <SelectionAction title={t("canvas.nodeToolbar.groupTitle")} label={t("canvas.nodeToolbar.group")} icon={<Group className="size-4" />} onClick={onGroup} /> : null}
                    {canUngroup ? <SelectionAction title={t("canvas.nodeToolbar.ungroupTitle")} label={t("canvas.nodeToolbar.ungroup")} icon={<Ungroup className="size-4" />} onClick={onUngroup} /> : null}
                    <Dropdown trigger={["click"]} placement="bottom" popupRender={(menu) => <div data-canvas-shortcuts-ignore>{menu}</div>} menu={{
                        onClick: ({ key }) => onAlign(key as CanvasNodeAlignment),
                        items: [
                            { key: "left", label: t("canvas.toolbar.alignLeft"), icon: <AlignHorizontalJustifyStart className="size-4" /> },
                            { key: "center-horizontal", label: t("canvas.toolbar.alignHorizontalCenter"), icon: <AlignHorizontalJustifyCenter className="size-4" /> },
                            { key: "right", label: t("canvas.toolbar.alignRight"), icon: <AlignHorizontalJustifyEnd className="size-4" /> },
                            { key: "top", label: t("canvas.toolbar.alignTop"), icon: <AlignVerticalJustifyStart className="size-4" /> },
                            { key: "center-vertical", label: t("canvas.toolbar.alignVerticalCenter"), icon: <AlignVerticalJustifyCenter className="size-4" /> },
                            { key: "bottom", label: t("canvas.toolbar.alignBottom"), icon: <AlignVerticalJustifyEnd className="size-4" /> },
                            { type: "divider" },
                            { key: "distribute-horizontal", label: t("canvas.toolbar.distributeHorizontal"), icon: <Columns3 className="size-4" />, disabled: nodes.length < 3 },
                            { key: "distribute-vertical", label: t("canvas.toolbar.distributeVertical"), icon: <Rows3 className="size-4" />, disabled: nodes.length < 3 },
                        ],
                    }}>
                        <button type="button" aria-label={t("canvas.toolbar.align")} className="group flex h-12 items-center whitespace-nowrap px-1.5">
                            <span className="flex h-9 items-center gap-2 rounded-lg px-2.5 transition group-hover:bg-black/5 dark:group-hover:bg-white/10"><AlignHorizontalJustifyCenter className="size-4" />{t("canvas.toolbar.align")}</span>
                        </button>
                    </Dropdown>
                    <SelectionAction title={t("canvas.deleteSelected")} label={t("canvas.controls.delete")} icon={<Trash2 className="size-4" />} onClick={onDelete} danger />
                </div>
            ) : null}
        </>
    );
}

function SelectionAction({ title, label, icon, onClick, danger = false }: { title: string; label: string; icon: ReactNode; onClick: () => void; danger?: boolean }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} color="#ffffff" styles={{ container: { color: "#242529" }, root: { boxShadow: "0 8px 24px rgba(15,23,42,.16)", fontSize: 13, fontWeight: 500 } }}>
            <button type="button" className="group relative flex h-12 items-center whitespace-nowrap px-1.5" style={danger ? { color: "#ef4444" } : undefined} onClick={onClick} aria-label={title}>
                <span className="flex h-9 items-center gap-2 rounded-lg px-2.5 transition group-hover:bg-black/5 dark:group-hover:bg-white/10">
                    {icon}
                    <span>{label}</span>
                </span>
            </button>
        </Tooltip>
    );
}
