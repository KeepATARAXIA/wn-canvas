import type { ReactNode } from "react";
import { Dropdown, Tooltip } from "antd";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";

type TabItem<T> = { value: T; label: string; icon?: ReactNode; count?: number };

export function AgentPanelTabs<T extends string>({ value, items, moreItems = [], theme, leading, right, onChange }: { value: T; items: TabItem<T>[]; moreItems?: TabItem<T>[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; leading?: ReactNode; right?: ReactNode; onChange: (value: T) => void }) {
    const { t, i18n } = useTranslation();
    const moreLabel = i18n.resolvedLanguage === "en-US" ? "More" : "更多";
    const activeMore = moreItems.find((item) => item.value === value);
    return (
        <div className="@container shrink-0 border-b px-2" style={{ borderColor: theme.node.stroke }}>
            <div className="flex h-11 items-center justify-between gap-1">
                {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
                {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
            </div>
            <div className="flex items-center gap-1">
                <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-xs" role="tablist" aria-label={t("agent.panel.content")}>
                    {items.map((item) => (
                        <Tooltip key={item.value} title={`${item.label}${item.count ? ` ${item.count}` : ""}`} placement="bottom">
                            <button type="button" role="tab" aria-label={`${item.label}${item.count ? ` ${item.count}` : ""}`} aria-selected={value === item.value} className={`inline-flex h-10 min-w-0 flex-1 shrink-0 items-center justify-center gap-1 whitespace-nowrap border-b-2 px-2 transition ${value === item.value ? "font-medium" : "font-normal"}`} style={{ borderColor: value === item.value ? theme.toolbar.activeText : "transparent", color: value === item.value ? theme.toolbar.activeText : theme.node.muted, background: value === item.value ? theme.toolbar.activeBg : undefined }} onClick={() => onChange(item.value)}>
                                {item.icon ? <span className="agent-panel-tab-icon">{item.icon}</span> : null}
                                <span>{item.label}</span>
                            </button>
                        </Tooltip>
                    ))}
                </nav>
                {moreItems.length ? <Dropdown trigger={["click"]} menu={{ selectedKeys: [value], items: moreItems.map((item) => ({ key: item.value, icon: item.icon, label: `${item.label}${item.count ? ` (${item.count})` : ""}`, onClick: () => onChange(item.value) })) }}>
                    <button type="button" aria-label={moreLabel} className="flex h-10 shrink-0 items-center gap-1 border-b-2 px-2 text-xs" style={{ color: activeMore ? theme.toolbar.activeText : theme.node.muted, borderColor: activeMore ? theme.toolbar.activeText : "transparent" }}><MoreHorizontal className="size-3.5" />{activeMore?.label || moreLabel}</button>
                </Dropdown> : null}
            </div>
        </div>
    );
}
