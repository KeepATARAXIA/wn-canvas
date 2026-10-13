import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Keep editing controls legible at every zoom and anchored below the node.
// Limit panel size to the canvas without changing its side or alignment.
export function CanvasSafeNodePanel({ width, children }: { width: number; children: ReactNode }) {
    const anchor = useRef<HTMLSpanElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const node = anchor.current?.closest("[data-node-id]");
        const canvas = anchor.current?.closest("[data-canvas-surface]");
        const element = panel.current;
        if (!node || !canvas || !element) return;
        element.dataset.panelNodeId = node.getAttribute("data-node-id") || "";
        let frame = 0;
        const place = () => {
            const bounds = canvas.getBoundingClientRect(), target = node.getBoundingClientRect();
            const narrow = bounds.width <= 480;
            const left = bounds.left + (narrow ? 12 : 80), right = bounds.right - (narrow ? 12 : 16);
            const top = bounds.top + (narrow ? 132 : 76), bottom = bounds.bottom - (narrow ? 128 : 76);
            const toolbar = Array.from((canvas.parentElement || canvas).querySelectorAll<HTMLElement>("[data-canvas-node-toolbar]")).find((item) => item.dataset.toolbarNodeId === element.dataset.panelNodeId);
            const toolbarClearance = (toolbar?.getBoundingClientRect().height || 42) + 12;
            const w = Math.max(200, Math.min(width, right - left));
            element.style.width = `${w}px`;
            element.style.maxHeight = `${Math.max(120, bottom - top - toolbarClearance)}px`;
            element.style.left = `${target.left + target.width / 2 - w / 2}px`;
            element.style.top = `${target.bottom + 16}px`;
            element.style.visibility = "visible";
            // Body-portaled controls need a notice on their actual scroll ancestor,
            // after the panel has moved, for Antd, Radix and custom menus to realign.
            element.dispatchEvent(new Event("scroll"));
            window.dispatchEvent(new Event("canvas-node-panel-layout"));
        };
        const schedule = (event?: Event) => {
            // Panel scrolling moves its controls, but does not move the panel itself.
            // Ignore these notices to avoid feedback within or between safe panels.
            if (event?.type === "scroll" && event.target instanceof Element && event.target.closest("[data-canvas-safe-panel]")) return;
            cancelAnimationFrame(frame); frame = requestAnimationFrame(place);
        };
        const observer = new ResizeObserver(() => schedule());
        observer.observe(canvas); observer.observe(element);
        window.addEventListener("scroll", schedule, true);
        window.addEventListener("resize", schedule);
        window.addEventListener("canvas-node-toolbar-size", schedule);
        place();
        return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule); window.removeEventListener("canvas-node-toolbar-size", schedule); window.dispatchEvent(new Event("canvas-node-panel-layout")); };
    });
    return <><span ref={anchor} />{createPortal(<div ref={panel} data-canvas-safe-panel data-canvas-no-zoom data-canvas-shortcuts-ignore className="fixed z-[65] overflow-y-auto overscroll-contain rounded-[22px] shadow-lg" style={{ width, visibility: "hidden" }} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>{children}</div>, document.body)}</>;
}
