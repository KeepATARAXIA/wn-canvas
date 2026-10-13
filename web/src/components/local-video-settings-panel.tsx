import { useEffect, useState, type ReactNode } from "react";
import { Switch } from "antd";
import { useTranslation } from "react-i18next";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import i18n from "@/i18n";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { boolConfig, isSeedanceVideoConfig } from "@/lib/seedance-video";
import { modelOptionName, resolveModelRequestConfig, withLocalProxy, type AiConfig } from "@/stores/use-config-store";

import { h3VideoDimensions, normalizeH3Resolution } from "@/lib/h3-video-size";

const ratioOptions = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] as const;
const secondOptions = [5, 10, 15] as const;

export const videoSizeOptions = ratioOptions.map((value) => ({ value, label: value }));
export const videoSecondOptions = secondOptions.map(String);

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoH3SageAttention" | "videoH3TeSpeed" | "videoH3Mode", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    extrasOnly?: boolean;
    section?: "all" | "basic" | "advanced";
};

export function LocalVideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", extrasOnly = false, section = "all" }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    extrasOnly = extrasOnly || section === "advanced";
    const miniMaxH3 = isMiniMaxH3VideoConfig(config);
    const seedance = isSeedanceVideoConfig(config);
    const seconds = config.videoSeconds || "5";
    const maxSeconds = miniMaxH3 ? 15 : 20;
    const size = normalizeVideoSizeValue(config.size);
    const resolution = normalizeMiniMaxResolutionValue(config.vquality);
    const previewMegapixels = 0.9;
    const dimensions = miniMaxH3 ? h3VideoDimensions(size, resolution) : readSizeDimensions(size, previewMegapixels);
    const generateAudio = boolConfig(config.videoGenerateAudio, true);
    const watermark = boolConfig(config.videoWatermark, false);
    const sageAttention = boolConfig(config.videoH3SageAttention, true);
    const teSpeed = boolConfig(config.videoH3TeSpeed, true);
    const comfyUrl = miniMaxH3 ? resolveModelRequestConfig(config, config.model || config.videoModel).baseUrl.replace(/\/+$/, "") : "";
    const sageUrl = comfyUrl && section !== "basic" ? withLocalProxy(`${comfyUrl}/object_info/MiniMaxH3MemoryEfficientSageAttentionPatch`) : "";
    const [sageCapability, setSageCapability] = useState<{ url: string; status: "available" | "missing" | "offline" } | null>(null);
    const sageStatus = sageCapability?.url === sageUrl ? sageCapability.status : "checking";
    useEffect(() => {
        if (!sageUrl) return;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        let active = true;
        fetch(sageUrl, { signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const info = await response.json();
                if (active) setSageCapability({ url: sageUrl, status: info.MiniMaxH3MemoryEfficientSageAttentionPatch ? "available" : "missing" });
            })
            .catch(() => { if (active) setSageCapability({ url: sageUrl, status: "offline" }); })
            .finally(() => clearTimeout(timeout));
        return () => { active = false; clearTimeout(timeout); controller.abort(); };
    }, [sageUrl]);
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                {miniMaxH3 && !extrasOnly ? (
                    <SettingGroup title={t("settingsPanels.video.megapixels")} color={theme.node.muted}>
                        <div className="grid grid-cols-3 gap-2">{["480", "720", "1080"].map((value) => <OptionPill key={value} selected={resolution === value} theme={theme} onClick={() => { onConfigChange("vquality", value); if (size.includes("x")) onConfigChange("size", ratioValue(size)); }}>{value}p</OptionPill>)}</div>
                        <div className="text-[11px]" style={{ color: theme.node.muted }}>按短边选择清晰度，最终输出尺寸以 W × H 为准</div>
                    </SettingGroup>
                ) : null}

                <SettingGroup title={extrasOnly ? "自定义尺寸" : t("settingsPanels.video.size")} color={theme.node.muted}>
                    {section !== "basic" ? <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} theme={theme} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} theme={theme} onChange={(value) => updateDimension("height", value)} />
                    </div> : null}
                    {!extrasOnly ? <div className="grid grid-cols-4 gap-2.5">
                        {ratioOptions.map((value) => {
                            const optionDimensions = miniMaxH3 ? h3VideoDimensions(value, resolution) : dimensionsForRatio(value, previewMegapixels);
                            return (
                                <button
                                    key={value}
                                    type="button"
                                    aria-pressed={size === value}
                                    className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                    style={{ borderColor: size === value ? theme.node.activeStroke : theme.node.stroke, background: size === value ? theme.toolbar.activeBg : "transparent", color: size === value ? theme.toolbar.activeText : theme.node.text }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={() => onConfigChange("size", value)}
                                >
                                    <SizePreview width={optionDimensions.width} height={optionDimensions.height} color="currentColor" />
                                    <span>{value}</span>
                                    {miniMaxH3 ? <span className="text-[9px] leading-none opacity-55">{optionDimensions.width}×{optionDimensions.height}</span> : null}
                                </button>
                            );
                        })}
                    </div> : null}
                </SettingGroup>

                {!extrasOnly ? <SettingGroup title={t("settingsPanels.video.duration")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {secondOptions.map((value) => (
                            <OptionPill key={value} selected={seconds === String(value)} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value}s
                            </OptionPill>
                        ))}
                    </div>
                    <NumberSettingInput label={t("settingsPanels.video.customDuration")} value={seconds} min={1} max={maxSeconds} step={1} suffix="s" theme={theme} normalize={(value) => normalizeIntegerValue(value, 1, maxSeconds)} onChange={(value) => onConfigChange("videoSeconds", value)} />
                    <div className="text-[11px]" style={{ color: theme.node.muted }}>{t("settingsPanels.video.customDurationHint", { max: maxSeconds })}</div>
                </SettingGroup> : null}

                {miniMaxH3 && section !== "basic" ? (
                    <SettingGroup title={t("settingsPanels.video.accelerators")} color={theme.node.muted}>
                        {!extrasOnly || section === "advanced" ? <div className="grid grid-cols-2 gap-2">{[["te", "TE-Speed"], ["turbo", "Turbo 加速"], ["spectrum", "Spectrum"], ["native", "原生质量"]].map(([value, label]) => <OptionPill key={value} selected={(config.videoH3Mode || "te") === value} theme={theme} onClick={() => onConfigChange("videoH3Mode", value)}>{label}</OptionPill>)}</div> : null}
                        <div className="text-[11px]" style={{color:theme.node.muted}}>Turbo：文生、首尾帧 8 步；多参考 4 步。1–2 张图按首尾帧使用，更多图片使用参考模型。TE 开关仅在 TE-Speed 模式生效。</div>
                        {section === "all" ? <div className="flex flex-wrap gap-4 text-xs">
                            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("canvas-video-tools", { detail: "continuum" }))} className="underline">长视频续生成</button>
                            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("canvas-video-tools", { detail: "handtie" }))} className="underline">角色与音轨串联</button>
                        </div> : null}
                        <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                            <SwitchRow label={t("settingsPanels.video.sageAttention")} checked={sageAttention} disabled={!sageAttention && sageStatus !== "available"} theme={theme} onChange={(checked) => onConfigChange("videoH3SageAttention", String(checked))} />
                            <SwitchRow label={t("settingsPanels.video.teSpeed")} checked={teSpeed} theme={theme} onChange={(checked) => onConfigChange("videoH3TeSpeed", String(checked))} />
                        </div>
                        {sageStatus !== "available" ? <div role="status" className="text-[11px]" style={{ color: theme.node.muted }}>{sageStatus === "checking" ? "正在检查 SageAttention…" : sageStatus === "missing" ? `当前后端未安装适配的 SageAttention 节点${sageAttention ? "，请先关闭此开关" : "，可使用 Turbo 加速"}。` : "暂时无法检查 SageAttention，请确认 ComfyUI 已连接后重新打开设置。"}</div> : null}
                        <div className="text-[11px]" style={{ color: theme.node.muted }}>{t("settingsPanels.video.acceleratorHint")}</div>
                    </SettingGroup>
                ) : null}

                {seedance && section !== "basic" ? (
                    <SettingGroup title={t("settingsPanels.video.output")} color={theme.node.muted}>
                        <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                            <SwitchRow label={t("settingsPanels.video.generateAudio")} checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                            <SwitchRow label={t("settingsPanels.video.watermark")} checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                        </div>
                    </SettingGroup>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function isMiniMaxH3VideoConfig(config: Pick<AiConfig, "model" | "videoModel">) {
    return /minimax[\s_-]*h3/i.test(modelOptionName(config.model || config.videoModel));
}

export function videoResolutionLabel(value: string, config?: Pick<AiConfig, "model" | "videoModel">) {
    return config && isMiniMaxH3VideoConfig(config) ? `${normalizeMiniMaxResolutionValue(value)}p` : `${normalizeVideoResolutionValue(value)}p`;
}

export function videoSizeLabel(value: string) {
    if (ratioOptions.includes(value as (typeof ratioOptions)[number])) return value;
    if (/^\d+x\d+$/i.test(value || "")) return value.toLowerCase();
    return "16:9";
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    return `${value || "5"}s`;
}

export function normalizeVideoSizeValue(value: string) {
    if (ratioOptions.includes(value as (typeof ratioOptions)[number])) return value;
    if (/^\d+x\d+$/i.test(value || "")) return value.toLowerCase();
    return "16:9";
}

export function normalizeVideoResolutionValue(value: string) {
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium" || value === "0.4" || value === "0.9") return "720";
    return value.replace(/p$/i, "") || "720";
}

export function normalizeMiniMaxResolutionValue(value: string) { return normalizeH3Resolution(value); }

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" aria-pressed={selected} disabled={disabled} className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: selected ? theme.toolbar.activeBg : "transparent", borderColor: selected ? theme.node.activeStroke : theme.node.stroke, color: selected ? theme.toolbar.activeText : theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function DimensionInput({ prefix, value, theme, onChange }: { prefix: string; value: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    const [draft, setDraft] = useState(String(value));
    useEffect(() => setDraft(String(value)), [value]);
    const commit = () => { onChange(Number(draft) || value); setDraft(String(value)); };
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function NumberSettingInput({ label, value, min, max, step, suffix, theme, normalize, onChange }: { label: string; value: string; min: number; max: number; step: number; suffix: string; theme: CanvasTheme; normalize: (value: string) => string; onChange: (value: string) => void }) {
    const [draft, setDraft] = useState(value);
    const [editing, setEditing] = useState(false);

    useEffect(() => {
        if (!editing) setDraft(value);
    }, [editing, value]);

    const commit = () => {
        const next = normalize(draft);
        setDraft(next);
        setEditing(false);
        onChange(next);
    };

    return (
        <label className="flex h-10 items-center gap-3 rounded-xl border px-3" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <span className="shrink-0 text-sm font-medium">{label}</span>
            <input
                type="number"
                min={min}
                max={max}
                step={step}
                inputMode={step < 1 ? "decimal" : "numeric"}
                aria-label={label}
                className="min-w-0 flex-1 bg-transparent text-right text-sm font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={draft}
                onFocus={() => setEditing(true)}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                onMouseDown={(event) => event.stopPropagation()}
            />
            <span className="text-xs" style={{ color: theme.node.muted }}>{suffix}</span>
        </label>
    );
}

function normalizeIntegerValue(value: string, min: number, max: number) {
    return String(Math.max(min, Math.min(max, Math.floor(Number(value) || min))));
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function SwitchRow({ label, checked, disabled = false, theme, onChange }: { label: string; checked: boolean; disabled?: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-sm" style={{ color: theme.node.text }}>{label}</span>
            <span onMouseDown={(event) => event.stopPropagation()}><Switch aria-label={label} size="small" checked={checked} disabled={disabled} onChange={onChange} /></span>
        </div>
    );
}

function readSizeDimensions(size: string, megapixels: number) {
    const match = size.match(/^(\d+)x(\d+)$/i);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
    return dimensionsForRatio(ratioValue(size), megapixels);
}

function ratioValue(value: string) {
    if (ratioOptions.includes(value as (typeof ratioOptions)[number])) return value as (typeof ratioOptions)[number];
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return "16:9" as const;
    const actual = Number(match[1]) / Number(match[2]);
    return ratioOptions.reduce((best, item) => Math.abs(readRatio(item) - actual) < Math.abs(readRatio(best) - actual) ? item : best, ratioOptions[0]);
}

function dimensionsForRatio(ratio: string, megapixels: number) {
    const value = readRatio(ratio);
    const pixels = Math.max(0.01, megapixels) * 1_000_000;
    const width = Math.ceil(Math.sqrt(pixels * value) / 32) * 32;
    const height = Math.ceil(Math.sqrt(pixels / value) / 32) * 32;
    return { width, height };
}

function readRatio(ratio: string) {
    const [width, height] = ratio.split(":").map(Number);
    return width > 0 && height > 0 ? width / height : 16 / 9;
}
