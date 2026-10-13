import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Grid2X2, Layers, LockKeyhole, Maximize2, Ratio, SlidersHorizontal } from "lucide-react";
import { Button, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { ImageSettingsPanel, imageQualityLabel, type ImageSettingsSection } from "@/components/image-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { resolveModelWorkflowId, type AiConfig } from "@/stores/use-config-store";
import { inferMediaRatio, inferMediaScale } from "@/lib/media-size";
import { isQwenImageEditWorkflow } from "@/lib/qwen-image-mode";

type PopoverSection = Exclude<ImageSettingsSection, "all">;
type CanvasImageSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    onMissingConfig?: () => void;
    onOpenChange?: (open: boolean) => void;
    open?: boolean;
    buttonClassName?: string;
    getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
    autoAdjustOverflow?: boolean;
    section?: PopoverSection;
};

const sectionLabels: Record<PopoverSection, string> = {
    output: "图片比例、分辨率和数量", quality: "图片质量", ratio: "图片比例",
    resolution: "图片分辨率", count: "图片生成数量", background: "透明背景",
};
const sectionIcons = { output: Ratio, ratio: Ratio, resolution: Maximize2, count: Layers, quality: SlidersHorizontal, background: Grid2X2 };

export function CanvasImageSettingsControls({ config, onConfigChange, onOpenChange, placement = "topLeft", className = "" }: Pick<CanvasImageSettingsPopoverProps, "config" | "onConfigChange" | "onOpenChange" | "placement"> & { className?: string }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const workflow = resolveModelWorkflowId(config, config.model || config.imageModel);
    const isQwen = workflow.startsWith("builtin:qwen-image21-");
    const isEdit = isQwenImageEditWorkflow(workflow);
    const transparent = config.background === "transparent";
    const [openSection, setOpenSection] = useState<PopoverSection | null>(null);
    const openChangeRef = useRef(onOpenChange);
    openChangeRef.current = onOpenChange;

    // One owner reports the whole control bar, including node switches and mode changes.
    useEffect(() => { openChangeRef.current?.(openSection !== null); }, [openSection]);
    useEffect(() => () => openChangeRef.current?.(false), []);
    useEffect(() => {
        if ((isEdit && (openSection === "ratio" || openSection === "resolution")) || (isQwen && openSection === "quality")) setOpenSection(null);
    }, [isEdit, isQwen, openSection]);

    const sections: PopoverSection[] = [...(isEdit ? [] : ["ratio", "resolution"] as const), "count", ...(isQwen ? [] : ["quality"] as const)];
    return <div className={`flex min-w-0 flex-wrap items-center gap-1 ${className}`} data-canvas-shortcuts-ignore onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
        {isEdit ? <Tooltip title="编辑输出沿用第一张参考图的比例，尺寸约为 1K；当前工作流不支持指定 2K、4K 或自定义比例。" trigger={["hover", "focus"]}>
            <span tabIndex={0} aria-label="编辑尺寸：随原图，约 1K" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs" style={{ color: theme.node.muted, background: theme.node.fill }}>
                <LockKeyhole className="size-3.5" />随原图 · ≈1K
            </span>
        </Tooltip> : null}
        {sections.map((section) => <CanvasImageSettingsPopover key={section} section={section} config={config} placement={placement} open={openSection === section}
            onOpenChange={(nextOpen) => setOpenSection((current) => nextOpen ? section : current === section ? null : current)} onConfigChange={onConfigChange} />)}
        <Button size="small" type="text" aria-label="透明背景" aria-pressed={transparent} title={transparent ? "透明背景已开启" : "开启透明背景"}
            className="!h-8 shrink-0 !gap-1.5 !rounded-lg !px-2 !text-xs"
            style={{ color: transparent ? theme.toolbar.activeText : theme.node.text, background: transparent ? theme.toolbar.activeBg : theme.node.fill }}
            onClick={() => onConfigChange("background", transparent ? "auto" : "transparent")}>
            <Grid2X2 className="size-3.5 opacity-70" /><span>透明</span>
        </Button>
    </div>;
}

