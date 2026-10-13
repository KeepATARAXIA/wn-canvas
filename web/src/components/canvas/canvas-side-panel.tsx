import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_SIDE_PANEL_MAX_WIDTH, CANVAS_SIDE_PANEL_MIN_WIDTH, CANVAS_SIDE_PANEL_MOTION_MS, useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { type CanvasNodeData } from "@/types/canvas";

import { CanvasGenerationHistory } from "./canvas-generation-history";
import { CanvasGenerationQueue } from "./canvas-generation-queue";
import type { GenerationQueueItem } from "@/lib/canvas/generation-queue";
import type { GenerationRecord } from "@/lib/canvas/generation-history";

const PANEL_MOTION_SECONDS = CANVAS_SIDE_PANEL_MOTION_MS / 1000;
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

type Props = {
    nodes: CanvasNodeData[];
    records: GenerationRecord[];
    queue: GenerationQueueItem[];
    onFocusNode: (nodeId: string) => void;
    onCancelQueue: (id: string) => void;
    onMoveQueue: (id: string, direction: -1 | 1) => void;
    onReuse: (record: GenerationRecord) => void;
};

export function CanvasSidePanel({ nodes, records, queue, onFocusNode, onCancelQueue, onMoveQueue, onReuse }: Props) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const width = useCanvasSidePanelStore((state) => state.width);
    const panelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const panelMounted = useCanvasSidePanelStore((state) => state.panelMounted);
    const panelClosing = useCanvasSidePanelStore((state) => state.panelClosing);
    const setWidth = useCanvasSidePanelStore((state) => state.setWidth);
    const section = useCanvasSidePanelStore((state) => state.section);
    const setSection = useCanvasSidePanelStore((state) => state.setSection);
    const [resizing, setResizing] = useState(false);

    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, startWidth + moveEvent.clientX - startX));
            setWidth(nextWidth);
        };
        const onUp = () => {
            localStorage.setItem("canvas-side-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    if (!panelMounted) return null;

    return (
        <motion.div
            className="relative z-[60] flex h-full shrink-0 max-[1119px]:absolute max-[1119px]:z-[75] max-[1119px]:left-0 max-[1119px]:top-16 max-[1119px]:!h-[calc(100%-64px)] max-[1119px]:shadow-xl"
            inert={!panelOpen || panelClosing}
            aria-hidden={!panelOpen || panelClosing}
            data-history-panel
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
            style={{ overflow: "clip", pointerEvents: panelClosing ? "none" : undefined }}
        >
            <motion.aside
                className="relative flex h-full shrink-0 flex-col overflow-hidden border-r"
                initial={{ x: -48 }}
                animate={{ x: panelClosing ? -28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
                style={{ width, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                data-canvas-no-zoom
            >
                <div className="flex items-center gap-5 px-4 pt-3.5">
                    <button type="button" className="border-b-2 pb-1.5 text-sm font-semibold" style={{ borderColor: section === "history" ? theme.toolbar.activeText : "transparent", opacity: section === "history" ? 1 : 0.55 }} onClick={() => setSection("history")}>历史生成记录</button>
                    <button type="button" className="border-b-2 pb-1.5 text-sm font-semibold" style={{ borderColor: section === "queue" ? theme.toolbar.activeText : "transparent", opacity: section === "queue" ? 1 : 0.55 }} onClick={() => setSection("queue")}>生成队列{queue.length ? ` ${queue.length}` : ""}</button>
                </div>
                <div className="mt-2 min-h-0 flex-1 overflow-hidden">
                    {section === "history" ? <CanvasGenerationHistory records={records} nodes={nodes} onFocusNode={onFocusNode} onReuse={onReuse} /> : <CanvasGenerationQueue items={queue} nodes={nodes} onFocusNode={onFocusNode} onCancel={onCancelQueue} onMove={onMoveQueue} />}
                </div>
                <button type="button" className="absolute inset-y-0 right-0 z-40 w-4 translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label={t("canvas.sidePanel.resize")} />
            </motion.aside>
        </motion.div>
    );
}
