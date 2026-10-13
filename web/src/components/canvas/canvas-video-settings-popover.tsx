import { useState, type ReactNode } from "react";
import { Popover } from "antd";
import { ChevronDown } from "lucide-react";
import { isMiniMaxH3VideoConfig, normalizeMiniMaxResolutionValue, VideoSettingsPanel, videoModeLabel, videoSecondsLabel } from "@/components/video-settings-panel";
import { computeVideoSize, inferMediaRatio, parseVideoResolution } from "@/lib/media-size";
import { isSeedanceVideoConfig } from "@/lib/seedance-video";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

type Props = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    buttonClassName?: string;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
    section?: "output" | "duration" | "mode" | "extras";
    count?: number;
    onCountChange?: (count: number) => void;
};

export function CanvasVideoSettingsPopover({ config, onConfigChange, buttonClassName, placement = "topLeft", section = "output", count = 1, onCountChange }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [open, setOpen] = useState(false);
    const h3 = isMiniMaxH3VideoConfig(config);
    const seedance = isSeedanceVideoConfig(config);
    const ratio = inferMediaRatio(config.size, "16:9");
    const resolution = h3 ? normalizeMiniMaxResolutionValue(config.vquality) : parseVideoResolution(config.vquality);
    const ratios = h3 || seedance ? ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "3:2", "2:3", ...(seedance ? ["auto"] : [])] : ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "auto"];
    const modes = h3
        ? [
              ["te", "TE-Speed"],
              ["turbo", "Turbo"],
              ["spectrum", "Spectrum"],
              ["native", "原生质量"],
          ]
        : [
              ["frames", "首尾帧"],
              ["reference", "全部参考"],
          ];
    const currentMode = h3 ? config.videoH3Mode || "te" : config.videoMode || "frames";
    const modeLabel = modes.find(([value]) => value === currentMode)?.[1] || videoModeLabel(config.videoMode);
    const summary = section === "extras" ? "设置" : section === "duration" ? videoSecondsLabel(config.videoSeconds) : section === "mode" ? modeLabel : `${ratio === "auto" ? "自适应" : ratio} · ${resolution}P · ${count}`;
    const setRatio = (value: string) => onConfigChange("size", h3 || seedance ? value : computeVideoSize(resolution, value));
    const setResolution = (value: string) => {
        onConfigChange("vquality", value);
        if (h3 || seedance) {
            if (config.size.includes("x")) onConfigChange("size", ratio);
        } else onConfigChange("size", computeVideoSize(value, ratio));
    };
    const minSeconds = h3 ? 1 : 4;
    const maxSeconds = h3 || seedance ? 15 : 30;
    const seconds = Math.max(minSeconds, Math.min(maxSeconds, Math.floor(Number(config.videoSeconds) || 5)));
    const durationMarks = maxSeconds === 15 ? [minSeconds, 5, 10, 15] : [minSeconds, 10, 20, 30];
    const panel = (
        <div
            data-canvas-no-zoom
            data-canvas-shortcuts-ignore
            className={`thin-scrollbar max-h-[min(520px,65dvh)] ${section === "duration" ? "w-[368px]" : "w-[304px]"} max-w-[calc(100vw-64px)] space-y-5 overflow-y-auto p-1`}
            style={{ color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            {section === "output" ? (
                <>
                    <SettingGroup title="选择比例">
                        <div className="grid grid-cols-6 gap-0.5 rounded-xl p-0.5" style={{ background: theme.node.fill }}>
                            {ratios.map((value) => {
                                const [w, h] = value.split(":").map(Number);
                                return (
                                    <Option key={value} selected={ratio === value} onClick={() => setRatio(value)}>
                                        <span className="grid h-6 place-items-center">
                                            {value === "auto" ? <span className="text-xs">A</span> : <span className="rounded-[2px] border" style={{ width: (15 * w) / Math.max(w, h), height: (15 * h) / Math.max(w, h) }} />}
                                        </span>
                                        <span className="text-[11px]">{value === "auto" ? "自动" : value}</span>
                                    </Option>
                                );
                            })}
                        </div>
                    </SettingGroup>
                    <SettingGroup title="选择分辨率">
                        <div className="grid grid-cols-3 gap-0.5 rounded-xl p-0.5" style={{ background: theme.node.fill }}>
                            {["480", "720", "1080"].map((value) => (
                                <Option key={value} selected={resolution === value} onClick={() => setResolution(value)}>
                                    {value}P
                                </Option>
                            ))}
                        </div>
                    </SettingGroup>
                    {onCountChange ? (
                        <SettingGroup title="选择生成数量">
                            <div className="grid grid-cols-4 gap-0.5 rounded-xl p-0.5" style={{ background: theme.node.fill }}>
                                {[1, 2, 3, 4].map((value) => (
                                    <Option key={value} selected={count === value} onClick={() => onCountChange(value)}>
                                        {value}
                                    </Option>
                                ))}
                            </div>
                        </SettingGroup>
                    ) : null}
                </>
            ) : section === "extras" ? (
                <VideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} extrasOnly showTitle={false} className="space-y-4" />
            ) : section === "duration" ? (
                <SettingGroup title="选择视频生成时长">
                    <div className="flex items-start gap-6">
                        <div className="min-w-0 flex-1">
                            <div className="relative flex h-6 items-center">
                                <div className="pointer-events-none absolute inset-x-0 h-3 overflow-hidden rounded-sm" style={{ background: theme.toolbar.activeBg }}>
                                    <div className="h-full opacity-30" style={{ width: `${((seconds - minSeconds) / (maxSeconds - minSeconds)) * 100}%`, background: theme.node.text }} />
                                    {durationMarks.slice(1, -1).map((value) => <span key={value} className="absolute top-1 h-1 w-px opacity-30" style={{ left: `${((value - minSeconds) / (maxSeconds - minSeconds)) * 100}%`, background: theme.node.text }} />)}
                                </div>
                                <input
                                    aria-label="视频时长滑杆"
                                    type="range"
                                    min={minSeconds}
                                    max={maxSeconds}
                                    step={1}
                                    value={seconds}
                                    aria-valuetext={config.videoSeconds === "-1" ? "智能时长，拖动以指定秒数" : `${seconds} 秒`}
                                    className="relative m-0 h-6 w-full cursor-pointer appearance-none rounded-sm bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-1 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-current [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-1 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-current"
                                    onChange={(event) => onConfigChange("videoSeconds", event.target.value)}
                                />
                            </div>
                            <div className="relative mx-0.5 h-3 text-[10px] tabular-nums" style={{ color: theme.node.muted }}>
                                {durationMarks.map((value, index) => <span key={value} className="absolute" style={{ left: `${((value - minSeconds) / (maxSeconds - minSeconds)) * 100}%`, transform: index === 0 ? undefined : index === durationMarks.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>{value}</span>)}
                            </div>
                        </div>
                        <label className="flex h-9 w-[90px] shrink-0 items-center rounded-lg px-2 text-xs focus-within:outline-2 focus-within:outline-offset-2" style={{ background: theme.toolbar.activeBg }}>
                            <input
                                aria-label="自定义视频时长"
                                type="number"
                                min={minSeconds}
                                max={maxSeconds}
                                step={1}
                                key={config.videoSeconds}
                                defaultValue={Number(config.videoSeconds) > 0 ? config.videoSeconds : ""}
                                placeholder={seedance ? "智能" : undefined}
                                className="min-w-0 flex-1 bg-transparent outline-none tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                onBlur={(event) => {
                                    if (seedance && config.videoSeconds === "-1" && !event.target.value) return;
                                    const value = Math.max(minSeconds, Math.min(maxSeconds, Math.floor(Number(event.target.value) || 5)));
                                    event.target.value = String(value);
                                    onConfigChange("videoSeconds", String(value));
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") event.currentTarget.blur();
                                }}
                            />
                                <span style={{ color: theme.node.muted }}>s</span>
                        </label>
                    </div>
                    {seedance ? <button type="button" aria-pressed={config.videoSeconds === "-1"} onClick={() => onConfigChange("videoSeconds", "-1")} className="mt-2 rounded-md px-2 py-1 text-xs" style={{ background: config.videoSeconds === "-1" ? theme.toolbar.activeBg : "transparent" }}>智能时长</button> : null}
                </SettingGroup>
            ) : (
                <SettingGroup title={h3 ? "生成模式" : "参考模式"}>
                    <div className="grid grid-cols-2 gap-1 rounded-xl p-1" style={{ background: theme.node.fill }}>
                        {modes.map(([value, label]) => (
                            <Option
                                key={value}
                                selected={currentMode === value}
                                onClick={() => {
                                    onConfigChange(h3 ? "videoH3Mode" : "videoMode", value);
                                    setOpen(false);
                                }}
                            >
                                {label}
                            </Option>
                        ))}
                    </div>
                </SettingGroup>
            )}
        </div>
    );
    return (
        <Popover open={open} onOpenChange={setOpen} trigger="click" placement={placement} align={{ overflow: { shiftX: true, adjustY: true } }} content={panel} styles={{ container: { background: theme.toolbar.panel, borderRadius: 18, padding: 16 } }}>
            <button
                type="button"
                aria-label={section === "extras" ? "视频更多设置" : section === "output" ? "视频比例、分辨率和数量" : section === "duration" ? "视频时长" : "视频参考模式"}
                aria-expanded={open}
                className={buttonClassName || "flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs transition hover:bg-black/5 dark:hover:bg-white/10"}
                style={{ color: theme.node.text }}
            >
                <span className="truncate">{summary}</span>
                <ChevronDown className="size-3 shrink-0 opacity-60" />
            </button>
        </Popover>
    );
}

function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="text-xs opacity-50">{title}</div>
            {children}
        </div>
    );
}

function Option({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <button
            type="button"
            aria-pressed={selected}
            onClick={onClick}
            className="flex min-h-9 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-xs font-medium transition hover:opacity-75"
            style={{ background: selected ? theme.toolbar.activeBg : "transparent", boxShadow: selected ? `inset 0 0 0 1px ${theme.toolbar.border}` : undefined }}
        >
            {children}
        </button>
    );
}
