import { useState, type ReactNode } from "react";
import { Button, Segmented, Select, Switch, Tooltip } from "antd";
import { ArrowUpRight, CircleDot, Keyboard, Languages, Moon, Puzzle, Square, Sun, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMatch } from "react-router-dom";

import { CanvasPluginManagerModal } from "@/components/canvas/canvas-plugin-manager-modal";
import { CanvasShortcutsDialog } from "@/components/canvas/canvas-shortcuts-dialog";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { RepositoryUpdateButton } from "@/components/layout/user-status-actions";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { useThemeStore } from "@/stores/use-theme-store";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { resolveCanvasBackgroundMode } from "@/lib/canvas-theme";
import { InfoPopover } from "@/components/ui/compact-controls";

export function ConfigAppearanceTools() {
    const { i18n, t } = useTranslation();
    const en = i18n.resolvedLanguage === "en-US";
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const [pluginsOpen, setPluginsOpen] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const canvasRoute = useMatch("/canvas/:id");
    const project = useCanvasStore((state) => state.projects.find((item) => item.id === canvasRoute?.params.id));
    const changeCanvasAppearance = (patch: Partial<Pick<CanvasProject, "backgroundMode" | "showImageInfo">>) => {
        if (project) window.dispatchEvent(new CustomEvent("canvas-appearance-change", { detail: { projectId: project.id, ...patch } }));
    };

    return (
        <div className="space-y-6">
            <section className="config-section config-surface" aria-label={en ? "Interface appearance" : "界面外观"}>
                <h2 className="config-section-heading mb-3">{en ? "Interface appearance" : "界面外观"}</h2>
                <div className="divide-y divide-border">
                    <ToolRow icon={<Sun className="size-4" />} title={en ? "Appearance" : "界面主题"} description={en ? "You can also switch themes from the canvas toolbar." : "也可以通过画布顶栏的日夜按钮快速切换。"}>
                        <Segmented aria-label={en ? "Appearance" : "界面主题"} value={theme} onChange={(value) => setTheme(value as "light" | "dark")} options={[
                            { value: "light", label: <Tooltip title={en ? "Light" : "亮色"}><span aria-label={en ? "Light" : "亮色"} className="inline-flex items-center gap-1.5 py-1.5"><Sun className="size-4" />{en ? "Light" : "亮色"}</span></Tooltip> },
                            { value: "dark", label: <Tooltip title={en ? "Dark" : "暗色"}><span aria-label={en ? "Dark" : "暗色"} className="inline-flex items-center gap-1.5 py-1.5"><Moon className="size-4" />{en ? "Dark" : "暗色"}</span></Tooltip> },
                        ]} />
                    </ToolRow>
                    <ToolRow icon={<Languages className="size-4" />} title={en ? "Language" : "界面语言"} description={en ? "Saved automatically on this browser." : "语言选择自动保存在当前浏览器。"}>
                        <Select aria-label={en ? "Language" : "界面语言"} className="w-36" value={en ? "en-US" : "zh-CN"} onChange={(value: AppLocale) => void changeAppLocale(value)} options={[{ value: "zh-CN", label: "简体中文" }, { value: "en-US", label: "English" }]} />
                    </ToolRow>
                    {project ? (
                        <section aria-label={en ? "Current canvas" : "当前画布"} className="py-4">
                            <h3 className="mb-3 break-words text-sm font-semibold">{en ? "Current canvas" : "当前画布"} · {project.title}</h3>
                            <ToolRow icon={<CircleDot className="size-4" />} title={t("canvas.toolbar.gridStyle")} description={en ? "Saved for this canvas only." : "只影响当前画布，自动保存。"}>
                                <Segmented aria-label={t("canvas.toolbar.gridStyle")} value={resolveCanvasBackgroundMode(project.backgroundMode)} onChange={(value) => changeCanvasAppearance({ backgroundMode: value as "dots" | "blank" })} options={[
                                    { value: "dots", label: <span className="inline-flex items-center gap-1.5"><CircleDot className="size-4" />{t("canvas.toolbar.dots")}</span> },
                                    { value: "blank", label: <span className="inline-flex items-center gap-1.5"><Square className="size-4" />{t("canvas.toolbar.blank")}</span> },
                                ]} />
                            </ToolRow>
                            <ToolRow icon={<Info className="size-4" />} title={t("canvas.toolbar.imageInfo")} description={en ? "Show image dimensions and file size on nodes in this canvas." : "在当前画布的图片节点上显示尺寸和文件大小。"}>
                                <Switch aria-label={t("canvas.toolbar.imageInfo")} checked={project.showImageInfo} onChange={(showImageInfo) => changeCanvasAppearance({ showImageInfo })} />
                            </ToolRow>
                        </section>
                    ) : null}
                </div>
            </section>
            <section className="config-section config-surface" aria-label={en ? "Tools & shortcuts" : "工具与快捷键"}>
                <h2 className="config-section-heading mb-3">{en ? "Tools & shortcuts" : "工具与快捷键"}</h2>
                <div className="divide-y divide-border">
                    <ToolRow icon={<Puzzle className="size-4" />} title={en ? "Plugins" : "插件管理"} description={en ? "Browse available plugins and manage installed extensions." : "查看可用插件，管理已安装的扩展。"}>
                        <Button aria-label={en ? "Manage plugins" : "管理插件"} icon={<ArrowUpRight className="size-4" />} onClick={() => setPluginsOpen(true)}>{en ? "Manage plugins" : "管理插件"}</Button>
                    </ToolRow>
                    <ToolRow icon={<Keyboard className="size-4" />} title={en ? "Keyboard shortcuts" : "键盘快捷键"} description={en ? "Canvas navigation, editing and selection shortcuts." : "查看画布导航、编辑与选择操作的快捷键。"}>
                        <Button aria-label={en ? "View shortcuts" : "查看快捷键"} icon={<ArrowUpRight className="size-4" />} onClick={() => setShortcutsOpen(true)}>{en ? "View shortcuts" : "查看快捷键"}</Button>
                    </ToolRow>
                </div>
            </section>
            <section className="config-section config-surface" aria-label={en ? "Version & updates" : "版本与更新"}>
                <h2 className="config-section-heading mb-3">{en ? "Version & updates" : "版本与更新"}</h2>
                <ToolRow icon={<Info className="size-4" />} title={en ? "Version & release notes" : "版本与更新记录"} description={en ? "View the current version and release notes." : "查看当前版本及更新内容。"}>
                    <div className="flex flex-wrap items-center gap-2">
                        <VersionReleaseModal className="rounded-lg border border-border px-3 py-1.5 text-sm text-accent-foreground transition hover:bg-accent" />
                        <RepositoryUpdateButton className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-sm transition hover:bg-accent disabled:opacity-50" />
                    </div>
                </ToolRow>
            </section>
            <CanvasPluginManagerModal open={pluginsOpen} onClose={() => setPluginsOpen(false)} />
            <CanvasShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </div>
    );
}

function ToolRow({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
    return (
        <section className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-1">
            <div className="min-w-0 w-full sm:w-auto sm:flex-1">
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{icon}</span>
                    <h3 className="text-sm font-semibold">{title}</h3>
                    <InfoPopover label={title}>{description}</InfoPopover>
                </div>
                <p className="config-section-description mt-1 pl-6">{description}</p>
            </div>
            <div className="shrink-0">{children}</div>
        </section>
    );
}
