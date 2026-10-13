import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

import { reasoningEffortLabel, TextSettingsPanel } from "@/components/text-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig, ReasoningEffort } from "@/stores/use-config-store";

type CanvasTextSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
    count?: number;
    onCountChange?: (count: number) => void;
    buttonClassName?: string;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
    section?: "reasoning" | "count";
};

export function CanvasTextSettingsPopover({ config, onConfigChange, count = 1, onCountChange, buttonClassName, placement = "topLeft", section = "reasoning" }: CanvasTextSettingsPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node) || buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
        };
        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [open]);

    const panel = open && buttonRect ? <TextSettingsPortal buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme} config={config} count={count} section={section} onConfigChange={(key, value) => { onConfigChange(key, value); setOpen(false); }} onCountChange={onCountChange} /> : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <Button size="small" type="text" aria-label={section === "count" ? "文本生成数量" : "文本推理强度"} aria-expanded={open} className={buttonClassName || "!h-8 !max-w-[170px] !justify-start !gap-1.5 !rounded-lg !px-2 !text-xs"} style={{ color: theme.node.text }} onClick={() => setOpen((current) => !current)}>
                    <span className="truncate">{section === "count" ? t("canvas.controls.generations", { count }) : `${t("canvas.controls.reasoning")} · ${reasoningEffortLabel(config.reasoningEffort)}`}</span>
                    <ChevronDown className="size-3 shrink-0 opacity-60" />
                </Button>
            </span>
            {panel}
        </>
    );
}

function TextSettingsPortal({ buttonRect, panelRef, placement, theme, config, count, onConfigChange, onCountChange, section }: {
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: CanvasTextSettingsPopoverProps["placement"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    config: AiConfig;
    count?: number;
    onConfigChange: CanvasTextSettingsPopoverProps["onConfigChange"];
    onCountChange?: (count: number) => void;
    section: "reasoning" | "count";
}) {
    const { t } = useTranslation();
    const width = Math.min(340, window.innerWidth - 24);
    const gap = 8;
    const margin = 12;
    const alignRight = placement?.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    const left = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;
    const topPlacement = placement?.startsWith("top");
    const style = {
        position: "fixed",
        zIndex: 1200,
        width,
        left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
        ...(topPlacement ? { bottom: window.innerHeight - buttonRect.top + gap } : { top: buttonRect.bottom + gap }),
        background: theme.toolbar.panel,
        borderRadius: 18,
        boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)",
        padding: 16,
        color: theme.node.text,
    } as const;

    return createPortal(
        <div ref={panelRef} data-canvas-no-zoom data-canvas-shortcuts-ignore className="canvas-text-settings-popover" style={style} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            {section === "reasoning" ? <TextSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} compact /> : null}
            {section === "count" && onCountChange ? (
                <div className="space-y-2.5">
                    <div className="text-sm font-medium" style={{ color: theme.node.muted }}>{t("settingsPanels.text.count")}</div>
                    <div className="grid grid-cols-4 gap-1 rounded-xl p-1" style={{ background: theme.node.fill }}>
                        {[1, 2, 3, 4].map((value) => <button key={value} type="button" aria-pressed={count === value} className="h-9 rounded-lg text-xs font-medium" style={{ background: count === value ? theme.toolbar.activeBg : "transparent" }} onClick={() => onCountChange(value)}>{value}</button>)}
                    </div>
                    <label className="flex items-center justify-between gap-3 text-xs">
                        自定义数量（1–15）
                        <input aria-label="自定义文本生成数量" type="number" min={1} max={15} key={count} defaultValue={count} className="h-9 w-20 rounded-lg border border-current/15 bg-transparent px-2 text-center outline-none" onBlur={(event) => { const value = Math.max(1, Math.min(15, Math.floor(Number(event.currentTarget.value) || 1))); event.currentTarget.value = String(value); onCountChange(value); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
                    </label>
                </div>
            ) : null}
        </div>,
        document.body,
    );
}