export function CanvasImageSettingsPopover({ config, onConfigChange, onOpenChange, open: controlledOpen, buttonClassName, placement = "topLeft", section = "output" }: CanvasImageSettingsPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [localOpen, setLocalOpen] = useState(false);
    const open = controlledOpen ?? localOpen;
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const panelId = useId();
    const openChangeRef = useRef(onOpenChange);
    openChangeRef.current = onOpenChange;
    const quality = config.quality || "auto";
    const count = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "auto";
    const ratio = inferMediaRatio(activeSize);
    const scale = inferMediaScale(activeSize);
    const qwenWorkflow = resolveModelWorkflowId(config, config.model || config.imageModel);
    const isQwen = qwenWorkflow.startsWith("builtin:qwen-image21-");
    const ratioLabel = ratio === "auto" ? isQwen ? "1:1" : "自动" : ratio;
    const scaleLabel = scale === "auto" ? isQwen ? "1K" : "自动" : scale.toUpperCase();
    const summary = section === "quality" ? imageQualityLabel(quality) : section === "ratio" ? ratioLabel : section === "resolution" ? scaleLabel : section === "count" ? t("canvas.controls.images", { count }) : section === "background" ? "透明背景" : isQwenImageEditWorkflow(qwenWorkflow) ? `随原图 · ≈1K · ${t("canvas.controls.images", { count })}` : `${ratioLabel} · ${scaleLabel} · ${t("canvas.controls.images", { count })}`;
    const Icon = sectionIcons[section];
    const updateOpen = (nextOpen: boolean) => {
        setLocalOpen(nextOpen);
        openChangeRef.current?.(nextOpen);
    };

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
        const close = () => { setLocalOpen(false); openChangeRef.current?.(false); };
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            if (document.activeElement instanceof HTMLElement && panelRef.current?.contains(document.activeElement)) document.activeElement.blur();
            close();
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            if (document.activeElement instanceof HTMLElement && panelRef.current?.contains(document.activeElement)) document.activeElement.blur();
            close();
            buttonRef.current?.querySelector("button")?.focus();
        };
        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("canvas-node-panel-layout", syncPosition);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        window.addEventListener("keydown", closeOnEscape, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("canvas-node-panel-layout", syncPosition);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
            window.removeEventListener("keydown", closeOnEscape, true);
        };
    }, [open]);

    if (section === "quality" && isQwen) return null;
    return <>
        <span ref={buttonRef} className="inline-flex min-w-0 shrink-0" data-canvas-shortcuts-ignore onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
            <Button size="small" type="text" aria-label={sectionLabels[section]} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? panelId : undefined} title={sectionLabels[section]}
                className={buttonClassName || "!h-8 !max-w-[200px] !justify-start !gap-1.5 !rounded-lg !px-2 !text-xs"} style={{ color: theme.node.text, background: theme.node.fill }} onClick={() => updateOpen(!open)}>
                <Icon className="size-3.5 shrink-0 opacity-70" /><span className="truncate">{summary}</span><ChevronDown className="size-3 shrink-0 opacity-50" />
            </Button>
        </span>
        {open && buttonRect ? <ImageSettingsPortal id={panelId} buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme} config={config} section={section}
            onConfigChange={(key, value) => {
                onConfigChange(key, value);
                if (section === "quality" || section === "ratio") {
                    updateOpen(false);
                    buttonRef.current?.querySelector("button")?.focus();
                }
            }} /> : null}
    </>;
}

function ImageSettingsPortal({ id, buttonRect, panelRef, placement, theme, config, onConfigChange, section }: {
    id: string;
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: CanvasImageSettingsPopoverProps["placement"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    section: PopoverSection;
}) {
    const width = Math.min(section === "count" || section === "quality" ? 280 : 340, window.innerWidth - 24);
    const [panelHeight, setPanelHeight] = useState(0);
    useLayoutEffect(() => { setPanelHeight(panelRef.current?.scrollHeight || 0); }, [panelRef, section, width]);
    useEffect(() => { panelRef.current?.querySelector<HTMLElement>("button, input")?.focus(); }, [panelRef]);
    const gap = 8;
    const margin = 12;
    const above = Math.max(0, buttonRect.top - gap - margin);
    const below = Math.max(0, window.innerHeight - buttonRect.bottom - gap - margin);
    const preferTop = placement?.startsWith("top");
    const topPlacement = preferTop ? above >= panelHeight || above >= below : !(below >= panelHeight || below >= above);
    const maxHeight = Math.max(1, Math.min(window.innerHeight - margin * 2, topPlacement ? above : below));
    const height = Math.min(panelHeight, maxHeight);
    const alignRight = placement?.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    const left = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;
    const top = topPlacement ? buttonRect.top - gap - height : buttonRect.bottom + gap;
    return createPortal(<div ref={panelRef} id={id} role="dialog" aria-label={sectionLabels[section]} data-canvas-no-zoom data-canvas-shortcuts-ignore
        className="canvas-image-settings-popover thin-scrollbar"
        style={{ position: "fixed", zIndex: 1200, width, left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)), top: Math.max(margin, Math.min(window.innerHeight - height - margin, top)), maxHeight, background: theme.toolbar.panel, border: `1px solid ${theme.toolbar.border}`, borderRadius: 16, boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)", padding: 16, overflowY: "auto", color: theme.node.text }}
        onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
        <ImageSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} section={section} showTitle={false} quickCount={4} className="flex flex-col gap-5" />
    </div>, document.body);
}
