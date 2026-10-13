import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig, ReasoningEffort } from "@/stores/use-config-store";

const reasoningEffortOptions: ReasoningEffort[] = ["auto", "low", "medium", "high", "xhigh"];

type TextSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
    theme: CanvasTheme;
    className?: string;
    compact?: boolean;
};

export function TextSettingsPanel({ config, onConfigChange, theme, className = "space-y-4", compact = false }: TextSettingsPanelProps) {
    const { t } = useTranslation();
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {!compact ? <div className="text-lg font-semibold">{t("settingsPanels.text.title")}</div> : null}
                <div className="space-y-2.5">
                    <div className="text-sm font-medium" style={{ color: theme.node.muted }}>
                        {t("settingsPanels.text.reasoning")}
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                        {reasoningEffortOptions.map((value) => (
                            <OptionPill key={value} compact={compact} selected={config.reasoningEffort === value} theme={theme} onClick={() => onConfigChange("reasoningEffort", value)}>
                                {t(`settingsPanels.common.${value}`)}
                            </OptionPill>
                        ))}
                    </div>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function reasoningEffortLabel(value: ReasoningEffort) {
    return reasoningEffortOptions.includes(value) ? i18n.t(`settingsPanels.common.${value}`) : value;
}

function OptionPill({ selected, theme, onClick, children, compact = false }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode; compact?: boolean }) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            className={compact ? "h-9 rounded-lg px-2 text-xs font-medium transition hover:opacity-75" : "h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"}
            style={{ background: selected ? theme.toolbar.activeBg : compact ? theme.node.fill : "transparent", borderColor: selected ? theme.node.activeStroke : theme.node.stroke, color: selected ? theme.toolbar.activeText : theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
