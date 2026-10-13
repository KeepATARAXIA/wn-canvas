import { Bot, LayoutGrid, Menu, Settings2 } from "lucide-react";
import { Button, Popover, Tooltip } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function AppTopNav() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    const headerRef = useRef<HTMLElement>(null);
    const [compact, setCompact] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname === "/" ? "canvas" : pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;
    useEffect(() => {
        if (!headerRef.current) return;
        const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 900));
        observer.observe(headerRef.current);
        return () => observer.disconnect();
    }, [hideHeader]);

    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    return (
        <>
            {!hideHeader ? (
                <header ref={headerRef} className="workspace-top-nav sticky top-0 z-20 h-14 shrink-0 border-b" style={{ background: theme.node.panel, borderColor: theme.node.stroke }}>
                    <div className="mx-auto flex h-full max-w-[1328px] items-stretch justify-between gap-3 px-4 sm:px-6">
                        <div className="flex min-w-0 items-center">
                            <Link to="/" style={{ color: theme.node.text }} className="flex h-full shrink-0 items-center gap-2 text-sm font-semibold leading-none tracking-tight transition hover:opacity-75">
                                <LayoutGrid aria-hidden="true" className="size-6 shrink-0" />
                                <span className="text-base font-medium">{t("meta.title")}</span>
                            </Link>

                            <button
                                type="button"
                                className={`${compact ? "inline-flex" : "hidden"} ml-3 size-8 shrink-0 items-center justify-center text-slate-600 transition hover:text-slate-950 dark:text-stone-300 dark:hover:text-white`}
                                onClick={() => setMobileNavOpen(true)}
                                aria-label={t("topNav.openMenu")}
                                title={t("topNav.menu")}
                            >
                                <Menu className="size-5" />
                            </button>

                            <nav className={`${compact ? "hidden" : "flex"} hide-scrollbar ml-8 h-14 min-w-0 items-center gap-6 overflow-x-auto`}>
                                {navigationTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={`/${tool.slug}`}
                                            style={active ? { color: theme.toolbar.activeText } : undefined}
                                            className={cn(
                                                "relative flex h-14 shrink-0 items-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px",
                                                active
                                                    ? "font-medium text-blue-600 after:bg-blue-600 dark:text-stone-100 dark:after:bg-stone-100"
                                                    : "workspace-muted after:bg-transparent",
                                            )}
                                        >
                                            <Icon className="size-4" />
                                            <span className="truncate">{t(`navigation.${tool.slug}`)}</span>
                                        </Link>
                                    );
                                })}
                            </nav>
                        </div>

                        <div className="my-auto flex h-9 min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap">
                            <Tooltip title={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")}>
                                <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<Bot className="size-4" />} onClick={togglePanel} aria-label={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")} />
                            </Tooltip>
                            {compact ? <Popover trigger="click" placement="bottomRight" content={<UserStatusActions />}><Button type="text" icon={<Settings2 className="size-4" />} aria-label="设置与外观" /></Popover> : <UserStatusActions />}
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}
